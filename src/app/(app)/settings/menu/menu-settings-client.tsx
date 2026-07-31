"use client";

import { createElement, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  FolderPlus,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Search,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  defaultMenuTree,
  resolveIcon,
  type MenuNodeConfig,
} from "@/platform/navigation";
import {
  MOBILE_FOOTER_SLOT_COUNT,
  MORE_NAV_ITEM,
  applyMobileFooterIds,
  cloneMenuTree,
  collectLinkNodes,
  collectNodeIds,
  getChildrenOf,
  getMenuCatalog,
  getMobileFooterIds,
  insertNodeAt,
  moveNodeInTree,
  type MobileFooterOverrides,
} from "@/platform/navigation/menu-tree";

type AudienceGroup = { id: string; code: string; name: string };
type AudienceUser = { id: string; name: string; email: string };

type AudienceOptions = {
  groups: AudienceGroup[];
  users: AudienceUser[];
};

const MEMBERSHIP_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

type DragData =
  | { kind: "tree"; id: string }
  | { kind: "catalog"; node: MenuNodeConfig };

function toggleId(list: string[] | undefined, id: string): string[] {
  const cur = list ?? [];
  return cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
}

function SortableMenuRow({
  node,
  depth,
  onChange,
  onRemove,
  audienceOptions,
  tenantDefaultExpanded,
}: {
  node: MenuNodeConfig;
  depth: number;
  onChange: (id: string, fn: (n: MenuNodeConfig) => MenuNodeConfig) => void;
  onRemove: (id: string) => void;
  audienceOptions: AudienceOptions;
  tenantDefaultExpanded: boolean;
}) {
  const [openAccess, setOpenAccess] = useState(false);
  const hidden = node.visible === false;
  const hasAudience =
    (node.groupIds?.length ?? 0) > 0 ||
    (node.userIds?.length ?? 0) > 0 ||
    (node.roles?.length ?? 0) > 0;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: node.id,
    data: { kind: "tree", id: node.id } satisfies DragData,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    marginLeft: depth * 16,
  };

  const folderExpanded = node.defaultExpanded ?? tenantDefaultExpanded;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-xl border border-slate-200/80 bg-white",
        hidden && "opacity-55",
        isDragging && "z-10 opacity-40 shadow-md",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-2">
        <button
          type="button"
          className="cursor-grab touch-none rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          title="Σύρε για αναδιάταξη"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </button>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            node.type === "folder"
              ? "bg-slate-100 text-slate-600"
              : "bg-teal-50 text-teal-800",
          )}
        >
          {node.type === "folder" ? "Φάκελος" : "Σύνδεσμος"}
        </span>
        <input
          value={node.label}
          onChange={(e) =>
            onChange(node.id, (n) => ({ ...n, label: e.target.value }))
          }
          className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-medium text-ink-950 outline-none focus:border-slate-200 focus:bg-slate-50"
        />
        {node.href ? (
          <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
            {node.href}
          </span>
        ) : null}
        <button
          type="button"
          title="Πρόσβαση (ρόλοι / ομάδες / χρήστες)"
          onClick={() => setOpenAccess((v) => !v)}
          className={cn(
            "rounded-lg p-1.5 hover:bg-slate-100",
            hasAudience || openAccess
              ? "text-teal-700"
              : "text-slate-500",
          )}
        >
          <Users size={16} />
        </button>
        <button
          type="button"
          title={hidden ? "Εμφάνιση" : "Απόκρυψη"}
          onClick={() =>
            onChange(node.id, (n) => ({
              ...n,
              visible: n.visible === false ? true : false,
            }))
          }
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
        >
          {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button
          type="button"
          title="Αφαίρεση"
          onClick={() => onRemove(node.id)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
        >
          <Trash2 size={16} />
        </button>
        <button
          type="button"
          aria-expanded={openAccess}
          onClick={() => setOpenAccess((v) => !v)}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
        >
          <ChevronDown
            size={14}
            className={cn(
              "transition-transform",
              openAccess && "rotate-180",
            )}
          />
        </button>
      </div>

      {openAccess ? (
        <div className="space-y-3 border-t border-slate-100 px-3 py-3">
          {node.type === "folder" ? (
            <label className="flex items-center justify-between gap-3 text-sm text-ink-900">
              <span>
                Expand από προεπιλογή
                <span className="mt-0.5 block text-xs text-slate-500">
                  Ναι = ανοιχτός φάκελος στο sidebar
                </span>
              </span>
              <select
                value={folderExpanded ? "yes" : "no"}
                onChange={(e) =>
                  onChange(node.id, (n) => ({
                    ...n,
                    defaultExpanded: e.target.value === "yes",
                  }))
                }
                className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-teal-300 focus:bg-white"
              >
                <option value="yes">Ναι</option>
                <option value="no">Όχι</option>
              </select>
            </label>
          ) : null}

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Ρόλοι membership
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MEMBERSHIP_ROLES.map((role) => {
                const active = (node.roles ?? []).includes(role);
                return (
                  <button
                    key={role}
                    type="button"
                    onClick={() =>
                      onChange(node.id, (n) => ({
                        ...n,
                        roles: toggleId(n.roles, role) as MenuNodeConfig["roles"],
                      }))
                    }
                    className={cn(
                      "rounded-lg border px-2 py-1 text-xs font-medium",
                      active
                        ? "border-teal-300 bg-teal-50 text-teal-900"
                        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    {role}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[11px] text-slate-400">
              Κενό = όλοι οι ρόλοι
            </p>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Ομάδες χρηστών
            </p>
            {audienceOptions.groups.length === 0 ? (
              <p className="text-xs text-slate-500">
                Δεν υπάρχουν ομάδες. Δημιούργησε στο Ρυθμίσεις → Ομάδες.
              </p>
            ) : (
              <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
                {audienceOptions.groups.map((g) => {
                  const active = (node.groupIds ?? []).includes(g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      title={g.code}
                      onClick={() =>
                        onChange(node.id, (n) => ({
                          ...n,
                          groupIds: toggleId(n.groupIds, g.id),
                        }))
                      }
                      className={cn(
                        "rounded-lg border px-2 py-1 text-xs font-medium",
                        active
                          ? "border-teal-300 bg-teal-50 text-teal-900"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {g.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Συγκεκριμένοι χρήστες
            </p>
            {audienceOptions.users.length === 0 ? (
              <p className="text-xs text-slate-500">Δεν υπάρχουν χρήστες.</p>
            ) : (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-lg border border-slate-100 p-1.5">
                {audienceOptions.users.map((u) => {
                  const active = (node.userIds ?? []).includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50",
                        active && "bg-teal-50/70",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={() =>
                          onChange(node.id, (n) => ({
                            ...n,
                            userIds: toggleId(n.userIds, u.id),
                          }))
                        }
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-ink-900">
                        {u.name}
                      </span>
                      <span className="truncate text-slate-400">{u.email}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-400">
              Αν οριστούν ομάδες ή χρήστες, εμφανίζεται μόνο σε αυτούς (OR). Οι
              ρόλοι ισχύουν πάντα επιπλέον.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FolderDropZone({
  folderId,
  label,
  children,
}: {
  folderId: string;
  label: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-drop:${folderId}`,
    data: { kind: "folder-drop", folderId },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "space-y-1 rounded-xl border border-dashed border-transparent p-1 transition",
        isOver && "border-teal-300 bg-teal-50/50",
      )}
    >
      <p className="px-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      {children}
    </div>
  );
}

function CatalogItem({
  node,
  inMenu,
  onAdd,
}: {
  node: MenuNodeConfig;
  inMenu: boolean;
  onAdd: (node: MenuNodeConfig) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `catalog:${node.id}`,
    data: { kind: "catalog", node } satisfies DragData,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex items-center gap-2 rounded-xl border bg-white px-2 py-2",
        inMenu
          ? "border-slate-100 bg-slate-50/80"
          : "border-slate-200/80 shadow-sm shadow-slate-900/5",
        isDragging && "opacity-40",
      )}
    >
      <button
        type="button"
        className="cursor-grab touch-none rounded-lg p-1 text-slate-400 hover:bg-slate-100 active:cursor-grabbing"
        title="Σύρε στο μενού"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <span
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-lg",
          inMenu ? "bg-slate-200/70 text-slate-500" : "bg-teal-50 text-teal-700",
        )}
      >
        {createElement(resolveIcon(node.icon), { size: 14 })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{node.label}</p>
        <p className="truncate text-[11px] text-slate-400">{node.href}</p>
        {inMenu ? (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-medium text-slate-500">
            <Check size={10} /> ήδη στο μενού
          </p>
        ) : (
          <p className="mt-0.5 text-[10px] font-medium text-teal-700">
            διαθέσιμο για προσθήκη
          </p>
        )}
      </div>
      <button
        type="button"
        title={inMenu ? "Προσθήκη αντιγράφου" : "Προσθήκη στο μενού"}
        onClick={() => onAdd(node)}
        className={cn(
          "rounded-lg p-1.5",
          inMenu
            ? "text-slate-600 hover:bg-slate-200/70"
            : "text-teal-700 hover:bg-teal-50",
        )}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

function TreeBranch({
  nodes,
  depth,
  onChange,
  onRemove,
  audienceOptions,
  tenantDefaultExpanded,
}: {
  nodes: MenuNodeConfig[];
  depth: number;
  onChange: (id: string, fn: (n: MenuNodeConfig) => MenuNodeConfig) => void;
  onRemove: (id: string) => void;
  audienceOptions: AudienceOptions;
  tenantDefaultExpanded: boolean;
}) {
  return (
    <SortableContext
      items={nodes.map((n) => n.id)}
      strategy={verticalListSortingStrategy}
    >
      <div className="space-y-1">
        {nodes.map((node) => (
          <div key={node.id} className="space-y-1">
            <SortableMenuRow
              node={node}
              depth={depth}
              onChange={onChange}
              onRemove={onRemove}
              audienceOptions={audienceOptions}
              tenantDefaultExpanded={tenantDefaultExpanded}
            />
            {node.type === "folder" ? (
              <FolderDropZone folderId={node.id} label={`Μέσα: ${node.label}`}>
                <TreeBranch
                  nodes={node.children ?? []}
                  depth={depth + 1}
                  onChange={onChange}
                  onRemove={onRemove}
                  audienceOptions={audienceOptions}
                  tenantDefaultExpanded={tenantDefaultExpanded}
                />
              </FolderDropZone>
            ) : null}
          </div>
        ))}
      </div>
    </SortableContext>
  );
}

type FooterScope =
  | { kind: "default" }
  | { kind: "group"; id: string }
  | { kind: "user"; id: string };

function MobileFooterEditor({
  tree,
  overrides,
  audienceOptions,
  onChangeDefaultFooter,
  onChangeOverrides,
}: {
  tree: MenuNodeConfig[];
  overrides: MobileFooterOverrides;
  audienceOptions: AudienceOptions;
  onChangeDefaultFooter: (ids: string[]) => void;
  onChangeOverrides: (next: MobileFooterOverrides) => void;
}) {
  const [scopeKind, setScopeKind] = useState<"default" | "group" | "user">(
    "default",
  );
  const [scopeId, setScopeId] = useState("");

  const defaultFooterIds = getMobileFooterIds(tree);
  const links = collectLinkNodes(tree).filter((n) => n.visible !== false);
  const byId = new Map(links.map((n) => [n.id, n]));

  const scope: FooterScope =
    scopeKind === "default"
      ? { kind: "default" }
      : scopeKind === "group" && scopeId
        ? { kind: "group", id: scopeId }
        : scopeKind === "user" && scopeId
          ? { kind: "user", id: scopeId }
          : { kind: "default" };

  const hasOverride =
    (scope.kind === "group" &&
      Boolean(overrides.byGroupId?.[scope.id]?.length)) ||
    (scope.kind === "user" && Boolean(overrides.byUserId?.[scope.id]?.length));

  const footerIds =
    scope.kind === "group"
      ? (overrides.byGroupId?.[scope.id] ?? [])
      : scope.kind === "user"
        ? (overrides.byUserId?.[scope.id] ?? [])
        : defaultFooterIds;

  const commitIds = (ids: string[]) => {
    const clean = ids.filter(Boolean).slice(0, MOBILE_FOOTER_SLOT_COUNT);
    if (scope.kind === "default") {
      onChangeDefaultFooter(clean);
      return;
    }
    const next: MobileFooterOverrides = {
      byUserId: { ...(overrides.byUserId ?? {}) },
      byGroupId: { ...(overrides.byGroupId ?? {}) },
    };
    if (scope.kind === "group") {
      if (clean.length) next.byGroupId![scope.id] = clean;
      else delete next.byGroupId![scope.id];
    } else {
      if (clean.length) next.byUserId![scope.id] = clean;
      else delete next.byUserId![scope.id];
    }
    onChangeOverrides(next);
  };

  const setSlot = (index: number, linkId: string) => {
    const slots = Array.from(
      { length: MOBILE_FOOTER_SLOT_COUNT },
      (_, i) => footerIds[i] ?? "",
    );
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === linkId) slots[i] = "";
    }
    slots[index] = linkId;
    commitIds(slots.filter(Boolean));
  };

  const moveSlot = (index: number, dir: -1 | 1) => {
    const next = [...footerIds];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target]!;
    next[target] = tmp!;
    commitIds(next);
  };

  const clearOverride = () => {
    if (scope.kind === "default") return;
    commitIds([]);
  };

  const copyFromDefault = () => {
    commitIds(defaultFooterIds);
  };

  const previewItems: Array<{
    id: string;
    label: string;
    iconName?: MenuNodeConfig["icon"];
    isMore?: boolean;
  }> = [
    ...footerIds
      .map((id) => byId.get(id))
      .filter((n): n is MenuNodeConfig => Boolean(n))
      .map((n) => ({
        id: n.id,
        label: n.label,
        iconName: n.icon,
      })),
    {
      id: MORE_NAV_ITEM.id,
      label: MORE_NAV_ITEM.label,
      isMore: true,
    },
  ].slice(0, 4);

  const userCount = Object.keys(overrides.byUserId ?? {}).length;
  const groupCount = Object.keys(overrides.byGroupId ?? {}).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-ink-900">Footer κινητού</h2>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Έως {MOBILE_FOOTER_SLOT_COUNT} συντομεύσεις· προτεραιότητα: χρήστης →
        ομάδα → προεπιλογή. «Περισσότερα» πάντα τελευταίο.
      </p>

      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-2.5">
        <label className="block text-[11px] font-medium uppercase tracking-wide text-slate-500">
          Ισχύει για
        </label>
        <select
          value={scopeKind}
          onChange={(e) => {
            const kind = e.target.value as "default" | "group" | "user";
            setScopeKind(kind);
            if (kind === "group") {
              setScopeId(audienceOptions.groups[0]?.id ?? "");
            } else if (kind === "user") {
              setScopeId(audienceOptions.users[0]?.id ?? "");
            } else {
              setScopeId("");
            }
          }}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-teal-300"
        >
          <option value="default">Προεπιλογή tenant</option>
          <option value="group">Ομάδα χρηστών</option>
          <option value="user">Συγκεκριμένος χρήστης</option>
        </select>
        {scopeKind === "group" ? (
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-teal-300"
          >
            {audienceOptions.groups.length === 0 ? (
              <option value="">— Δεν υπάρχουν ομάδες —</option>
            ) : null}
            {audienceOptions.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.code})
                {overrides.byGroupId?.[g.id]?.length ? " · override" : ""}
              </option>
            ))}
          </select>
        ) : null}
        {scopeKind === "user" ? (
          <select
            value={scopeId}
            onChange={(e) => setScopeId(e.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-teal-300"
          >
            {audienceOptions.users.length === 0 ? (
              <option value="">— Δεν υπάρχουν χρήστες —</option>
            ) : null}
            {audienceOptions.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {overrides.byUserId?.[u.id]?.length ? " · override" : ""}
              </option>
            ))}
          </select>
        ) : null}
        <p className="text-[11px] text-slate-500">
          {scope.kind === "default"
            ? "Ορίζεται στα nodes του μενού (mobileTab)."
            : hasOverride
              ? "Ενεργό override για αυτή την επιλογή."
              : "Δεν υπάρχει override — χρησιμοποιείται η προεπιλογή μέχρι να ορίσεις slots."}
          {(userCount > 0 || groupCount > 0) && scope.kind === "default"
            ? ` · Overrides: ${groupCount} ομάδες, ${userCount} χρήστες.`
            : null}
        </p>
        {scope.kind !== "default" ? (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={copyFromDefault}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            >
              Αντιγραφή από προεπιλογή
            </button>
            {hasOverride ? (
              <button
                type="button"
                onClick={clearOverride}
                className="rounded-md border border-rose-200 bg-white px-2 py-1 text-[11px] font-medium text-rose-700 hover:bg-rose-50"
              >
                Καθαρισμός override
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="space-y-2">
        {Array.from({ length: MOBILE_FOOTER_SLOT_COUNT }).map((_, index) => {
          const selected = footerIds[index] ?? "";
          const disabledEditor =
            (scopeKind === "group" || scopeKind === "user") && !scopeId;
          return (
            <div
              key={index}
              className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 py-2"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-100 text-[11px] font-semibold text-slate-600">
                {index + 1}
              </span>
              <select
                value={selected}
                disabled={disabledEditor}
                onChange={(e) => setSlot(index, e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-teal-300 focus:bg-white disabled:opacity-50"
              >
                <option value="">— Κενό —</option>
                {links.map((link) => (
                  <option
                    key={link.id}
                    value={link.id}
                    disabled={
                      footerIds.includes(link.id) && footerIds[index] !== link.id
                    }
                  >
                    {link.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={disabledEditor || index === 0}
                onClick={() => moveSlot(index, -1)}
                className="rounded-lg px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabledEditor || index >= footerIds.length - 1}
                onClick={() => moveSlot(index, 1)}
                className="rounded-lg px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                ↓
              </button>
            </div>
          );
        })}
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-2 py-2 opacity-90">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-slate-200/80 text-[11px] font-semibold text-slate-600">
            4
          </span>
          <MoreHorizontal size={14} className="text-slate-500" />
          <span className="text-sm font-medium text-slate-600">Περισσότερα</span>
          <span className="ml-auto text-[11px] text-slate-400">σταθερό</span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-ink-950 px-3 pb-3 pt-4 shadow-inner">
        <p className="mb-2 text-center text-[10px] font-medium uppercase tracking-wider text-slate-400">
          Προεπισκόπηση
        </p>
        <div className="grid grid-cols-4 gap-1 rounded-xl bg-white px-1 py-2">
          {previewItems.map((item) => (
            <div
              key={item.id}
              className="flex flex-col items-center gap-1 px-0.5 text-[10px] text-slate-600"
            >
              {item.isMore
                ? createElement(MoreHorizontal, { size: 16 })
                : createElement(resolveIcon(item.iconName), { size: 16 })}
              <span className="w-full truncate text-center font-medium">
                {item.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function MenuSettingsClient({
  initialMenu,
  initialNavGroupsDefaultExpanded = true,
  initialMobileFooterOverrides,
  audienceOptions,
}: {
  initialMenu: MenuNodeConfig[];
  initialNavGroupsDefaultExpanded?: boolean;
  initialMobileFooterOverrides?: MobileFooterOverrides;
  audienceOptions: AudienceOptions;
}) {
  const [tree, setTree] = useState(() => cloneMenuTree(initialMenu));
  const [navGroupsDefaultExpanded, setNavGroupsDefaultExpanded] = useState(
    initialNavGroupsDefaultExpanded,
  );
  const [footerOverrides, setFooterOverrides] = useState<MobileFooterOverrides>(
    () => ({
      byUserId: { ...(initialMobileFooterOverrides?.byUserId ?? {}) },
      byGroupId: { ...(initialMobileFooterOverrides?.byGroupId ?? {}) },
    }),
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [customHref, setCustomHref] = useState("");

  const catalog = useMemo(
    () => getMenuCatalog(tree, defaultMenuTree),
    [tree],
  );

  const filteredCatalog = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter((entry) => {
      const hay = `${entry.node.label} ${entry.node.href ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [catalog, catalogQuery]);

  const missingCount = catalog.filter((e) => !e.inMenu).length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const defaultFolderId = tree.find((n) => n.type === "folder")?.id ?? null;

  const updateNode = (id: string, fn: (n: MenuNodeConfig) => MenuNodeConfig) => {
    setTree((prev) => {
      const next = cloneMenuTree(prev);
      const walk = (nodes: MenuNodeConfig[]): boolean => {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (!n) continue;
          if (n.id === id) {
            nodes[i] = fn(n);
            return true;
          }
          if (n.children && walk(n.children)) return true;
        }
        return false;
      };
      walk(next);
      return next;
    });
    setMessage(null);
  };

  const removeNode = (id: string) => {
    setTree((prev) => {
      const cloned = cloneMenuTree(prev);
      const remove = (nodes: MenuNodeConfig[]): boolean => {
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (!n) continue;
          if (n.id === id) {
            if (n.type === "folder" && (n.children?.length ?? 0) > 0) {
              nodes.splice(i, 1, ...(n.children ?? []));
            } else {
              nodes.splice(i, 1);
            }
            return true;
          }
          if (n.children && remove(n.children)) return true;
        }
        return false;
      };
      remove(cloned);
      return cloned;
    });
    setMessage(null);
  };

  const addCatalogNode = (node: MenuNodeConfig, folderId?: string | null) => {
    const target =
      folderId ??
      defaultFolderId ??
      tree.find((n) => n.type === "folder")?.id ??
      null;
    setTree((prev) => {
      const used = collectNodeIds(prev);
      const baseId = node.id || "custom";
      const id = used.has(baseId)
        ? `${baseId}-${Math.random().toString(36).slice(2, 8)}`
        : baseId;
      const clean: MenuNodeConfig = {
        ...cloneMenuTree([node])[0]!,
        id,
        mobileTab: false,
        visible: true,
      };
      delete clean.mobileOrder;
      if (target) {
        const kids = getChildrenOf(prev, target);
        return insertNodeAt(prev, target, kids.length, clean);
      }
      return [...cloneMenuTree(prev), clean];
    });
    setMessage(
      `Προστέθηκε «${node.label}» στο μενού. Πάτα Αποθήκευση για οριστικοποίηση.`,
    );
  };

  const addCustomLink = () => {
    const label = customLabel.trim();
    let href = customHref.trim();
    if (!label || !href) {
      setError("Συμπλήρωσε ετικέτα και διαδρομή για custom link.");
      return;
    }
    if (!href.startsWith("/")) href = `/${href}`;
    const id = `custom-${label
      .toLowerCase()
      .replace(/[^a-z0-9α-ωάέήίόύώϊϋΐΰ]+/gi, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "link"}`;
    addCatalogNode({
      id,
      type: "link",
      label,
      href,
      icon: "FileText",
      visible: true,
      mobileTab: false,
    });
    setCustomLabel("");
    setCustomHref("");
    setError(null);
  };

  const addFolder = () => {
    const id = `folder_${Date.now().toString(36)}`;
    setTree((prev) => [
      ...prev,
      {
        id,
        type: "folder",
        label: "Νέος φάκελος",
        icon: "FolderTree",
        children: [],
      },
    ]);
    setMessage(null);
  };

  const onDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as DragData | undefined;
    setActiveDrag(data ?? null);
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveDrag(null);
    if (!over) return;

    const activeData = active.data.current as DragData | undefined;
    const overId = String(over.id);

    if (activeData?.kind === "catalog") {
      if (overId.startsWith("folder-drop:")) {
        addCatalogNode(activeData.node, overId.replace("folder-drop:", ""));
        return;
      }
      // Dropped on a tree node — insert after that item (unique id if duplicate)
      const overData = over.data.current as { kind?: string; id?: string } | undefined;
      if (overData?.kind === "tree" && overData.id) {
        setTree((prev) => {
          const used = collectNodeIds(prev);
          const baseId = activeData.node.id || "custom";
          const id = used.has(baseId)
            ? `${baseId}-${Math.random().toString(36).slice(2, 8)}`
            : baseId;
          const clean = {
            ...cloneMenuTree([activeData.node])[0]!,
            id,
            mobileTab: false,
            visible: true,
          };
          delete clean.mobileOrder;
          const moved = insertNodeAt(prev, null, prev.length, clean);
          return moveNodeInTree(moved, clean.id, overData.id!, "after");
        });
        setMessage(
          `Προστέθηκε «${activeData.node.label}». Πάτα Αποθήκευση για οριστικοποίηση.`,
        );
      } else if (defaultFolderId) {
        addCatalogNode(activeData.node, defaultFolderId);
      } else {
        addCatalogNode(activeData.node, null);
      }
      return;
    }

    if (activeData?.kind === "tree") {
      if (overId.startsWith("folder-drop:")) {
        const folderId = overId.replace("folder-drop:", "");
        if (folderId === activeData.id) return;
        setTree((prev) => moveNodeInTree(prev, activeData.id, folderId, "into"));
        setMessage(null);
        return;
      }
      if (active.id !== over.id) {
        setTree((prev) =>
          moveNodeInTree(prev, String(active.id), String(over.id), "before"),
        );
        setMessage(null);
      }
    }
  };

  const save = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/menu", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          menu: tree,
          navGroupsDefaultExpanded,
          mobileFooterOverrides: footerOverrides,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setTree(cloneMenuTree(data.menu));
      if (typeof data.navGroupsDefaultExpanded === "boolean") {
        setNavGroupsDefaultExpanded(data.navGroupsDefaultExpanded);
      }
      if (data.mobileFooterOverrides) {
        setFooterOverrides({
          byUserId: { ...(data.mobileFooterOverrides.byUserId ?? {}) },
          byGroupId: { ...(data.mobileFooterOverrides.byGroupId ?? {}) },
        });
      }
      setMessage("Το μενού αποθηκεύτηκε. Ανανεώστε τη σελίδα για το sidebar.");
    });
  };

  const reset = () => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία επαναφοράς");
        return;
      }
      setTree(cloneMenuTree(data.menu));
      setNavGroupsDefaultExpanded(
        typeof data.navGroupsDefaultExpanded === "boolean"
          ? data.navGroupsDefaultExpanded
          : true,
      );
      setFooterOverrides({ byUserId: {}, byGroupId: {} });
      setMessage("Επαναφορά στο προεπιλεγμένο μενού.");
    });
  };

  const overlayLabel = (() => {
    if (!activeDrag) return null;
    if (activeDrag.kind === "catalog") return activeDrag.node.label;
    const links = collectLinkNodes(tree);
    const folders: MenuNodeConfig[] = [];
    const walk = (nodes: MenuNodeConfig[]) => {
      for (const n of nodes) {
        if (n.type === "folder") folders.push(n);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    return (
      [...links, ...folders].find((n) => n.id === activeDrag.id)?.label ?? null
    );
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
          >
            <ArrowLeft size={14} /> Ρυθμίσεις
          </Link>
          <PageHeader
            title="Μενού πλοήγησης"
            description="Δομή, expand φακέλων και εμφάνιση ανά ρόλο / ομάδα / χρήστη."
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={addFolder}
            disabled={pending}
          >
            <FolderPlus size={16} /> Νέος φάκελος
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={reset}
            disabled={pending}
          >
            <RotateCcw size={16} /> Επαναφορά
          </Button>
          <Button size="sm" onClick={save} disabled={pending}>
            <Save size={16} /> Αποθήκευση
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <div className="soft-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink-900">
            Expand φακέλων από προεπιλογή
          </p>
          <p className="text-xs text-slate-500">
            Ναι = ανοιχτοί οι φάκελοι στο sidebar (ο χρήστης μπορεί να τους
            αλλάξει τοπικά). Ανά φάκελο μπορείς να ορίσεις εξαίρεση.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setNavGroupsDefaultExpanded(true);
              setMessage(null);
            }}
            className={cn(
              "rounded-xl border px-4 py-2 text-sm font-medium",
              navGroupsDefaultExpanded
                ? "border-teal-300 bg-teal-50 text-teal-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            Ναι
          </button>
          <button
            type="button"
            onClick={() => {
              setNavGroupsDefaultExpanded(false);
              setMessage(null);
            }}
            className={cn(
              "rounded-xl border px-4 py-2 text-sm font-medium",
              !navGroupsDefaultExpanded
                ? "border-teal-300 bg-teal-50 text-teal-900"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
          >
            Όχι
          </button>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveDrag(null)}
      >
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="soft-panel space-y-2 p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900">Δομή μενού</h2>
              <span className="text-xs text-slate-400">
                Εικονίδιο χρηστών = πρόσβαση ανά ομάδα/χρήστη
              </span>
            </div>
            <TreeBranch
              nodes={tree}
              depth={0}
              onChange={updateNode}
              onRemove={removeNode}
              audienceOptions={audienceOptions}
              tenantDefaultExpanded={navGroupsDefaultExpanded}
            />
            {tree.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                Το μενού είναι κενό. Προσθέστε φάκελο ή επιλογή από τη λίστα.
              </p>
            ) : null}
          </div>

          <aside className="space-y-4">
            <div className="soft-panel space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold text-ink-900">
                  Διαθέσιμες επιλογές
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Σύρε στο δέντρο ή πάτα{" "}
                  <span className="font-semibold text-teal-700">+</span> για
                  προσθήκη.
                  {missingCount > 0
                    ? ` ${missingCount} δεν είναι ακόμη στο μενού.`
                    : " Όλα τα defaults υπάρχουν ήδη — μπορείς να προσθέσεις αντίγραφο ή custom link."}
                </p>
              </div>

              <div className="relative">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="Αναζήτηση…"
                  className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                />
              </div>

              <div className="max-h-[360px] space-y-1.5 overflow-y-auto pr-1">
                {filteredCatalog.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                    Καμία επιλογή δεν ταιριάζει.
                  </p>
                ) : (
                  filteredCatalog.map((entry) => (
                    <CatalogItem
                      key={entry.node.id}
                      node={entry.node}
                      inMenu={entry.inMenu}
                      onAdd={(n) => addCatalogNode(n)}
                    />
                  ))
                )}
              </div>

              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-900">
                  <Link2 size={13} className="text-teal-700" />
                  Custom link
                </div>
                <input
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Ετικέτα (π.χ. Αποθήκη Β)"
                  className="h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm outline-none focus:border-teal-300"
                />
                <input
                  value={customHref}
                  onChange={(e) => setCustomHref(e.target.value)}
                  placeholder="Διαδρομή (π.χ. /inventory)"
                  className="h-9 w-full rounded-lg border border-slate-200 px-2.5 font-mono text-sm outline-none focus:border-teal-300"
                />
                <button
                  type="button"
                  onClick={addCustomLink}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-sm font-medium text-white hover:bg-slate-800"
                >
                  <Plus size={14} />
                  Προσθήκη στο μενού
                </button>
              </div>
            </div>

            <div className="soft-panel p-4">
              <MobileFooterEditor
                tree={tree}
                overrides={footerOverrides}
                audienceOptions={audienceOptions}
                onChangeDefaultFooter={(ids) => {
                  setTree((prev) => applyMobileFooterIds(prev, ids));
                  setMessage(null);
                }}
                onChangeOverrides={(next) => {
                  setFooterOverrides(next);
                  setMessage(null);
                }}
              />
            </div>
          </aside>
        </div>

        <DragOverlay>
          {overlayLabel ? (
            <div className="rounded-xl border border-teal-200 bg-white px-3 py-2 text-sm font-medium shadow-lg">
              {overlayLabel}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
