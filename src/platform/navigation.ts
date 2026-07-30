import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Wallet,
  Users,
  UserRound,
  BarChart3,
  Settings,
  FileText,
  Truck,
  ScrollText,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  mobileTab?: boolean;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const navGroups: NavGroup[] = [
  {
    id: "main",
    label: "Κύρια",
    items: [
      {
        href: "/",
        label: "Πίνακας ελέγχου",
        icon: LayoutDashboard,
        mobileTab: true,
      },
    ],
  },
  {
    id: "sales",
    label: "Πωλήσεις",
    items: [
      {
        href: "/invoices",
        label: "Τιμολόγια",
        icon: FileText,
        mobileTab: true,
      },
      { href: "/orders", label: "Παραγγελίες", icon: ShoppingCart },
    ],
  },
  {
    id: "ops",
    label: "Λειτουργίες",
    items: [
      {
        href: "/inventory",
        label: "Αποθήκη",
        icon: Package,
        mobileTab: true,
      },
      { href: "/purchasing", label: "Αγορές", icon: Truck },
    ],
  },
  {
    id: "finance",
    label: "Οργάνωση",
    items: [
      { href: "/finance", label: "Οικονομικά", icon: Wallet },
      { href: "/crm", label: "CRM", icon: Users },
      { href: "/hr", label: "HR", icon: UserRound },
      { href: "/reports", label: "Αναφορές", icon: BarChart3 },
      { href: "/audit", label: "Audit log", icon: ScrollText },
      { href: "/settings", label: "Ρυθμίσεις", icon: Settings },
    ],
  },
];

export const mobileTabs: NavItem[] = [
  ...navGroups.flatMap((g) => g.items).filter((i) => i.mobileTab),
  {
    href: "/more",
    label: "Περισσότερα",
    icon: Settings,
    mobileTab: true,
  },
];

export const quickActions = [
  {
    id: "new-invoice",
    label: "Νέο τιμολόγιο",
    href: "/invoices?new=1",
    shortcut: "N I",
  },
  {
    id: "new-order",
    label: "Νέα παραγγελία",
    href: "/orders?new=1",
    shortcut: "N O",
  },
  {
    id: "open-customer",
    label: "Άνοιγμα πελάτη",
    href: "/crm",
    shortcut: "G C",
  },
  {
    id: "inventory",
    label: "Μετάβαση σε αποθήκη",
    href: "/inventory",
    shortcut: "G W",
  },
  {
    id: "overdue",
    label: "Αναφορά ληξιπρόθεσμων",
    href: "/invoices?status=overdue",
    shortcut: "G D",
  },
];
