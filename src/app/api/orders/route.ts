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
import { orderCreateSchema } from "@/modules/sales/order-schemas";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";

export const dynamic = "force-dynamic";

const listSchema = listQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z
    .enum(["DRAFT", "CONFIRMED", "PARTIAL_INVOICED", "INVOICED", "CANCELLED"])
    .optional(),
  kind: z.enum(["SALES_ORDER", "SALES_QUOTE"]).optional().default("SALES_ORDER"),
});

async function nextOrderNumberFallback(tenantId: string, kind: string) {
  const year = new Date().getFullYear();
  const code = kind === "SALES_QUOTE" ? "ΠΡΟΣ" : "ΠΑΡ";
  const prefix = `${code}-${year}-`;
  const latest = await prisma.order.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = latest?.number?.slice(prefix.length) ?? "0";
  const seq = Number.parseInt(lastSeq, 10);
  const next = Number.isFinite(seq) ? seq + 1 : 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

async function resolveHierarchy(
  tenantId: string,
  customerId: string,
  branchId: string | null | undefined,
  spaceId: string | null | undefined,
) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true },
  });
  if (!customer) return { error: "Ο πελάτης δεν βρέθηκε" as const };

  const resolvedBranch: string | null = branchId || null;
  let resolvedSpace: string | null = spaceId || null;

  if (resolvedBranch) {
    const branch = await prisma.branch.findFirst({
      where: { id: resolvedBranch, tenantId, customerId: customer.id },
      select: { id: true },
    });
    if (!branch) return { error: "Το υποκατάστημα δεν ανήκει στον πελάτη" as const };
  } else {
    resolvedSpace = null;
  }

  if (resolvedSpace) {
    if (!resolvedBranch) {
      return { error: "Επιλέξτε υποκατάστημα για τον χώρο" as const };
    }
    const space = await prisma.space.findFirst({
      where: { id: resolvedSpace, tenantId, branchId: resolvedBranch },
      select: { id: true },
    });
    if (!space) return { error: "Ο χώρος δεν ανήκει στο υποκατάστημα" as const };
  }

  return { customerId: customer.id, branchId: resolvedBranch, spaceId: resolvedSpace };
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = listSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { limit, cursor: cursorParam, q, status, kind } = parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        kind: string;
        orderedAt: Date;
        total: Prisma.Decimal;
        createdAt: Date;
        customerId: string;
        customerName: string;
        customerCode: string;
        branchName: string | null;
        lineCount: bigint;
        customFields: unknown;
      }>
    >`
      SELECT
        o.id, o.number, o.status, o.kind, o."orderedAt", o.total, o."createdAt",
        o."customerId", c.name AS "customerName", c.code AS "customerCode",
        b.name AS "branchName", o."customFields",
        (SELECT COUNT(*) FROM order_lines ol WHERE ol."orderId" = o.id) AS "lineCount"
      FROM orders o
      JOIN customers c ON c.id = o."customerId"
      LEFT JOIN branches b ON b.id = o."branchId"
      WHERE o."tenantId" = ${session.tenantId}
        AND o.kind = ${kind}::"OrderKind"
        ${status ? Prisma.sql`AND o.status = ${status}::"OrderStatus"` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                o.number ILIKE ${"%" + q + "%"}
                OR c.name ILIKE ${"%" + q + "%"}
                OR c.code ILIKE ${"%" + q + "%"}
              )`
            : Prisma.empty
        }
        ${
          cursor
            ? Prisma.sql`AND (o."createdAt", o.id) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY o."createdAt" DESC, o.id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      id: row.id,
      number: row.number,
      status: row.status,
      kind: row.kind,
      orderedAt: row.orderedAt.toISOString(),
      total: toNumber(row.total),
      createdAt: row.createdAt.toISOString(),
      customerId: row.customerId,
      customerName: row.customerName,
      customerCode: row.customerCode,
      branchName: row.branchName,
      lineCount: Number(row.lineCount),
      customFields:
        row.customFields && typeof row.customFields === "object"
          ? row.customFields
          : {},
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return NextResponse.json({
      items,
      nextCursor,
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

    const body = orderCreateSchema.parse(await request.json());
    const hierarchy = await resolveHierarchy(
      session.tenantId,
      body.customerId,
      body.branchId,
      body.spaceId,
    );
    if ("error" in hierarchy) {
      return NextResponse.json({ error: hierarchy.error }, { status: 400 });
    }

    for (const line of body.lines) {
      if (!line.productId) continue;
      const product = await prisma.product.findFirst({
        where: {
          id: line.productId,
          tenantId: session.tenantId,
          status: "ACTIVE",
        },
        select: { id: true },
      });
      if (!product) {
        return NextResponse.json(
          { error: `Το προϊόν δεν βρέθηκε: ${line.description}` },
          { status: 400 },
        );
      }
    }

    const totals = calcInvoiceTotals(body.lines);
    const docKind = body.kind ?? "SALES_ORDER";
    const series =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              kind: docKind,
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(prisma, session.tenantId, docKind));

    if (!series && !body.number?.trim()) {
      return NextResponse.json(
        {
          error:
            "Δεν υπάρχει ενεργή σειρά για αυτόν τον τύπο — ρυθμίστε Σειρές & Τύποι",
        },
        { status: 400 },
      );
    }

    const order = await prisma.$transaction(async (tx) => {
      let number = body.number?.trim() || "";
      let seriesId: string | null = series?.id ?? null;
      let siteId: string | null = series?.siteId ?? null;
      if (!number) {
        if (series) {
          const allocated = await allocateFromSeries(tx, {
            tenantId: session.tenantId,
            seriesId: series.id,
            kind: docKind,
          });
          number = allocated.number;
          seriesId = allocated.seriesId;
          siteId = allocated.siteId;
        } else {
          number = await nextOrderNumberFallback(session.tenantId, docKind);
        }
      }

      return tx.order.create({
        data: {
          tenantId: session.tenantId,
          customerId: hierarchy.customerId,
          branchId: hierarchy.branchId,
          spaceId: hierarchy.spaceId,
          seriesId,
          siteId,
          kind: docKind,
          number,
          status: body.status ?? "DRAFT",
          currency: "EUR",
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
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
        },
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: docKind === "SALES_QUOTE" ? "quote.create" : "order.create",
      entity: "order",
      entityId: order.id,
      meta: { number: order.number, status: order.status, kind: order.kind },
    });

    return NextResponse.json(
      {
        item: {
          ...order,
          subtotal: toNumber(order.subtotal),
          vatAmount: toNumber(order.vatAmount),
          total: toNumber(order.total),
          orderedAt: order.orderedAt.toISOString(),
          createdAt: order.createdAt.toISOString(),
          updatedAt: order.updatedAt.toISOString(),
          lines: order.lines.map((line) => ({
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
        { error: "Μη έγκυρα δεδομένα παραγγελίας" },
        { status: 400 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ο αριθμός παραγγελίας υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
