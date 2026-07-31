"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
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
import type { FormViewConfig, ListViewConfig } from "@/modules/entity-views/types";

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
  return (
    <div className="space-y-4">
      <form
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const options = String(form.get("options") || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
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
        }}
        className="soft-panel grid gap-3 p-4 sm:grid-cols-6"
      >
        <input name="code" required placeholder="code *" className="h-10 rounded-xl border border-slate-200 px-3 text-sm sm:col-span-1" />
        <input name="label" required placeholder="Ετικέτα *" className="h-10 rounded-xl border border-slate-200 px-3 text-sm sm:col-span-2" />
        <select name="type" className="h-10 rounded-xl border border-slate-200 px-3 text-sm" defaultValue="TEXT">
          {FIELD_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input name="options" placeholder="Options (κόμμα)" className="h-10 rounded-xl border border-slate-200 px-3 text-sm" />
        <Button type="submit" size="sm" disabled={pending} className="h-10">
          <Plus size={14} /> Προσθήκη
        </Button>
        <div className="flex flex-wrap gap-3 text-xs text-slate-600 sm:col-span-6">
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="required" /> Required</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="filterable" /> Filterable</label>
          <label className="inline-flex items-center gap-1.5"><input type="checkbox" name="showInList" defaultChecked /> Show in list</label>
        </div>
      </form>

      <ul className="soft-panel divide-y divide-slate-100">
        {items.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-950">
                {f.label}{" "}
                <span className="font-mono text-xs text-slate-400">{f.code}</span>
              </p>
              <p className="text-xs text-slate-500">
                {FIELD_TYPES.find((t) => t.value === f.type)?.label}
                {f.required ? " · required" : ""}
                {f.filterable ? " · filterable" : ""}
                {!f.isActive ? " · off" : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onPatch(f.id, { isActive: !f.isActive })}
            >
              {f.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => onDelete(f.id)}
            >
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-slate-500">
            Δεν υπάρχουν custom πεδία για {entityLabel(entity)}.
          </li>
        ) : null}
      </ul>
    </div>
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

  const toggleColumn = (key: string, source: "system" | "custom") => {
    if (!selected) return;
    const base = activeConfig ?? selected.config;
    const exists = base.columns.some((c) => c.key === key && c.source === source);
    const columns = exists
      ? base.columns.filter((c) => !(c.key === key && c.source === source))
      : [...base.columns, { key, source }];
    if (columns.length === 0) return;
    setSelectedId(selected.id);
    setDraft({ ...base, columns });
    setName(selected.name);
  };

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
                  selectedId === item.id ? "bg-teal-50 text-teal-900" : "hover:bg-slate-50",
                )}
              >
                {item.name}
                {item.isDefault ? (
                  <Badge tone="teal" className="ml-1">Default</Badge>
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
            Επιλέξτε στήλες (system + custom). Αποθηκευμένα φίλτρα επεξεργάζονται παρακάτω.
          </p>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              System πεδία
            </p>
            <div className="flex flex-wrap gap-1.5">
              {builtins.filter((b) => b.listable).map((b) => {
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
                      on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white",
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
                      on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white",
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

          <FilterEditor
            config={activeConfig}
            builtins={builtins}
            customFields={customFields}
            onChange={(next) => {
              setSelectedId(selected.id);
              setDraft(next);
            }}
          />

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
  builtins: { key: string; label: string; filterable?: boolean }[];
  customFields: FieldItem[];
  onChange: (c: ListViewConfig) => void;
}) {
  const filterables = [
    ...builtins
      .filter((b) => b.filterable)
      .map((b) => ({ key: b.key, label: b.label, source: "system" as const })),
    ...customFields
      .filter((f) => f.filterable)
      .map((f) => ({ key: f.code, label: f.label, source: "custom" as const })),
  ];

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
        <div key={idx} className="grid gap-2 sm:grid-cols-[1.2fr_0.7fr_1fr_auto]">
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
              <option key={`${opt.source}:${opt.key}`} value={`${opt.source}:${opt.key}`}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={f.op}
            onChange={(e) => {
              const next = [...config.filters];
              next[idx] = {
                ...f,
                op: e.target.value as ListViewConfig["filters"][number]["op"],
              };
              onChange({ ...config, filters: next });
            }}
          >
            <option value="eq">=</option>
            <option value="neq">≠</option>
            <option value="contains">περιέχει</option>
            <option value="gt">&gt;</option>
            <option value="gte">≥</option>
            <option value="lt">&lt;</option>
            <option value="lte">≤</option>
          </select>
          <input
            className="h-9 rounded-lg border border-slate-200 px-2 text-sm"
            value={f.value == null ? "" : String(f.value)}
            onChange={(e) => {
              const next = [...config.filters];
              next[idx] = { ...f, value: e.target.value };
              onChange({ ...config, filters: next });
            }}
          />
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
        <p className="text-xs text-slate-400">Χωρίς φίλτρα — εμφανίζονται όλες οι εγγραφές.</p>
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
    setSelectedId(selected.id);
    setDraft({ sections });
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
                  selectedId === item.id ? "bg-teal-50 text-teal-900" : "hover:bg-slate-50",
                )}
              >
                {item.name}
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

          {activeConfig.sections.map((section) => (
            <div key={section.id} className="space-y-2 rounded-xl border border-slate-200 p-3">
              <input
                value={section.title}
                onChange={(e) => {
                  setDraft({
                    sections: activeConfig.sections.map((s) =>
                      s.id === section.id ? { ...s, title: e.target.value } : s,
                    ),
                  });
                  setSelectedId(selected.id);
                }}
                className="h-9 w-full rounded-lg border border-slate-200 px-2 text-sm font-semibold"
              />
              <div className="flex flex-wrap gap-1.5">
                {builtins.filter((b) => b.formable).map((b) => {
                  const on = section.fields.some(
                    (f) => f.key === b.key && f.source === "system",
                  );
                  return (
                    <button
                      key={b.key}
                      type="button"
                      onClick={() => toggleField(section.id, b.key, "system")}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white",
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
                      onClick={() => toggleField(section.id, f.code, "custom")}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        on ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white",
                      )}
                    >
                      {f.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setSelectedId(selected.id);
              setDraft({
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
