"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/shared/lib/cn";
import type { BuiltinField } from "./registry";
import type { CustomFieldsMap } from "./types";
import type {
  FieldWidth,
  FormBlock,
  FormFieldRef,
  FormMode,
  FormViewConfig,
} from "./form-experience-types";
import { WIDTH_CLASS } from "./form-experience-types";
import { evaluateFormRules } from "./form-rules";
import type { CustomFieldDef } from "./dynamic-ui";

function optionsOf(def: CustomFieldDef): string[] {
  if (!Array.isArray(def.optionsJson)) return [];
  return def.optionsJson.map(String);
}

function mapCustomType(t: string): BuiltinField["type"] {
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

function widthClass(w?: FieldWidth) {
  return WIDTH_CLASS[w ?? "half"];
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
  help,
  placeholder,
}: {
  label: string;
  required?: boolean;
  type: BuiltinField["type"];
  options?: Array<{ value: string; label: string }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  wide?: boolean;
  help?: string;
  placeholder?: string;
}) {
  const cls =
    "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-teal-400 disabled:bg-slate-50";
  return (
    <label className={cn("block text-sm", wide && "w-full")}>
      <span className="mb-1.5 block font-medium">
        {label}
        {required ? " *" : ""}
      </span>
      {type === "textarea" ? (
        <textarea
          className="min-h-[88px] w-full rounded-xl border border-slate-200 px-3 py-2 text-sm disabled:bg-slate-50"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
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
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          required={required}
        />
      )}
      {help ? <span className="mt-1 block text-xs text-slate-400">{help}</span> : null}
    </label>
  );
}

function RenderField({
  field,
  builtins,
  customDefs,
  values,
  customValues,
  onSystemChange,
  onCustomChange,
  disabled,
  required,
  readonly,
}: {
  field: FormFieldRef;
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  values: Record<string, unknown>;
  customValues: CustomFieldsMap;
  onSystemChange: (key: string, value: string) => void;
  onCustomChange: (key: string, value: string | string[]) => void;
  disabled?: boolean;
  required?: boolean;
  readonly?: boolean;
}) {
  const builtinMap = useMemo(() => new Map(builtins.map((b) => [b.key, b])), [builtins]);
  const customMap = useMemo(() => new Map(customDefs.map((d) => [d.code, d])), [customDefs]);
  const isDisabled = disabled || readonly;

  if (field.source === "system") {
    const meta = builtinMap.get(field.key);
    if (!meta || meta.formable === false) return null;
    let type = meta.type;
    if (field.widget === "textarea") type = "textarea";
    if (field.widget === "select") type = "select";
    if (field.widget === "toggle") type = "boolean";
    const val = values[field.key];
    return (
      <div className={widthClass(field.width)}>
        <FieldControl
          label={field.label || meta.label}
          required={required}
          type={type}
          options={meta.options}
          value={val == null ? "" : String(val)}
          disabled={isDisabled}
          wide={field.width === "full" || type === "textarea"}
          help={field.help}
          placeholder={field.placeholder}
          onChange={(v) => onSystemChange(field.key, v)}
        />
      </div>
    );
  }

  const def = customMap.get(field.key);
  if (!def) return null;
  const cur = customValues[field.key];

  if (field.computed) {
    return (
      <div className={cn("text-sm", widthClass(field.width))}>
        <span className="mb-1.5 block font-medium text-slate-500">
          {field.label || field.computedLabel || def.label}
        </span>
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2.5 text-slate-600">
          {cur == null || cur === "" ? "—" : Array.isArray(cur) ? cur.join(", ") : String(cur)}
        </p>
      </div>
    );
  }

  if (def.type === "MULTI_SELECT") {
    const selected = Array.isArray(cur)
      ? cur
      : cur
        ? String(cur)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    return (
      <div className={cn("block text-sm", widthClass(field.width ?? "full"))}>
        <span className="mb-1.5 block font-medium">
          {field.label || def.label}
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
                  isDisabled && "opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  disabled={isDisabled}
                  onChange={() => {
                    const next = on
                      ? selected.filter((x) => x !== opt)
                      : [...selected, opt];
                    onCustomChange(field.key, next);
                  }}
                />
                {opt}
              </label>
            );
          })}
        </div>
        {field.help ? (
          <span className="mt-1 block text-xs text-slate-400">{field.help}</span>
        ) : null}
      </div>
    );
  }

  let type = mapCustomType(def.type);
  if (field.widget === "textarea") type = "textarea";
  if (field.widget === "toggle") type = "boolean";

  return (
    <div className={widthClass(field.width)}>
      <FieldControl
        label={field.label || def.label}
        required={required}
        type={type}
        options={optionsOf(def).map((o) => ({ value: o, label: o }))}
        value={cur == null ? "" : String(cur)}
        disabled={isDisabled}
        wide={field.width === "full"}
        help={field.help}
        placeholder={field.placeholder}
        onChange={(v) => onCustomChange(field.key, v)}
      />
    </div>
  );
}

function Blocks({
  blocks,
  ...ctx
}: {
  blocks: FormBlock[];
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  values: Record<string, unknown>;
  customValues: CustomFieldsMap;
  onSystemChange: (key: string, value: string) => void;
  onCustomChange: (key: string, value: string | string[]) => void;
  disabled?: boolean;
  compact?: boolean;
  fieldState: ReturnType<typeof evaluateFormRules>["fields"];
  blockState: ReturnType<typeof evaluateFormRules>["blocks"];
  mode: FormMode;
}) {
  return (
    <div className={cn("space-y-4", ctx.compact && "space-y-3")}>
      {blocks.map((b) => (
        <Block key={b.id} block={b} {...ctx} />
      ))}
    </div>
  );
}

function Block({
  block,
  ...ctx
}: {
  block: FormBlock;
  builtins: BuiltinField[];
  customDefs: CustomFieldDef[];
  values: Record<string, unknown>;
  customValues: CustomFieldsMap;
  onSystemChange: (key: string, value: string) => void;
  onCustomChange: (key: string, value: string | string[]) => void;
  disabled?: boolean;
  compact?: boolean;
  fieldState: ReturnType<typeof evaluateFormRules>["fields"];
  blockState: ReturnType<typeof evaluateFormRules>["blocks"];
  mode: FormMode;
}) {
  const hidden = ctx.blockState[block.id]?.hidden;
  const [open, setOpen] = useState(!(block.type === "section" && block.collapsed));
  const [tabIdx, setTabIdx] = useState(0);
  const [accOpen, setAccOpen] = useState<Record<string, boolean>>({});

  if (hidden) return null;

  if (block.type === "heading") {
    const Tag = block.level === 3 ? "h4" : "h3";
    return (
      <Tag className="text-sm font-semibold text-ink-950">{block.text}</Tag>
    );
  }

  if (block.type === "divider") {
    return <hr className="border-slate-200" />;
  }

  if (block.type === "spacer") {
    const h = block.size === "lg" ? "h-8" : block.size === "sm" ? "h-2" : "h-4";
    return <div className={h} />;
  }

  if (block.type === "callout") {
    return (
      <div
        className={cn(
          "rounded-xl px-3 py-2.5 text-sm",
          block.tone === "warning"
            ? "border border-amber-200 bg-amber-50 text-amber-900"
            : "border border-sky-200 bg-sky-50 text-sky-900",
        )}
      >
        {block.text}
      </div>
    );
  }

  if (block.type === "related") {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-3">
        <p className="text-sm font-semibold text-ink-950">{block.title}</p>
        <p className="mt-1 text-xs text-slate-400">
          {block.emptyText ||
            `Σχετική λίστα${block.entityHint ? ` · ${block.entityHint}` : ""} (σύνδεση δεδομένων σε επόμενο βήμα runtime).`}
        </p>
      </div>
    );
  }

  if (block.type === "fields") {
    return (
      <div className="grid grid-cols-12 gap-3">
        {block.fields.map((f) => {
          const st = ctx.fieldState[f.id];
          if (st?.hidden) return null;
          return (
            <RenderField
              key={f.id}
              field={f}
              builtins={ctx.builtins}
              customDefs={ctx.customDefs}
              values={ctx.values}
              customValues={ctx.customValues}
              onSystemChange={ctx.onSystemChange}
              onCustomChange={ctx.onCustomChange}
              disabled={ctx.disabled}
              required={st?.required ?? f.required}
              readonly={st?.readonly ?? f.readonly}
            />
          );
        })}
      </div>
    );
  }

  if (block.type === "section") {
    return (
      <section className="space-y-3 rounded-xl border border-slate-100 p-3">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => block.collapsible && setOpen((v) => !v)}
          disabled={!block.collapsible}
        >
          <div>
            <h3 className="text-sm font-semibold text-ink-950">{block.title}</h3>
            {block.description ? (
              <p className="text-xs text-slate-400">{block.description}</p>
            ) : null}
          </div>
          {block.collapsible ? (
            <span className="text-xs text-slate-400">{open ? "▼" : "▶"}</span>
          ) : null}
        </button>
        {open ? <Blocks blocks={block.children} {...ctx} /> : null}
      </section>
    );
  }

  if (block.type === "columns") {
    return (
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${Math.max(block.columns.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {block.columns.map((col) => (
          <div key={col.id} className="min-w-0 space-y-3">
            <Blocks blocks={col.children} {...ctx} />
          </div>
        ))}
      </div>
    );
  }

  if (block.type === "accordion") {
    return (
      <div className="space-y-2">
        {block.items.map((it) => {
          const isOpen = accOpen[it.id] ?? false;
          return (
            <div key={it.id} className="rounded-xl border border-slate-200">
              <button
                type="button"
                className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium"
                onClick={() =>
                  setAccOpen((prev) => ({ ...prev, [it.id]: !isOpen }))
                }
              >
                {it.title}
                <span className="text-xs text-slate-400">{isOpen ? "▼" : "▶"}</span>
              </button>
              {isOpen ? (
                <div className="border-t border-slate-100 p-3">
                  <Blocks blocks={it.children} {...ctx} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  if (block.type === "tabs") {
    const isWizard = block.variant === "wizard" || ctx.mode === "wizard";
    const tab = block.tabs[tabIdx] ?? block.tabs[0];
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1 border-b border-slate-200 pb-1">
          {block.tabs.map((t, i) => (
            <button
              key={t.id}
              type="button"
              disabled={isWizard && i > tabIdx}
              onClick={() => setTabIdx(i)}
              className={cn(
                "rounded-t-lg px-3 py-1.5 text-xs font-medium",
                i === tabIdx
                  ? "bg-teal-600 text-white"
                  : "text-slate-500 hover:bg-slate-50",
                isWizard && i > tabIdx && "opacity-40",
              )}
            >
              {isWizard ? `${i + 1}. ` : ""}
              {t.title}
            </button>
          ))}
        </div>
        {tab ? <Blocks blocks={tab.children} {...ctx} /> : null}
        {isWizard ? (
          <div className="flex justify-between gap-2">
            <button
              type="button"
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs disabled:opacity-40"
              disabled={tabIdx === 0}
              onClick={() => setTabIdx((i) => Math.max(0, i - 1))}
            >
              Πίσω
            </button>
            <button
              type="button"
              className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs text-white disabled:opacity-40"
              disabled={tabIdx >= block.tabs.length - 1}
              onClick={() =>
                setTabIdx((i) => Math.min(block.tabs.length - 1, i + 1))
              }
            >
              Επόμενο
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}

export function FormExperienceRenderer({
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
  const mode = modeOverride ?? config.mode ?? "edit";
  const evaluated = useMemo(
    () => evaluateFormRules(config, values, customValues, role),
    [config, values, customValues, role],
  );

  // Apply set_value side effects once when rules force values
  useEffect(() => {
    for (const [fieldId, st] of Object.entries(evaluated.fields)) {
      if (st.forceValue === undefined) continue;
      // find field key/source
      let found: FormFieldRef | null = null;
      const walk = (blocks: FormBlock[]) => {
        for (const b of blocks) {
          if (b.type === "fields") {
            const f = b.fields.find((x) => x.id === fieldId);
            if (f) found = f;
          } else if (b.type === "section") walk(b.children);
          else if (b.type === "tabs") b.tabs.forEach((t) => walk(t.children));
          else if (b.type === "columns")
            b.columns.forEach((c) => walk(c.children));
          else if (b.type === "accordion")
            b.items.forEach((it) => walk(it.children));
        }
      };
      walk(config.page.root);
      if (!found) continue;
      const f: FormFieldRef = found;
      const asStr = st.forceValue == null ? "" : String(st.forceValue);
      if (f.source === "system") {
        if (String(values[f.key] ?? "") !== asStr) onSystemChange(f.key, asStr);
      } else if (String(customValues[f.key] ?? "") !== asStr) {
        onCustomChange(f.key, asStr);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evaluated]);

  const viewDisabled = disabled || mode === "view";

  return (
    <div className={cn("space-y-4", config.page.showSide && "lg:grid lg:grid-cols-[1fr_240px] lg:gap-4")}>
      <div>
        {config.page.showHeader && config.page.title ? (
          <h2 className="mb-3 text-base font-semibold text-ink-950">
            {config.page.title}
          </h2>
        ) : null}
        <Blocks
          blocks={config.page.root}
          builtins={builtins}
          customDefs={customDefs}
          values={values}
          customValues={customValues}
          onSystemChange={onSystemChange}
          onCustomChange={onCustomChange}
          disabled={viewDisabled}
          compact={compact}
          fieldState={evaluated.fields}
          blockState={evaluated.blocks}
          mode={mode}
        />
      </div>
      {config.page.showSide && config.page.sideContent === "summary" ? (
        <aside className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm">
          <p className="font-semibold text-ink-950">Σύνοψη</p>
          <p className="mt-1 text-xs text-slate-500">
            Side panel από το Form Experience (σύνοψη / related σύντομα).
          </p>
          <dl className="mt-3 space-y-1.5 text-xs">
            {Object.entries(values)
              .filter(([, v]) => v != null && String(v) !== "")
              .slice(0, 6)
              .map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2">
                  <dt className="text-slate-400">{k}</dt>
                  <dd className="truncate font-medium text-slate-700">
                    {String(v)}
                  </dd>
                </div>
              ))}
          </dl>
        </aside>
      ) : null}
    </div>
  );
}
