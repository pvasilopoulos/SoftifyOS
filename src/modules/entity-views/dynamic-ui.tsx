"use client";

import type { CustomFieldType } from "@/generated/prisma/client";
import { cn } from "@/shared/lib/cn";
import type { BuiltinField } from "./registry";
import type { CustomFieldsMap, FormViewConfig } from "./types";
import { formatFieldValue } from "./types";

export type CustomFieldDef = {
  code: string;
  label: string;
  type: CustomFieldType;
  optionsJson?: unknown;
  required: boolean;
};

function optionsOf(def: CustomFieldDef): string[] {
  if (!Array.isArray(def.optionsJson)) return [];
  return def.optionsJson.map(String);
}

export function DynamicFormSections({
  config,
  builtins,
  customDefs,
  values,
  customValues,
  onSystemChange,
  onCustomChange,
  disabled,
  compact,
}: {
  config: FormViewConfig;
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  values: Record<string, unknown>;
  customValues: CustomFieldsMap;
  onSystemChange: (key: string, value: string) => void;
  onCustomChange: (key: string, value: string | string[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const builtinMap = new Map(builtins.map((b) => [b.key, b]));
  const customMap = new Map(customDefs.map((d) => [d.code, d]));

  return (
    <div className={cn("space-y-5", compact && "space-y-3")}>
      {config.sections.map((section) => (
        <section key={section.id} className="space-y-3">
          <h3 className="text-sm font-semibold text-ink-950">{section.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {section.fields.map((ref) => {
              if (ref.source === "system") {
                const field = builtinMap.get(ref.key);
                if (!field || field.formable === false) return null;
                const required = ref.required ?? field.required;
                const val = values[ref.key];
                return (
                  <FieldControl
                    key={`s:${ref.key}`}
                    label={ref.label || field.label}
                    required={required}
                    type={field.type}
                    options={field.options}
                    value={val == null ? "" : String(val)}
                    disabled={disabled}
                    wide={field.type === "textarea"}
                    onChange={(v) => onSystemChange(ref.key, v)}
                  />
                );
              }
              const def = customMap.get(ref.key);
              if (!def) return null;
              const required = ref.required ?? def.required;
              const cur = customValues[ref.key];
              if (def.type === "MULTI_SELECT") {
                const selected = Array.isArray(cur)
                  ? cur
                  : cur
                    ? String(cur).split(",").map((s) => s.trim()).filter(Boolean)
                    : [];
                return (
                  <div key={`c:${ref.key}`} className="block text-sm sm:col-span-2">
                    <span className="mb-1.5 block font-medium">
                      {ref.label || def.label}
                      {required ? " *" : ""}
                    </span>
                    <div className="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-slate-50/50 p-2.5">
                      {optionsOf(def).map((opt) => {
                        const on = selected.includes(opt);
                        return (
                          <label
                            key={opt}
                            className={cn(
                              "inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                              on
                                ? "border-teal-600 bg-teal-600 text-white"
                                : "border-slate-200 bg-white text-slate-600",
                              disabled && "opacity-60",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={on}
                              disabled={disabled}
                              onChange={() => {
                                const next = on
                                  ? selected.filter((x) => x !== opt)
                                  : [...selected, opt];
                                onCustomChange(ref.key, next);
                              }}
                            />
                            {opt}
                          </label>
                        );
                      })}
                      {optionsOf(def).length === 0 ? (
                        <span className="text-xs text-slate-400">Χωρίς επιλογές</span>
                      ) : null}
                    </div>
                  </div>
                );
              }
              return (
                <FieldControl
                  key={`c:${ref.key}`}
                  label={ref.label || def.label}
                  required={required}
                  type={mapCustomType(def.type)}
                  options={optionsOf(def).map((o) => ({ value: o, label: o }))}
                  value={cur == null ? "" : String(cur)}
                  disabled={disabled}
                  onChange={(v) => onCustomChange(ref.key, v)}
                />
              );
            })}
          </div>
          {section.fields.length === 0 ? (
            <p className="text-xs text-slate-400">Κενή ενότητα — πρόσθεσε πεδία από τον builder.</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function mapCustomType(t: CustomFieldType): BuiltinField["type"] {
  switch (t) {
    case "NUMBER":
      return "number";
    case "DATE":
      return "date";
    case "BOOLEAN":
      return "boolean";
    case "SELECT":
      return "select";
    default:
      return "text";
  }
}

function FieldControl({
  label,
  required,
  type,
  options,
  value,
  onChange,
  disabled,
  wide,
}: {
  label: string;
  required?: boolean;
  type: BuiltinField["type"];
  options?: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  const cls =
    "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-400 disabled:bg-slate-50";
  return (
    <label className={wide ? "block text-sm sm:col-span-2" : "block text-sm"}>
      <span className="mb-1.5 block font-medium">
        {label}
        {required ? " *" : ""}
      </span>
      {type === "textarea" ? (
        <textarea
          className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
      ) : type === "select" || type === "badge" ? (
        <select
          className={cls}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        >
          <option value="">—</option>
          {(options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : type === "boolean" ? (
        <select
          className={cls}
          value={value === "true" ? "true" : value === "false" ? "false" : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">—</option>
          <option value="true">Ναι</option>
          <option value="false">Όχι</option>
        </select>
      ) : (
        <input
          className={cls}
          type={
            type === "number" || type === "money"
              ? "number"
              : type === "date"
                ? "date"
                : type === "email"
                  ? "email"
                  : type === "phone"
                    ? "tel"
                    : "text"
          }
          step={type === "money" ? "0.01" : undefined}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
      )}
    </label>
  );
}

type ColRef = { key: string; source: "system" | "custom"; label?: string };

export function DynamicListHeader({
  columns,
  builtins,
  customDefs,
}: {
  columns: ColRef[];
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
}) {
  const builtinMap = new Map(builtins.map((b) => [b.key, b]));
  const customMap = new Map(customDefs.map((d) => [d.code, d]));
  return (
    <div
      className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:gap-3"
      style={{
        gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((col) => {
        const label =
          col.label ||
          (col.source === "system"
            ? builtinMap.get(col.key)?.label ?? col.key
            : customMap.get(col.key)?.label ?? col.key);
        return <span key={`${col.source}:${col.key}`}>{label}</span>;
      })}
    </div>
  );
}

export function DynamicListCells({
  columns,
  builtins,
  customDefs,
  row,
}: {
  columns: ColRef[];
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  row: Record<string, unknown>;
}) {
  const builtinMap = new Map(builtins.map((b) => [b.key, b]));
  const customMap = new Map(customDefs.map((d) => [d.code, d]));
  const cf = (row.customFields ?? {}) as CustomFieldsMap;

  return (
    <div
      className="grid flex-1 gap-1 text-sm md:gap-3"
      style={{
        gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`,
      }}
    >
      {columns.map((col, idx) => {
        const builtin = builtinMap.get(col.key);
        const custom = customMap.get(col.key);
        const raw = col.source === "custom" ? cf[col.key] : row[col.key];
        const type = col.source === "system" ? builtin?.type : custom?.type;
        const text = formatFieldValue(raw, type);
        const label =
          col.label ||
          (col.source === "system" ? builtin?.label : custom?.label);
        return (
          <div
            key={`${col.source}:${col.key}`}
            className={idx === 0 ? "font-medium text-ink-950" : "text-slate-600"}
          >
            <span className="text-[10px] uppercase text-slate-400 md:hidden">
              {label}{" "}
            </span>
            {text}
          </div>
        );
      })}
    </div>
  );
}
