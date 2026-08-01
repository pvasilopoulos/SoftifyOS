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
  summary: z
    .enum(["0", "1", "true", "false"])
    .optional()
    .transform((v) => v === "1" || v === "true"),
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

function buildWhere(
  tenantId: string,
  input: {
    action?: string;
    entity?: string;
    userId?: string;
    from?: string;
    to?: string;
    q?: string;
  },
): Prisma.AuditEventWhereInput[] {
  const baseAnd: Prisma.AuditEventWhereInput[] = [{ tenantId }];

  if (input.action) {
    if (input.action.endsWith(".")) {
      baseAnd.push({ action: { startsWith: input.action } });
    } else {
      baseAnd.push({ action: input.action });
    }
  }
  if (input.entity) baseAnd.push({ entity: input.entity });
  if (input.userId) baseAnd.push({ userId: input.userId });
  if (input.from || input.to) {
    baseAnd.push({
      createdAt: {
        ...(input.from ? { gte: new Date(input.from) } : {}),
        ...(input.to ? { lte: new Date(input.to) } : {}),
      },
    });
  }
  const query = input.q?.trim();
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
  return baseAnd;
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
      summary: wantSummary,
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

    const baseAnd = buildWhere(session.tenantId, {
      action,
      entity,
      userId,
      from,
      to,
      q,
    });

    const listAnd = [...baseAnd];
    const cw = cursorWhere(cursor);
    if (cw) listAnd.push(cw);

    const now = Date.now();
    const hourAgo = new Date(now - 60 * 60_000);
    const dayAgo = new Date(now - 24 * 60 * 60_000);

    const [rows, total, summary] = await Promise.all([
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
      wantSummary
        ? Promise.all([
            prisma.auditEvent.count({
              where: {
                tenantId: session.tenantId,
                createdAt: { gte: hourAgo },
              },
            }),
            prisma.auditEvent.count({
              where: {
                tenantId: session.tenantId,
                createdAt: { gte: dayAgo },
              },
            }),
            prisma.auditEvent.count({
              where: {
                tenantId: session.tenantId,
                createdAt: { gte: dayAgo },
                action: { startsWith: "auth." },
              },
            }),
            prisma.auditEvent.count({
              where: {
                tenantId: session.tenantId,
                createdAt: { gte: dayAgo },
                OR: [
                  { action: { contains: "delete" } },
                  { action: { contains: "fail" } },
                  { action: { contains: "cancel" } },
                ],
              },
            }),
          ]).then(([lastHour, last24h, auth24h, risk24h]) => ({
            lastHour,
            last24h,
            auth24h,
            risk24h,
          }))
        : Promise.resolve(null),
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
        summary,
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
