import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  adjustLoyaltySchema,
  patchLoyaltyAccountSchema,
} from "@/modules/loyalty/schemas";
import {
  adjustLoyaltyPoints,
  getLoyaltyRules,
  LoyaltyError,
} from "@/modules/loyalty/service";
import { pointsToEur } from "@/modules/loyalty/rules";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const rules = await getLoyaltyRules(prisma, session.tenantId);
    const account = await prisma.loyaltyAccount.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        customer: {
          select: { id: true, code: true, name: true, email: true },
        },
        ledger: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!account) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    return NextResponse.json({
      rules,
      item: {
        id: account.id,
        pointsBalance: account.pointsBalance,
        balanceEur: pointsToEur(account.pointsBalance, rules),
        tier: account.tier,
        isActive: account.isActive,
        customer: account.customer,
        createdAt: account.createdAt.toISOString(),
        updatedAt: account.updatedAt.toISOString(),
        ledger: account.ledger.map((l) => ({
          id: l.id,
          kind: l.kind,
          points: l.points,
          invoiceId: l.invoiceId,
          note: l.note,
          createdAt: l.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const raw = (await req.json()) as { action?: string };

    if (raw.action === "adjust") {
      const data = adjustLoyaltySchema.parse(raw);
      const account = await adjustLoyaltyPoints(prisma, {
        tenantId: session.tenantId,
        accountId: id,
        data,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "loyalty.accounts.adjust",
        entity: "loyalty_account",
        entityId: id,
        meta: { points: data.points },
      });
      const rules = await getLoyaltyRules(prisma, session.tenantId);
      return NextResponse.json({
        item: {
          ...account,
          balanceEur: pointsToEur(account.pointsBalance, rules),
          ledger: account.ledger?.map((l) => ({
            id: l.id,
            kind: l.kind,
            points: l.points,
            invoiceId: l.invoiceId,
            note: l.note,
            createdAt: l.createdAt.toISOString(),
          })),
        },
      });
    }

    const data = patchLoyaltyAccountSchema.parse(raw);
    const existing = await prisma.loyaltyAccount.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const account = await prisma.loyaltyAccount.update({
      where: { id },
      data: {
        ...(data.tier ? { tier: data.tier } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
      },
      include: {
        customer: {
          select: { id: true, code: true, name: true, email: true },
        },
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "loyalty.accounts.update",
      entity: "loyalty_account",
      entityId: id,
      meta: data,
    });

    return NextResponse.json({ item: account });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof LoyaltyError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 500 },
    );
  }
}
