import { roundMoney } from "@/modules/sales/invoice-utils";
import {
  defaultLoyaltyRules,
  earnPointsForSale as earnPointsForSaleWithRules,
  eurToRedeemPoints as eurToRedeemPointsWithRules,
  pointsToEur as pointsToEurWithRules,
  type LoyaltyRules,
} from "@/modules/loyalty/rules";

/** @deprecated use LoyaltyProgram / modules/loyalty/rules — kept for POS compatibility */
export const LOYALTY_POINTS_PER_EUR = defaultLoyaltyRules.redeemPointsPerEur;
/** @deprecated */
export const LOYALTY_EARN_POINTS_PER_EUR = defaultLoyaltyRules.earnPointsPerEur;

export const tenderMethodLabel = {
  CASH: "Μετρητά",
  CARD: "Κάρτα (POS)",
  TRANSFER: "Μεταφορά",
  GIFT_CARD: "Δωροκάρτα",
  LOYALTY: "Πόντοι loyalty",
  OTHER: "Άλλο",
} as const;

export type TenderMethod = keyof typeof tenderMethodLabel;

export function pointsToEur(points: number, rules?: LoyaltyRules) {
  return pointsToEurWithRules(points, rules ?? defaultLoyaltyRules);
}

export function eurToRedeemPoints(amountEur: number, rules?: LoyaltyRules) {
  return eurToRedeemPointsWithRules(amountEur, rules ?? defaultLoyaltyRules);
}

export function earnPointsForSale(totalEur: number, rules?: LoyaltyRules) {
  return earnPointsForSaleWithRules(totalEur, rules ?? defaultLoyaltyRules);
}

export type PayableInput = {
  saleTotal: number;
  giftCardApplied?: number;
  loyaltyAppliedEur?: number;
  discount?: number;
};

export type PayableBreakdown = {
  saleTotal: number;
  discount: number;
  giftCardApplied: number;
  loyaltyAppliedEur: number;
  /** Ποσό που πρέπει να καλυφθεί με μετρητά/κάρτα/κ.λπ. */
  payableDue: number;
};

/** Υπολογίζει αυτόματα το πληρωτέο μετά από gift card / loyalty / έκπτωση. */
export function calcPayable(input: PayableInput): PayableBreakdown {
  const saleTotal = roundMoney(Math.max(0, input.saleTotal));
  const discount = roundMoney(Math.max(0, input.discount ?? 0));
  let giftCardApplied = roundMoney(Math.max(0, input.giftCardApplied ?? 0));
  let loyaltyAppliedEur = roundMoney(Math.max(0, input.loyaltyAppliedEur ?? 0));

  const afterDiscount = roundMoney(Math.max(0, saleTotal - discount));
  giftCardApplied = roundMoney(Math.min(giftCardApplied, afterDiscount));
  const afterGift = roundMoney(Math.max(0, afterDiscount - giftCardApplied));
  loyaltyAppliedEur = roundMoney(Math.min(loyaltyAppliedEur, afterGift));
  const payableDue = roundMoney(Math.max(0, afterGift - loyaltyAppliedEur));

  return {
    saleTotal,
    discount,
    giftCardApplied,
    loyaltyAppliedEur,
    payableDue,
  };
}

export type TenderLine = {
  method: string;
  kind?: TenderMethod | string;
  amount: number;
  changeAmount?: number;
  allowsChange?: boolean;
};

/**
 * Ελέγχει ότι τα tenders καλύπτουν το payableDue.
 * Μετρητά (ή allowsChange) μπορούν να υπερκαλύψουν (ρέστα).
 */
export function validateTenders(
  payableDue: number,
  tenders: TenderLine[],
): { ok: true; change: number } | { ok: false; error: string } {
  const cover = tenders.filter((t) => {
    const kind = t.kind ?? t.method;
    return kind !== "GIFT_CARD" && kind !== "LOYALTY";
  });
  const paid = roundMoney(cover.reduce((s, t) => s + Math.max(0, t.amount), 0));
  const due = roundMoney(Math.max(0, payableDue));

  if (due > 0 && paid + 0.001 < due) {
    return {
      ok: false,
      error: `Ανεπαρκής κάλυψη πληρωμής (χρειάζονται ${due.toFixed(2)} €)`,
    };
  }

  const cashLike = cover.filter((t) => {
    const kind = t.kind ?? t.method;
    return t.allowsChange || kind === "CASH";
  });
  const cash = cashLike.reduce((s, t) => s + t.amount, 0);
  const nonCash = cover
    .filter((t) => {
      const kind = t.kind ?? t.method;
      return !(t.allowsChange || kind === "CASH");
    })
    .reduce((s, t) => s + t.amount, 0);

  if (nonCash > due + 0.001) {
    return { ok: false, error: "Μη μετρητά δεν μπορούν να υπερκαλύψουν το πληρωτέο" };
  }

  const change = roundMoney(Math.max(0, cash - Math.max(0, due - nonCash)));
  return { ok: true, change };
}
