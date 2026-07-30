import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/shared/lib/cursor";
import { getErrorMessage } from "@/shared/lib/safe";
import { calcInvoiceTotals, toNumber } from "@/modules/sales/invoice-utils";
import { invoiceCreateSchema } from "@/modules/sales/schemas";
import { syncOverdueInvoices } from "@/modules/sales/overdue";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";

export const dynamic = "force-dynamic";

const listSchema = listQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z
    .enum(["DRAFT", "ISSUED", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"])
    .optional(),
  tab: z
    .enum(["all", "pending", "issued", "overdue", "paid", "draft"])
    .optional(),
  customerId: z.string().min(1).optional(),
});

async function nextInvoiceNumberFallback(tenantId: string) {
  const year = new Date().getFullYear();
  const prefix = `ΤΙΜ-${year}-`;
  const latest = await prisma.invoice.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = latest?.number?.slice(prefix.length) ?? "0";
  const seq = Number.parseInt(lastSeq, 10);
  const next = Number.isFinite(seq) ? seq + 1 : 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

function parseDueAt(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await syncOverdueInvoices(session.tenantId);

    const parsed = listSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { limit, cursor: cursorParam, q, status, tab, customerId } =
      parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const statusFilter = status
      ? Prisma.sql`AND i.status = ${status}::"InvoiceStatus"`
      : tab === "draft"
        ? Prisma.sql`AND i.status = 'DRAFT'::"InvoiceStatus"`
        : tab === "paid"
          ? Prisma.sql`AND i.status = 'PAID'::"InvoiceStatus"`
          : tab === "overdue"
            ? Prisma.sql`AND i.status = 'OVERDUE'::"InvoiceStatus"`
            : tab === "issued"
              ? Prisma.sql`AND i.status = 'ISSUED'::"InvoiceStatus"`
              : tab === "pending"
                ? Prisma.sql`AND i.status IN ('ISSUED'::"InvoiceStatus", 'PARTIAL'::"InvoiceStatus", 'OVERDUE'::"InvoiceStatus")`
                : Prisma.empty;

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        issuedAt: Date | null;
        dueAt: Date | null;
        total: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        createdAt: Date;
        customerId: string;
        customerName: string;
        customerCode: string;
        branchName: string | null;
        spaceName: string | null;
      }>
    >`
      SELECT
        i.id, i.number, i.status, i."issuedAt", i."dueAt",
        i.total, i."paidAmount", i."createdAt",
        i."customerId", c.name AS "customerName", c.code AS "customerCode",
        b.name AS "branchName", s.name AS "spaceName"
      FROM invoices i
      JOIN customers c ON c.id = i."customerId"
      LEFT JOIN branches b ON b.id = i."branchId"
      LEFT JOIN spaces s ON s.id = i."spaceId"
      WHERE i."tenantId" = ${session.tenantId}
        ${statusFilter}
        ${customerId ? Prisma.sql`AND i."customerId" = ${customerId}` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                i.number ILIKE ${"%" + q + "%"}
                OR c.name ILIKE ${"%" + q + "%"}
                OR c.code ILIKE ${"%" + q + "%"}
              )`
            : Prisma.empty
        }
        ${
          cursor
            ? Prisma.sql`AND (i."createdAt", i.id) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY i."createdAt" DESC, i.id DESC
      LIMIT ${limit + 1}
    `;

    const counts = await prisma.$queryRaw<
      Array<{
        all: bigint;
        draft: bigint;
        pending: bigint;
        issued: bigint;
        overdue: bigint;
        paid: bigint;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS all,
        COUNT(*) FILTER (WHERE status = 'DRAFT')::bigint AS draft,
        COUNT(*) FILTER (WHERE status IN ('ISSUED','PARTIAL','OVERDUE'))::bigint AS pending,
        COUNT(*) FILTER (WHERE status = 'ISSUED')::bigint AS issued,
        COUNT(*) FILTER (WHERE status = 'OVERDUE')::bigint AS overdue,
        COUNT(*) FILTER (WHERE status = 'PAID')::bigint AS paid
      FROM invoices
      WHERE "tenantId" = ${session.tenantId}
    `;

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => {
      const total = toNumber(row.total);
      const paidAmount = toNumber(row.paidAmount);
      return {
        id: row.id,
        number: row.number,
        status: row.status,
        issuedAt: row.issuedAt?.toISOString() ?? null,
        dueAt: row.dueAt?.toISOString() ?? null,
        total,
        paidAmount,
        createdAt: row.createdAt.toISOString(),
        customerId: row.customerId,
        customerName: row.customerName,
        customerCode: row.customerCode,
        branchName: row.branchName,
        spaceName: row.spaceName,
      };
    });
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    const c = counts[0];
    return NextResponse.json({
      items,
      nextCursor,
      counts: {
        all: Number(c?.all ?? 0),
        draft: Number(c?.draft ?? 0),
        pending: Number(c?.pending ?? 0),
        issued: Number(c?.issued ?? 0),
        overdue: Number(c?.overdue ?? 0),
        paid: Number(c?.paid ?? 0),
      },
      meta: { ms: Date.now() - started, count: items.length, hasMore },
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

    const body = invoiceCreateSchema.parse(await request.json());
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json(
        { error: "Ο πελάτης δεν βρέθηκε" },
        { status: 400 },
      );
    }

    let spaceId: string | null = body.spaceId || null;
    const branchId: string | null = body.branchId || null;

    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: branchId,
          tenantId: session.tenantId,
          customerId: customer.id,
        },
        select: { id: true },
      });
      if (!branch) {
        return NextResponse.json(
          { error: "Το υποκατάστημα δεν ανήκει στον πελάτη" },
          { status: 400 },
        );
      }
    } else {
      spaceId = null;
    }

    if (spaceId) {
      if (!branchId) {
        return NextResponse.json(
          { error: "Επιλέξτε υποκατάστημα για τον χώρο" },
          { status: 400 },
        );
      }
      const space = await prisma.space.findFirst({
        where: {
          id: spaceId,
          tenantId: session.tenantId,
          branchId,
        },
        select: { id: true },
      });
      if (!space) {
        return NextResponse.json(
          { error: "Ο χώρος δεν ανήκει στο υποκατάστημα" },
          { status: 400 },
        );
      }
    }

    const totals = calcInvoiceTotals(body.lines);
    const status = body.status ?? "DRAFT";
    const issuedAt = status === "ISSUED" ? new Date() : null;
    const dueAt = parseDueAt(body.dueAt ?? null);

    const series =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              kind: "SALES_INVOICE",
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(prisma, session.tenantId, "SALES_INVOICE"));

    const invoice = await prisma.$transaction(async (tx) => {
      let number = body.number?.trim() || "";
      let seriesId: string | null = series?.id ?? null;
      let siteId: string | null = series?.siteId ?? null;
      if (!number) {
        if (series) {
          const allocated = await allocateFromSeries(tx, {
            tenantId: session.tenantId,
            seriesId: series.id,
            kind: "SALES_INVOICE",
          });
          number = allocated.number;
          seriesId = allocated.seriesId;
          siteId = allocated.siteId;
        } else {
          number = await nextInvoiceNumberFallback(session.tenantId);
        }
      }

      return tx.invoice.create({
        data: {
          tenantId: session.tenantId,
          customerId: customer.id,
          branchId,
          spaceId,
          seriesId,
          siteId,
          number,
          status,
          issuedAt,
          dueAt,
          currency: "EUR",
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paidAmount: 0,
          notes: body.notes || null,
          lines: {
            create: body.lines.map((line, idx) => ({
              tenantId: session.tenantId,
              productId: line.productId || null,
              position: idx + 1,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: totals.lines[idx]!.lineTotal,
            })),
          },
        },
        include: {
          lines: { orderBy: { position: "asc" } },
          customer: true,
          branch: true,
          space: true,
        },
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.create",
      entity: "invoice",
      entityId: invoice.id,
      meta: { number: invoice.number, status: invoice.status },
    });

    return NextResponse.json(
      {
        item: {
          ...invoice,
          subtotal: toNumber(invoice.subtotal),
          vatAmount: toNumber(invoice.vatAmount),
          total: toNumber(invoice.total),
          paidAmount: toNumber(invoice.paidAmount),
          issuedAt: invoice.issuedAt?.toISOString() ?? null,
          dueAt: invoice.dueAt?.toISOString() ?? null,
          createdAt: invoice.createdAt.toISOString(),
          updatedAt: invoice.updatedAt.toISOString(),
          lines: invoice.lines.map((line) => ({
            ...line,
            quantity: toNumber(line.quantity),
            unitPrice: toNumber(line.unitPrice),
            vatRate: toNumber(line.vatRate),
            lineTotal: toNumber(line.lineTotal),
          })),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Μη έγκυρα δεδομένα τιμολογίου" },
        { status: 400 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ο αριθμός τιμολογίου υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
