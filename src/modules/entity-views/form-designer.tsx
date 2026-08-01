"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Columns2,
  Copy,
  Heading,
  LayoutList,
  Minus,
  PanelTop,
  Plus,
  Rows3,
  Save,
  SeparatorHorizontal,
  Sparkles,
  SquareStack,
  Trash2,
  Type,
} from "lucide-react";
import type { EntityModule } from "@/generated/prisma/client";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { entityLabel, type BuiltinField } from "./registry";
import {
  emptyFormConfig,
  findBlock,
  findSiblingContext,
  fxId,
  insertChild,
  mapBlocks,
  moveBlock,
  normalizeFormConfig,
  removeBlock,
  duplicateBlock,
  walkFormBlocks,
  walkFormFields,
  type FieldWidth,
  type FormBlock,
  type FormFieldRef,
  type FormMode,
  type FormRule,
  type FormViewConfig,
  type RuleOp,
} from "./form-experience-types";
import { FormExperienceRenderer } from "./form-experience-renderer";

type CustomFieldItem = {
  id: string;
  code: string;
  label: string;
  type: string;
  options: string[];
  required: boolean;
  filterable: boolean;
  showInList: boolean;
  sortOrder: number;
  isActive: boolean;
};

type FormViewItem = {
  id: string;
  entity: EntityModule;
  code: string;
  name: string;
  description: string | null;
  config: FormViewConfig;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
};

type Selection =
  | { kind: "page" }
  | { kind: "block"; id: string }
  | { kind: "field"; blockId: string; fieldId: string }
  | { kind: "slot"; containerId: string; slotId: string };

const MODES: FormMode[] = ["create", "edit", "view", "quick", "wizard"];

const MODE_LABELS: Record<FormMode, string> = {
  create: "Δημιουργία",
  edit: "Επεξεργασία",
  view: "Προβολή",
  quick: "Γρήγορη",
  wizard: "Οδηγός",
};

const BLOCK_PALETTE: Array<{
  type: FormBlock["type"];
  label: string;
  icon: typeof Plus;
}> = [
  { type: "section", label: "Ενότητα", icon: PanelTop },
  { type: "tabs", label: "Tabs", icon: SquareStack },
  { type: "columns", label: "Στήλες (2)", icon: Columns2 },
  { type: "accordion", label: "Accordion", icon: Rows3 },
  { type: "fields", label: "Πεδία", icon: LayoutList },
  { type: "heading", label: "Τίτλος", icon: Heading },
  { type: "divider", label: "Διαχωριστικό", icon: SeparatorHorizontal },
  { type: "callout", label: "Callout", icon: Sparkles },
  { type: "spacer", label: "Κενό", icon: Minus },
  { type: "related", label: "Related", icon: Type },
];

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const next = index + dir;
  if (next < 0 || next >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[next]] = [copy[next]!, copy[index]!];
  return copy;
}

function makeBlock(type: FormBlock["type"]): FormBlock {
  switch (type) {
    case "section":
      return {
        type: "section",
        id: fxId("sec"),
        title: "Νέα ενότητα",
        children: [{ type: "fields", id: fxId("flds"), fields: [] }],
      };
    case "tabs":
      return {
        type: "tabs",
        id: fxId("tabs"),
        variant: "tabs",
        tabs: [
          { id: fxId("tab"), title: "Καρτέλα 1", children: [] },
          { id: fxId("tab"), title: "Καρτέλα 2", children: [] },
        ],
      };
    case "columns":
      return {
        type: "columns",
        id: fxId("cols"),
        columns: [
          { id: fxId("col"), children: [] },
          { id: fxId("col"), children: [] },
        ],
      };
    case "accordion":
      return {
        type: "accordion",
        id: fxId("acc"),
        items: [{ id: fxId("acci"), title: "Στοιχείο", children: [] }],
      };
    case "fields":
      return { type: "fields", id: fxId("flds"), fields: [] };
    case "heading":
      return { type: "heading", id: fxId("hd"), text: "Τίτλος", level: 2 };
    case "divider":
      return { type: "divider", id: fxId("div") };
    case "callout":
      return {
        type: "callout",
        id: fxId("call"),
        tone: "info",
        text: "Κείμενο ενημέρωσης",
      };
    case "spacer":
      return { type: "spacer", id: fxId("sp"), size: "md" };
    case "related":
      return {
        type: "related",
        id: fxId("rel"),
        title: "Σχετικά",
        entityHint: "",
        emptyText: "Δεν υπάρχουν εγγραφές",
      };
  }
}

function findFirstFieldsBlock(blocks: FormBlock[]): FormBlock | null {
  for (const b of blocks) {
    if (b.type === "fields") return b;
    if (b.type === "section") {
      const f = findFirstFieldsBlock(b.children);
      if (f) return f;
    } else if (b.type === "tabs") {
      for (const t of b.tabs) {
        const f = findFirstFieldsBlock(t.children);
        if (f) return f;
      }
    } else if (b.type === "columns") {
      for (const c of b.columns) {
        const f = findFirstFieldsBlock(c.children);
        if (f) return f;
      }
    } else if (b.type === "accordion") {
      for (const it of b.items) {
        const f = findFirstFieldsBlock(it.children);
        if (f) return f;
      }
    }
  }
  return null;
}

function countFields(config: FormViewConfig): number {
  let n = 0;
  walkFormFields(config.page.root, () => {
    n += 1;
  });
  return n;
}

function blockLabel(b: FormBlock): string {
  switch (b.type) {
    case "section":
      return b.title || "Ενότητα";
    case "tabs":
      return `Tabs (${b.tabs.length})`;
    case "columns":
      return `Στήλες (${b.columns.length})`;
    case "accordion":
      return `Accordion (${b.items.length})`;
    case "fields":
      return `Πεδία (${b.fields.length})`;
    case "heading":
      return b.text || "Τίτλος";
    case "divider":
      return "Διαχωριστικό";
    case "callout":
      return b.text.slice(0, 32) || "Callout";
    case "spacer":
      return `Spacer (${b.size ?? "md"})`;
    case "related":
      return b.title || "Related";
  }
}

function walkNestedBlocks(blocks: FormBlock[], visit: (b: FormBlock) => void) {
  for (const b of blocks) {
    visit(b);
    switch (b.type) {
      case "section":
        walkNestedBlocks(b.children, visit);
        break;
      case "tabs":
        for (const t of b.tabs) walkNestedBlocks(t.children, visit);
        break;
      case "columns":
        for (const c of b.columns) walkNestedBlocks(c.children, visit);
        break;
      case "accordion":
        for (const it of b.items) walkNestedBlocks(it.children, visit);
        break;
      default:
        break;
    }
  }
}

/** Nested blocks + field refs inside a block (excludes the block itself). */
function countNestedContent(block: FormBlock): number {
  let n = 0;
  const tally = (blocks: FormBlock[]) => {
    walkNestedBlocks(blocks, (b) => {
      n += 1;
      if (b.type === "fields") n += b.fields.length;
    });
  };
  switch (block.type) {
    case "section":
      tally(block.children);
      break;
    case "tabs":
      for (const t of block.tabs) tally(t.children);
      break;
    case "columns":
      for (const c of block.columns) tally(c.children);
      break;
    case "accordion":
      for (const it of block.items) tally(it.children);
      break;
    case "fields":
      return block.fields.length;
    default:
      return 0;
  }
  return n;
}

function confirmRemoveBlock(block: FormBlock): boolean {
  const nested = countNestedContent(block);
  if (nested === 0) return true;
  return window.confirm(
    `Να αφαιρεθεί «${blockLabel(block)}» και τα ${nested} εσωτερικά στοιχεία;`,
  );
}

function StructureTree({
  blocks,
  depth,
  selection,
  onSelect,
  onRemoveBlock,
  onRemoveField,
  onMoveBlock,
  onDuplicateBlock,
}: {
  blocks: FormBlock[];
  depth: number;
  selection: Selection;
  onSelect: (s: Selection) => void;
  onRemoveBlock: (id: string) => void;
  onRemoveField: (blockId: string, fieldId: string) => void;
  onMoveBlock: (id: string, dir: -1 | 1) => void;
  onDuplicateBlock: (id: string) => void;
}) {
  const treeProps = {
    selection,
    onSelect,
    onRemoveBlock,
    onRemoveField,
    onMoveBlock,
    onDuplicateBlock,
  };
  return (
    <ul className={cn("space-y-0.5", depth > 0 && "ml-3 border-l border-slate-100 pl-2")}>
      {blocks.map((b, idx) => {
        const active =
          (selection.kind === "block" && selection.id === b.id) ||
          (selection.kind === "field" && selection.blockId === b.id);
        return (
          <li key={b.id}>
            <div
              className={cn(
                "flex w-full items-center gap-0.5 rounded-lg",
                active
                  ? "bg-teal-50 font-medium text-teal-900"
                  : "text-slate-600 hover:bg-slate-50",
              )}
            >
              <button
                type="button"
                onClick={() => onSelect({ kind: "block", id: b.id })}
                className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[11px]"
              >
                <span className="truncate text-slate-400">{b.type}</span>
                <span className="truncate">{blockLabel(b)}</span>
              </button>
              <button
                type="button"
                title="Πάνω"
                disabled={idx === 0}
                className="shrink-0 rounded p-0.5 text-slate-400 disabled:opacity-30 hover:bg-slate-100"
                onClick={() => onMoveBlock(b.id, -1)}
              >
                <ArrowUp size={10} />
              </button>
              <button
                type="button"
                title="Κάτω"
                disabled={idx === blocks.length - 1}
                className="shrink-0 rounded p-0.5 text-slate-400 disabled:opacity-30 hover:bg-slate-100"
                onClick={() => onMoveBlock(b.id, 1)}
              >
                <ArrowDown size={10} />
              </button>
              <button
                type="button"
                title="Αντίγραφο"
                className="shrink-0 rounded p-0.5 text-slate-500 hover:bg-slate-100"
                onClick={() => onDuplicateBlock(b.id)}
              >
                <Copy size={10} />
              </button>
              <button
                type="button"
                title="Αφαίρεση"
                aria-label={`Αφαίρεση ${blockLabel(b)}`}
                className="mr-1 shrink-0 rounded p-1 text-rose-500 opacity-70 hover:bg-rose-50 hover:opacity-100"
                onClick={() => onRemoveBlock(b.id)}
              >
                <Trash2 size={11} />
              </button>
            </div>
            {b.type === "fields"
              ? b.fields.map((f) => (
                  <div
                    key={f.id}
                    className={cn(
                      "ml-3 flex w-[calc(100%-0.75rem)] items-center gap-0.5 rounded-lg",
                      selection.kind === "field" && selection.fieldId === f.id
                        ? "bg-teal-100 text-teal-900"
                        : "text-slate-500 hover:bg-slate-50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onSelect({
                          kind: "field",
                          blockId: b.id,
                          fieldId: f.id,
                        })
                      }
                      className="min-w-0 flex-1 truncate px-2 py-0.5 text-left text-[10px]"
                    >
                      · {f.label || f.key}
                    </button>
                    <button
                      type="button"
                      title="Αφαίρεση πεδίου"
                      aria-label={`Αφαίρεση ${f.label || f.key}`}
                      className="mr-1 shrink-0 rounded p-0.5 text-rose-500 opacity-70 hover:bg-rose-50 hover:opacity-100"
                      onClick={() => onRemoveField(b.id, f.id)}
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ))
              : null}
            {b.type === "section" ? (
              <StructureTree
                blocks={b.children}
                depth={depth + 1}
                {...treeProps}
              />
            ) : null}
            {b.type === "tabs"
              ? b.tabs.map((t) => {
                  const slotActive =
                    selection.kind === "slot" &&
                    selection.containerId === b.id &&
                    selection.slotId === t.id;
                  return (
                    <div key={t.id} className="ml-3 mt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onSelect({
                            kind: "slot",
                            containerId: b.id,
                            slotId: t.id,
                          })
                        }
                        className={cn(
                          "w-full rounded px-2 py-0.5 text-left text-[10px] font-medium",
                          slotActive
                            ? "bg-teal-100 text-teal-900"
                            : "text-slate-400 hover:bg-slate-50",
                        )}
                      >
                        ▸ {t.title}
                      </button>
                      <StructureTree
                        blocks={t.children}
                        depth={depth + 1}
                        {...treeProps}
                      />
                    </div>
                  );
                })
              : null}
            {b.type === "columns"
              ? b.columns.map((c, i) => {
                  const slotActive =
                    selection.kind === "slot" &&
                    selection.containerId === b.id &&
                    selection.slotId === c.id;
                  return (
                    <div key={c.id} className="ml-3 mt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onSelect({
                            kind: "slot",
                            containerId: b.id,
                            slotId: c.id,
                          })
                        }
                        className={cn(
                          "w-full rounded px-2 py-0.5 text-left text-[10px] font-medium",
                          slotActive
                            ? "bg-teal-100 text-teal-900"
                            : "text-slate-400 hover:bg-slate-50",
                        )}
                      >
                        ▸ Στήλη {i + 1}
                      </button>
                      <StructureTree
                        blocks={c.children}
                        depth={depth + 1}
                        {...treeProps}
                      />
                    </div>
                  );
                })
              : null}
            {b.type === "accordion"
              ? b.items.map((it) => {
                  const slotActive =
                    selection.kind === "slot" &&
                    selection.containerId === b.id &&
                    selection.slotId === it.id;
                  return (
                    <div key={it.id} className="ml-3 mt-0.5">
                      <button
                        type="button"
                        onClick={() =>
                          onSelect({
                            kind: "slot",
                            containerId: b.id,
                            slotId: it.id,
                          })
                        }
                        className={cn(
                          "w-full rounded px-2 py-0.5 text-left text-[10px] font-medium",
                          slotActive
                            ? "bg-teal-100 text-teal-900"
                            : "text-slate-400 hover:bg-slate-50",
                        )}
                      >
                        ▸ {it.title}
                      </button>
                      <StructureTree
                        blocks={it.children}
                        depth={depth + 1}
                        {...treeProps}
                      />
                    </div>
                  );
                })
              : null}
          </li>
        );
      })}
    </ul>
  );
}

function FieldInput({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1 text-xs">
      <span className="font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-8 w-full rounded-lg border border-slate-200 px-2 text-xs outline-none focus:border-teal-400";

export function FormExperienceDesigner({
  entity,
  builtins,
  customFields,
  items,
  pending,
  onSave,
  onCreate,
  onDelete,
}: {
  entity: EntityModule;
  builtins: BuiltinField[];
  customFields: CustomFieldItem[];
  items: FormViewItem[];
  pending: boolean;
  onSave: (
    item: {
      id: string;
      isSystem: boolean;
      isDefault: boolean;
      isActive: boolean;
      name: string;
    },
    config: FormViewConfig,
    meta: { name: string; isDefault: boolean; isActive: boolean },
  ) => void;
  onCreate: (payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;

  const [draft, setDraft] = useState<FormViewConfig>(() =>
    normalizeFormConfig(items[0]?.config),
  );
  const [name, setName] = useState(items[0]?.name ?? "");
  const [selection, setSelection] = useState<Selection>({ kind: "page" });
  const [previewMode, setPreviewMode] = useState<FormMode>("edit");
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>(
    {},
  );
  const [previewCustom, setPreviewCustom] = useState<Record<string, string>>(
    {},
  );
  const [validateMsg, setValidateMsg] = useState<string | null>(null);

  // Sync when selected view disappears from items; do not thrash draft otherwise
  useEffect(() => {
    if (!selectedId) {
      const first = items[0];
      if (first) {
        setSelectedId(first.id);
        setDraft(normalizeFormConfig(first.config));
        setName(first.name);
        setSelection({ kind: "page" });
      }
      return;
    }
    if (!items.some((i) => i.id === selectedId)) {
      const first = items[0];
      if (first) {
        setSelectedId(first.id);
        setDraft(normalizeFormConfig(first.config));
        setName(first.name);
        setSelection({ kind: "page" });
      } else {
        setSelectedId("");
        setDraft(emptyFormConfig());
        setName("");
        setSelection({ kind: "page" });
      }
    }
  }, [items, selectedId]);

  const selectView = (item: FormViewItem) => {
    setSelectedId(item.id);
    setDraft(normalizeFormConfig(item.config));
    setName(item.name);
    setSelection({ kind: "page" });
    setValidateMsg(null);
  };

  const updateDraft = (next: FormViewConfig) => {
    setDraft(next);
    setValidateMsg(null);
  };

  const patchPage = (patch: Partial<FormViewConfig["page"]>) => {
    updateDraft({ ...draft, page: { ...draft.page, ...patch } });
  };

  const setRoot = (root: FormBlock[]) => {
    updateDraft({ ...draft, page: { ...draft.page, root } });
  };

  const insertTarget = (): {
    parentId: string | null;
    slotId?: string | null;
  } => {
    if (selection.kind === "slot") {
      return {
        parentId: selection.containerId,
        slotId: selection.slotId,
      };
    }
    if (selection.kind === "block") {
      const b = findBlock(draft.page.root, selection.id);
      if (!b) return { parentId: null };
      if (b.type === "section") return { parentId: b.id };
      if (b.type === "tabs") {
        return { parentId: b.id, slotId: b.tabs[0]?.id ?? null };
      }
      if (b.type === "columns") {
        return { parentId: b.id, slotId: b.columns[0]?.id ?? null };
      }
      if (b.type === "accordion") {
        return { parentId: b.id, slotId: b.items[0]?.id ?? null };
      }
    }
    return { parentId: null };
  };

  const addBlock = (type: FormBlock["type"]) => {
    const child = makeBlock(type);
    const { parentId, slotId } = insertTarget();
    setRoot(insertChild(draft.page.root, parentId, child, slotId));
    setSelection({ kind: "block", id: child.id });
  };

  const addField = (key: string, source: "system" | "custom", label: string) => {
    const ref: FormFieldRef = {
      id: fxId("f"),
      key,
      source,
      label,
      width: "half",
    };

    let targetId: string | null = null;
    if (selection.kind === "block" || selection.kind === "field") {
      const bid =
        selection.kind === "field" ? selection.blockId : selection.id;
      const b = findBlock(draft.page.root, bid);
      if (b?.type === "fields") targetId = b.id;
    }
    if (!targetId) {
      const first = findFirstFieldsBlock(draft.page.root);
      if (first) targetId = first.id;
    }

    if (targetId) {
      setRoot(
        mapBlocks(draft.page.root, (b) => {
          if (b.type !== "fields" || b.id !== targetId) return b;
          if (b.fields.some((f) => f.key === key && f.source === source))
            return b;
          return { ...b, fields: [...b.fields, ref] };
        }),
      );
      setSelection({ kind: "field", blockId: targetId, fieldId: ref.id });
      return;
    }

    // Create fields block under selected container/slot, or at root
    const fieldsBlock: FormBlock = {
      type: "fields",
      id: fxId("flds"),
      fields: [ref],
    };
    const { parentId, slotId } = insertTarget();
    setRoot(insertChild(draft.page.root, parentId, fieldsBlock, slotId));
    setSelection({
      kind: "field",
      blockId: fieldsBlock.id,
      fieldId: ref.id,
    });
  };

  const selectedBlock =
    selection.kind === "block" || selection.kind === "field"
      ? findBlock(
          draft.page.root,
          selection.kind === "field" ? selection.blockId : selection.id,
        )
      : null;

  const selectedField: FormFieldRef | null =
    selection.kind === "field" && selectedBlock?.type === "fields"
      ? (selectedBlock.fields.find((f) => f.id === selection.fieldId) ?? null)
      : null;

  const customDefs = useMemo(
    () =>
      customFields
        .filter((f) => f.isActive)
        .map((f) => ({
          code: f.code,
          label: f.label,
          type: f.type as never,
          optionsJson: f.options,
          required: f.required,
        })),
    [customFields],
  );

  const formableBuiltins = builtins.filter((b) => b.formable !== false);
  const activeCustoms = customFields.filter((f) => f.isActive);

  const fieldRefs = (
    keys: string[] | "all",
    width: FieldWidth = "half",
  ): FormFieldRef[] => {
    const list =
      keys === "all"
        ? formableBuiltins
        : formableBuiltins.filter((b) => keys.includes(b.key));
    return list.map((b) => ({
      id: fxId("f"),
      key: b.key,
      source: "system" as const,
      required: b.required,
      label: b.label,
      width: (b.type === "textarea" ? "full" : width) as FieldWidth,
    }));
  };

  const createConfigFromTemplate = (
    template: "basic" | "tabs" | "quick" | "wizard" | "columns",
  ): FormViewConfig => {
    const base = emptyFormConfig(
      template === "quick"
        ? "quick"
        : template === "wizard"
          ? "wizard"
          : "edit",
    );
    if (template === "quick") {
      return {
        ...base,
        mode: "quick",
        page: {
          ...base.page,
          showHeader: false,
          showSide: false,
          root: [
            {
              type: "section",
              id: fxId("sec"),
              title: "Γρήγορα",
              children: [
                {
                  type: "fields",
                  id: fxId("flds"),
                  fields: fieldRefs(
                    formableBuiltins.slice(0, 4).map((b) => b.key),
                  ),
                },
              ],
            },
          ],
        },
      };
    }
    if (template === "wizard") {
      const half = Math.ceil(formableBuiltins.length / 2) || 1;
      const a = formableBuiltins.slice(0, half).map((b) => b.key);
      const bKeys = formableBuiltins.slice(half).map((b) => b.key);
      return {
        ...base,
        mode: "wizard",
        page: {
          ...base.page,
          showHeader: true,
          root: [
            {
              type: "tabs",
              id: fxId("tabs"),
              variant: "wizard",
              tabs: [
                {
                  id: fxId("tab"),
                  title: "Βήμα 1",
                  children: [
                    {
                      type: "section",
                      id: fxId("sec"),
                      title: "Βασικά",
                      children: [
                        {
                          type: "fields",
                          id: fxId("flds"),
                          fields: fieldRefs(a.length ? a : ["code", "name"]),
                        },
                      ],
                    },
                  ],
                },
                {
                  id: fxId("tab"),
                  title: "Βήμα 2",
                  children: [
                    {
                      type: "section",
                      id: fxId("sec"),
                      title: "Λεπτομέρειες",
                      children: [
                        {
                          type: "fields",
                          id: fxId("flds"),
                          fields: fieldRefs(bKeys.length ? bKeys : []),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
    }
    if (template === "tabs") {
      return {
        ...base,
        mode: "edit",
        page: {
          ...base.page,
          showHeader: true,
          showSide: true,
          sideContent: "summary",
          root: [
            {
              type: "tabs",
              id: fxId("tabs"),
              variant: "tabs",
              tabs: [
                {
                  id: fxId("tab"),
                  title: "Βασικά",
                  children: [
                    {
                      type: "section",
                      id: fxId("sec"),
                      title: "Βασικά στοιχεία",
                      children: [
                        {
                          type: "fields",
                          id: fxId("flds"),
                          fields: fieldRefs("all"),
                        },
                      ],
                    },
                  ],
                },
                {
                  id: fxId("tab"),
                  title: "Πρόσθετα",
                  children: [
                    {
                      type: "callout",
                      id: fxId("call"),
                      tone: "info",
                      text: "Πρόσθεσε custom πεδία από τη βιβλιοθήκη αριστερά.",
                    },
                    {
                      type: "section",
                      id: fxId("sec"),
                      title: "Πρόσθετα πεδία",
                      children: [
                        { type: "fields", id: fxId("flds"), fields: [] },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
    }
    if (template === "columns") {
      const keys = formableBuiltins.map((b) => b.key);
      const mid = Math.ceil(keys.length / 2);
      return {
        ...base,
        mode: "edit",
        page: {
          ...base.page,
          root: [
            {
              type: "section",
              id: fxId("sec"),
              title: "Διάταξη στηλών",
              children: [
                {
                  type: "columns",
                  id: fxId("cols"),
                  columns: [
                    {
                      id: fxId("col"),
                      children: [
                        {
                          type: "fields",
                          id: fxId("flds"),
                          fields: fieldRefs(keys.slice(0, mid), "full"),
                        },
                      ],
                    },
                    {
                      id: fxId("col"),
                      children: [
                        {
                          type: "fields",
                          id: fxId("flds"),
                          fields: fieldRefs(keys.slice(mid), "full"),
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
    }
    // basic
    return {
      ...base,
      page: {
        ...base.page,
        root: [
          {
            type: "section",
            id: fxId("sec"),
            title: "Βασικά στοιχεία",
            children: [
              {
                type: "fields",
                id: fxId("flds"),
                fields: fieldRefs(formableBuiltins.slice(0, 6).map((b) => b.key)),
              },
            ],
          },
          {
            type: "section",
            id: fxId("sec"),
            title: "Πρόσθετα πεδία",
            children: [{ type: "fields", id: fxId("flds"), fields: [] }],
          },
        ],
      },
    };
  };

  const handleCreate = (
    template: "basic" | "tabs" | "quick" | "wizard" | "columns" = "basic",
  ) => {
    const labels: Record<typeof template, string> = {
      basic: "Βασική",
      tabs: "Tabs + Side",
      quick: "Γρήγορη",
      wizard: "Οδηγός",
      columns: "Στήλες",
    };
    onCreate({
      entity,
      code: `form_${Date.now().toString(36)}`,
      name: `${labels[template]} · ${entityLabel(entity)}`,
      configJson: createConfigFromTemplate(template),
    });
  };

  const handleDuplicate = () => {
    if (!selected) return;
    onCreate({
      entity,
      code: `form_${Date.now().toString(36)}`,
      name: `${name || selected.name} (αντίγραφο)`,
      configJson: draft,
    });
  };

  const handleValidate = () => {
    if (countFields(draft) === 0) {
      setValidateMsg("Προσοχή: η φόρμα δεν έχει πεδία.");
      return;
    }
    setValidateMsg("OK — υπάρχουν πεδία στη φόρμα.");
  };

  const patchBlock = (id: string, patcher: (b: FormBlock) => FormBlock) => {
    setRoot(mapBlocks(draft.page.root, (b) => (b.id === id ? patcher(b) : b)));
  };

  const selectionStillValid = (
    nextRoot: FormBlock[],
    sel: Selection,
  ): boolean => {
    if (sel.kind === "page") return true;
    if (sel.kind === "block") return !!findBlock(nextRoot, sel.id);
    if (sel.kind === "slot") {
      const container = findBlock(nextRoot, sel.containerId);
      if (!container) return false;
      if (container.type === "tabs") {
        return container.tabs.some((t) => t.id === sel.slotId);
      }
      if (container.type === "columns") {
        return container.columns.some((c) => c.id === sel.slotId);
      }
      if (container.type === "accordion") {
        return container.items.some((it) => it.id === sel.slotId);
      }
      return false;
    }
    const block = findBlock(nextRoot, sel.blockId);
    if (!block || block.type !== "fields") return false;
    return block.fields.some((f) => f.id === sel.fieldId);
  };

  const removeBlockById = (id: string) => {
    const block = findBlock(draft.page.root, id);
    if (!block) return;
    if (!confirmRemoveBlock(block)) return;
    const next = removeBlock(draft.page.root, id);
    setRoot(next);
    if (!selectionStillValid(next, selection)) {
      setSelection({ kind: "page" });
    }
  };

  const moveBlockById = (id: string, dir: -1 | 1) => {
    setRoot(moveBlock(draft.page.root, id, dir));
  };

  const duplicateBlockById = (id: string) => {
    const next = duplicateBlock(draft.page.root, id);
    setRoot(next);
    const ctx = findSiblingContext(next, id);
    if (ctx && ctx.index + 1 < ctx.siblings.length) {
      const clone = ctx.siblings[ctx.index + 1];
      if (clone) setSelection({ kind: "block", id: clone.id });
    }
  };

  const removeFieldById = (blockId: string, fieldId: string) => {
    const next = mapBlocks(draft.page.root, (b) => {
      if (b.type !== "fields" || b.id !== blockId) return b;
      return { ...b, fields: b.fields.filter((f) => f.id !== fieldId) };
    });
    setRoot(next);
    if (
      selection.kind === "field" &&
      selection.blockId === blockId &&
      selection.fieldId === fieldId
    ) {
      setSelection({ kind: "block", id: blockId });
    }
  };

  const ruleTargetOptions = useMemo(() => {
    const fields: Array<{ id: string; label: string }> = [];
    const blocks: Array<{ id: string; label: string }> = [];
    walkFormFields(draft.page.root, (f, blockId) => {
      fields.push({
        id: f.id,
        label: `${f.label || f.key} (${f.source})`,
      });
      void blockId;
    });
    walkFormBlocks(draft.page.root, (b) => {
      blocks.push({ id: b.id, label: `${b.type} · ${blockLabel(b)}` });
    });
    return { fields, blocks };
  }, [draft.page.root]);

  const patchField = (
    blockId: string,
    fieldId: string,
    patch: Partial<FormFieldRef>,
  ) => {
    setRoot(
      mapBlocks(draft.page.root, (b) => {
        if (b.type !== "fields" || b.id !== blockId) return b;
        return {
          ...b,
          fields: b.fields.map((f) =>
            f.id === fieldId ? { ...f, ...patch } : f,
          ),
        };
      }),
    );
  };

  const rules = draft.rules ?? [];

  return (
    <div className="space-y-3">
      {selected ? (
        <div className="soft-panel flex flex-wrap items-center gap-2 p-3">
          <input
            value={name || selected.name}
            onChange={(e) => setName(e.target.value)}
            className="h-9 min-w-[180px] flex-1 rounded-xl border border-slate-200 px-3 text-sm font-medium"
          />
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              onSave(selected, draft, {
                name: name || selected.name,
                isDefault: selected.isDefault,
                isActive: selected.isActive,
              })
            }
          >
            <Save size={14} /> Αποθήκευση
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() =>
              onSave(selected, draft, {
                name: name || selected.name,
                isDefault: true,
                isActive: true,
              })
            }
          >
            Default
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={handleDuplicate}
          >
            <Copy size={14} /> Διπλότυπο
          </Button>
          <Button size="sm" variant="secondary" onClick={handleValidate}>
            Έλεγχος
          </Button>
          {!selected.isSystem ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onDelete(selected.id)}
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
          {validateMsg ? (
            <span
              className={cn(
                "text-xs",
                validateMsg.startsWith("OK")
                  ? "text-emerald-700"
                  : "text-amber-700",
              )}
            >
              {validateMsg}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
        {/* Left: views list */}
        <aside className="soft-panel flex flex-col gap-2 p-2">
          <p className="px-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Προβολές φόρμας
          </p>
          <ul className="max-h-[420px] space-y-1 overflow-y-auto">
            {items.map((item) => {
              const life =
                normalizeFormConfig(item.config).lifecycle ?? "published";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => selectView(item)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2 text-left text-sm",
                      selectedId === item.id
                        ? "bg-teal-50 text-teal-900"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <span className="block truncate font-medium">
                      {item.name}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      {item.isDefault ? (
                        <Badge tone="teal">Default</Badge>
                      ) : null}
                      <Badge tone={life === "draft" ? "amber" : "emerald"}>
                        {life === "draft" ? "Draft" : "Published"}
                      </Badge>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="space-y-1 border-t border-slate-100 pt-2">
            <p className="px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Νέα από πρότυπο
            </p>
            {(
              [
                ["basic", "Βασική"],
                ["tabs", "Tabs + Side"],
                ["columns", "Στήλες"],
                ["quick", "Γρήγορη"],
                ["wizard", "Οδηγός"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                disabled={pending}
                onClick={() => handleCreate(key)}
                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-slate-600 hover:bg-teal-50 hover:text-teal-900 disabled:opacity-40"
              >
                <Plus size={12} /> {label}
              </button>
            ))}
          </div>
          {selected ? (
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              disabled={pending}
              onClick={handleDuplicate}
            >
              <Copy size={14} /> Διπλότυπο
            </Button>
          ) : null}
          {selected && !selected.isSystem ? (
            <Button
              size="sm"
              variant="ghost"
              className="w-full text-rose-600"
              disabled={pending}
              onClick={() => onDelete(selected.id)}
            >
              <Trash2 size={14} /> Διαγραφή
            </Button>
          ) : null}
        </aside>

        {/* Center: palette + canvas */}
        <div className="grid gap-3 min-[900px]:grid-cols-[200px_minmax(0,1fr)]">
          <aside className="soft-panel space-y-3 p-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Blocks
            </p>
            <div className="flex flex-col gap-1">
              {BLOCK_PALETTE.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  disabled={!selected}
                  onClick={() => addBlock(type)}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs text-slate-700 hover:bg-teal-50 disabled:opacity-40"
                >
                  <Icon size={14} className="shrink-0 text-teal-700" />
                  {label}
                </button>
              ))}
            </div>
            <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Πεδία συστήματος
            </p>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {formableBuiltins.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  disabled={!selected}
                  onClick={() => addField(b.key, "system", b.label)}
                  className="rounded-lg px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  {b.label}
                </button>
              ))}
            </div>
            <p className="px-1 pt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Custom
            </p>
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto">
              {activeCustoms.length === 0 ? (
                <p className="px-2 text-[11px] text-slate-400">Κανένα ενεργό</p>
              ) : (
                activeCustoms.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    disabled={!selected}
                    onClick={() => addField(f.code, "custom", f.label)}
                    className="rounded-lg px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                  >
                    {f.label}
                  </button>
                ))
              )}
            </div>
          </aside>

          <div className="soft-panel space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Καμβάς
              </p>
              <div className="ml-auto flex flex-wrap gap-1">
                {MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPreviewMode(m)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[11px] font-medium",
                      previewMode === m
                        ? "bg-teal-600 text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200",
                    )}
                  >
                    {MODE_LABELS[m]}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3 rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
              {!selected ? (
                <p className="text-sm text-slate-400">
                  Επιλέξτε ή δημιουργήστε μια προβολή φόρμας.
                </p>
              ) : draft.page.root.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-400">
                  Κενός καμβάς — προσθέστε περιοχή ή πεδία από τη βιβλιοθήκη.
                </p>
              ) : (
                draft.page.root.map((block) => {
                  const selectedHere =
                    (selection.kind === "block" &&
                      !!findBlock([block], selection.id)) ||
                    (selection.kind === "field" &&
                      !!findBlock([block], selection.blockId));
                  return (
                    <div
                      key={block.id}
                      className={cn(
                        "rounded-xl border bg-slate-50/40",
                        selectedHere
                          ? "border-teal-400 ring-1 ring-teal-200"
                          : "border-slate-200",
                      )}
                    >
                      <div className="flex items-center gap-2 border-b border-slate-200/80 px-2 py-1.5">
                        <button
                          type="button"
                          className="min-w-0 flex-1 truncate text-left text-[11px] font-medium text-slate-600 hover:text-teal-800"
                          onClick={() =>
                            setSelection({ kind: "block", id: block.id })
                          }
                        >
                          <span className="text-slate-400">{block.type}</span>
                          {" · "}
                          {blockLabel(block)}
                        </button>
                        <button
                          type="button"
                          title="Αφαίρεση από τον καμβά"
                          aria-label={`Αφαίρεση ${blockLabel(block)}`}
                          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50"
                          onClick={() => removeBlockById(block.id)}
                        >
                          <Trash2 size={12} />
                          Αφαίρεση
                        </button>
                      </div>
                      <div className="p-3">
                        <FormExperienceRenderer
                          config={{
                            ...draft,
                            page: { ...draft.page, root: [block] },
                          }}
                          builtins={builtins}
                          customDefs={customDefs}
                          values={previewValues}
                          customValues={previewCustom}
                          onSystemChange={(key, value) =>
                            setPreviewValues((v) => ({ ...v, [key]: value }))
                          }
                          onCustomChange={(key, value) =>
                            setPreviewCustom((v) => ({
                              ...v,
                              [key]: Array.isArray(value)
                                ? value.join(",")
                                : value,
                            }))
                          }
                          modeOverride={previewMode}
                          compact
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/60 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Δομή
                </p>
                <button
                  type="button"
                  className="text-[11px] text-teal-700 hover:underline"
                  onClick={() => setSelection({ kind: "page" })}
                >
                  Σελίδα
                </button>
              </div>
              <StructureTree
                blocks={draft.page.root}
                depth={0}
                selection={selection}
                onSelect={setSelection}
                onRemoveBlock={removeBlockById}
                onRemoveField={removeFieldById}
                onMoveBlock={moveBlockById}
                onDuplicateBlock={duplicateBlockById}
              />
              {draft.page.root.length === 0 ? (
                <p className="text-[11px] text-slate-400">Κενή δομή</p>
              ) : null}
            </div>
          </div>
        </div>

        {/* Right: inspector */}
        <aside className="soft-panel max-h-[720px] space-y-3 overflow-y-auto p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Inspector
          </p>

          {selection.kind === "page" ? (
            <div className="space-y-2">
              <FieldInput label="Τίτλος σελίδας">
                <input
                  className={inputCls}
                  value={draft.page.title ?? ""}
                  onChange={(e) =>
                    patchPage({ title: e.target.value || undefined })
                  }
                />
              </FieldInput>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.page.showHeader ?? true}
                  onChange={(e) => patchPage({ showHeader: e.target.checked })}
                />
                Header
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={draft.page.showSide ?? false}
                  onChange={(e) => patchPage({ showSide: e.target.checked })}
                />
                Side panel
              </label>
              <FieldInput label="Side content">
                <select
                  className={inputCls}
                  value={draft.page.sideContent ?? "none"}
                  onChange={(e) =>
                    patchPage({
                      sideContent: e.target.value as "summary" | "none",
                    })
                  }
                >
                  <option value="none">none</option>
                  <option value="summary">summary</option>
                </select>
              </FieldInput>
              <FieldInput label="Mode">
                <select
                  className={inputCls}
                  value={draft.mode ?? "edit"}
                  onChange={(e) =>
                    updateDraft({
                      ...draft,
                      mode: e.target.value as FormMode,
                    })
                  }
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
              </FieldInput>
              <FieldInput label="Lifecycle">
                <select
                  className={inputCls}
                  value={draft.lifecycle ?? "published"}
                  onChange={(e) =>
                    updateDraft({
                      ...draft,
                      lifecycle: e.target.value as "draft" | "published",
                    })
                  }
                >
                  <option value="draft">draft</option>
                  <option value="published">published</option>
                </select>
              </FieldInput>
            </div>
          ) : null}

          {selection.kind === "slot" ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-700">
                Στόχος εισαγωγής
              </p>
              <p className="text-[11px] text-slate-500">
                Νέα blocks/πεδία θα μπουν σε αυτό το slot (καρτέλα / στήλη /
                accordion).
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  setSelection({
                    kind: "block",
                    id: selection.containerId,
                  })
                }
              >
                Επιλογή container
              </Button>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock ? (
            <div className="flex flex-wrap gap-1 border-b border-slate-100 pb-2">
              <button
                type="button"
                title="Πάνω"
                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                onClick={() => moveBlockById(selectedBlock.id, -1)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                title="Κάτω"
                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                onClick={() => moveBlockById(selectedBlock.id, 1)}
              >
                <ArrowDown size={12} />
              </button>
              <button
                type="button"
                title="Αντίγραφο"
                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                onClick={() => duplicateBlockById(selectedBlock.id)}
              >
                <Copy size={12} />
              </button>
              <button
                type="button"
                title="Αφαίρεση"
                className="rounded-md border border-rose-200 p-1.5 text-rose-600 hover:bg-rose-50"
                onClick={() => removeBlockById(selectedBlock.id)}
              >
                <Trash2 size={12} />
              </button>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "section" ? (
            <div className="space-y-2">
              <FieldInput label="Τίτλος">
                <input
                  className={inputCls}
                  value={selectedBlock.title}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "section"
                        ? { ...b, title: e.target.value }
                        : b,
                    )
                  }
                />
              </FieldInput>
              <FieldInput label="Περιγραφή">
                <textarea
                  className="min-h-[60px] w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  value={selectedBlock.description ?? ""}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "section"
                        ? {
                            ...b,
                            description: e.target.value || undefined,
                          }
                        : b,
                    )
                  }
                />
              </FieldInput>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedBlock.collapsible}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "section"
                        ? { ...b, collapsible: e.target.checked }
                        : b,
                    )
                  }
                />
                Collapsible
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedBlock.collapsed}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "section"
                        ? {
                            ...b,
                            collapsed: e.target.checked,
                            collapsible: e.target.checked
                              ? true
                              : b.collapsible,
                          }
                        : b,
                    )
                  }
                />
                Αρχικά κλειστή
              </label>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "tabs" ? (
            <div className="space-y-2">
              <FieldInput label="Variant">
                <select
                  className={inputCls}
                  value={selectedBlock.variant ?? "tabs"}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "tabs"
                        ? {
                            ...b,
                            variant: e.target.value as "tabs" | "wizard",
                          }
                        : b,
                    )
                  }
                >
                  <option value="tabs">tabs</option>
                  <option value="wizard">wizard</option>
                </select>
              </FieldInput>
              {selectedBlock.tabs.map((t, idx) => (
                <div key={t.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    className="text-slate-400 disabled:opacity-30"
                    onClick={() =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "tabs") return b;
                        return { ...b, tabs: moveItem(b.tabs, idx, -1) };
                      })
                    }
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={idx === selectedBlock.tabs.length - 1}
                    className="text-slate-400 disabled:opacity-30"
                    onClick={() =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "tabs") return b;
                        return { ...b, tabs: moveItem(b.tabs, idx, 1) };
                      })
                    }
                  >
                    <ArrowDown size={12} />
                  </button>
                  <input
                    className={inputCls}
                    value={t.title}
                    onChange={(e) =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "tabs") return b;
                        const tabs = b.tabs.map((x, i) =>
                          i === idx ? { ...x, title: e.target.value } : x,
                        );
                        return { ...b, tabs };
                      })
                    }
                  />
                  <button
                    type="button"
                    title="Εισαγωγή εδώ"
                    className="text-teal-700"
                    onClick={() =>
                      setSelection({
                        kind: "slot",
                        containerId: selectedBlock.id,
                        slotId: t.id,
                      })
                    }
                  >
                    ▸
                  </button>
                  <button
                    type="button"
                    className="text-rose-600 disabled:opacity-30"
                    disabled={selectedBlock.tabs.length <= 1}
                    onClick={() =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "tabs" || b.tabs.length <= 1) return b;
                        return {
                          ...b,
                          tabs: b.tabs.filter((_, i) => i !== idx),
                        };
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  patchBlock(selectedBlock.id, (b) => {
                    if (b.type !== "tabs") return b;
                    return {
                      ...b,
                      tabs: [
                        ...b.tabs,
                        {
                          id: fxId("tab"),
                          title: `Καρτέλα ${b.tabs.length + 1}`,
                          children: [],
                        },
                      ],
                    };
                  })
                }
              >
                <Plus size={12} /> Tab
              </Button>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "columns" ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                {selectedBlock.columns.length} στήλες
              </p>
              <ul className="space-y-1">
                {selectedBlock.columns.map((c, idx) => (
                  <li
                    key={c.id}
                    className="flex items-center gap-1 rounded-lg border border-slate-100 px-1.5 py-1"
                  >
                    <button
                      type="button"
                      disabled={idx === 0}
                      className="text-slate-400 disabled:opacity-30"
                      onClick={() =>
                        patchBlock(selectedBlock.id, (b) => {
                          if (b.type !== "columns") return b;
                          return {
                            ...b,
                            columns: moveItem(b.columns, idx, -1),
                          };
                        })
                      }
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === selectedBlock.columns.length - 1}
                      className="text-slate-400 disabled:opacity-30"
                      onClick={() =>
                        patchBlock(selectedBlock.id, (b) => {
                          if (b.type !== "columns") return b;
                          return {
                            ...b,
                            columns: moveItem(b.columns, idx, 1),
                          };
                        })
                      }
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-slate-600"
                      onClick={() =>
                        setSelection({
                          kind: "slot",
                          containerId: selectedBlock.id,
                          slotId: c.id,
                        })
                      }
                    >
                      Στήλη {idx + 1} · {c.children.length} blocks
                    </button>
                    <button
                      type="button"
                      className="text-rose-600 disabled:opacity-30"
                      disabled={selectedBlock.columns.length <= 1}
                      onClick={() =>
                        patchBlock(selectedBlock.id, (b) => {
                          if (b.type !== "columns" || b.columns.length <= 1)
                            return b;
                          return {
                            ...b,
                            columns: b.columns.filter((_, i) => i !== idx),
                          };
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  patchBlock(selectedBlock.id, (b) => {
                    if (b.type !== "columns") return b;
                    return {
                      ...b,
                      columns: [
                        ...b.columns,
                        { id: fxId("col"), children: [] },
                      ],
                    };
                  })
                }
              >
                <Plus size={12} /> Στήλη
              </Button>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "fields" ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-slate-600">Πεδία</p>
              <ul className="space-y-1">
                {selectedBlock.fields.map((f, idx) => (
                  <li
                    key={f.id}
                    className="flex items-center gap-1 rounded-lg border border-slate-100 px-1.5 py-1"
                  >
                    <button
                      type="button"
                      disabled={idx === 0}
                      className="text-slate-400 disabled:opacity-30"
                      onClick={() =>
                        patchBlock(selectedBlock.id, (b) => {
                          if (b.type !== "fields") return b;
                          return {
                            ...b,
                            fields: moveItem(b.fields, idx, -1),
                          };
                        })
                      }
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === selectedBlock.fields.length - 1}
                      className="text-slate-400 disabled:opacity-30"
                      onClick={() =>
                        patchBlock(selectedBlock.id, (b) => {
                          if (b.type !== "fields") return b;
                          return {
                            ...b,
                            fields: moveItem(b.fields, idx, 1),
                          };
                        })
                      }
                    >
                      <ArrowDown size={12} />
                    </button>
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left text-[11px]"
                      onClick={() =>
                        setSelection({
                          kind: "field",
                          blockId: selectedBlock.id,
                          fieldId: f.id,
                        })
                      }
                    >
                      {f.label || f.key}
                    </button>
                    <button
                      type="button"
                      className="text-rose-600"
                      onClick={() =>
                        removeFieldById(selectedBlock.id, f.id)
                      }
                    >
                      <Trash2 size={12} />
                    </button>
                  </li>
                ))}
              </ul>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-600"
                onClick={() => removeBlockById(selectedBlock.id)}
              >
                <Trash2 size={12} /> Αφαίρεση block
              </Button>
            </div>
          ) : null}

          {selection.kind === "field" && selectedField ? (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-400">
                {selectedField.source}:{selectedField.key}
              </p>
              <FieldInput label="Ετικέτα">
                <input
                  className={inputCls}
                  value={selectedField.label ?? ""}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      label: e.target.value || undefined,
                    })
                  }
                />
              </FieldInput>
              <FieldInput label="Help">
                <input
                  className={inputCls}
                  value={selectedField.help ?? ""}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      help: e.target.value || undefined,
                    })
                  }
                />
              </FieldInput>
              <FieldInput label="Placeholder">
                <input
                  className={inputCls}
                  value={selectedField.placeholder ?? ""}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      placeholder: e.target.value || undefined,
                    })
                  }
                />
              </FieldInput>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedField.required}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      required: e.target.checked,
                    })
                  }
                />
                Required
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedField.readonly}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      readonly: e.target.checked,
                    })
                  }
                />
                Readonly
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedField.hidden}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      hidden: e.target.checked,
                    })
                  }
                />
                Hidden
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={!!selectedField.computed}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      computed: e.target.checked,
                    })
                  }
                />
                Computed
              </label>
              {selectedField.computed ? (
                <FieldInput label="Computed label">
                  <input
                    className={inputCls}
                    value={selectedField.computedLabel ?? ""}
                    onChange={(e) =>
                      patchField(selection.blockId, selectedField.id, {
                        computedLabel: e.target.value || undefined,
                      })
                    }
                  />
                </FieldInput>
              ) : null}
              <FieldInput label="Width">
                <select
                  className={inputCls}
                  value={selectedField.width ?? "half"}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      width: e.target.value as FieldWidth,
                    })
                  }
                >
                  <option value="full">full</option>
                  <option value="half">half</option>
                  <option value="third">third</option>
                  <option value="quarter">quarter</option>
                </select>
              </FieldInput>
              <FieldInput label="Widget">
                <select
                  className={inputCls}
                  value={selectedField.widget ?? "default"}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      widget: e.target.value as FormFieldRef["widget"],
                    })
                  }
                >
                  <option value="default">default</option>
                  <option value="textarea">textarea</option>
                  <option value="select">select</option>
                  <option value="toggle">toggle</option>
                </select>
              </FieldInput>
              <FieldInput label="Default value">
                <input
                  className={inputCls}
                  value={
                    selectedField.defaultValue == null
                      ? ""
                      : String(selectedField.defaultValue)
                  }
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      defaultValue: e.target.value || null,
                    })
                  }
                />
              </FieldInput>
              <FieldInput label="Visible roles (comma)">
                <input
                  className={inputCls}
                  value={(selectedField.visibleRoles ?? []).join(", ")}
                  onChange={(e) =>
                    patchField(selection.blockId, selectedField.id, {
                      visibleRoles: e.target.value
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </FieldInput>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-600"
                onClick={() =>
                  removeFieldById(selection.blockId, selectedField.id)
                }
              >
                <Trash2 size={12} /> Αφαίρεση πεδίου
              </Button>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "callout" ? (
            <div className="space-y-2">
              <FieldInput label="Κείμενο">
                <textarea
                  className="min-h-[72px] w-full rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  value={selectedBlock.text}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "callout" ? { ...b, text: e.target.value } : b,
                    )
                  }
                />
              </FieldInput>
              <FieldInput label="Tone">
                <select
                  className={inputCls}
                  value={selectedBlock.tone ?? "info"}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "callout"
                        ? {
                            ...b,
                            tone: e.target.value as "info" | "warning",
                          }
                        : b,
                    )
                  }
                >
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                </select>
              </FieldInput>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-600"
                onClick={() => removeBlockById(selectedBlock.id)}
              >
                <Trash2 size={12} /> Αφαίρεση
              </Button>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "heading" ? (
            <div className="space-y-2">
              <FieldInput label="Κείμενο">
                <input
                  className={inputCls}
                  value={selectedBlock.text}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "heading" ? { ...b, text: e.target.value } : b,
                    )
                  }
                />
              </FieldInput>
              <FieldInput label="Επίπεδο">
                <select
                  className={inputCls}
                  value={selectedBlock.level ?? 2}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "heading"
                        ? {
                            ...b,
                            level: Number(e.target.value) as 2 | 3,
                          }
                        : b,
                    )
                  }
                >
                  <option value={2}>H2</option>
                  <option value={3}>H3</option>
                </select>
              </FieldInput>
            </div>
          ) : null}

          {selection.kind === "block" && selectedBlock?.type === "related" ? (
            <div className="space-y-2">
              <FieldInput label="Τίτλος">
                <input
                  className={inputCls}
                  value={selectedBlock.title}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "related"
                        ? { ...b, title: e.target.value }
                        : b,
                    )
                  }
                />
              </FieldInput>
              <FieldInput label="Entity hint">
                <input
                  className={inputCls}
                  value={selectedBlock.entityHint ?? ""}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "related"
                        ? { ...b, entityHint: e.target.value || undefined }
                        : b,
                    )
                  }
                />
              </FieldInput>
              <FieldInput label="Empty text">
                <input
                  className={inputCls}
                  value={selectedBlock.emptyText ?? ""}
                  onChange={(e) =>
                    patchBlock(selectedBlock.id, (b) =>
                      b.type === "related"
                        ? { ...b, emptyText: e.target.value || undefined }
                        : b,
                    )
                  }
                />
              </FieldInput>
              <Button
                size="sm"
                variant="ghost"
                className="text-rose-600"
                onClick={() => removeBlockById(selectedBlock.id)}
              >
                <Trash2 size={12} /> Αφαίρεση
              </Button>
            </div>
          ) : null}

          {selection.kind === "block" &&
          selectedBlock &&
          (selectedBlock.type === "divider" ||
            selectedBlock.type === "spacer") ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">{selectedBlock.type}</p>
              {selectedBlock.type === "spacer" ? (
                <FieldInput label="Μέγεθος">
                  <select
                    className={inputCls}
                    value={selectedBlock.size ?? "md"}
                    onChange={(e) =>
                      patchBlock(selectedBlock.id, (b) =>
                        b.type === "spacer"
                          ? {
                              ...b,
                              size: e.target.value as "sm" | "md" | "lg",
                            }
                          : b,
                      )
                    }
                  >
                    <option value="sm">sm</option>
                    <option value="md">md</option>
                    <option value="lg">lg</option>
                  </select>
                </FieldInput>
              ) : null}
            </div>
          ) : null}

          {selection.kind === "block" &&
          selectedBlock?.type === "accordion" ? (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">Accordion items</p>
              {selectedBlock.items.map((it, idx) => (
                <div key={it.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={idx === 0}
                    className="text-slate-400 disabled:opacity-30"
                    onClick={() =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "accordion") return b;
                        return { ...b, items: moveItem(b.items, idx, -1) };
                      })
                    }
                  >
                    <ArrowUp size={12} />
                  </button>
                  <button
                    type="button"
                    disabled={idx === selectedBlock.items.length - 1}
                    className="text-slate-400 disabled:opacity-30"
                    onClick={() =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "accordion") return b;
                        return { ...b, items: moveItem(b.items, idx, 1) };
                      })
                    }
                  >
                    <ArrowDown size={12} />
                  </button>
                  <input
                    className={inputCls}
                    value={it.title}
                    onChange={(e) =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "accordion") return b;
                        const items = b.items.map((x, i) =>
                          i === idx ? { ...x, title: e.target.value } : x,
                        );
                        return { ...b, items };
                      })
                    }
                  />
                  <button
                    type="button"
                    title="Εισαγωγή εδώ"
                    className="text-teal-700"
                    onClick={() =>
                      setSelection({
                        kind: "slot",
                        containerId: selectedBlock.id,
                        slotId: it.id,
                      })
                    }
                  >
                    ▸
                  </button>
                  <button
                    type="button"
                    className="text-rose-600 disabled:opacity-30"
                    disabled={selectedBlock.items.length <= 1}
                    onClick={() =>
                      patchBlock(selectedBlock.id, (b) => {
                        if (b.type !== "accordion" || b.items.length <= 1)
                          return b;
                        return {
                          ...b,
                          items: b.items.filter((_, i) => i !== idx),
                        };
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  patchBlock(selectedBlock.id, (b) => {
                    if (b.type !== "accordion") return b;
                    return {
                      ...b,
                      items: [
                        ...b.items,
                        {
                          id: fxId("acci"),
                          title: `Στοιχείο ${b.items.length + 1}`,
                          children: [],
                        },
                      ],
                    };
                  })
                }
              >
                <Plus size={12} /> Item
              </Button>
            </div>
          ) : null}

          {/* Rules */}
          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Κανόνες
            </p>
            <ul className="mb-2 space-y-2">
              {rules.map((r, idx) => (
                <li
                  key={r.id}
                  className="space-y-1 rounded-lg border border-slate-100 p-2 text-[10px]"
                >
                  <div className="flex gap-1">
                    <select
                      className={inputCls}
                      value={`${r.when.source}:${r.when.key}`}
                      onChange={(e) => {
                        const [source, ...rest] = e.target.value.split(":");
                        const key = rest.join(":");
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          when: {
                            ...r.when,
                            source: source as "system" | "custom",
                            key,
                          },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    >
                      {formableBuiltins.map((b) => (
                        <option key={`s:${b.key}`} value={`system:${b.key}`}>
                          sys:{b.label}
                        </option>
                      ))}
                      {activeCustoms.map((f) => (
                        <option key={`c:${f.code}`} value={`custom:${f.code}`}>
                          cus:{f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputCls}
                      value={r.when.op}
                      onChange={(e) => {
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          when: { ...r.when, op: e.target.value as RuleOp },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    >
                      {(
                        [
                          "eq",
                          "neq",
                          "empty",
                          "not_empty",
                          "contains",
                        ] as RuleOp[]
                      ).map((op) => (
                        <option key={op} value={op}>
                          {op}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    className={inputCls}
                    placeholder="value"
                    value={
                      r.when.value == null ? "" : String(r.when.value)
                    }
                    onChange={(e) => {
                      const next = [...rules];
                      next[idx] = {
                        ...r,
                        when: {
                          ...r.when,
                          value: e.target.value || null,
                        },
                      };
                      updateDraft({ ...draft, rules: next });
                    }}
                  />
                  <div className="flex gap-1">
                    <select
                      className={inputCls}
                      value={r.then.action}
                      onChange={(e) => {
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          then: {
                            ...r.then,
                            action: e.target.value as FormRule["then"]["action"],
                          },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    >
                      {(
                        [
                          "hide",
                          "show",
                          "require",
                          "optional",
                          "readonly",
                          "set_value",
                        ] as FormRule["then"]["action"][]
                      ).map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <select
                      className={inputCls}
                      value={r.then.targetType}
                      onChange={(e) => {
                        const targetType = e.target.value as "field" | "block";
                        const opts =
                          targetType === "field"
                            ? ruleTargetOptions.fields
                            : ruleTargetOptions.blocks;
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          then: {
                            ...r.then,
                            targetType,
                            targetId: opts[0]?.id ?? "",
                          },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    >
                      <option value="field">field</option>
                      <option value="block">block</option>
                    </select>
                  </div>
                  <select
                    className={inputCls}
                    value={r.then.targetId}
                    onChange={(e) => {
                      const next = [...rules];
                      next[idx] = {
                        ...r,
                        then: { ...r.then, targetId: e.target.value },
                      };
                      updateDraft({ ...draft, rules: next });
                    }}
                  >
                    <option value="">— στόχος —</option>
                    {(r.then.targetType === "block"
                      ? ruleTargetOptions.blocks
                      : ruleTargetOptions.fields
                    ).map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {r.then.action === "set_value" ? (
                    <input
                      className={inputCls}
                      placeholder="τιμή set_value"
                      value={
                        r.then.value == null ? "" : String(r.then.value)
                      }
                      onChange={(e) => {
                        const next = [...rules];
                        next[idx] = {
                          ...r,
                          then: {
                            ...r.then,
                            value: e.target.value || null,
                          },
                        };
                        updateDraft({ ...draft, rules: next });
                      }}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="text-rose-600"
                    onClick={() =>
                      updateDraft({
                        ...draft,
                        rules: rules.filter((_, i) => i !== idx),
                      })
                    }
                  >
                    Αφαίρεση κανόνα
                  </button>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => {
                const first = formableBuiltins[0];
                const rule: FormRule = {
                  id: fxId("rule"),
                  when: {
                    source: "system",
                    key: first?.key ?? "status",
                    op: "eq",
                    value: "",
                  },
                  then: {
                    action: "hide",
                    targetType: "field",
                    targetId: ruleTargetOptions.fields[0]?.id ?? "",
                  },
                };
                updateDraft({ ...draft, rules: [...rules, rule] });
              }}
            >
              <Plus size={12} /> Κανόνας
            </Button>
          </div>
        </aside>
      </div>
    </div>
  );
}
