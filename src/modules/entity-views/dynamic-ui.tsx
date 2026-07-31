"use client";

import type { CustomFieldType } from "@/generated/prisma/client";
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
}: {
  config: FormViewConfig;
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  values: Record<string, unknown>;
  customValues: CustomFieldsMap;
  onSystemChange: (key: string, value: string) => void;
  onCustomChange: (key: string, value: string | string[]) => void;
  disabled?: boolean;
}) {
  const builtinMap = new Map(builtins.map((b) => [b.key, b]));
  const customMap = new Map(customDefs.map((d) => [d.code, d]));

  return (
    <div className="space-y-5">
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
                    label={field.label}
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
              return (
                <FieldControl
                  key={`c:${ref.key}`}
                  label={def.label}
                  required={required}
                  type={mapCustomType(def.type)}
                  options={optionsOf(def).map((o) => ({ value: o, label: o }))}
                  value={
                    Array.isArray(cur)
                      ? cur.join(",")
                      : cur == null
                        ? ""
                        : String(cur)
                  }
                  disabled={disabled}
                  onChange={(v) => {
                    if (def.type === "MULTI_SELECT") {
                      onCustomChange(
                        ref.key,
                        v
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean),
                      );
                    } else {
                      onCustomChange(ref.key, v);
                    }
                  }}
                />
              );
            })}
          </div>
          {section.fields.length === 0 ? (
            <p className="text-xs text-slate-400">Κενή ενότητα</p>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function mapCustomType(
  t: CustomFieldType,
): BuiltinField["type"] {
  switch (t) {
    case "NUMBER":
      return "number";
    case "DATE":
      return "date";
    case "BOOLEAN":
      return "boolean";
    case "SELECT":
      return "select";
    case "MULTI_SELECT":
      return "text";
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
    "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-400";
  return (
    <label className={wide ? "block text-sm sm:col-span-2" : "block text-sm"}>
      <span className="mb-1.5 block font-medium">
        {label}
        {required ? " *" : ""}
      </span>
      {type === "textarea" ? (
        <textarea
          className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
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

export function DynamicListHeader({
  columns,
  builtins,
  customDefs,
}: {
  columns: Array<{ key: string; source: "system" | "custom" }>;
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
          col.source === "system"
            ? builtinMap.get(col.key)?.label ?? col.key
            : customMap.get(col.key)?.label ?? col.key;
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
  columns: Array<{ key: string; source: "system" | "custom" }>;
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
        const raw =
          col.source === "custom" ? cf[col.key] : row[col.key];
        const type =
          col.source === "system" ? builtin?.type : custom?.type;
        const text = formatFieldValue(raw, type);
        return (
          <div
            key={`${col.source}:${col.key}`}
            className={idx === 0 ? "font-medium text-ink-950" : "text-slate-600"}
          >
            <span className="md:hidden text-[10px] uppercase text-slate-400">
              {col.source === "system"
                ? builtin?.label
                : custom?.label}{" "}
            </span>
            {text}
          </div>
        );
      })}
    </div>
  );
}
