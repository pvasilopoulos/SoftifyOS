export const paymentMethodKindLabel = {
  CASH: "Μετρητά",
  CARD: "Κάρτα",
  TRANSFER: "Μεταφορά",
  GIFT_CARD: "Δωροκάρτα",
  LOYALTY: "Loyalty",
  OTHER: "Άλλο",
} as const;

export type PaymentMethodKind = keyof typeof paymentMethodKindLabel;

export const DEFAULT_PAYMENT_METHODS: Array<{
  code: string;
  name: string;
  kind: PaymentMethodKind;
  description: string;
  glAccount: string;
  glContraAccount: string;
  glClearingAccount: string | null;
  sortOrder: number;
  showInPos: boolean;
  showInCollect: boolean;
  requiresExternalRef: boolean;
  allowsChange: boolean;
  affectsCashDrawer: boolean;
}> = [
  {
    code: "CASH",
    name: "Μετρητά",
    kind: "CASH",
    description: "Μετρητά στο ταμείο",
    glAccount: "38.00.00",
    glContraAccount: "30.00.00",
    glClearingAccount: null,
    sortOrder: 10,
    showInPos: true,
    showInCollect: true,
    requiresExternalRef: false,
    allowsChange: true,
    affectsCashDrawer: true,
  },
  {
    code: "CARD",
    name: "Κάρτα (POS)",
    kind: "CARD",
    description: "Κάρτα μέσω τερματικού",
    glAccount: "33.90.00",
    glContraAccount: "30.00.00",
    glClearingAccount: "33.90.01",
    sortOrder: 20,
    showInPos: true,
    showInCollect: true,
    requiresExternalRef: true,
    allowsChange: false,
    affectsCashDrawer: false,
  },
  {
    code: "TRANSFER",
    name: "Μεταφορά",
    kind: "TRANSFER",
    description: "Τραπεζική μεταφορά",
    glAccount: "38.03.00",
    glContraAccount: "30.00.00",
    glClearingAccount: null,
    sortOrder: 30,
    showInPos: true,
    showInCollect: true,
    requiresExternalRef: false,
    allowsChange: false,
    affectsCashDrawer: false,
  },
  {
    code: "GIFT_CARD",
    name: "Δωροκάρτα",
    kind: "GIFT_CARD",
    description: "Εξαργύρωση δωροκάρτας",
    glAccount: "56.00.00",
    glContraAccount: "30.00.00",
    glClearingAccount: null,
    sortOrder: 40,
    showInPos: true,
    showInCollect: false,
    requiresExternalRef: false,
    allowsChange: false,
    affectsCashDrawer: false,
  },
  {
    code: "LOYALTY",
    name: "Πόντοι loyalty",
    kind: "LOYALTY",
    description: "Εξαργύρωση πόντων",
    glAccount: "64.90.00",
    glContraAccount: "30.00.00",
    glClearingAccount: null,
    sortOrder: 50,
    showInPos: false,
    showInCollect: false,
    requiresExternalRef: false,
    allowsChange: false,
    affectsCashDrawer: false,
  },
  {
    code: "OTHER",
    name: "Άλλο",
    kind: "OTHER",
    description: "Λοιποί τρόποι",
    glAccount: "38.99.00",
    glContraAccount: "30.00.00",
    glClearingAccount: null,
    sortOrder: 90,
    showInPos: true,
    showInCollect: true,
    requiresExternalRef: false,
    allowsChange: false,
    affectsCashDrawer: false,
  },
];
