import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  adjustGiftCardSchema,
  patchGiftCardAccountingSchema,
  voidGiftCardSchema,
} from "@/modules/gift-cards/schemas";
import {
  adjustGiftCard,
  GiftCardError,
  updateGiftCardAccounting,
  voidGiftCard,
} from "@/modules/gift-cards/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function serializeCard(card: {
  id: string;
  code: string;
  initialBalance: { toString(): string } | number;
  balance: { toString(): string } | number;
  currency: string;
  status: string;
  expiresAt: Date | null;
  notes: string | null;
  glLiabilityAccount?: string | null;
  glCashAccount?: string | null;
  glRedeemContraAccount?: string | null;
  costCenter?: string | null;
  accountingCode?: string | null;
  createdAt: Date;
  updatedAt: Date;
  customer: { id: string; code: string; name: string } | null;
  ledger?: Array<{
    id: string;
    kind: string;
    amount: { toString(): string } | number;
    balanceAfter: { toString(): string } | number;
    invoiceId: string | null;
    note: string | null;
    glDebitAccount?: string | null;
    glCreditAccount?: string | null;
    createdAt: Date;
  }>;
}) {
  return {
    id: card.id,
    code: card.code,
    initialBalance: toNumber(card.initialBalance),
    balance: toNumber(card.balance),
    currency: card.currency,
    status: card.status,
    expiresAt: card.expiresAt?.toISOString() ?? null,
    notes: card.notes,
    glLiabilityAccount: card.glLiabilityAccount ?? null,
    glCashAccount: card.glCashAccount ?? null,
    glRedeemContraAccount: card.glRedeemContraAccount ?? null,
    costCenter: card.costCenter ?? null,
    accountingCode: card.accountingCode ?? null,
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
    customer: card.customer,
    ledger: (card.ledger ?? []).map((l) => ({
      id: l.id,
      kind: l.kind,
      amount: toNumber(l.amount),
      balanceAfter: toNumber(l.balanceAfter),
      invoiceId: l.invoiceId,
      note: l.note,
      glDebitAccount: l.glDebitAccount ?? null,
      glCreditAccount: l.glCreditAccount ?? null,
      createdAt: l.createdAt.toISOString(),
    })),
  };
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const card = await prisma.giftCard.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        customer: { select: { id: true, code: true, name: true } },
        ledger: { orderBy: { createdAt: "desc" }, take: 50 },
      },
    });
    if (!card) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    return NextResponse.json({ item: serializeCard(card) });
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
    const body = (await req.json()) as { action?: string };
    if (body.action === "void") {
      const data = voidGiftCardSchema.parse(body);
      const card = await voidGiftCard(prisma, {
        tenantId: session.tenantId,
        giftCardId: id,
        userId: session.sub,
        note: data.note,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "gift_cards.void",
        entity: "gift_card",
        entityId: id,
      });
      return NextResponse.json({ item: serializeCard(card) });
    }

    if (body.action === "adjust") {
      const data = adjustGiftCardSchema.parse(body);
      const card = await adjustGiftCard(prisma, {
        tenantId: session.tenantId,
        giftCardId: id,
        userId: session.sub,
        data,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "gift_cards.adjust",
        entity: "gift_card",
        entityId: id,
        meta: { amount: data.amount },
      });
      return NextResponse.json({ item: serializeCard(card) });
    }

    if (body.action === "accounting") {
      const data = patchGiftCardAccountingSchema.parse(body);
      const card = await updateGiftCardAccounting(prisma, {
        tenantId: session.tenantId,
        giftCardId: id,
        data,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "gift_cards.accounting",
        entity: "gift_card",
        entityId: id,
        meta: data,
      });
      return NextResponse.json({ item: serializeCard(card) });
    }

    return NextResponse.json({ error: "Άγνωστη ενέργεια" }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof GiftCardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 500 },
    );
  }
}
