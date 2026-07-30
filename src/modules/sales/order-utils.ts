export const orderStatusLabel = {
  DRAFT: "Πρόχειρη",
  CONFIRMED: "Επιβεβαιωμένη",
  INVOICED: "Τιμολογημένη",
  CANCELLED: "Ακυρωμένη",
} as const;

export const orderStatusTone = {
  DRAFT: "slate",
  CONFIRMED: "teal",
  INVOICED: "emerald",
  CANCELLED: "slate",
} as const;

export type OrderStatusKey = keyof typeof orderStatusLabel;
