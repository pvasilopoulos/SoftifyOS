import type { GiftCardLedgerKind } from "@/generated/prisma/client";

export const DEFAULT_GIFT_CARD_ACCOUNTS = {
  glLiabilityAccount: "56.00.00",
  glCashAccount: "38.00.00",
  glRedeemContraAccount: "70.00.00",
} as const;

export type GiftCardAccounts = {
  glLiabilityAccount: string | null | undefined;
  glCashAccount: string | null | undefined;
  glRedeemContraAccount: string | null | undefined;
};

export type LedgerPosting = {
  glDebitAccount: string;
  glCreditAccount: string;
  label: string;
};

function acc(
  value: string | null | undefined,
  fallback: string,
) {
  const t = value?.trim();
  return t && t.length > 0 ? t : fallback;
}

/** Λογιστική κίνηση ανά είδος ledger (χρέωση / πίστωση). */
export function postingForGiftCardMovement(
  kind: GiftCardLedgerKind,
  accounts: GiftCardAccounts,
  signedAmount: number,
): LedgerPosting {
  const liability = acc(
    accounts.glLiabilityAccount,
    DEFAULT_GIFT_CARD_ACCOUNTS.glLiabilityAccount,
  );
  const cash = acc(
    accounts.glCashAccount,
    DEFAULT_GIFT_CARD_ACCOUNTS.glCashAccount,
  );
  const redeemContra = acc(
    accounts.glRedeemContraAccount,
    DEFAULT_GIFT_CARD_ACCOUNTS.glRedeemContraAccount,
  );

  switch (kind) {
    case "ISSUE":
      return {
        glDebitAccount: cash,
        glCreditAccount: liability,
        label: "Έκδοση · Χρέωση ταμείου / Πίστωση παθητικού δωροκαρτών",
      };
    case "REDEEM":
      return {
        glDebitAccount: liability,
        glCreditAccount: redeemContra,
        label: "Εξαργύρωση · Χρέωση παθητικού / Πίστωση εσόδων",
      };
    case "VOID":
    case "EXPIRE":
      return {
        glDebitAccount: liability,
        glCreditAccount: cash,
        label:
          kind === "VOID"
            ? "Ακύρωση · Αντιστροφή υπολοίπου παθητικού"
            : "Λήξη · Αντιστροφή υπολοίπου παθητικού",
      };
    case "ADJUST":
      if (signedAmount >= 0) {
        return {
          glDebitAccount: cash,
          glCreditAccount: liability,
          label: "Προσαρμογή (+) · Αύξηση παθητικού",
        };
      }
      return {
        glDebitAccount: liability,
        glCreditAccount: cash,
        label: "Προσαρμογή (−) · Μείωση παθητικού",
      };
    default:
      return {
        glDebitAccount: liability,
        glCreditAccount: cash,
        label: "Κίνηση δωροκάρτας",
      };
  }
}
