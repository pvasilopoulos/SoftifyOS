export const PERMISSION_CATALOG = [
  { code: "dashboard.view", label: "Πίνακας ελέγχου", group: "Κύρια" },
  { code: "customers.read", label: "Πελάτες — ανάγνωση", group: "Πωλήσεις" },
  { code: "customers.write", label: "Πελάτες — εγγραφή", group: "Πωλήσεις" },
  { code: "quotes.read", label: "Προσφορές — ανάγνωση", group: "Πωλήσεις" },
  { code: "quotes.write", label: "Προσφορές — εγγραφή", group: "Πωλήσεις" },
  { code: "orders.read", label: "Παραγγελίες — ανάγνωση", group: "Πωλήσεις" },
  { code: "orders.write", label: "Παραγγελίες — εγγραφή", group: "Πωλήσεις" },
  { code: "invoices.read", label: "Τιμολόγια — ανάγνωση", group: "Πωλήσεις" },
  { code: "invoices.write", label: "Τιμολόγια — εγγραφή", group: "Πωλήσεις" },
  { code: "pos.use", label: "Χρήση POS", group: "Πωλήσεις" },
  { code: "gift_cards.read", label: "Δωροκάρτες — ανάγνωση", group: "Πωλήσεις" },
  { code: "gift_cards.write", label: "Δωροκάρτες — εγγραφή", group: "Πωλήσεις" },
  { code: "loyalty.read", label: "Loyalty — ανάγνωση", group: "Πωλήσεις" },
  { code: "loyalty.write", label: "Loyalty — εγγραφή", group: "Πωλήσεις" },
  { code: "products.read", label: "Προϊόντα — ανάγνωση", group: "Λειτουργίες" },
  { code: "products.write", label: "Προϊόντα — εγγραφή", group: "Λειτουργίες" },
  { code: "inventory.read", label: "Αποθήκη — ανάγνωση", group: "Λειτουργίες" },
  { code: "inventory.write", label: "Αποθήκη — εγγραφή", group: "Λειτουργίες" },
  { code: "purchasing.read", label: "Αγορές — ανάγνωση", group: "Λειτουργίες" },
  { code: "purchasing.write", label: "Αγορές — εγγραφή", group: "Λειτουργίες" },
  { code: "finance.read", label: "Οικονομικά", group: "Οργάνωση" },
  { code: "hr.read", label: "HR", group: "Οργάνωση" },
  { code: "reports.read", label: "Αναφορές", group: "Οργάνωση" },
  { code: "audit.read", label: "Audit log", group: "Οργάνωση" },
  { code: "settings.read", label: "Ρυθμίσεις — ανάγνωση", group: "Διαχείριση" },
  { code: "settings.write", label: "Ρυθμίσεις — εγγραφή", group: "Διαχείριση" },
  { code: "users.manage", label: "Διαχείριση χρηστών", group: "Διαχείριση" },
  { code: "roles.manage", label: "Διαχείριση ρόλων", group: "Διαχείριση" },
  { code: "groups.manage", label: "Διαχείριση ομάδων", group: "Διαχείριση" },
  { code: "menu.manage", label: "Παραμετροποίηση μενού", group: "Διαχείριση" },
] as const;

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]["code"];

export const SYSTEM_ROLE_PERMISSIONS: Record<
  "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  PermissionCode[]
> = {
  OWNER: PERMISSION_CATALOG.map((p) => p.code),
  ADMIN: PERMISSION_CATALOG.map((p) => p.code),
  MEMBER: [
    "dashboard.view",
    "customers.read",
    "customers.write",
    "quotes.read",
    "quotes.write",
    "orders.read",
    "orders.write",
    "invoices.read",
    "invoices.write",
    "pos.use",
    "gift_cards.read",
    "gift_cards.write",
    "loyalty.read",
    "loyalty.write",
    "products.read",
    "inventory.read",
    "purchasing.read",
    "finance.read",
    "reports.read",
  ],
  VIEWER: [
    "dashboard.view",
    "customers.read",
    "quotes.read",
    "orders.read",
    "invoices.read",
    "gift_cards.read",
    "loyalty.read",
    "products.read",
    "inventory.read",
    "purchasing.read",
    "finance.read",
    "reports.read",
  ],
};

export function hasPermission(
  permissions: string[] | undefined,
  code: PermissionCode | string,
) {
  if (!permissions) return false;
  return permissions.includes(code) || permissions.includes("*");
}

const permissionSet = new Set<string>(PERMISSION_CATALOG.map((p) => p.code));

export function isPermissionKey(code: string): code is PermissionCode {
  return permissionSet.has(code);
}

export function permissionsByGroup() {
  const map = new Map<string, typeof PERMISSION_CATALOG[number][]>();
  for (const p of PERMISSION_CATALOG) {
    const list = map.get(p.group) ?? [];
    list.push(p);
    map.set(p.group, list);
  }
  return [...map.entries()].map(([group, items]) => ({ group, items }));
}
