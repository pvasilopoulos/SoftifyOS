import { prisma } from "@/server/db";
import {
  defaultMenuTree,
  menuTreeToNavGroups,
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

export async function getTenantMenuTree(tenantId: string): Promise<MenuNodeConfig[]> {
  const settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    select: { menuJson: true },
  });
  return parseMenuJson(settings?.menuJson) ?? defaultMenuTree;
}

export async function getNavForSession(input: {
  tenantId: string;
  role: string;
}): Promise<{ groups: NavGroup[]; mobileTabs: NavItem[]; menuTree: MenuNodeConfig[] }> {
  const menuTree = await getTenantMenuTree(input.tenantId);
  const groups = menuTreeToNavGroups(menuTree, input.role);
  const mobileTabs: NavItem[] = resolveMobileTabsFromGroups(groups);
  return { groups, mobileTabs, menuTree };
}
