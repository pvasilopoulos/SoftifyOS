import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { upsertBin } from "@/modules/inventory/warehouse";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  id: z.string().min(1).optional(),
  siteId: z.string().min(1),
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  zone: z.string().trim().max(40).optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const siteId =
      new URL(request.url).searchParams.get("siteId") ?? undefined;
    const items = await prisma.stockBin.findMany({
      where: {
        tenantId: session.tenantId,
        ...(siteId ? { siteId } : {}),
      },
      orderBy: [{ siteId: "asc" }, { code: "asc" }],
      include: { site: { select: { code: true, name: true } } },
    });
    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
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
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = upsertSchema.parse(await request.json());
    const site = await prisma.site.findFirst({
      where: { id: body.siteId, tenantId: session.tenantId },
    });
    if (!site) {
      return NextResponse.json({ error: "Μη έγκυρη αποθήκη" }, { status: 400 });
    }

    let item;
    if (body.id) {
      item = await prisma.stockBin.updateMany({
        where: { id: body.id, tenantId: session.tenantId },
        data: {
          code: body.code,
          name: body.name,
          zone: body.zone ?? null,
          siteId: body.siteId,
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        },
      });
      const row = await prisma.stockBin.findFirst({
        where: { id: body.id, tenantId: session.tenantId },
      });
      if (!row) {
        return NextResponse.json({ error: "Το bin δεν βρέθηκε" }, { status: 404 });
      }
      item = row;
    } else {
      item = await upsertBin(prisma, {
        tenantId: session.tenantId,
        siteId: body.siteId,
        code: body.code,
        name: body.name,
        zone: body.zone,
      });
    }

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: body.id ? "stock_bin.update" : "stock_bin.create",
      entity: "stock_bin",
      entityId: item.id,
    });
    return NextResponse.json({ item }, { status: body.id ? 200 : 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός bin υπάρχει ήδη" }, { status: 409 });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const bin = await prisma.stockBin.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!bin) {
      return NextResponse.json({ error: "Το bin δεν βρέθηκε" }, { status: 404 });
    }
    const bal = await prisma.stockBalance.count({
      where: { binId: id, qtyOnHand: { not: 0 } },
    });
    if (bal > 0) {
      await prisma.stockBin.update({
        where: { id },
        data: { isActive: false },
      });
      return NextResponse.json({ item: { id, deactivated: true } });
    }
    await prisma.stockBin.delete({ where: { id } });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "stock_bin.delete",
      entity: "stock_bin",
      entityId: id,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
