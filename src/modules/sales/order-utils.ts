export const orderStatusLabel = {
  DRAFT: "Πρόχειρη",
  CONFIRMED: "Επιβεβαιωμένη",
  PARTIAL_INVOICED: "Μερικώς τιμολογημένη",
  INVOICED: "Τιμολογημένη",
  CANCELLED: "Ακυρωμένη",
} as const;

export const orderStatusTone = {
  DRAFT: "slate",
  CONFIRMED: "teal",
  PARTIAL_INVOICED: "amber",
  INVOICED: "emerald",
  CANCELLED: "slate",
} as const;

export type OrderStatusKey = keyof typeof orderStatusLabel;
