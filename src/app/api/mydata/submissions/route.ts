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

/** Enqueue (or return existing) myDATA row for an already-issued document. */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json().catch(() => ({}))) as {
      entityType?: string;
      entityId?: string;
    };
    const entityType = body.entityType?.trim();
    const entityId = body.entityId?.trim();
    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: "Απαιτούνται entityType και entityId" },
        { status: 400 },
      );
    }

    if (entityType === "invoice") {
      const invoice = await prisma.invoice.findFirst({
        where: { id: entityId, tenantId: session.tenantId },
        include: {
          series: {
            select: {
              myDataEnabled: true,
              myDataInvoiceType: true,
              myDataVatCategory: true,
            },
          },
        },
      });
      if (!invoice) {
        return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
      }
      if (invoice.status === "DRAFT" || invoice.status === "CANCELLED") {
        return NextResponse.json(
          {
            error:
              "Η ουρά myDATA ανοίγει μόνο για εκδομένα παραστατικά (όχι DRAFT/CANCELLED)",
          },
          { status: 400 },
        );
      }
      if (!invoice.series?.myDataEnabled) {
        return NextResponse.json(
          { error: "Η σειρά δεν έχει ενεργό myDATA" },
          { status: 400 },
        );
      }
      const { enqueueMyDataSubmission } = await import(
        "@/modules/mydata/service"
      );
      const { toNumber } = await import("@/modules/sales/invoice-utils");
      const sub = await enqueueMyDataSubmission(prisma, {
        tenantId: session.tenantId,
        entityType: "invoice",
        entityId: invoice.id,
        entityNumber: invoice.number,
        invoiceType: invoice.series.myDataInvoiceType,
        vatCategory: invoice.series.myDataVatCategory,
        payload: {
          number: invoice.number,
          kind: invoice.kind,
          total: toNumber(invoice.total),
          source: "mydata.enqueue",
        },
      });
      return NextResponse.json(
        {
          item: {
            ...sub,
            lastAttemptAt: sub.lastAttemptAt?.toISOString() ?? null,
            createdAt: sub.createdAt.toISOString(),
            updatedAt: sub.updatedAt.toISOString(),
          },
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      { error: `Μη υποστηριζόμενο entityType=${entityType}` },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Enqueue failed") },
      { status: 500 },
    );
  }
}
