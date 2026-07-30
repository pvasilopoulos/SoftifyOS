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
  Eye,
  EyeOff,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  Smartphone,
  Trash2,
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
  getAvailableCatalogLinks,
  getChildrenOf,
  getMobileFooterIds,
  insertNodeAt,
  moveNodeInTree,
} from "@/platform/navigation/menu-tree";

type DragData =
  | { kind: "tree"; id: string }
  | { kind: "catalog"; node: MenuNodeConfig };

function SortableMenuRow({
  node,
  depth,
  onChange,
  onRemove,
}: {
  node: MenuNodeConfig;
  depth: number;
  onChange: (id: string, fn: (n: MenuNodeConfig) => MenuNodeConfig) => void;
  onRemove: (id: string) => void;
}) {
  const hidden = node.visible === false;
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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 py-2",
        hidden && "opacity-55",
        isDragging && "z-10 opacity-40 shadow-md",
      )}
    >
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
  onAdd,
}: {
  node: MenuNodeConfig;
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
        "flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white px-2 py-2",
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
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
        {createElement(resolveIcon(node.icon), { size: 14 })}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink-900">{node.label}</p>
        <p className="truncate text-[11px] text-slate-400">{node.href}</p>
      </div>
      <button
        type="button"
        title="Προσθήκη"
        onClick={() => onAdd(node)}
        className="rounded-lg p-1.5 text-teal-700 hover:bg-teal-50"
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
}: {
  nodes: MenuNodeConfig[];
  depth: number;
  onChange: (id: string, fn: (n: MenuNodeConfig) => MenuNodeConfig) => void;
  onRemove: (id: string) => void;
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
            />
            {node.type === "folder" ? (
              <FolderDropZone folderId={node.id} label={`Μέσα: ${node.label}`}>
                <TreeBranch
                  nodes={node.children ?? []}
                  depth={depth + 1}
                  onChange={onChange}
                  onRemove={onRemove}
                />
              </FolderDropZone>
            ) : null}
          </div>
        ))}
      </div>
    </SortableContext>
  );
}

function MobileFooterEditor({
  tree,
  onChangeFooter,
}: {
  tree: MenuNodeConfig[];
  onChangeFooter: (ids: string[]) => void;
}) {
  const footerIds = getMobileFooterIds(tree);
  const links = collectLinkNodes(tree).filter((n) => n.visible !== false);
  const byId = new Map(links.map((n) => [n.id, n]));

  const setSlot = (index: number, linkId: string) => {
    const slots = Array.from(
      { length: MOBILE_FOOTER_SLOT_COUNT },
      (_, i) => footerIds[i] ?? "",
    );
    for (let i = 0; i < slots.length; i++) {
      if (slots[i] === linkId) slots[i] = "";
    }
    slots[index] = linkId;
    onChangeFooter(slots.filter(Boolean));
  };

  const moveSlot = (index: number, dir: -1 | 1) => {
    const next = [...footerIds];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const tmp = next[index];
    next[index] = next[target]!;
    next[target] = tmp!;
    onChangeFooter(next);
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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Smartphone size={16} className="text-slate-500" />
        <h2 className="text-sm font-semibold text-ink-900">Footer κινητού</h2>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        Έως {MOBILE_FOOTER_SLOT_COUNT} συντομεύσεις· η θέση «Περισσότερα» μένει
        πάντα τελευταία.
      </p>

      <div className="space-y-2">
        {Array.from({ length: MOBILE_FOOTER_SLOT_COUNT }).map((_, index) => {
          const selected = footerIds[index] ?? "";
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
                onChange={(e) => setSlot(index, e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:border-teal-300 focus:bg-white"
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
                disabled={index === 0}
                onClick={() => moveSlot(index, -1)}
                className="rounded-lg px-1.5 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={index >= footerIds.length - 1}
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
}: {
  initialMenu: MenuNodeConfig[];
}) {
  const [tree, setTree] = useState(() => cloneMenuTree(initialMenu));
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [activeDrag, setActiveDrag] = useState<DragData | null>(null);

  const catalog = useMemo(
    () => getAvailableCatalogLinks(tree, defaultMenuTree),
    [tree],
  );

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
    const clean: MenuNodeConfig = {
      ...cloneMenuTree([node])[0]!,
      mobileTab: false,
      visible: true,
    };
    delete clean.mobileOrder;
    setTree((prev) => {
      if (target) {
        const kids = getChildrenOf(prev, target);
        return insertNodeAt(prev, target, kids.length, clean);
      }
      return [...cloneMenuTree(prev), clean];
    });
    setMessage(null);
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
      // Dropped on a tree node — insert into parent folder or after item
      const overData = over.data.current as { kind?: string; id?: string } | undefined;
      if (overData?.kind === "tree" && overData.id) {
        setTree((prev) => {
          const clean = {
            ...cloneMenuTree([activeData.node])[0]!,
            mobileTab: false,
            visible: true,
          };
          delete clean.mobileOrder;
          // Insert after the over node in its parent
          const moved = insertNodeAt(
            prev,
            null,
            prev.length,
            clean,
          );
          // Prefer placing next to over via move trick: add then move
          return moveNodeInTree(moved, clean.id, overData.id!, "after");
        });
        setMessage(null);
      } else if (defaultFolderId) {
        addCatalogNode(activeData.node, defaultFolderId);
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
        body: JSON.stringify({ menu: tree }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setTree(cloneMenuTree(data.menu));
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
            description="Drag & drop, διαθέσιμες επιλογές και footer κινητού — ανά tenant."
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
                Σύρε για σειρά ή μέσα σε φάκελο
              </span>
            </div>
            <TreeBranch
              nodes={tree}
              depth={0}
              onChange={updateNode}
              onRemove={removeNode}
            />
            {tree.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
                Το μενού είναι κενό. Προσθέστε φάκελο ή επιλογή από τη λίστα.
              </p>
            ) : null}
          </div>

          <aside className="space-y-4">
            <div className="soft-panel space-y-2 p-4">
              <h2 className="text-sm font-semibold text-ink-900">
                Διαθέσιμες επιλογές
              </h2>
              <p className="text-xs text-slate-500">
                Σύρε στο δέντρο ή πάτα + για προσθήκη.
              </p>
              <div className="max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
                {catalog.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
                    Όλες οι προεπιλεγμένες επιλογές είναι ήδη στο μενού.
                  </p>
                ) : (
                  catalog.map((node) => (
                    <CatalogItem
                      key={node.id}
                      node={node}
                      onAdd={(n) => addCatalogNode(n)}
                    />
                  ))
                )}
              </div>
            </div>

            <div className="soft-panel p-4">
              <MobileFooterEditor
                tree={tree}
                onChangeFooter={(ids) => {
                  setTree((prev) => applyMobileFooterIds(prev, ids));
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
