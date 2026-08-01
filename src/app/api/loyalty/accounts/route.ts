import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  loyaltyTierSchema,
  openLoyaltyAccountSchema,
} from "@/modules/loyalty/schemas";
import {
  ensureLoyaltyProgram,
  getLoyaltyRules,
  LoyaltyError,
  openLoyaltyAccount,
} from "@/modules/loyalty/service";
import { pointsToEur } from "@/modules/loyalty/rules";
import type { Prisma } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(["all", "active", "inactive"]).optional().default("all"),
  tier: z
    .enum(["all", "STANDARD", "SILVER", "GOLD", "PLATINUM"])
    .optional()
    .default("all"),
  minPoints: z.coerce.number().int().min(0).max(10_000_000).optional(),
  maxPoints: z.coerce.number().int().min(0).max(10_000_000).optional(),
  sort: z
    .enum(["updated", "points_desc", "points_asc", "name", "tier"])
    .optional()
    .default("updated"),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).max(100_000).optional().default(0),
});

function orderBy(
  sort: z.infer<typeof listSchema>["sort"],
): Prisma.LoyaltyAccountOrderByWithRelationInput[] {
  switch (sort) {
    case "points_desc":
      return [{ pointsBalance: "desc" }, { updatedAt: "desc" }];
    case "points_asc":
      return [{ pointsBalance: "asc" }, { updatedAt: "desc" }];
    case "name":
      return [{ customer: { name: "asc" } }];
    case "tier":
      return [{ tier: "asc" }, { pointsBalance: "desc" }];
    default:
      return [{ updatedAt: "desc" }];
  }
}

export async function GET(request: NextRequest) {
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

    const { q, status, tier, minPoints, maxPoints, sort, limit, offset } =
      parsed.data;
    const rules = await getLoyaltyRules(prisma, session.tenantId);

    const where: Prisma.LoyaltyAccountWhereInput = {
      tenantId: session.tenantId,
      ...(status === "active" ? { isActive: true } : {}),
      ...(status === "inactive" ? { isActive: false } : {}),
      ...(tier !== "all" ? { tier } : {}),
      ...(minPoints != null || maxPoints != null
        ? {
            pointsBalance: {
              ...(minPoints != null ? { gte: minPoints } : {}),
              ...(maxPoints != null ? { lte: maxPoints } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            customer: {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { code: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            },
          }
        : {}),
    };

    const [items, total, activeCount, allForStats] = await Promise.all([
      prisma.loyaltyAccount.findMany({
        where,
        orderBy: orderBy(sort),
        take: limit,
        skip: offset,
        include: {
          customer: {
            select: { id: true, code: true, name: true, email: true },
          },
        },
      }),
      prisma.loyaltyAccount.count({ where }),
      prisma.loyaltyAccount.count({
        where: { tenantId: session.tenantId, isActive: true },
      }),
      prisma.loyaltyAccount.findMany({
        where: { tenantId: session.tenantId },
        select: { pointsBalance: true, tier: true, isActive: true },
      }),
    ]);

    const pointsTotal = allForStats.reduce((s, a) => s + a.pointsBalance, 0);
    const byTier: Record<string, number> = {};
    for (const a of allForStats) {
      byTier[a.tier] = (byTier[a.tier] || 0) + 1;
    }

    return NextResponse.json({
      rules,
      items: items.map((a) => ({
        id: a.id,
        pointsBalance: a.pointsBalance,
        balanceEur: pointsToEur(a.pointsBalance, rules),
        tier: a.tier,
        isActive: a.isActive,
        customer: a.customer,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
      })),
      meta: {
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      },
      stats: {
        totalAccounts: allForStats.length,
        activeAccounts: activeCount,
        pointsTotal,
        valueTotal: pointsToEur(pointsTotal, rules),
        byTier,
      },
    });
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
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    await ensureLoyaltyProgram(prisma, session.tenantId);
    const body = openLoyaltyAccountSchema.parse(await request.json());
    const account = await openLoyaltyAccount(prisma, {
      tenantId: session.tenantId,
      data: body,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "loyalty.accounts.open",
      entity: "loyalty_account",
      entityId: account.id,
      meta: { customerId: account.customerId },
    });

    return NextResponse.json({ item: account }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 500 },
    );
  }
}

const bulkSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(100),
  isActive: z.boolean().optional(),
  tier: loyaltyTierSchema.optional(),
});

/** Bulk update tier / active flag. */
export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = bulkSchema.parse(await request.json());
    if (body.isActive === undefined && body.tier === undefined) {
      return NextResponse.json(
        { error: "Δώσε isActive ή tier" },
        { status: 400 },
      );
    }

    const result = await prisma.loyaltyAccount.updateMany({
      where: {
        tenantId: session.tenantId,
        id: { in: body.ids },
      },
      data: {
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        ...(body.tier ? { tier: body.tier } : {}),
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "loyalty.accounts.bulk_update",
      entity: "loyalty_account",
      meta: {
        ids: body.ids,
        isActive: body.isActive ?? null,
        tier: body.tier ?? null,
        count: result.count,
      },
    });

    return NextResponse.json({ updated: result.count });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Bulk update failed") },
      { status: 500 },
    );
  }
}
