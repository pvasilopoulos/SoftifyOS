import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  decodeCursor,
  encodeCursor,
  cursorWhere,
} from "@/shared/lib/cursor";
import { getErrorMessage } from "@/shared/lib/safe";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
  /** Exact action, or prefix when ending with "." (e.g. auth.) */
  action: z.string().min(1).max(120).optional(),
  entity: z.string().min(1).max(80).optional(),
  q: z.string().max(120).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  userId: z.string().min(1).max(80).optional(),
});

function serialize(row: {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  createdAt: Date;
  userId: string | null;
  meta: Prisma.JsonValue | null;
  user: { id: string; name: string; email: string } | null;
}) {
  return {
    id: row.id,
    action: row.action,
    entity: row.entity,
    entityId: row.entityId,
    createdAt: row.createdAt.toISOString(),
    userId: row.userId,
    meta: row.meta,
    user: row.user
      ? {
          id: row.user.id,
          name: row.user.name,
          email: row.user.email,
        }
      : null,
  };
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = querySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const {
      limit,
      cursor: cursorParam,
      action,
      entity,
      q,
      from: fromRaw,
      to: toRaw,
      userId,
    } = parsed.data;

    const from = fromRaw?.trim() || undefined;
    const to = toRaw?.trim() || undefined;
    if (from && Number.isNaN(Date.parse(from))) {
      return NextResponse.json({ error: "Invalid from" }, { status: 400 });
    }
    if (to && Number.isNaN(Date.parse(to))) {
      return NextResponse.json({ error: "Invalid to" }, { status: 400 });
    }

    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const baseAnd: Prisma.AuditEventWhereInput[] = [
      { tenantId: session.tenantId },
    ];

    if (action) {
      if (action.endsWith(".")) {
        baseAnd.push({ action: { startsWith: action } });
      } else {
        baseAnd.push({ action });
      }
    }
    if (entity) baseAnd.push({ entity });
    if (userId) baseAnd.push({ userId });
    if (from || to) {
      baseAnd.push({
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to) } : {}),
        },
      });
    }
    const query = q?.trim();
    if (query) {
      baseAnd.push({
        OR: [
          { action: { contains: query, mode: "insensitive" } },
          { entity: { contains: query, mode: "insensitive" } },
          { entityId: { contains: query, mode: "insensitive" } },
          {
            user: {
              OR: [
                { name: { contains: query, mode: "insensitive" } },
                { email: { contains: query, mode: "insensitive" } },
              ],
            },
          },
        ],
      });
    }

    const listAnd = [...baseAnd];
    const cw = cursorWhere(cursor);
    if (cw) listAnd.push(cw);

    const [rows, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where: { AND: listAnd },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          action: true,
          entity: true,
          entityId: true,
          createdAt: true,
          userId: true,
          meta: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditEvent.count({ where: { AND: baseAnd } }),
    ]);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null;

    const ms = Date.now() - started;

    return NextResponse.json(
      {
        items: page.map(serialize),
        nextCursor,
        limit,
        meta: {
          ms,
          tenantId: session.tenantId,
          count: page.length,
          hasMore,
          total,
        },
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Server-Timing": `db;dur=${ms}`,
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
      { status: 500 },
    );
  }
}
