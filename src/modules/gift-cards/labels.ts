export const giftCardStatusLabel = {
  ACTIVE: "Ενεργή",
  DEPLETED: "Εξαντλημένη",
  VOID: "Άκυρη",
  EXPIRED: "Ληγμένη",
} as const;

export const giftCardLedgerKindLabel = {
  ISSUE: "Έκδοση",
  REDEEM: "Εξαργύρωση",
  ADJUST: "Προσαρμογή",
  VOID: "Ακύρωση",
  EXPIRE: "Λήξη",
} as const;

export function giftCardStatusTone(
  status: keyof typeof giftCardStatusLabel,
): "emerald" | "slate" | "rose" | "amber" {
  switch (status) {
    case "ACTIVE":
      return "emerald";
    case "DEPLETED":
      return "slate";
    case "VOID":
      return "rose";
    case "EXPIRED":
      return "amber";
  }
}
