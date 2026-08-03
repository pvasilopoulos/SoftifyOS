import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const STATUSES = [
  "PENDING",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "CANCELLED",
] as const;

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const sp = request.nextUrl.searchParams;
    const status = sp.get("status") || undefined;
    const entityType = sp.get("entityType") || undefined;
    const q = (sp.get("q") || "").trim();
    const from = sp.get("from");
    const to = sp.get("to");
    const takeRaw = Number(sp.get("take") || "200");
    const take = Number.isFinite(takeRaw)
      ? Math.min(Math.max(1, takeRaw), 500)
      : 200;

    const createdAt: Prisma.DateTimeFilter = {};
    if (from) {
      const d = new Date(from);
      if (!Number.isNaN(d.getTime())) createdAt.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAt.lte = d;
      }
    }

    const where: Prisma.MyDataSubmissionWhereInput = {
      tenantId: session.tenantId,
      ...(status && (STATUSES as readonly string[]).includes(status)
        ? { status: status as (typeof STATUSES)[number] }
        : {}),
      ...(entityType ? { entityType } : {}),
      ...(Object.keys(createdAt).length ? { createdAt } : {}),
      ...(q
        ? {
            OR: [
              { entityNumber: { contains: q, mode: "insensitive" } },
              { mark: { contains: q, mode: "insensitive" } },
              { uid: { contains: q, mode: "insensitive" } },
              { invoiceType: { contains: q, mode: "insensitive" } },
              { entityType: { contains: q, mode: "insensitive" } },
              { errorMessage: { contains: q, mode: "insensitive" } },
              { entityId: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, counts] = await Promise.all([
      prisma.myDataSubmission.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        take,
      }),
      prisma.myDataSubmission.groupBy({
        by: ["status"],
        where: { tenantId: session.tenantId },
        _count: { _all: true },
      }),
    ]);

    const byStatus = Object.fromEntries(
      counts.map((c) => [c.status, c._count._all]),
    ) as Record<string, number>;

    return NextResponse.json({
      items: items.map((s) => ({
        id: s.id,
        entityType: s.entityType,
        entityId: s.entityId,
        entityNumber: s.entityNumber,
        invoiceType: s.invoiceType,
        vatCategory: s.vatCategory,
        status: s.status,
        mark: s.mark,
        uid: s.uid,
        errorMessage: s.errorMessage,
        attempts: s.attempts,
        lastAttemptAt: s.lastAttemptAt?.toISOString() ?? null,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        response: s.response,
      })),
      counts: {
        PENDING: byStatus.PENDING ?? 0,
        SENT: byStatus.SENT ?? 0,
        ACCEPTED: byStatus.ACCEPTED ?? 0,
        REJECTED: byStatus.REJECTED ?? 0,
        CANCELLED: byStatus.CANCELLED ?? 0,
        total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}
