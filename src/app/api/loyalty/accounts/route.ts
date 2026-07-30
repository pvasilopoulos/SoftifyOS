import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { openLoyaltyAccountSchema } from "@/modules/loyalty/schemas";
import {
  ensureLoyaltyProgram,
  getLoyaltyRules,
  LoyaltyError,
  openLoyaltyAccount,
} from "@/modules/loyalty/service";
import { pointsToEur } from "@/modules/loyalty/rules";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q")?.trim();
    const rules = await getLoyaltyRules(prisma, session.tenantId);

    const items = await prisma.loyaltyAccount.findMany({
      where: {
        tenantId: session.tenantId,
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
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
      include: {
        customer: {
          select: { id: true, code: true, name: true, email: true },
        },
      },
    });

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
