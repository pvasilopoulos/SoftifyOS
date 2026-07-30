import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { calcInvoiceTotals, roundMoney, toNumber } from "@/modules/sales/invoice-utils";
import { posCheckoutSchema } from "@/modules/pos/schemas";
import {
  calcPayable,
  eurToRedeemPoints,
  pointsToEur,
  validateTenders,
} from "@/modules/pos/payable";
import { GiftCardError, redeemGiftCard } from "@/modules/gift-cards/service";
import {
  earnLoyaltyPoints,
  getLoyaltyRules,
  redeemLoyaltyPoints,
} from "@/modules/loyalty/service";
import { listPaymentMethods } from "@/modules/payments/service";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = posCheckoutSchema.parse(await request.json());

    const site = await prisma.site.findFirst({
      where: { id: body.siteId, tenantId: session.tenantId, isActive: true },
    });
    if (!site) {
      return NextResponse.json({ error: "Μη έγκυρο ταμείο/υποκατάστημα" }, { status: 400 });
    }

    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, tenantId: session.tenantId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json({ error: "Ο πελάτης δεν βρέθηκε" }, { status: 400 });
    }

    let posSession = body.sessionId
      ? await prisma.posSession.findFirst({
          where: {
            id: body.sessionId,
            tenantId: session.tenantId,
            siteId: site.id,
            status: "OPEN",
          },
        })
      : await prisma.posSession.findFirst({
          where: {
            tenantId: session.tenantId,
            siteId: site.id,
            status: "OPEN",
          },
          orderBy: { openedAt: "desc" },
        });

    if (!posSession) {
      posSession = await prisma.posSession.create({
        data: {
          tenantId: session.tenantId,
          siteId: site.id,
          openedByUserId: session.sub,
          status: "OPEN",
          openingFloat: 0,
        },
      });
    }

    if (body.terminalId) {
      const terminal = await prisma.posTerminal.findFirst({
        where: {
          id: body.terminalId,
          tenantId: session.tenantId,
          siteId: site.id,
          isActive: true,
        },
      });
      if (!terminal) {
        return NextResponse.json({ error: "Το τερματικό POS δεν βρέθηκε" }, { status: 400 });
      }
    }

    const series =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              kind: "RETAIL_RECEIPT",
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(
        prisma,
        session.tenantId,
        "RETAIL_RECEIPT",
        site.id,
      ));

    if (!series) {
      return NextResponse.json(
        { error: "Δεν υπάρχει ενεργή σειρά ΑΠΥ — ρυθμίστε Σειρές & Τύποι" },
        { status: 400 },
      );
    }

    const totals = calcInvoiceTotals(body.lines);

    const { resolveSeriesPaymentMethods } = await import(
      "@/modules/documents/series-payments"
    );
    const seriesMethods = await resolveSeriesPaymentMethods(prisma, {
      tenantId: session.tenantId,
      seriesId: series.id,
      posOnly: true,
      activeOnly: true,
    });
    // Full PaymentMethod rows filtered to series allow-list (empty list = all POS methods)
    const paymentMethods = await listPaymentMethods(prisma, session.tenantId, {
      activeOnly: true,
    });
    const allowedIds = new Set(seriesMethods.map((m) => m.id));
    const allowedCatalog = paymentMethods.filter((m) => allowedIds.has(m.id));
    const methodByCode = new Map(allowedCatalog.map((m) => [m.code, m]));

    for (const t of body.tenders) {
      if (!methodByCode.has(t.method)) {
        return NextResponse.json(
          {
            error: `Ο τρόπος πληρωμής «${t.method}» δεν επιτρέπεται για τη σειρά ΑΠΥ`,
          },
          { status: 400 },
        );
      }
    }

    const tenderKind = (code: string) => methodByCode.get(code)!.kind;

    // Resolve gift card / loyalty from tenders (by kind)
    let giftCardApplied = 0;
    let loyaltyAppliedEur = 0;
    const giftCardCodes: string[] = [];
    let loyaltyPointsRequested = 0;

    for (const t of body.tenders) {
      const kind = tenderKind(t.method);
      if (kind === "GIFT_CARD") {
        giftCardApplied = roundMoney(giftCardApplied + t.amount);
        if (t.giftCardCode) giftCardCodes.push(t.giftCardCode.trim().toUpperCase());
      }
      if (kind === "LOYALTY") {
        loyaltyAppliedEur = roundMoney(loyaltyAppliedEur + t.amount);
        if (t.loyaltyPoints) loyaltyPointsRequested += t.loyaltyPoints;
      }
    }

    const payable = calcPayable({
      saleTotal: totals.total,
      discount: body.discount ?? 0,
      giftCardApplied,
      loyaltyAppliedEur,
    });

    // Cap gift/loyalty tender amounts to what calcPayable actually applies
    // so we never burn more balance than the sale needs.
    let giftBudget = payable.giftCardApplied;
    let loyaltyBudget = payable.loyaltyAppliedEur;
    const settledTenders = body.tenders.map((t) => {
      const kind = tenderKind(t.method);
      if (kind === "GIFT_CARD") {
        const applied = roundMoney(Math.min(Math.max(0, t.amount), giftBudget));
        giftBudget = roundMoney(Math.max(0, giftBudget - applied));
        return { ...t, amount: applied };
      }
      if (kind === "LOYALTY") {
        const applied = roundMoney(
          Math.min(Math.max(0, t.amount), loyaltyBudget),
        );
        loyaltyBudget = roundMoney(Math.max(0, loyaltyBudget - applied));
        return { ...t, amount: applied };
      }
      return t;
    });

    // Non gift/loyalty tenders cover payableDue
    const coverTenders = settledTenders
      .filter((t) => {
        const kind = tenderKind(t.method);
        return kind !== "GIFT_CARD" && kind !== "LOYALTY";
      })
      .map((t) => {
        const pm = methodByCode.get(t.method)!;
        return {
          method: t.method,
          kind: pm.kind,
          amount: t.amount,
          allowsChange: pm.allowsChange,
        };
      });

    const tenderCheck = validateTenders(payable.payableDue, coverTenders);
    if (!tenderCheck.ok) {
      return NextResponse.json({ error: tenderCheck.error }, { status: 400 });
    }

    const loyaltyAccount = await prisma.loyaltyAccount.findUnique({
      where: {
        tenantId_customerId: {
          tenantId: session.tenantId,
          customerId: customer.id,
        },
      },
    });

    const loyaltyRules = await getLoyaltyRules(prisma, session.tenantId);

    if (payable.loyaltyAppliedEur > 0) {
      if (!loyaltyAccount || !loyaltyAccount.isActive) {
        return NextResponse.json(
          { error: "Δεν υπάρχει ενεργός λογαριασμός loyalty" },
          { status: 400 },
        );
      }
      const needPoints =
        loyaltyPointsRequested > 0
          ? loyaltyPointsRequested
          : eurToRedeemPoints(payable.loyaltyAppliedEur, loyaltyRules);
      if (needPoints > loyaltyAccount.pointsBalance) {
        return NextResponse.json(
          { error: "Ανεπαρκείς πόντοι loyalty" },
          { status: 400 },
        );
      }
      if (pointsToEur(needPoints, loyaltyRules) + 0.001 < payable.loyaltyAppliedEur) {
        return NextResponse.json(
          { error: "Οι πόντοι δεν καλύπτουν το ποσό loyalty" },
          { status: 400 },
        );
      }
    }

    // Preload gift cards
    const giftCards =
      giftCardCodes.length > 0
        ? await prisma.giftCard.findMany({
            where: {
              tenantId: session.tenantId,
              code: { in: giftCardCodes },
              status: "ACTIVE",
            },
          })
        : [];

    const remainingByCode = new Map(
      giftCards.map((g) => [g.code, toNumber(g.balance)] as const),
    );
    for (const t of settledTenders.filter(
      (x) => tenderKind(x.method) === "GIFT_CARD" && x.amount > 0,
    )) {
      const code = (t.giftCardCode || "").trim().toUpperCase();
      const card = giftCards.find((g) => g.code === code);
      if (!card) {
        return NextResponse.json(
          { error: `Δωροκάρτα δεν βρέθηκε: ${code || "—"}` },
          { status: 400 },
        );
      }
      if (card.expiresAt && card.expiresAt < new Date()) {
        return NextResponse.json(
          { error: `Η δωροκάρτα ${code} έχει λήξει` },
          { status: 400 },
        );
      }
      const remaining = remainingByCode.get(code) ?? 0;
      if (remaining + 0.001 < t.amount) {
        return NextResponse.json(
          {
            error: `Ανεπαρκές υπόλοιπο δωροκάρτας ${code} (${remaining.toFixed(2)} €)`,
          },
          { status: 400 },
        );
      }
      remainingByCode.set(code, roundMoney(remaining - t.amount));
    }

    const result = await prisma.$transaction(async (tx) => {
      const allocated = await allocateFromSeries(tx, {
        tenantId: session.tenantId,
        seriesId: series.id,
        kind: "RETAIL_RECEIPT",
      });

      const invoice = await tx.invoice.create({
        data: {
          tenantId: session.tenantId,
          customerId: customer.id,
          seriesId: allocated.seriesId,
          siteId: allocated.siteId ?? site.id,
          kind: "RETAIL_RECEIPT",
          number: allocated.number,
          status: "PAID",
          issuedAt: new Date(),
          currency: "EUR",
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paidAmount: totals.total,
          notes: body.notes || `POS · ${site.code}`,
          lines: {
            create: body.lines.map((line, idx) => ({
              tenantId: session.tenantId,
              productId: line.productId || null,
              position: idx + 1,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: totals.lines[idx]!.lineTotal,
            })),
          },
        },
      });

      let changeLeft = tenderCheck.change;
      for (const t of settledTenders) {
        if (t.amount <= 0 && (tenderKind(t.method) === "GIFT_CARD" || tenderKind(t.method) === "LOYALTY")) {
          continue;
        }
        const pm = methodByCode.get(t.method)!;
        const kind = pm.kind;
        let giftCardId: string | null = null;
        let loyaltyAccountId: string | null = null;
        let changeAmount = 0;

        if (kind === "GIFT_CARD") {
          const code = (t.giftCardCode || "").trim().toUpperCase();
          const card = giftCards.find((g) => g.code === code)!;
          giftCardId = card.id;
          await redeemGiftCard(tx, {
            tenantId: session.tenantId,
            giftCardId: card.id,
            amount: t.amount,
            invoiceId: invoice.id,
            userId: session.sub,
            note: `POS redeem ${t.amount.toFixed(2)} €`,
          });
        }

        if (kind === "LOYALTY") {
          loyaltyAccountId = loyaltyAccount!.id;
          const pts =
            t.loyaltyPoints && t.loyaltyPoints > 0
              ? t.loyaltyPoints
              : eurToRedeemPoints(t.amount, loyaltyRules);
          await redeemLoyaltyPoints(tx, {
            tenantId: session.tenantId,
            accountId: loyaltyAccount!.id,
            points: pts,
            invoiceId: invoice.id,
            note: `POS redeem ${t.amount.toFixed(2)} €`,
            rules: loyaltyRules,
          });
        }

        if ((pm.allowsChange || kind === "CASH") && changeLeft > 0) {
          const cashAmt = roundMoney(t.amount);
          if (cashAmt >= changeLeft) {
            changeAmount = changeLeft;
            changeLeft = 0;
          }
        }

        let externalRef = t.externalRef || null;
        if ((pm.requiresExternalRef || kind === "CARD") && !externalRef) {
          externalRef = `MOCK-${Date.now().toString(36).toUpperCase()}`;
        }

        await tx.invoicePayment.create({
          data: {
            tenantId: session.tenantId,
            invoiceId: invoice.id,
            amount: t.amount,
            method: t.method,
            paymentMethodId: pm.id,
            note: t.note || null,
            changeAmount,
            externalRef,
            posSessionId: posSession!.id,
            giftCardId,
            loyaltyAccountId,
          },
        });
      }

      // Earn loyalty on sale total
      if (loyaltyAccount?.isActive) {
        await earnLoyaltyPoints(tx, {
          tenantId: session.tenantId,
          accountId: loyaltyAccount.id,
          saleTotalEur: totals.total,
          invoiceId: invoice.id,
          rules: loyaltyRules,
        });
      }

      return { invoice, change: tenderCheck.change };
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "pos.checkout",
      entity: "invoice",
      entityId: result.invoice.id,
      meta: {
        number: result.invoice.number,
        total: totals.total,
        payableDue: payable.payableDue,
        change: result.change,
        sessionId: posSession.id,
        siteId: site.id,
      },
    });

    return NextResponse.json(
      {
        item: {
          invoiceId: result.invoice.id,
          number: result.invoice.number,
          total: totals.total,
          payable,
          change: result.change,
          sessionId: posSession.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα POS" }, { status: 400 });
    }
    if (error instanceof GiftCardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "POS checkout failed") },
      { status: 500 },
    );
  }
}
