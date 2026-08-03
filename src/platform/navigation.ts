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
  Tags,
  ClipboardList,
  Store,
  Shield,
  FolderTree,
  Gift,
  Star,
  BookOpen,
  MoreHorizontal,
  type LucideIcon,
} from "lucide-react";

export type NavIconName =
  | "LayoutDashboard"
  | "Users"
  | "FileText"
  | "ShoppingCart"
  | "ClipboardList"
  | "Store"
  | "Gift"
  | "Star"
  | "Tags"
  | "Package"
  | "Truck"
  | "Wallet"
  | "UserRound"
  | "BarChart3"
  | "ScrollText"
  | "Settings"
  | "Shield"
  | "FolderTree"
  | "BookOpen";

export const navIconMap: Record<NavIconName, LucideIcon> = {
  LayoutDashboard,
  Users,
  FileText,
  ShoppingCart,
  ClipboardList,
  Store,
  Gift,
  Star,
  Tags,
  Package,
  Truck,
  Wallet,
  UserRound,
  BarChart3,
  ScrollText,
  Settings,
  Shield,
  FolderTree,
  BookOpen,
};

/** Serializable menu node (stored in DB / edited in settings) */
export type MenuNodeConfig = {
  id: string;
  /** folder | link */
  type: "folder" | "link";
  label: string;
  href?: string;
  icon?: NavIconName;
  visible?: boolean;
  /** Nested children for folders */
  children?: MenuNodeConfig[];
  /** Roles that can see this node; empty/undefined = all */
  roles?: Array<"OWNER" | "ADMIN" | "MEMBER" | "VIEWER">;
  /**
   * UserGroup ids that can see this node.
   * Empty/undefined = no group restriction.
   * Combined with userIds: visible if in any listed group OR any listed user.
   */
  groupIds?: string[];
  /**
   * User ids (User.id) that can see this node.
   * Empty/undefined = no user allowlist.
   */
  userIds?: string[];
  /** Folder default open/closed in sidebar (overrides tenant default) */
  defaultExpanded?: boolean;
  mobileTab?: boolean;
  /** Order among mobile footer tabs (0-based). Lower first. */
  mobileOrder?: number;
};

export type NavItem = {
  id: string;
  href: string;
  label: string;
  icon: LucideIcon;
  mobileTab?: boolean;
  mobileOrder?: number;
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
  /** Initial expand state before localStorage override */
  defaultExpanded?: boolean;
};

/** Audience used when resolving menu for a logged-in membership */
export type MenuAudience = {
  role?: string;
  userId?: string;
  groupIds?: string[];
};

export function nodeVisibleToAudience(
  node: MenuNodeConfig,
  audience?: MenuAudience,
): boolean {
  if (node.visible === false) return false;
  if (!roleAllowed(node, audience?.role)) return false;

  const groupIds = node.groupIds?.filter(Boolean) ?? [];
  const userIds = node.userIds?.filter(Boolean) ?? [];
  if (groupIds.length === 0 && userIds.length === 0) return true;

  const inGroup =
    groupIds.length > 0 &&
    Boolean(audience?.groupIds?.some((id) => groupIds.includes(id)));
  const inUser =
    userIds.length > 0 &&
    Boolean(audience?.userId && userIds.includes(audience.userId));

  return inGroup || inUser;
}

/** Default SoftifyOS menu — source of truth when tenant has no overrides */
export const defaultMenuTree: MenuNodeConfig[] = [
  {
    id: "main",
    type: "folder",
    label: "Κύρια",
    icon: "LayoutDashboard",
    children: [
      {
        id: "dashboard",
        type: "link",
        label: "Πίνακας ελέγχου",
        href: "/",
        icon: "LayoutDashboard",
        mobileTab: true,
        mobileOrder: 0,
      },
    ],
  },
  {
    id: "sales",
    type: "folder",
    label: "Πωλήσεις",
    icon: "ShoppingCart",
    children: [
      {
        id: "customers",
        type: "link",
        label: "Πελάτες",
        href: "/customers",
        icon: "Users",
        mobileTab: true,
        mobileOrder: 1,
      },
      {
        id: "crm",
        type: "link",
        label: "CRM",
        href: "/crm",
        icon: "FolderTree",
      },
      {
        id: "quotes",
        type: "link",
        label: "Προσφορές",
        href: "/quotes",
        icon: "ClipboardList",
      },
      {
        id: "orders",
        type: "link",
        label: "Παραγγελίες",
        href: "/orders",
        icon: "ShoppingCart",
      },
      {
        id: "invoices",
        type: "link",
        label: "Τιμολόγια",
        href: "/invoices",
        icon: "FileText",
      },
      {
        id: "delivery-notes",
        type: "link",
        label: "Δελτία αποστολής",
        href: "/delivery-notes",
        icon: "Truck",
      },
      {
        id: "pos",
        type: "link",
        label: "POS Λιανική",
        href: "/pos",
        icon: "Store",
      },
      {
        id: "gift-cards",
        type: "link",
        label: "Δωροκάρτες",
        href: "/gift-cards",
        icon: "Gift",
      },
      {
        id: "loyalty",
        type: "link",
        label: "Loyalty",
        href: "/loyalty",
        icon: "Star",
      },
    ],
  },
  {
    id: "ops",
    type: "folder",
    label: "Λειτουργίες",
    icon: "Package",
    children: [
      {
        id: "products",
        type: "link",
        label: "Προϊόντα",
        href: "/products",
        icon: "Tags",
      },
      {
        id: "inventory",
        type: "link",
        label: "Αποθήκη",
        href: "/inventory",
        icon: "Package",
        mobileTab: true,
        mobileOrder: 2,
      },
      {
        id: "purchasing",
        type: "link",
        label: "Αγορές",
        href: "/purchasing",
        icon: "Truck",
      },
    ],
  },
  {
    id: "org",
    type: "folder",
    label: "Οργάνωση",
    icon: "Settings",
    children: [
      {
        id: "finance",
        type: "link",
        label: "Οικονομικά",
        href: "/finance",
        icon: "Wallet",
      },
      {
        id: "mydata",
        type: "link",
        label: "myDATA Live",
        href: "/mydata",
        icon: "ScrollText",
      },
      {
        id: "hr",
        type: "link",
        label: "HR",
        href: "/hr",
        icon: "UserRound",
      },
      {
        id: "reports",
        type: "link",
        label: "Αναφορές & BI",
        href: "/reports",
        icon: "BarChart3",
      },
      {
        id: "docs",
        type: "link",
        label: "Docs",
        href: "/docs",
        icon: "BookOpen",
      },
      {
        id: "settings",
        type: "link",
        label: "Ρυθμίσεις",
        href: "/settings",
        icon: "Settings",
        roles: ["OWNER", "ADMIN"],
      },
    ],
  },
];

export function resolveIcon(name?: NavIconName): LucideIcon {
  if (!name) return FolderTree;
  return navIconMap[name] ?? FolderTree;
}

function roleAllowed(
  node: MenuNodeConfig,
  role: string | undefined,
): boolean {
  if (!node.roles || node.roles.length === 0) return true;
  if (!role) return true;
  return node.roles.includes(role as MenuNodeConfig["roles"] extends
    | Array<infer R>
    | undefined
    ? R
    : never);
}

/** Flatten configurable tree → sidebar groups (folders → groups, nested folders recurse) */
export function menuTreeToNavGroups(
  tree: MenuNodeConfig[],
  roleOrAudience?: string | MenuAudience,
  tenantDefaultExpanded = true,
): NavGroup[] {
  const audience: MenuAudience =
    typeof roleOrAudience === "string" || roleOrAudience == null
      ? { role: roleOrAudience }
      : roleOrAudience;

  const groups: NavGroup[] = [];

  function walk(nodes: MenuNodeConfig[]) {
    for (const node of nodes) {
      if (!nodeVisibleToAudience(node, audience)) continue;

      if (node.type === "folder") {
        const items: NavItem[] = [];
        const nested: MenuNodeConfig[] = [];
        for (const child of node.children ?? []) {
          if (!nodeVisibleToAudience(child, audience)) continue;
          if (child.type === "folder") {
            nested.push(child);
            continue;
          }
          if (child.type !== "link" || !child.href) continue;
          items.push({
            id: child.id,
            href: child.href,
            label: child.label,
            icon: resolveIcon(child.icon),
            mobileTab: child.mobileTab,
            mobileOrder: child.mobileOrder,
          });
        }
        if (items.length > 0) {
          groups.push({
            id: node.id,
            label: node.label,
            items,
            defaultExpanded: node.defaultExpanded ?? tenantDefaultExpanded,
          });
        }
        if (nested.length > 0) walk(nested);
      } else if (node.type === "link" && node.href) {
        groups.push({
          id: node.id,
          label: node.label,
          items: [
            {
              id: node.id,
              href: node.href,
              label: node.label,
              icon: resolveIcon(node.icon),
              mobileTab: node.mobileTab,
              mobileOrder: node.mobileOrder,
            },
          ],
          defaultExpanded: tenantDefaultExpanded,
        });
      }
    }
  }

  walk(tree);
  return groups;
}

/** @deprecated use menuTreeToNavGroups(defaultMenuTree) — kept for gradual migration */
export const navGroups: NavGroup[] = menuTreeToNavGroups(defaultMenuTree);

/** @deprecated use resolveMobileTabsFromGroups — kept for gradual migration */
export const mobileTabs: NavItem[] = [
  ...navGroups
    .flatMap((g) => g.items)
    .filter((i) => i.mobileTab)
    .sort((a, b) => (a.mobileOrder ?? 999) - (b.mobileOrder ?? 999))
    .slice(0, 3),
  {
    id: "more",
    href: "/more",
    label: "Περισσότερα",
    icon: MoreHorizontal,
    mobileTab: true,
  },
];

export const quickActions = [
  {
    id: "new-invoice",
    label: "Νέο τιμολόγιο",
    href: "/invoices/new",
    shortcut: "N I",
  },
  {
    id: "new-order",
    label: "Νέα παραγγελία",
    href: "/orders/new",
    shortcut: "N O",
  },
  {
    id: "new-quote",
    label: "Νέα προσφορά",
    href: "/quotes/new",
    shortcut: "N Q",
  },
  {
    id: "pos",
    label: "Άνοιγμα POS",
    href: "/pos",
    shortcut: "G R",
  },
  {
    id: "open-customer",
    label: "Άνοιγμα πελάτη",
    href: "/customers",
    shortcut: "G C",
  },
  {
    id: "open-products",
    label: "Κατάλογος προϊόντων",
    href: "/products",
    shortcut: "G P",
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
