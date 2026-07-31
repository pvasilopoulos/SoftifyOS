"use client";

import { useEffect, useState } from "react";
import type { CustomFieldType, EntityModule } from "@/generated/prisma/client";
import type { BuiltinField } from "./registry";
import type { CustomFieldsMap, FormMode, FormViewConfig } from "./types";
import { formatFieldValue, normalizeFormConfig } from "./types";
import { FormExperienceRenderer } from "./form-experience-renderer";
import { useFormScriptHooks } from "@/modules/scripts/use-form-script-hooks";

export type CustomFieldDef = {
  code: string;
  label: string;
  type: CustomFieldType;
  optionsJson?: unknown;
  required: boolean;
};

function buildFormRecord(
  values: Record<string, unknown>,
  customValues: CustomFieldsMap,
) {
  return {
    ...values,
    customFields: { ...customValues },
  };
}

function splitFormRecord(record: Record<string, unknown>): {
  values: Record<string, unknown>;
  customFields: CustomFieldsMap;
} {
  const { customFields, ...rest } = record;
  return {
    values: rest,
    customFields:
      customFields && typeof customFields === "object" && !Array.isArray(customFields)
        ? (customFields as CustomFieldsMap)
        : {},
  };
}

/** Thin adapter — runtime forms use Form Experience Engine + optional UI scripts */
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
  entityModule,
  enableScripts = true,
  onScriptFail,
  onBeforeSubmitReady,
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
  /** When set, runs form.onLoad / onFieldChange / beforeSubmit hooks */
  entityModule?: EntityModule;
  enableScripts?: boolean;
  onScriptFail?: (message: string, script?: string) => void;
  /** Expose beforeSubmit runner to parent forms */
  onBeforeSubmitReady?: (
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ) => void;
}) {
  const normalized = normalizeFormConfig(config);
  const [scriptError, setScriptError] = useState<string | null>(null);
  const scriptsOn = Boolean(entityModule) && enableScripts && !disabled;

  const hooks = useFormScriptHooks({
    module: entityModule ?? "CUSTOMERS",
    enabled: scriptsOn,
    mode:
      modeOverride === "create" || modeOverride === "quick"
        ? "create"
        : modeOverride === "view"
          ? "view"
          : "edit",
    getRecord: () => buildFormRecord(values, customValues),
    applyRecord: (record) => {
      const split = splitFormRecord(record);
      for (const [k, v] of Object.entries(split.values)) {
        if (k === "id") continue;
        const asStr = v == null ? "" : Array.isArray(v) ? v.join(",") : String(v);
        if (String(values[k] ?? "") !== asStr) {
          onSystemChange(k, asStr);
        }
      }
      for (const [k, v] of Object.entries(split.customFields)) {
        const cur = customValues[k];
        const next = v as string | string[];
        const same =
          Array.isArray(cur) && Array.isArray(next)
            ? cur.join("|") === next.join("|")
            : String(cur ?? "") === String(next ?? "");
        if (!same) onCustomChange(k, next);
      }
    },
    onFail: (message, script) => {
      setScriptError(script ? `${message} (${script})` : message);
      onScriptFail?.(message, script);
    },
  });

  useEffect(() => {
    if (!scriptsOn) return;
    hooks.onLoad();
    // only on mount / module change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptsOn, entityModule]);

  useEffect(() => {
    if (!onBeforeSubmitReady) return;
    onBeforeSubmitReady(async () => {
      const r = await hooks.beforeSubmit();
      if (!r.ok) {
        setScriptError(r.error ?? "Validation failed");
        return { ok: false, error: r.error };
      }
      setScriptError(null);
      return { ok: true };
    });
  }, [onBeforeSubmitReady, hooks]);

  return (
    <div className="space-y-2">
      {scriptError ? (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {scriptError}
        </p>
      ) : null}
      <FormExperienceRenderer
        config={normalized}
        builtins={builtins}
        customDefs={customDefs}
        values={values}
        customValues={customValues}
        onSystemChange={(key, value) => {
          setScriptError(null);
          onSystemChange(key, value);
          if (scriptsOn) {
            hooks.onFieldChange(key, value, {
              ...buildFormRecord(values, customValues),
              [key]: value,
            });
          }
        }}
        onCustomChange={(key, value) => {
          setScriptError(null);
          onCustomChange(key, value);
          if (scriptsOn) {
            const nextCf = { ...customValues, [key]: value };
            hooks.onFieldChange(`customFields.${key}`, value, {
              ...buildFormRecord(values, customValues),
              customFields: nextCf,
            });
          }
        }}
        disabled={disabled}
        compact={compact}
        role={role}
        modeOverride={modeOverride}
      />
    </div>
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
