import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/shared/lib/cursor";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

type AuditRow = {
  id: string;
  action: string;
  entity: string | null;
  entityId: string | null;
  createdAt: Date;
  userId: string | null;
};

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = listQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { limit, cursor: cursorParam, action } = parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    // Tuple keyset: ("createdAt", id) < cursor — uses covering DESC index cleanly
    const rows = await prisma.$queryRaw<AuditRow[]>`
      SELECT id, action, entity, "entityId", "createdAt", "userId"
      FROM audit_events
      WHERE "tenantId" = ${session.tenantId}
        ${action ? Prisma.sql`AND action = ${action}` : Prisma.empty}
        ${
          cursor
            ? Prisma.sql`AND ("createdAt", id) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY "createdAt" DESC, id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items[items.length - 1];
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
        items,
        nextCursor,
        limit,
        meta: {
          ms,
          tenantId: session.tenantId,
          count: items.length,
          hasMore,
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
