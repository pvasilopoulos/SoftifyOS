"use client";

import type { CustomFieldType } from "@/generated/prisma/client";
import type { BuiltinField } from "./registry";
import type { CustomFieldsMap, FormMode, FormViewConfig } from "./types";
import { formatFieldValue, normalizeFormConfig } from "./types";
import { FormExperienceRenderer } from "./form-experience-renderer";

export type CustomFieldDef = {
  code: string;
  label: string;
  type: CustomFieldType;
  optionsJson?: unknown;
  required: boolean;
};

/** Thin adapter — runtime forms use Form Experience Engine */
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
  role,
  modeOverride,
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
  role?: string | null;
  modeOverride?: FormMode;
}) {
  const normalized = normalizeFormConfig(config);
  return (
    <FormExperienceRenderer
      config={normalized}
      builtins={builtins}
      customDefs={customDefs}
      values={values}
      customValues={customValues}
      onSystemChange={onSystemChange}
      onCustomChange={onCustomChange}
      disabled={disabled}
      compact={compact}
      role={role}
      modeOverride={modeOverride}
    />
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
