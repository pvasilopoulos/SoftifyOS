import { roundMoney } from "@/modules/sales/invoice-utils";

/** 100 πόντοι = 1 € */
export const LOYALTY_POINTS_PER_EUR = 100;
/** 1 € αγορών = 1 πόντος */
export const LOYALTY_EARN_POINTS_PER_EUR = 1;

export const tenderMethodLabel = {
  CASH: "Μετρητά",
  CARD: "Κάρτα (POS)",
  TRANSFER: "Μεταφορά",
  GIFT_CARD: "Δωροκάρτα",
  LOYALTY: "Πόντοι loyalty",
  OTHER: "Άλλο",
} as const;

export type TenderMethod = keyof typeof tenderMethodLabel;

export function pointsToEur(points: number) {
  return roundMoney(points / LOYALTY_POINTS_PER_EUR);
}

export function eurToRedeemPoints(amountEur: number) {
  return Math.floor(roundMoney(amountEur) * LOYALTY_POINTS_PER_EUR);
}

export function earnPointsForSale(totalEur: number) {
  return Math.floor(roundMoney(totalEur) * LOYALTY_EARN_POINTS_PER_EUR);
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
  method: TenderMethod;
  amount: number;
  changeAmount?: number;
};

/**
 * Ελέγχει ότι τα tenders καλύπτουν το payableDue.
 * Μετρητά μπορούν να υπερκαλύψουν (ρέστα).
 */
export function validateTenders(
  payableDue: number,
  tenders: TenderLine[],
): { ok: true; tendered: number; change: number } | { ok: false; error: string } {
  if (tenders.length === 0 && payableDue > 0) {
    return { ok: false, error: "Προσθέστε τρόπο πληρωμής" };
  }

  let cash = 0;
  let nonCash = 0;
  for (const t of tenders) {
    const amt = roundMoney(t.amount);
    if (amt <= 0) return { ok: false, error: "Μη έγκυρο ποσό πληρωμής" };
    if (t.method === "CASH") cash = roundMoney(cash + amt);
    else nonCash = roundMoney(nonCash + amt);
  }

  const due = roundMoney(payableDue);
  if (nonCash > due + 0.001) {
    return { ok: false, error: "Οι μη-μετρητές πληρωμές υπερβαίνουν το πληρωτέο" };
  }
  const remainingAfterNonCash = roundMoney(due - nonCash);
  if (cash + 0.001 < remainingAfterNonCash) {
    return {
      ok: false,
      error: `Υπόλοιπο προς είσπραξη ${remainingAfterNonCash.toFixed(2)} €`,
    };
  }

  const tendered = roundMoney(cash + nonCash);
  const change = roundMoney(Math.max(0, cash - remainingAfterNonCash));
  return { ok: true, tendered, change };
}
