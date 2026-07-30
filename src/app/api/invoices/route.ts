import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/shared/lib/cursor";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

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
