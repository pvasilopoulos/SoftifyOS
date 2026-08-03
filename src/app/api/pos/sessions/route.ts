import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  posSessionCloseSchema,
  posSessionOpenSchema,
} from "@/modules/pos/schemas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const siteId = request.nextUrl.searchParams.get("siteId") || undefined;
    const items = await prisma.posSession.findMany({
      where: {
        tenantId: session.tenantId,
        siteId,
        status: "OPEN",
      },
      orderBy: { openedAt: "desc" },
      include: {
        site: { select: { id: true, code: true, name: true, kind: true } },
      },
      take: 20,
    });
    return NextResponse.json({
      items: items.map((s) => ({
        ...s,
        openingFloat: toNumber(s.openingFloat),
        closingCash: s.closingCash != null ? toNumber(s.closingCash) : null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = posSessionOpenSchema.parse(await request.json());
    const site = await prisma.site.findFirst({
      where: { id: body.siteId, tenantId: session.tenantId, isActive: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Μη έγκυρο ταμείο" }, { status: 400 });
    }

    const existing = await prisma.posSession.findFirst({
      where: {
        tenantId: session.tenantId,
        siteId: site.id,
        status: "OPEN",
      },
    });
    if (existing) {
      return NextResponse.json(
        {
          error: "Υπάρχει ήδη ανοιχτή βάρδια σε αυτό το ταμείο",
          item: {
            ...existing,
            openingFloat: toNumber(existing.openingFloat),
          },
        },
        { status: 409 },
      );
    }

    const created = await prisma.posSession.create({
      data: {
        tenantId: session.tenantId,
        siteId: site.id,
        openedByUserId: session.sub,
        openingFloat: body.openingFloat ?? 0,
        notes: body.notes || null,
      },
      include: { site: { select: { code: true, name: true } } },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "pos.session.open",
      entity: "pos_session",
      entityId: created.id,
      meta: { siteId: site.id, siteCode: site.code },
    });

    return NextResponse.json(
      {
        item: {
          ...created,
          openingFloat: toNumber(created.openingFloat),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Open session failed") },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const json = (await request.json()) as { id?: string } & Record<string, unknown>;
    const id = String(json.id || "");
    if (!id) {
      return NextResponse.json({ error: "Λείπει id βάρδιας" }, { status: 400 });
    }
    const body = posSessionCloseSchema.parse(json);
    const existing = await prisma.posSession.findFirst({
      where: { id, tenantId: session.tenantId, status: "OPEN" },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε ανοιχτή βάρδια" }, { status: 404 });
    }

    const closed = await prisma.posSession.update({
      where: { id: existing.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closingCash: body.closingCash,
        notes: body.notes ?? existing.notes,
      },
    });

    const { buildPosSessionZReport } = await import("@/modules/pos/z-report");
    const zReport = await buildPosSessionZReport(prisma, {
      tenantId: session.tenantId,
      sessionId: closed.id,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "pos.session.close",
      entity: "pos_session",
      entityId: closed.id,
      meta: {
        closingCash: body.closingCash,
        expectedCash: zReport?.expectedCash,
        cashVariance: zReport?.cashVariance,
      },
    });

    return NextResponse.json({
      item: {
        ...closed,
        openingFloat: toNumber(closed.openingFloat),
        closingCash: closed.closingCash != null ? toNumber(closed.closingCash) : null,
      },
      zReport,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Close session failed") },
      { status: 500 },
    );
  }
}
