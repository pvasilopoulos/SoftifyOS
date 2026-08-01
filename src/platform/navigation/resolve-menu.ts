import { prisma } from "@/server/db";
import {
  defaultMenuTree,
  menuTreeToNavGroups,
  type MenuAudience,
  type MenuNodeConfig,
  type NavGroup,
  type NavItem,
} from "@/platform/navigation";
import {
  parseMobileFooterOverrides,
  resolveMobileTabsForAudience,
  type MobileFooterOverrides,
} from "@/platform/navigation/menu-tree";

/** Audit lives under Settings — strip legacy main-nav entries from stored menus. */
function stripLegacyAuditNav(nodes: MenuNodeConfig[]): MenuNodeConfig[] {
  return nodes
    .filter((n) => {
      if (n.id === "audit") return false;
      if (n.type === "link" && (n.href === "/audit" || n.href?.startsWith("/audit/"))) {
        return false;
      }
      return true;
    })
    .map((n) =>
      n.children?.length
        ? { ...n, children: stripLegacyAuditNav(n.children) }
        : n,
    );
}

function parseMenuJson(raw: unknown): MenuNodeConfig[] | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) return null;
  return stripLegacyAuditNav(raw as MenuNodeConfig[]);
}

export type TenantMenuSettings = {
  menuTree: MenuNodeConfig[];
  navGroupsDefaultExpanded: boolean;
  mobileFooterOverrides: MobileFooterOverrides;
};

export async function getTenantMenuSettings(
  tenantId: string,
): Promise<TenantMenuSettings> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: {
      menuJson: true,
      navGroupsDefaultExpanded: true,
      mobileFooterOverrides: true,
    },
  });
  return {
    menuTree: parseMenuJson(settings?.menuJson) ?? defaultMenuTree,
    navGroupsDefaultExpanded: settings?.navGroupsDefaultExpanded ?? true,
    mobileFooterOverrides: parseMobileFooterOverrides(
      settings?.mobileFooterOverrides,
    ),
  };
}

export async function getTenantMenuTree(tenantId: string): Promise<MenuNodeConfig[]> {
  const { menuTree } = await getTenantMenuSettings(tenantId);
  return menuTree;
}

/** Resolve UserGroup ids for a tenant membership (by user id). */
export async function getMembershipGroupIds(
  tenantId: string,
  userId: string,
): Promise<string[]> {
  const membership = await prisma.membership.findFirst({
    where: { tenantId, userId },
    select: {
      groups: { select: { groupId: true } },
    },
  });
  return membership?.groups.map((g) => g.groupId) ?? [];
}

export async function getMenuAudienceForSession(input: {
  tenantId: string;
  userId: string;
  role: string;
}): Promise<MenuAudience> {
  const groupIds = await getMembershipGroupIds(input.tenantId, input.userId);
  return {
    role: input.role,
    userId: input.userId,
    groupIds,
  };
}

export async function getNavForSession(input: {
  tenantId: string;
  role: string;
  userId?: string;
}): Promise<{
  groups: NavGroup[];
  mobileTabs: NavItem[];
  menuTree: MenuNodeConfig[];
  navGroupsDefaultExpanded: boolean;
  mobileFooterOverrides: MobileFooterOverrides;
  audience: MenuAudience;
}> {
  const { menuTree, navGroupsDefaultExpanded, mobileFooterOverrides } =
    await getTenantMenuSettings(input.tenantId);
  const audience: MenuAudience = input.userId
    ? await getMenuAudienceForSession({
        tenantId: input.tenantId,
        userId: input.userId,
        role: input.role,
      })
    : { role: input.role };

  const groups = menuTreeToNavGroups(
    menuTree,
    audience,
    navGroupsDefaultExpanded,
  );
  const mobileTabs: NavItem[] = resolveMobileTabsForAudience(
    groups,
    audience,
    mobileFooterOverrides,
  );
  return {
    groups,
    mobileTabs,
    menuTree,
    navGroupsDefaultExpanded,
    mobileFooterOverrides,
    audience,
  };
}
