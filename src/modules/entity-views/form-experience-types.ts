/** Form Experience Engine — schema v2 */

export type FormMode = "create" | "edit" | "view" | "quick" | "wizard";
export type FormLifecycle = "draft" | "published";
export type FieldWidth = "full" | "half" | "third" | "quarter";

export type FormFieldRef = {
  id: string;
  key: string;
  source: "system" | "custom";
  label?: string;
  help?: string;
  placeholder?: string;
  required?: boolean;
  readonly?: boolean;
  hidden?: boolean;
  width?: FieldWidth;
  defaultValue?: string | number | boolean | null;
  widget?: "default" | "textarea" | "select" | "toggle";
  /** If set, only these roles see the field */
  visibleRoles?: string[];
  /** Display-only computed / related placeholder */
  computed?: boolean;
  computedLabel?: string;
};

export type RuleOp = "eq" | "neq" | "empty" | "not_empty" | "contains";

export type FormRule = {
  id: string;
  when: {
    source: "system" | "custom";
    key: string;
    op: RuleOp;
    value?: string | number | boolean | null;
  };
  then: {
    action: "hide" | "show" | "require" | "optional" | "readonly" | "set_value";
    targetType: "field" | "block";
    targetId: string;
    value?: string | number | boolean | null;
  };
};

export type FormBlock =
  | {
      type: "section";
      id: string;
      title: string;
      description?: string;
      collapsible?: boolean;
      collapsed?: boolean;
      children: FormBlock[];
    }
  | {
      type: "tabs";
      id: string;
      /** tabs = same page; wizard = stepped */
      variant?: "tabs" | "wizard";
      tabs: Array<{ id: string; title: string; children: FormBlock[] }>;
    }
  | {
      type: "columns";
      id: string;
      columns: Array<{ id: string; children: FormBlock[] }>;
    }
  | {
      type: "accordion";
      id: string;
      items: Array<{ id: string; title: string; children: FormBlock[] }>;
    }
  | {
      type: "fields";
      id: string;
      fields: FormFieldRef[];
    }
  | {
      type: "heading";
      id: string;
      text: string;
      level?: 2 | 3;
    }
  | {
      type: "divider";
      id: string;
    }
  | {
      type: "callout";
      id: string;
      tone?: "info" | "warning";
      text: string;
    }
  | {
      type: "spacer";
      id: string;
      size?: "sm" | "md" | "lg";
    }
  | {
      type: "related";
      id: string;
      title: string;
      entityHint?: string;
      emptyText?: string;
    };

export type FormViewConfig = {
  schemaVersion: 2;
  mode?: FormMode;
  lifecycle?: FormLifecycle;
  page: {
    title?: string;
    showHeader?: boolean;
    showSide?: boolean;
    sideContent?: "summary" | "none";
    root: FormBlock[];
  };
  rules?: FormRule[];
};

/** Legacy v1 shape (still accepted on ingest) */
export type FormViewConfigV1 = {
  sections: Array<{
    id: string;
    title: string;
    fields: Array<{
      key: string;
      source: "system" | "custom";
      required?: boolean;
      label?: string;
    }>;
  }>;
};

export function fxId(prefix = "fx") {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function emptyFormConfig(mode: FormMode = "edit"): FormViewConfig {
  return {
    schemaVersion: 2,
    mode,
    lifecycle: "published",
    page: {
      showHeader: true,
      showSide: false,
      sideContent: "none",
      root: [
        {
          type: "section",
          id: fxId("sec"),
          title: "Βασικά στοιχεία",
          children: [{ type: "fields", id: fxId("flds"), fields: [] }],
        },
      ],
    },
    rules: [],
  };
}

export function migrateFormV1ToV2(v1: FormViewConfigV1): FormViewConfig {
  const sections = Array.isArray(v1.sections) ? v1.sections : [];
  return {
    schemaVersion: 2,
    mode: "edit",
    lifecycle: "published",
    page: {
      showHeader: true,
      showSide: false,
      sideContent: "none",
      root:
        sections.length > 0
          ? sections.map((s) => ({
              type: "section" as const,
              id: s.id || fxId("sec"),
              title: s.title || "Ενότητα",
              children: [
                {
                  type: "fields" as const,
                  id: `${s.id || "sec"}_fields`,
                  fields: (s.fields ?? []).map((f, i) => ({
                    id: `${s.id || "s"}_${f.source}_${f.key}_${i}`,
                    key: f.key,
                    source: f.source,
                    required: f.required,
                    label: f.label,
                    width: "half" as const,
                  })),
                },
              ],
            }))
          : emptyFormConfig().page.root,
    },
    rules: [],
  };
}

export function isFormV2(raw: unknown): raw is FormViewConfig {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as FormViewConfig).schemaVersion === 2 &&
    typeof (raw as FormViewConfig).page === "object" &&
    Array.isArray((raw as FormViewConfig).page?.root)
  );
}

export function normalizeFormConfig(raw: unknown): FormViewConfig {
  if (isFormV2(raw)) {
    return {
      schemaVersion: 2,
      mode: raw.mode ?? "edit",
      lifecycle: raw.lifecycle ?? "published",
      page: {
        title: raw.page.title,
        showHeader: raw.page.showHeader ?? true,
        showSide: raw.page.showSide ?? false,
        sideContent: raw.page.sideContent ?? "none",
        root: Array.isArray(raw.page.root) ? raw.page.root : [],
      },
      rules: Array.isArray(raw.rules) ? raw.rules : [],
    };
  }
  if (raw && typeof raw === "object" && Array.isArray((raw as FormViewConfigV1).sections)) {
    return migrateFormV1ToV2(raw as FormViewConfigV1);
  }
  return emptyFormConfig();
}

/** Walk all field refs in the tree */
export function walkFormFields(
  blocks: FormBlock[],
  visit: (field: FormFieldRef, blockId: string) => void,
) {
  for (const b of blocks) {
    switch (b.type) {
      case "fields":
        for (const f of b.fields) visit(f, b.id);
        break;
      case "section":
        walkFormFields(b.children, visit);
        break;
      case "tabs":
        for (const t of b.tabs) walkFormFields(t.children, visit);
        break;
      case "columns":
        for (const c of b.columns) walkFormFields(c.children, visit);
        break;
      case "accordion":
        for (const it of b.items) walkFormFields(it.children, visit);
        break;
      default:
        break;
    }
  }
}

export function walkFormBlocks(
  blocks: FormBlock[],
  visit: (block: FormBlock, parentId: string | null) => void,
  parentId: string | null = null,
) {
  for (const b of blocks) {
    visit(b, parentId);
    switch (b.type) {
      case "section":
        walkFormBlocks(b.children, visit, b.id);
        break;
      case "tabs":
        for (const t of b.tabs) walkFormBlocks(t.children, visit, t.id);
        break;
      case "columns":
        for (const c of b.columns) walkFormBlocks(c.children, visit, c.id);
        break;
      case "accordion":
        for (const it of b.items) walkFormBlocks(it.children, visit, it.id);
        break;
      default:
        break;
    }
  }
}

export function findBlock(
  blocks: FormBlock[],
  id: string,
): FormBlock | null {
  for (const b of blocks) {
    if (b.id === id) return b;
    let found: FormBlock | null = null;
    switch (b.type) {
      case "section":
        found = findBlock(b.children, id);
        break;
      case "tabs":
        for (const t of b.tabs) {
          found = findBlock(t.children, id);
          if (found) return found;
        }
        break;
      case "columns":
        for (const c of b.columns) {
          found = findBlock(c.children, id);
          if (found) return found;
        }
        break;
      case "accordion":
        for (const it of b.items) {
          found = findBlock(it.children, id);
          if (found) return found;
        }
        break;
      default:
        break;
    }
    if (found) return found;
  }
  return null;
}

export function mapBlocks(
  blocks: FormBlock[],
  mapper: (block: FormBlock) => FormBlock,
): FormBlock[] {
  return blocks.map((b) => {
    const mapped = mapper(b);
    switch (mapped.type) {
      case "section":
        return { ...mapped, children: mapBlocks(mapped.children, mapper) };
      case "tabs":
        return {
          ...mapped,
          tabs: mapped.tabs.map((t) => ({
            ...t,
            children: mapBlocks(t.children, mapper),
          })),
        };
      case "columns":
        return {
          ...mapped,
          columns: mapped.columns.map((c) => ({
            ...c,
            children: mapBlocks(c.children, mapper),
          })),
        };
      case "accordion":
        return {
          ...mapped,
          items: mapped.items.map((it) => ({
            ...it,
            children: mapBlocks(it.children, mapper),
          })),
        };
      default:
        return mapped;
    }
  });
}

export function insertChild(
  blocks: FormBlock[],
  parentId: string | null,
  child: FormBlock,
): FormBlock[] {
  if (parentId == null) return [...blocks, child];
  return mapBlocks(blocks, (b) => {
    if (b.id !== parentId) return b;
    if (b.type === "section") return { ...b, children: [...b.children, child] };
    if (b.type === "tabs" && b.tabs[0]) {
      const first = b.tabs[0];
      const tabs = [...b.tabs];
      tabs[0] = {
        ...first,
        children: [...first.children, child],
      };
      return { ...b, tabs };
    }
    if (b.type === "columns" && b.columns[0]) {
      const first = b.columns[0];
      const columns = [...b.columns];
      columns[0] = {
        ...first,
        children: [...first.children, child],
      };
      return { ...b, columns };
    }
    if (b.type === "accordion" && b.items[0]) {
      const first = b.items[0];
      const items = [...b.items];
      items[0] = {
        ...first,
        children: [...first.children, child],
      };
      return { ...b, items };
    }
    return b;
  });
}

export function removeBlock(blocks: FormBlock[], id: string): FormBlock[] {
  return blocks
    .filter((b) => b.id !== id)
    .map((b) => {
      switch (b.type) {
        case "section":
          return { ...b, children: removeBlock(b.children, id) };
        case "tabs":
          return {
            ...b,
            tabs: b.tabs.map((t) => ({
              ...t,
              children: removeBlock(t.children, id),
            })),
          };
        case "columns":
          return {
            ...b,
            columns: b.columns.map((c) => ({
              ...c,
              children: removeBlock(c.children, id),
            })),
          };
        case "accordion":
          return {
            ...b,
            items: b.items.map((it) => ({
              ...it,
              children: removeBlock(it.children, id),
            })),
          };
        case "fields":
          return {
            ...b,
            fields: b.fields.filter((f) => f.id !== id),
          };
        default:
          return b;
      }
    });
}

export const WIDTH_CLASS: Record<FieldWidth, string> = {
  full: "sm:col-span-2",
  half: "",
  third: "sm:col-span-1",
  quarter: "sm:col-span-1",
};
