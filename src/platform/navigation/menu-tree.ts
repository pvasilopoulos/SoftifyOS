import {
  defaultMenuTree,
  type MenuNodeConfig,
  type NavGroup,
  type NavItem,
} from "@/platform/navigation";
import { MoreHorizontal } from "lucide-react";

export const MORE_NAV_ITEM: NavItem = {
  id: "more",
  href: "/more",
  label: "Περισσότερα",
  icon: MoreHorizontal,
  mobileTab: true,
};

/** Max custom tabs in the mobile footer; "Περισσότερα" is always appended. */
export const MOBILE_FOOTER_SLOT_COUNT = 3;

export function cloneMenuTree(tree: MenuNodeConfig[]): MenuNodeConfig[] {
  return JSON.parse(JSON.stringify(tree)) as MenuNodeConfig[];
}

export function walkMenuNodes(
  tree: MenuNodeConfig[],
  visit: (node: MenuNodeConfig, parent: MenuNodeConfig | null) => void,
  parent: MenuNodeConfig | null = null,
): void {
  for (const node of tree) {
    visit(node, parent);
    if (node.children?.length) walkMenuNodes(node.children, visit, node);
  }
}

export function collectLinkNodes(tree: MenuNodeConfig[]): MenuNodeConfig[] {
  const links: MenuNodeConfig[] = [];
  walkMenuNodes(tree, (node) => {
    if (node.type === "link") links.push(node);
  });
  return links;
}

export function collectNodeIds(tree: MenuNodeConfig[]): Set<string> {
  const ids = new Set<string>();
  walkMenuNodes(tree, (node) => ids.add(node.id));
  return ids;
}

/** Link templates from the default menu that are not currently in the tree. */
export function getAvailableCatalogLinks(
  tree: MenuNodeConfig[],
  catalogSource: MenuNodeConfig[] = defaultMenuTree,
): MenuNodeConfig[] {
  const used = collectNodeIds(tree);
  const available: MenuNodeConfig[] = [];
  walkMenuNodes(catalogSource, (node) => {
    if (node.type === "link" && node.href && !used.has(node.id)) {
      available.push({
        id: node.id,
        type: "link",
        label: node.label,
        href: node.href,
        icon: node.icon,
        roles: node.roles ? [...node.roles] : undefined,
        visible: true,
        mobileTab: false,
      });
    }
  });
  return available.sort((a, b) => a.label.localeCompare(b.label, "el"));
}

export function findNodeLocation(
  tree: MenuNodeConfig[],
  id: string,
): {
  node: MenuNodeConfig;
  parentId: string | null;
  index: number;
  siblings: MenuNodeConfig[];
} | null {
  for (let i = 0; i < tree.length; i++) {
    const node = tree[i];
    if (!node) continue;
    if (node.id === id) {
      return { node, parentId: null, index: i, siblings: tree };
    }
    if (node.children?.length) {
      const found = findNodeLocation(node.children, id);
      if (found) {
        if (found.parentId === null && found.siblings === node.children) {
          return { ...found, parentId: node.id };
        }
        return found;
      }
    }
  }
  return null;
}

export function getChildrenOf(
  tree: MenuNodeConfig[],
  parentId: string | null,
): MenuNodeConfig[] {
  if (parentId === null) return tree;
  const loc = findNodeLocation(tree, parentId);
  if (!loc || loc.node.type !== "folder") return [];
  return loc.node.children ?? [];
}

export function removeNodeById(
  tree: MenuNodeConfig[],
  id: string,
): { tree: MenuNodeConfig[]; removed: MenuNodeConfig | null } {
  const next = cloneMenuTree(tree);
  const loc = findNodeLocation(next, id);
  if (!loc) return { tree: next, removed: null };
  const [removed] = loc.siblings.splice(loc.index, 1);
  return { tree: next, removed: removed ?? null };
}

export function insertNodeAt(
  tree: MenuNodeConfig[],
  parentId: string | null,
  index: number,
  node: MenuNodeConfig,
): MenuNodeConfig[] {
  const next = cloneMenuTree(tree);
  if (parentId === null) {
    next.splice(Math.max(0, Math.min(index, next.length)), 0, node);
    return next;
  }
  const loc = findNodeLocation(next, parentId);
  if (!loc || loc.node.type !== "folder") return next;
  const children = loc.node.children ?? [];
  children.splice(Math.max(0, Math.min(index, children.length)), 0, node);
  loc.node.children = children;
  return next;
}

/** Move a node within the tree (same or different parent). */
export function moveNodeInTree(
  tree: MenuNodeConfig[],
  activeId: string,
  overId: string,
  placement: "before" | "after" | "into" = "before",
): MenuNodeConfig[] {
  if (activeId === overId) return tree;
  const activeLoc = findNodeLocation(tree, activeId);
  if (!activeLoc) return tree;

  // Prevent dropping a folder into its own descendant
  if (activeLoc.node.type === "folder" && placement === "into") {
    const overLoc = findNodeLocation(tree, overId);
    if (overLoc) {
      let cursor: string | null = overLoc.parentId;
      while (cursor) {
        if (cursor === activeId) return tree;
        cursor = findNodeLocation(tree, cursor)?.parentId ?? null;
      }
      if (overId === activeId) return tree;
    }
  }

  const { tree: without, removed } = removeNodeById(tree, activeId);
  if (!removed) return tree;

  if (placement === "into") {
    const overLoc = findNodeLocation(without, overId);
    if (!overLoc || overLoc.node.type !== "folder") return tree;
    const children = overLoc.node.children ?? [];
    return insertNodeAt(without, overId, children.length, removed);
  }

  const overLoc = findNodeLocation(without, overId);
  if (!overLoc) return tree;
  let index = overLoc.index;
  if (placement === "after") index += 1;
  return insertNodeAt(without, overLoc.parentId, index, removed);
}

export function getMobileFooterIds(tree: MenuNodeConfig[]): string[] {
  return collectLinkNodes(tree)
    .filter((n) => n.mobileTab)
    .sort((a, b) => (a.mobileOrder ?? 999) - (b.mobileOrder ?? 999))
    .slice(0, MOBILE_FOOTER_SLOT_COUNT)
    .map((n) => n.id);
}

export function applyMobileFooterIds(
  tree: MenuNodeConfig[],
  footerIds: string[],
): MenuNodeConfig[] {
  const allowed = footerIds
    .filter((id) => id !== MORE_NAV_ITEM.id)
    .slice(0, MOBILE_FOOTER_SLOT_COUNT);
  const order = new Map(allowed.map((id, i) => [id, i]));
  const next = cloneMenuTree(tree);
  walkMenuNodes(next, (node) => {
    if (node.type !== "link") return;
    const idx = order.get(node.id);
    if (idx === undefined) {
      node.mobileTab = false;
      delete node.mobileOrder;
    } else {
      node.mobileTab = true;
      node.mobileOrder = idx;
    }
  });
  return next;
}

export function resolveMobileTabsFromGroups(groups: NavGroup[]): NavItem[] {
  const custom = groups
    .flatMap((g) => g.items)
    .filter((i) => i.mobileTab)
    .sort((a, b) => (a.mobileOrder ?? 999) - (b.mobileOrder ?? 999))
    .slice(0, MOBILE_FOOTER_SLOT_COUNT);
  return [...custom, MORE_NAV_ITEM];
}
