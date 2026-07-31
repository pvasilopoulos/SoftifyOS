"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
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
} from "@/modules/entity-views/registry";
import type { FormViewConfig, ListViewConfig } from "@/modules/entity-views/types";
import { FormExperienceDesigner } from "@/modules/entity-views/form-designer";
import { ListExperienceDesigner } from "@/modules/entity-views/list-designer";

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
          description="Custom fields · λίστες · Form Experience Designer (tabs, columns, rules, modes)."
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
            ["lists", "List Designer"],
            ["forms", "Form Designer"],
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
        <ListExperienceDesigner
          entity={entity}
          builtins={builtins}
          customFields={entityFields.filter((f) => f.isActive)}
          items={lists}
          formViews={forms.map((f) => ({
            id: f.id,
            code: f.code,
            name: f.name,
          }))}
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
        <FormExperienceDesigner
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

