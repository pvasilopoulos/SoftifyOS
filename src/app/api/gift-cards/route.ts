import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { issueGiftCardSchema } from "@/modules/gift-cards/schemas";
import { GiftCardError, issueGiftCard } from "@/modules/gift-cards/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const q = request.nextUrl.searchParams.get("q")?.trim();
    const status = request.nextUrl.searchParams.get("status")?.trim();

    const items = await prisma.giftCard.findMany({
      where: {
        tenantId: session.tenantId,
        ...(status ? { status: status as "ACTIVE" | "DEPLETED" | "VOID" | "EXPIRED" } : {}),
        ...(q
          ? {
              OR: [
                { code: { contains: q.toUpperCase(), mode: "insensitive" } },
                { notes: { contains: q, mode: "insensitive" } },
                { customer: { name: { contains: q, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }],
      take: 100,
      include: {
        customer: { select: { id: true, code: true, name: true } },
      },
    });

    return NextResponse.json({
      items: items.map((g) => ({
        id: g.id,
        code: g.code,
        initialBalance: toNumber(g.initialBalance),
        balance: toNumber(g.balance),
        currency: g.currency,
        status: g.status,
        expiresAt: g.expiresAt?.toISOString() ?? null,
        notes: g.notes,
        customer: g.customer,
        createdAt: g.createdAt.toISOString(),
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

    const body = issueGiftCardSchema.parse(await request.json());
    const card = await issueGiftCard(prisma, {
      tenantId: session.tenantId,
      userId: session.sub,
      data: body,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "gift_cards.issue",
      entity: "gift_card",
      entityId: card.id,
      meta: { code: card.code, balance: toNumber(card.balance) },
    });

    return NextResponse.json(
      {
        item: {
          id: card.id,
          code: card.code,
          initialBalance: toNumber(card.initialBalance),
          balance: toNumber(card.balance),
          status: card.status,
          customer: card.customer,
          expiresAt: card.expiresAt?.toISOString() ?? null,
          notes: card.notes,
          glLiabilityAccount: card.glLiabilityAccount,
          glCashAccount: card.glCashAccount,
          glRedeemContraAccount: card.glRedeemContraAccount,
          costCenter: card.costCenter,
          accountingCode: card.accountingCode,
          createdAt: card.createdAt.toISOString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof GiftCardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Issue failed") },
      { status: 500 },
    );
  }
}
