import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { entityModuleSchema } from "@/modules/entity-views/schemas";
import {
  decodeCursor,
  encodeCursor,
  cursorWhere,
} from "@/shared/lib/cursor";

export const dynamic = "force-dynamic";

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
  q: z.string().trim().max(120).optional(),
  module: entityModuleSchema.optional(),
  eventKey: z.string().trim().max(80).optional(),
  scriptCode: z.string().trim().max(40).optional(),
  success: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : v === "true" || v === "1",
    ),
  source: z.enum(["PRODUCTION", "TEST"]).optional(),
  userId: z.string().trim().max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  hasHttp: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : v === "true" || v === "1",
    ),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const parsed = listSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const {
      limit,
      cursor: cursorParam,
      q,
      module,
      eventKey,
      scriptCode,
      success,
      source,
      userId,
      from,
      to,
      hasHttp,
    } = parsed.data;

    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const and: Prisma.ScriptRunLogWhereInput[] = [];
    if (q) {
      and.push({
        OR: [
          { scriptCode: { contains: q, mode: "insensitive" } },
          { scriptName: { contains: q, mode: "insensitive" } },
          { eventKey: { contains: q, mode: "insensitive" } },
          { userEmail: { contains: q, mode: "insensitive" } },
          { userName: { contains: q, mode: "insensitive" } },
          { error: { contains: q, mode: "insensitive" } },
          { recordCode: { contains: q, mode: "insensitive" } },
          { recordId: { contains: q, mode: "insensitive" } },
        ],
      });
    }
    const cw = cursorWhere(cursor);
    if (cw) and.push(cw);

    const where: Prisma.ScriptRunLogWhereInput = {
      tenantId: session!.tenantId,
      ...(module ? { module } : {}),
      ...(eventKey ? { eventKey } : {}),
      ...(scriptCode ? { scriptCode } : {}),
      ...(success !== undefined ? { success } : {}),
      ...(source ? { source } : {}),
      ...(userId ? { userId } : {}),
      ...(hasHttp === true ? { httpCalls: { gt: 0 } } : {}),
      ...(hasHttp === false ? { httpCalls: 0 } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
      ...(and.length ? { AND: and } : {}),
    };

    const [rows, stats] = await Promise.all([
      prisma.scriptRunLog.findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: {
          id: true,
          scriptId: true,
          module: true,
          eventKey: true,
          success: true,
          durationMs: true,
          error: true,
          httpCalls: true,
          source: true,
          scriptCode: true,
          scriptName: true,
          userId: true,
          userEmail: true,
          userName: true,
          userRole: true,
          recordId: true,
          recordCode: true,
          createdAt: true,
        },
      }),
      prisma.scriptRunLog.groupBy({
        by: ["success"],
        where: {
          tenantId: session!.tenantId,
          ...(module ? { module } : {}),
          ...(source ? { source } : {}),
          ...(from || to
            ? {
                createdAt: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              }
            : {}),
        },
        _count: { _all: true },
      }),
    ]);

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

    let okCount = 0;
    let failCount = 0;
    for (const g of stats) {
      if (g.success) okCount += g._count._all;
      else failCount += g._count._all;
    }

    return NextResponse.json({
      items: items.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
      })),
      nextCursor,
      stats: {
        ok: okCount,
        fail: failCount,
        total: okCount + failCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

const cleanupSchema = z.object({
  olderThanDays: z.coerce.number().int().min(1).max(3650).optional(),
  onlySource: z.enum(["PRODUCTION", "TEST"]).optional(),
  onlyFailures: z.boolean().optional(),
  ids: z.array(z.string().min(1)).max(500).optional(),
});

/** Retention cleanup / selective delete */
export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = cleanupSchema.parse(await request.json().catch(() => ({})));

    if (body.ids?.length) {
      const result = await prisma.scriptRunLog.deleteMany({
        where: {
          tenantId: session!.tenantId,
          id: { in: body.ids },
        },
      });
      return NextResponse.json({ ok: true, deleted: result.count });
    }

    if (!body.olderThanDays) {
      return NextResponse.json(
        { error: "Δώσε olderThanDays ή ids" },
        { status: 400 },
      );
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - body.olderThanDays);

    const result = await prisma.scriptRunLog.deleteMany({
      where: {
        tenantId: session!.tenantId,
        createdAt: { lt: cutoff },
        ...(body.onlySource ? { source: body.onlySource } : {}),
        ...(body.onlyFailures ? { success: false } : {}),
      },
    });

    return NextResponse.json({ ok: true, deleted: result.count, cutoff });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Cleanup failed") },
      { status: 400 },
    );
  }
}
