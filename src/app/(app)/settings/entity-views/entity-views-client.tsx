"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Copy,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import type { CustomFieldType, EntityModule } from "@/generated/prisma/client";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  ENTITY_MODULES,
  ENTITY_REGISTRY,
  entityLabel,
  type BuiltinField,
} from "@/modules/entity-views/registry";
import {
  FILTER_OP_LABELS,
  FILTER_OPS,
  type FormViewConfig,
  type ListViewConfig,
} from "@/modules/entity-views/types";
import {
  DynamicFormSections,
  DynamicListCells,
  DynamicListHeader,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";

type FieldItem = {
  id: string;
  entity: EntityModule;
  code: string;
  label: string;
  type: CustomFieldType;
  options: string[];
  required: boolean;
  filterable: boolean;
  showInList: boolean;
  sortOrder: number;
  isActive: boolean;
};

type ListViewItem = {
  id: string;
  entity: EntityModule;
  code: string;
  name: string;
  description: string | null;
  config: ListViewConfig;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
  sortOrder: number;
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

type Tab = "fields" | "lists" | "forms";

const FIELD_TYPES: Array<{ value: CustomFieldType; label: string }> = [
  { value: "TEXT", label: "Κείμενο" },
  { value: "NUMBER", label: "Αριθμός" },
  { value: "DATE", label: "Ημερομηνία" },
  { value: "BOOLEAN", label: "Ναι/Όχι" },
  { value: "SELECT", label: "Επιλογή" },
  { value: "MULTI_SELECT", label: "Πολλαπλή" },
];

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const next = index + dir;
  if (next < 0 || next >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[next]] = [copy[next]!, copy[index]!];
  return copy;
}

function parseOptionsText(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  if (trimmed.includes("\n")) {
    return trimmed
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function toCustomDefs(fields: FieldItem[]): CustomFieldDef[] {
  return fields.map((f) => ({
    code: f.code,
    label: f.label,
    type: f.type,
    optionsJson: f.options,
    required: f.required,
  }));
}

function fieldTypeOf(
  key: string,
  source: "system" | "custom",
  builtins: BuiltinField[],
  customFields: FieldItem[],
): string {
  if (source === "system") {
    return builtins.find((b) => b.key === key)?.type ?? "text";
  }
  return customFields.find((f) => f.code === key)?.type ?? "TEXT";
}

function sampleListRows(
  builtins: BuiltinField[],
  customFields: FieldItem[],
): Record<string, unknown>[] {
  const samples: Record<string, unknown>[] = [
    { id: "sample-1" },
    { id: "sample-2" },
    { id: "sample-3" },
  ];
  return samples.map((row, i) => {
    const next: Record<string, unknown> = { ...row };
    const customFieldsMap: Record<string, unknown> = {};
    for (const b of builtins.filter((x) => x.listable)) {
      switch (b.type) {
        case "number":
        case "money":
          next[b.key] = (i + 1) * 10;
          break;
        case "boolean":
          next[b.key] = i % 2 === 0;
          break;
        case "date":
          next[b.key] = new Date(2026, 0, 10 + i).toISOString();
          break;
        case "select":
          next[b.key] = b.options?.[i % (b.options.length || 1)]?.value ?? "A";
          break;
        case "badge":
          next[b.key] = b.options?.[0]?.value ?? "ACTIVE";
          break;
        default:
          next[b.key] = `${b.label} ${i + 1}`;
      }
    }
    for (const f of customFields) {
      switch (f.type) {
        case "NUMBER":
          customFieldsMap[f.code] = (i + 1) * 5;
          break;
        case "BOOLEAN":
          customFieldsMap[f.code] = i % 2 === 1;
          break;
        case "DATE":
          customFieldsMap[f.code] = new Date(2026, 1, 1 + i)
            .toISOString()
            .slice(0, 10);
          break;
        case "SELECT":
          customFieldsMap[f.code] = f.options[i % (f.options.length || 1)] ?? "A";
          break;
        case "MULTI_SELECT":
          customFieldsMap[f.code] = f.options.slice(0, Math.min(2, f.options.length));
          break;
        default:
          customFieldsMap[f.code] = `${f.label} ${i + 1}`;
      }
    }
    next.customFields = customFieldsMap;
    return next;
  });
}

export function EntityViewsClient({
  initialFields,
  initialViews,
}: {
  initialFields: FieldItem[];
  initialViews: Record<string, { lists: ListViewItem[]; forms: FormViewItem[] }>;
}) {
  const [entity, setEntity] = useState<EntityModule>("CUSTOMERS");
  const [tab, setTab] = useState<Tab>("fields");
  const [fields, setFields] = useState(initialFields);
  const [views, setViews] = useState(initialViews);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const entityFields = useMemo(
    () => fields.filter((f) => f.entity === entity),
    [fields, entity],
  );
  const lists = views[entity]?.lists ?? [];
  const forms = views[entity]?.forms ?? [];
  const builtins = ENTITY_REGISTRY[entity].builtins;

  const refreshEntity = async () => {
    const [fRes, lRes, foRes] = await Promise.all([
      fetch(`/api/settings/custom-fields?entity=${entity}`),
      fetch(`/api/settings/list-views?entity=${entity}&all=1`),
      fetch(`/api/settings/form-views?entity=${entity}&all=1`),
    ]);
    const fData = await fRes.json();
    const lData = await lRes.json();
    const foData = await foRes.json();
    if (fRes.ok) {
      setFields((prev) => [
        ...prev.filter((f) => f.entity !== entity),
        ...fData.items.map((f: FieldItem & { optionsJson?: unknown }) => ({
          ...f,
          options: Array.isArray(f.options)
            ? f.options
            : Array.isArray(f.optionsJson)
              ? f.optionsJson.map(String)
              : [],
        })),
      ]);
    }
    if (lRes.ok || foRes.ok) {
      setViews((prev) => ({
        ...prev,
        [entity]: {
          lists: lData.items ?? prev[entity]?.lists ?? [],
          forms: foData.items ?? prev[entity]?.forms ?? [],
        },
      }));
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/settings"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Ρυθμίσεις
        </Link>
        <PageHeader
          title="Πεδία & Προβολές"
          description="Custom fields (JSONB) · πολλαπλές λίστες και φόρμες ανά module."
        />
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

      <div className="flex flex-wrap gap-1.5">
        {ENTITY_MODULES.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => setEntity(e)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs font-medium",
              entity === e
                ? "border-teal-600 bg-teal-600 text-white"
                : "border-slate-200 bg-white text-slate-600",
            )}
          >
            {entityLabel(e)}
          </button>
        ))}
      </div>

      <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
        {(
          [
            ["fields", "Custom πεδία"],
            ["lists", "Λίστες"],
            ["forms", "Φόρμες"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium",
              tab === id
                ? "bg-white text-ink-950 shadow-sm"
                : "text-slate-500",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "fields" ? (
        <FieldsPanel
          entity={entity}
          items={entityFields}
          pending={pending}
          onCreate={(payload) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch("/api/settings/custom-fields", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Το πεδίο δημιουργήθηκε.");
              await refreshEntity();
            });
          }}
          onPatch={(id, patch) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch(`/api/settings/custom-fields/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Αποθηκεύτηκε.");
              await refreshEntity();
            });
          }}
          onDelete={(id) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch(`/api/settings/custom-fields/${id}`, {
                method: "DELETE",
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Διαγράφηκε.");
              await refreshEntity();
            });
          }}
        />
      ) : null}

      {tab === "lists" ? (
        <ListBuilderPanel
          entity={entity}
          builtins={builtins}
          customFields={entityFields.filter((f) => f.isActive)}
          items={lists}
          pending={pending}
          onSave={(item, config, meta) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch(`/api/settings/list-views/${item.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: meta.name,
                  configJson: config,
                  isDefault: meta.isDefault,
                  isActive: meta.isActive,
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Η λίστα αποθηκεύτηκε.");
              await refreshEntity();
            });
          }}
          onCreate={(payload) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch("/api/settings/list-views", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Η λίστα δημιουργήθηκε.");
              await refreshEntity();
            });
          }}
          onDelete={(id) => {
            startTransition(async () => {
              const res = await fetch(`/api/settings/list-views/${id}`, {
                method: "DELETE",
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Διαγράφηκε.");
              await refreshEntity();
            });
          }}
        />
      ) : null}

      {tab === "forms" ? (
        <FormBuilderPanel
          entity={entity}
          builtins={builtins}
          customFields={entityFields.filter((f) => f.isActive)}
          items={forms}
          pending={pending}
          onSave={(item, config, meta) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch(`/api/settings/form-views/${item.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: meta.name,
                  configJson: config,
                  isDefault: meta.isDefault,
                  isActive: meta.isActive,
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Η φόρμα αποθηκεύτηκε.");
              await refreshEntity();
            });
          }}
          onCreate={(payload) => {
            startTransition(async () => {
              setError(null);
              const res = await fetch("/api/settings/form-views", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Η φόρμα δημιουργήθηκε.");
              await refreshEntity();
            });
          }}
          onDelete={(id) => {
            startTransition(async () => {
              const res = await fetch(`/api/settings/form-views/${id}`, {
                method: "DELETE",
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error || "Αποτυχία");
                return;
              }
              setMessage("Διαγράφηκε.");
              await refreshEntity();
            });
          }}
        />
      ) : null}
    </div>
  );
}

function FieldsPanel({
  entity,
  items,
  pending,
  onCreate,
  onPatch,
  onDelete,
}: {
  entity: EntityModule;
  items: FieldItem[];
  pending: boolean;
  onCreate: (payload: Record<string, unknown>) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [createType, setCreateType] = useState<CustomFieldType>("TEXT");
  const sorted = useMemo(
    () => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "el")),
    [items],
  );
  const needsOptions =
    createType === "SELECT" || createType === "MULTI_SELECT";

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const options = parseOptionsText(String(form.get("options") || ""));
          onCreate({
            entity,
            code: form.get("code"),
            label: form.get("label"),
            type: form.get("type"),
            options,
            required: form.get("required") === "on",
            filterable: form.get("filterable") === "on",
            showInList: form.get("showInList") === "on",
          });
          e.currentTarget.reset();
          setCreateType("TEXT");
        }}
        className="soft-panel grid gap-3 p-4 sm:grid-cols-6"
      >
        <input
          name="code"
          required
          placeholder="κωδικός *"
          className="h-10 rounded-xl border border-slate-200 px-3 text-sm sm:col-span-1"
        />
        <input
          name="label"
          required
          placeholder="Ετικέτα *"
          className="h-10 rounded-xl border border-slate-200 px-3 text-sm sm:col-span-2"
        />
        <select
          name="type"
          className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          value={createType}
          onChange={(e) => setCreateType(e.target.value as CustomFieldType)}
        >
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          name="options"
          placeholder={
            needsOptions
              ? "Επιλογές (μία ανά γραμμή ή κόμμα)"
              : "Επιλογές (προαιρετικό)"
          }
          disabled={!needsOptions}
          className="h-10 rounded-xl border border-slate-200 px-3 text-sm disabled:bg-slate-50 disabled:text-slate-400"
        />
        <Button type="submit" size="sm" disabled={pending} className="h-10">
          <Plus size={14} /> Προσθήκη
        </Button>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600 sm:col-span-6">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="required" /> Υποχρεωτικό
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="filterable" /> Φιλτράρισμα
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" name="showInList" defaultChecked /> Σε λίστα
          </label>
        </div>
      </form>

      <ul className="soft-panel divide-y divide-slate-100">
        {sorted.map((f, idx) => (
          <FieldRow
            key={`${f.id}:${f.label}:${f.options.join(",")}:${f.required}:${f.filterable}:${f.showInList}:${f.isActive}`}
            field={f}
            pending={pending}
            canUp={idx > 0}
            canDown={idx < sorted.length - 1}
            onMove={(dir) => {
              const neighbor = sorted[idx + dir];
              if (!neighbor) return;
              onPatch(f.id, { sortOrder: neighbor.sortOrder });
              onPatch(neighbor.id, { sortOrder: f.sortOrder });
            }}
            onPatch={onPatch}
            onDelete={onDelete}
          />
        ))}
        {sorted.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-slate-500">
            Δεν υπάρχουν custom πεδία για {entityLabel(entity)}.
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function FieldRow({
  field,
  pending,
  canUp,
  canDown,
  onMove,
  onPatch,
  onDelete,
}: {
  field: FieldItem;
  pending: boolean;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onPatch: (id: string, patch: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [label, setLabel] = useState(field.label);
  const [optionsText, setOptionsText] = useState(field.options.join("\n"));
  const [required, setRequired] = useState(field.required);
  const [filterable, setFilterable] = useState(field.filterable);
  const [showInList, setShowInList] = useState(field.showInList);
  const needsOptions = field.type === "SELECT" || field.type === "MULTI_SELECT";

  const dirty =
    label !== field.label ||
    optionsText !== field.options.join("\n") ||
    required !== field.required ||
    filterable !== field.filterable ||
    showInList !== field.showInList;

  return (
    <li className="space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-0.5">
          <button
            type="button"
            disabled={pending || !canUp}
            onClick={() => onMove(-1)}
            className="rounded-lg border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
            aria-label="Πάνω"
          >
            <ArrowUp size={14} />
          </button>
          <button
            type="button"
            disabled={pending || !canDown}
            onClick={() => onMove(1)}
            className="rounded-lg border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
            aria-label="Κάτω"
          >
            <ArrowDown size={14} />
          </button>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="h-9 min-w-[160px] flex-1 rounded-xl border border-slate-200 px-3 text-sm font-medium"
            />
            <span className="font-mono text-xs text-slate-400">{field.code}</span>
            <Badge tone="slate">
              {FIELD_TYPES.find((t) => t.value === field.type)?.label ?? field.type}
            </Badge>
            {!field.isActive ? <Badge tone="amber">Ανενεργό</Badge> : null}
          </div>
          {needsOptions ? (
            <textarea
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              rows={2}
              placeholder="Επιλογές — μία ανά γραμμή ή κόμμα"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            />
          ) : null}
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => setRequired(e.target.checked)}
              />{" "}
              Υποχρεωτικό
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={filterable}
                onChange={(e) => setFilterable(e.target.checked)}
              />{" "}
              Φιλτράρισμα
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showInList}
                onChange={(e) => setShowInList(e.target.checked)}
              />{" "}
              Σε λίστα
            </label>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {dirty ? (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                onPatch(field.id, {
                  label,
                  options: needsOptions ? parseOptionsText(optionsText) : field.options,
                  required,
                  filterable,
                  showInList,
                })
              }
            >
              <Save size={14} /> Αποθήκευση
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => onPatch(field.id, { isActive: !field.isActive })}
          >
            {field.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => onDelete(field.id)}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </li>
  );
}

function ListBuilderPanel({
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
  customFields: FieldItem[];
  items: ListViewItem[];
  pending: boolean;
  onSave: (
    item: ListViewItem,
    config: ListViewConfig,
    meta: { name: string; isDefault: boolean; isActive: boolean },
  ) => void;
  onCreate: (payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const [draft, setDraft] = useState<ListViewConfig | null>(
    () => items[0]?.config ?? null,
  );
  const [name, setName] = useState(items[0]?.name ?? "");

  const selectView = (item: ListViewItem) => {
    setSelectedId(item.id);
    setDraft(item.config);
    setName(item.name);
  };

  const activeConfig = draft ?? selected?.config ?? null;
  const customDefs = useMemo(() => toCustomDefs(customFields), [customFields]);
  const previewRows = useMemo(
    () => sampleListRows(builtins, customFields),
    [builtins, customFields],
  );

  const updateConfig = (next: ListViewConfig) => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraft(next);
  };

  const toggleColumn = (key: string, source: "system" | "custom") => {
    if (!selected || !activeConfig) return;
    const exists = activeConfig.columns.some(
      (c) => c.key === key && c.source === source,
    );
    const columns = exists
      ? activeConfig.columns.filter(
          (c) => !(c.key === key && c.source === source),
        )
      : [...activeConfig.columns, { key, source }];
    if (columns.length === 0) return;
    updateConfig({ ...activeConfig, columns });
  };

  const columnLabel = (col: ListViewConfig["columns"][number]) => {
    if (col.source === "system") {
      return builtins.find((b) => b.key === col.key)?.label ?? col.key;
    }
    return customFields.find((f) => f.code === col.key)?.label ?? col.key;
  };

  const sortableFields = [
    ...builtins
      .filter((b) => b.listable)
      .map((b) => ({ key: b.key, label: b.label, source: "system" as const })),
    ...customFields.map((f) => ({
      key: f.code,
      label: f.label,
      source: "custom" as const,
    })),
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="soft-panel space-y-2 p-2">
        <ul className="space-y-1">
          {items.map((item) => (
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
                {item.name}
                {item.isDefault ? (
                  <Badge tone="teal" className="ml-1">
                    Default
                  </Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={() =>
            onCreate({
              entity,
              code: `list_${Date.now().toString(36)}`,
              name: `Νέα λίστα ${entityLabel(entity)}`,
              configJson: {
                columns: builtins
                  .filter((b) => b.listable)
                  .slice(0, 5)
                  .map((b) => ({ key: b.key, source: "system" })),
                filters: [],
                sort: { key: "createdAt", source: "system", dir: "desc" },
                pageSize: 50,
              },
            })
          }
        >
          <Plus size={14} /> Νέα λίστα
        </Button>
      </aside>

      {selected && activeConfig ? (
        <div className="soft-panel space-y-4 p-4">
          <input
            value={name || selected.name}
            onChange={(e) => {
              setName(e.target.value);
              setSelectedId(selected.id);
              setDraft(activeConfig);
            }}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium"
          />
          <p className="text-xs text-slate-500">
            Επιλέξτε στήλες (system + custom). Αποθηκευμένα φίλτρα επεξεργάζονται
            παρακάτω.
          </p>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              System πεδία
            </p>
            <div className="flex flex-wrap gap-1.5">
              {builtins
                .filter((b) => b.listable)
                .map((b) => {
                  const on = activeConfig.columns.some(
                    (c) => c.key === b.key && c.source === "system",
                  );
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => toggleColumn(b.key, "system")}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        on
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-slate-200 bg-white",
                      )}
                    >
                      {b.label}
                    </button>
                  );
                })}
            </div>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              Custom πεδία
            </p>
            <div className="flex flex-wrap gap-1.5">
              {customFields.map((f) => {
                const on = activeConfig.columns.some(
                  (c) => c.key === f.code && c.source === "custom",
                );
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => toggleColumn(f.code, "custom")}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                      on
                        ? "border-teal-600 bg-teal-600 text-white"
                        : "border-slate-200 bg-white",
                    )}
                  >
                    {f.label}
                  </button>
                );
              })}
              {customFields.length === 0 ? (
                <span className="text-xs text-slate-400">Δεν υπάρχουν ακόμα</span>
              ) : null}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Στήλες (σειρά)
            </p>
            <ul className="space-y-2">
              {activeConfig.columns.map((col, idx) => (
                <li
                  key={`${col.source}:${col.key}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5"
                >
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() =>
                        updateConfig({
                          ...activeConfig,
                          columns: moveItem(activeConfig.columns, idx, -1),
                        })
                      }
                      className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={idx === activeConfig.columns.length - 1}
                      onClick={() =>
                        updateConfig({
                          ...activeConfig,
                          columns: moveItem(activeConfig.columns, idx, 1),
                        })
                      }
                      className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                  <span className="min-w-[100px] text-sm font-medium text-ink-950">
                    {columnLabel(col)}
                  </span>
                  <input
                    value={col.label ?? ""}
                    placeholder="Ετικέτα (προαιρετικά)"
                    onChange={(e) => {
                      const columns = [...activeConfig.columns];
                      columns[idx] = {
                        ...col,
                        label: e.target.value || undefined,
                      };
                      updateConfig({ ...activeConfig, columns });
                    }}
                    className="h-8 min-w-[140px] flex-1 rounded-lg border border-slate-200 px-2 text-xs"
                  />
                  <button
                    type="button"
                    className="text-xs text-rose-600"
                    disabled={activeConfig.columns.length <= 1}
                    onClick={() => {
                      const columns = activeConfig.columns.filter(
                        (_, i) => i !== idx,
                      );
                      if (columns.length === 0) return;
                      updateConfig({ ...activeConfig, columns });
                    }}
                  >
                    Αφαίρεση
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Ταξινόμηση
              </p>
              <div className="flex gap-2">
                <select
                  className="h-9 flex-1 rounded-lg border border-slate-200 px-2 text-sm"
                  value={
                    activeConfig.sort
                      ? `${activeConfig.sort.source}:${activeConfig.sort.key}`
                      : ""
                  }
                  onChange={(e) => {
                    if (!e.target.value) {
                      const { sort: _s, ...rest } = activeConfig;
                      updateConfig(rest as ListViewConfig);
                      return;
                    }
                    const [source, key] = e.target.value.split(":") as [
                      "system" | "custom",
                      string,
                    ];
                    updateConfig({
                      ...activeConfig,
                      sort: {
                        key,
                        source,
                        dir: activeConfig.sort?.dir ?? "asc",
                      },
                    });
                  }}
                >
                  <option value="">—</option>
                  {sortableFields.map((opt) => (
                    <option
                      key={`${opt.source}:${opt.key}`}
                      value={`${opt.source}:${opt.key}`}
                    >
                      {opt.label}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-sm"
                  value={activeConfig.sort?.dir ?? "asc"}
                  disabled={!activeConfig.sort}
                  onChange={(e) => {
                    if (!activeConfig.sort) return;
                    updateConfig({
                      ...activeConfig,
                      sort: {
                        ...activeConfig.sort,
                        dir: e.target.value as "asc" | "desc",
                      },
                    });
                  }}
                >
                  <option value="asc">Αύξουσα</option>
                  <option value="desc">Φθίνουσα</option>
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Μέγεθος σελίδας
              </p>
              <input
                type="number"
                min={10}
                max={100}
                value={activeConfig.pageSize ?? 50}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const pageSize = Number.isFinite(n)
                    ? Math.min(100, Math.max(10, n))
                    : 50;
                  updateConfig({ ...activeConfig, pageSize });
                }}
                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm"
              />
            </div>
          </div>

          <FilterEditor
            config={activeConfig}
            builtins={builtins}
            customFields={customFields}
            onChange={updateConfig}
          />

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Προεπισκόπηση
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-100 bg-white">
              <DynamicListHeader
                columns={activeConfig.columns}
                builtins={builtins}
                customDefs={customDefs}
              />
              <ul className="divide-y divide-slate-100">
                {previewRows.map((row) => (
                  <li key={String(row.id)} className="px-4 py-2.5">
                    <DynamicListCells
                      columns={activeConfig.columns}
                      builtins={builtins}
                      customDefs={customDefs}
                      row={row}
                    />
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                onSave(selected, activeConfig, {
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
                onSave(selected, activeConfig, {
                  name: name || selected.name,
                  isDefault: true,
                  isActive: true,
                })
              }
            >
              Ορισμός default
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                onCreate({
                  entity,
                  code: `list_${Date.now().toString(36)}`,
                  name: `${name || selected.name} (αντίγραφο)`,
                  configJson: activeConfig,
                })
              }
            >
              <Copy size={14} /> Διπλότυπο
            </Button>
            {!selected.isSystem ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => onDelete(selected.id)}
              >
                <Trash2 size={14} /> Διαγραφή
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function FilterEditor({
  config,
  builtins,
  customFields,
  onChange,
}: {
  config: ListViewConfig;
  builtins: BuiltinField[];
  customFields: FieldItem[];
  onChange: (c: ListViewConfig) => void;
}) {
  const filterables = [
    ...builtins
      .filter((b) => b.filterable)
      .map((b) => ({
        key: b.key,
        label: b.label,
        source: "system" as const,
        type: b.type,
      })),
    ...customFields
      .filter((f) => f.filterable)
      .map((f) => ({
        key: f.code,
        label: f.label,
        source: "custom" as const,
        type: f.type,
      })),
  ];

  const valueInput = (
    f: ListViewConfig["filters"][number],
    idx: number,
  ) => {
    if (f.op === "empty" || f.op === "not_empty") return null;
    const type = fieldTypeOf(f.key, f.source, builtins, customFields);
    const setValue = (value: string | number | boolean | null) => {
      const next = [...config.filters];
      next[idx] = { ...f, value };
      onChange({ ...config, filters: next });
    };

    if (type === "boolean" || type === "BOOLEAN") {
      return (
        <select
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
          value={
            f.value === true || f.value === "true"
              ? "true"
              : f.value === false || f.value === "false"
                ? "false"
                : ""
          }
          onChange={(e) => {
            if (e.target.value === "") setValue(null);
            else setValue(e.target.value === "true");
          }}
        >
          <option value="">—</option>
          <option value="true">Ναι</option>
          <option value="false">Όχι</option>
        </select>
      );
    }
    if (type === "number" || type === "NUMBER" || type === "money") {
      return (
        <input
          type="number"
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
          value={f.value == null ? "" : String(f.value)}
          onChange={(e) => {
            const n = e.target.value === "" ? null : Number(e.target.value);
            setValue(n);
          }}
        />
      );
    }
    if (type === "date" || type === "DATE") {
      return (
        <input
          type="date"
          className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
          value={f.value == null ? "" : String(f.value).slice(0, 10)}
          onChange={(e) => setValue(e.target.value || null)}
        />
      );
    }
    return (
      <input
        className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
        value={f.value == null ? "" : String(f.value)}
        onChange={(e) => setValue(e.target.value)}
      />
    );
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Αποθηκευμένα φίλτρα
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={filterables.length === 0}
          onClick={() => {
            const first = filterables[0];
            if (!first) return;
            onChange({
              ...config,
              filters: [
                ...config.filters,
                { key: first.key, source: first.source, op: "eq", value: "" },
              ],
            });
          }}
        >
          <Plus size={12} /> Φίλτρο
        </Button>
      </div>
      {config.filters.map((f, idx) => (
        <div
          key={idx}
          className="grid gap-2 sm:grid-cols-[1.2fr_0.7fr_1fr_auto]"
        >
          <select
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={`${f.source}:${f.key}`}
            onChange={(e) => {
              const [source, key] = e.target.value.split(":") as [
                "system" | "custom",
                string,
              ];
              const next = [...config.filters];
              next[idx] = { ...f, source, key };
              onChange({ ...config, filters: next });
            }}
          >
            {filterables.map((opt) => (
              <option
                key={`${opt.source}:${opt.key}`}
                value={`${opt.source}:${opt.key}`}
              >
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={f.op}
            onChange={(e) => {
              const op = e.target.value as ListViewConfig["filters"][number]["op"];
              const next = [...config.filters];
              next[idx] = {
                ...f,
                op,
                value:
                  op === "empty" || op === "not_empty" ? null : f.value ?? "",
              };
              onChange({ ...config, filters: next });
            }}
          >
            {FILTER_OPS.map((op) => (
              <option key={op} value={op}>
                {FILTER_OP_LABELS[op]}
              </option>
            ))}
          </select>
          {valueInput(f, idx) ?? (
            <span className="flex h-9 items-center text-xs text-slate-400">
              —
            </span>
          )}
          <button
            type="button"
            className="text-xs text-rose-600"
            onClick={() =>
              onChange({
                ...config,
                filters: config.filters.filter((_, i) => i !== idx),
              })
            }
          >
            ✕
          </button>
        </div>
      ))}
      {config.filters.length === 0 ? (
        <p className="text-xs text-slate-400">
          Χωρίς φίλτρα — εμφανίζονται όλες οι εγγραφές.
        </p>
      ) : null}
    </div>
  );
}

function FormBuilderPanel({
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
  customFields: FieldItem[];
  items: FormViewItem[];
  pending: boolean;
  onSave: (
    item: FormViewItem,
    config: FormViewConfig,
    meta: { name: string; isDefault: boolean; isActive: boolean },
  ) => void;
  onCreate: (payload: Record<string, unknown>) => void;
  onDelete: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? "");
  const selected = items.find((i) => i.id === selectedId) ?? items[0] ?? null;
  const [draft, setDraft] = useState<FormViewConfig | null>(
    () => items[0]?.config ?? null,
  );
  const [name, setName] = useState(items[0]?.name ?? "");
  const activeConfig = draft ?? selected?.config ?? null;
  const customDefs = useMemo(() => toCustomDefs(customFields), [customFields]);

  const updateConfig = (next: FormViewConfig) => {
    if (!selected) return;
    setSelectedId(selected.id);
    setDraft(next);
  };

  const toggleField = (
    sectionId: string,
    key: string,
    source: "system" | "custom",
  ) => {
    if (!selected || !activeConfig) return;
    const sections = activeConfig.sections.map((s) => {
      if (s.id !== sectionId) return s;
      const exists = s.fields.some((f) => f.key === key && f.source === source);
      return {
        ...s,
        fields: exists
          ? s.fields.filter((f) => !(f.key === key && f.source === source))
          : [...s.fields, { key, source }],
      };
    });
    updateConfig({ sections });
  };

  const fieldLabel = (
    key: string,
    source: "system" | "custom",
  ): string => {
    if (source === "system") {
      return builtins.find((b) => b.key === key)?.label ?? key;
    }
    return customFields.find((f) => f.code === key)?.label ?? key;
  };

  const unusedForSection = (section: FormViewConfig["sections"][number]) => {
    const used = new Set(section.fields.map((f) => `${f.source}:${f.key}`));
    return [
      ...builtins
        .filter((b) => b.formable !== false)
        .map((b) => ({
          key: b.key,
          label: b.label,
          source: "system" as const,
        })),
      ...customFields.map((f) => ({
        key: f.code,
        label: f.label,
        source: "custom" as const,
      })),
    ].filter((x) => !used.has(`${x.source}:${x.key}`));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="soft-panel space-y-2 p-2">
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  setSelectedId(item.id);
                  setDraft(item.config);
                  setName(item.name);
                }}
                className={cn(
                  "w-full rounded-xl px-3 py-2 text-left text-sm",
                  selectedId === item.id
                    ? "bg-teal-50 text-teal-900"
                    : "hover:bg-slate-50",
                )}
              >
                {item.name}
                {item.isDefault ? (
                  <Badge tone="teal" className="ml-1">
                    Default
                  </Badge>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        <Button
          size="sm"
          className="w-full"
          disabled={pending}
          onClick={() =>
            onCreate({
              entity,
              code: `form_${Date.now().toString(36)}`,
              name: `Νέα φόρμα ${entityLabel(entity)}`,
              configJson: {
                sections: [
                  {
                    id: "main",
                    title: "Βασικά",
                    fields: builtins
                      .filter((b) => b.formable)
                      .slice(0, 4)
                      .map((b) => ({ key: b.key, source: "system" })),
                  },
                ],
              },
            })
          }
        >
          <Plus size={14} /> Νέα φόρμα
        </Button>
      </aside>

      {selected && activeConfig ? (
        <div className="soft-panel space-y-4 p-4">
          <input
            value={name || selected.name}
            onChange={(e) => {
              setName(e.target.value);
              setSelectedId(selected.id);
              setDraft(activeConfig);
            }}
            className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium"
          />

          {activeConfig.sections.map((section, sIdx) => {
            const unused = unusedForSection(section);
            return (
              <div
                key={section.id}
                className="space-y-3 rounded-xl border border-slate-200 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-0.5">
                    <button
                      type="button"
                      disabled={sIdx === 0}
                      onClick={() =>
                        updateConfig({
                          sections: moveItem(activeConfig.sections, sIdx, -1),
                        })
                      }
                      className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      type="button"
                      disabled={sIdx === activeConfig.sections.length - 1}
                      onClick={() =>
                        updateConfig({
                          sections: moveItem(activeConfig.sections, sIdx, 1),
                        })
                      }
                      className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                  <input
                    value={section.title}
                    onChange={(e) => {
                      updateConfig({
                        sections: activeConfig.sections.map((s) =>
                          s.id === section.id
                            ? { ...s, title: e.target.value }
                            : s,
                        ),
                      });
                    }}
                    className="h-9 min-w-[160px] flex-1 rounded-lg border border-slate-200 px-2 text-sm font-semibold"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={activeConfig.sections.length <= 1}
                    onClick={() => {
                      if (activeConfig.sections.length <= 1) return;
                      updateConfig({
                        sections: activeConfig.sections.filter(
                          (s) => s.id !== section.id,
                        ),
                      });
                    }}
                  >
                    <Trash2 size={14} /> Ενότητα
                  </Button>
                </div>

                <ul className="space-y-2">
                  {section.fields.map((ref, fIdx) => (
                    <li
                      key={`${ref.source}:${ref.key}`}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-2 py-1.5"
                    >
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          disabled={fIdx === 0}
                          onClick={() => {
                            const fields = moveItem(section.fields, fIdx, -1);
                            updateConfig({
                              sections: activeConfig.sections.map((s) =>
                                s.id === section.id ? { ...s, fields } : s,
                              ),
                            });
                          }}
                          className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                        >
                          <ArrowUp size={12} />
                        </button>
                        <button
                          type="button"
                          disabled={fIdx === section.fields.length - 1}
                          onClick={() => {
                            const fields = moveItem(section.fields, fIdx, 1);
                            updateConfig({
                              sections: activeConfig.sections.map((s) =>
                                s.id === section.id ? { ...s, fields } : s,
                              ),
                            });
                          }}
                          className="rounded border border-slate-200 p-1 text-slate-500 disabled:opacity-30"
                        >
                          <ArrowDown size={12} />
                        </button>
                      </div>
                      <span className="min-w-[90px] text-sm font-medium">
                        {fieldLabel(ref.key, ref.source)}
                      </span>
                      <input
                        value={ref.label ?? ""}
                        placeholder="Ετικέτα"
                        onChange={(e) => {
                          const fields = section.fields.map((x, i) =>
                            i === fIdx
                              ? { ...x, label: e.target.value || undefined }
                              : x,
                          );
                          updateConfig({
                            sections: activeConfig.sections.map((s) =>
                              s.id === section.id ? { ...s, fields } : s,
                            ),
                          });
                        }}
                        className="h-8 min-w-[120px] flex-1 rounded-lg border border-slate-200 px-2 text-xs"
                      />
                      <label className="inline-flex items-center gap-1 text-xs text-slate-600">
                        <input
                          type="checkbox"
                          checked={!!ref.required}
                          onChange={(e) => {
                            const fields = section.fields.map((x, i) =>
                              i === fIdx
                                ? { ...x, required: e.target.checked }
                                : x,
                            );
                            updateConfig({
                              sections: activeConfig.sections.map((s) =>
                                s.id === section.id ? { ...s, fields } : s,
                              ),
                            });
                          }}
                        />{" "}
                        Υποχρ.
                      </label>
                      <button
                        type="button"
                        className="text-xs text-rose-600"
                        onClick={() =>
                          toggleField(section.id, ref.key, ref.source)
                        }
                      >
                        Αφαίρεση
                      </button>
                    </li>
                  ))}
                  {section.fields.length === 0 ? (
                    <li className="text-xs text-slate-400">
                      Κανένα πεδίο — επιλέξτε από τις κάψουλες ή προσθέστε.
                    </li>
                  ) : null}
                </ul>

                <div className="flex flex-wrap gap-1.5">
                  {builtins
                    .filter((b) => b.formable)
                    .map((b) => {
                      const on = section.fields.some(
                        (f) => f.key === b.key && f.source === "system",
                      );
                      return (
                        <button
                          key={b.key}
                          type="button"
                          onClick={() =>
                            toggleField(section.id, b.key, "system")
                          }
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                            on
                              ? "border-teal-600 bg-teal-600 text-white"
                              : "border-slate-200 bg-white",
                          )}
                        >
                          {b.label}
                        </button>
                      );
                    })}
                  {customFields.map((f) => {
                    const on = section.fields.some(
                      (x) => x.key === f.code && x.source === "custom",
                    );
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() =>
                          toggleField(section.id, f.code, "custom")
                        }
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                          on
                            ? "border-teal-600 bg-teal-600 text-white"
                            : "border-slate-200 bg-white",
                        )}
                      >
                        {f.label}
                      </button>
                    );
                  })}
                </div>

                {unused.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-slate-400">Προσθήκη:</span>
                    {unused.slice(0, 8).map((u) => (
                      <button
                        key={`${u.source}:${u.key}`}
                        type="button"
                        onClick={() =>
                          toggleField(section.id, u.key, u.source)
                        }
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:border-teal-500 hover:text-teal-800"
                      >
                        <Plus size={10} /> {u.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              updateConfig({
                sections: [
                  ...activeConfig.sections,
                  {
                    id: `sec_${Date.now().toString(36)}`,
                    title: "Νέα ενότητα",
                    fields: [],
                  },
                ],
              });
            }}
          >
            <Plus size={14} /> Ενότητα
          </Button>

          <div className="space-y-2 rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Προεπισκόπηση
            </p>
            <div className="rounded-xl border border-slate-100 bg-white p-3 opacity-90">
              <DynamicFormSections
                config={activeConfig}
                builtins={builtins}
                customDefs={customDefs}
                values={{}}
                customValues={{}}
                onSystemChange={() => {}}
                onCustomChange={() => {}}
                disabled
                compact
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                onSave(selected, activeConfig, {
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
                onSave(selected, activeConfig, {
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
              onClick={() =>
                onCreate({
                  entity,
                  code: `form_${Date.now().toString(36)}`,
                  name: `${name || selected.name} (αντίγραφο)`,
                  configJson: activeConfig,
                })
              }
            >
              <Copy size={14} /> Διπλότυπο
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
          </div>
        </div>
      ) : null}
    </div>
  );
}
