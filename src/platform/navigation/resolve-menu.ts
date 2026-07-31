import { prisma } from "@/server/db";
import {
  defaultMenuTree,
  menuTreeToNavGroups,
  type MenuAudience,
  type MenuNodeConfig,
  type NavGroup,
  type NavItem,
} from "@/platform/navigation";
import { resolveMobileTabsFromGroups } from "@/platform/navigation/menu-tree";

function parseMenuJson(raw: unknown): MenuNodeConfig[] | null {
  if (!raw) return null;
  if (!Array.isArray(raw)) return null;
  return raw as MenuNodeConfig[];
}

export type TenantMenuSettings = {
  menuTree: MenuNodeConfig[];
  navGroupsDefaultExpanded: boolean;
};

export async function getTenantMenuSettings(
  tenantId: string,
): Promise<TenantMenuSettings> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { menuJson: true, navGroupsDefaultExpanded: true },
  });
  return {
    menuTree: parseMenuJson(settings?.menuJson) ?? defaultMenuTree,
    navGroupsDefaultExpanded: settings?.navGroupsDefaultExpanded ?? true,
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
  audience: MenuAudience;
}> {
  const { menuTree, navGroupsDefaultExpanded } = await getTenantMenuSettings(
    input.tenantId,
  );
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
  const mobileTabs: NavItem[] = resolveMobileTabsFromGroups(groups);
  return {
    groups,
    mobileTabs,
    menuTree,
    navGroupsDefaultExpanded,
    audience,
  };
}
