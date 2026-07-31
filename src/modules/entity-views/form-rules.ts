import type { CustomFieldsMap } from "./types";
import type { FormFieldRef, FormRule, FormViewConfig, RuleOp } from "./form-experience-types";
import { walkFormFields } from "./form-experience-types";

function readValue(
  source: "system" | "custom",
  key: string,
  values: Record<string, unknown>,
  customValues: CustomFieldsMap,
): unknown {
  return source === "custom" ? customValues[key] : values[key];
}

function matchOp(raw: unknown, op: RuleOp, expected?: string | number | boolean | null): boolean {
  const empty =
    raw == null ||
    raw === "" ||
    (Array.isArray(raw) && raw.length === 0);
  switch (op) {
    case "empty":
      return empty;
    case "not_empty":
      return !empty;
    case "eq":
      return String(raw ?? "") === String(expected ?? "");
    case "neq":
      return String(raw ?? "") !== String(expected ?? "");
    case "contains":
      return String(raw ?? "")
        .toLowerCase()
        .includes(String(expected ?? "").toLowerCase());
    default:
      return false;
  }
}

export type FieldRuntimeState = {
  hidden: boolean;
  required: boolean;
  readonly: boolean;
  forceValue?: string | number | boolean | null;
};

export type RulesEvaluation = {
  fields: Record<string, FieldRuntimeState>;
  blocks: Record<string, { hidden: boolean }>;
};

export function evaluateFormRules(
  config: FormViewConfig,
  values: Record<string, unknown>,
  customValues: CustomFieldsMap,
  role?: string | null,
): RulesEvaluation {
  const fields: Record<string, FieldRuntimeState> = {};
  const blocks: Record<string, { hidden: boolean }> = {};

  walkFormFields(config.page.root, (field) => {
    const roleHidden =
      Array.isArray(field.visibleRoles) &&
      field.visibleRoles.length > 0 &&
      role != null &&
      !field.visibleRoles.includes(role);
    fields[field.id] = {
      hidden: field.hidden === true || !!roleHidden,
      required: field.required === true,
      readonly: field.readonly === true || field.computed === true,
    };
    if (field.computed) {
      const st = fields[field.id]!;
      st.hidden = field.hidden === true || !!roleHidden;
      st.readonly = true;
    }
  });

  for (const rule of config.rules ?? []) {
    const raw = readValue(rule.when.source, rule.when.key, values, customValues);
    if (!matchOp(raw, rule.when.op, rule.when.value)) continue;
    const { action, targetType, targetId, value } = rule.then;
    if (targetType === "block") {
      const cur = blocks[targetId] ?? { hidden: false };
      if (action === "hide") cur.hidden = true;
      if (action === "show") cur.hidden = false;
      blocks[targetId] = cur;
      continue;
    }
    const cur = fields[targetId] ?? {
      hidden: false,
      required: false,
      readonly: false,
    };
    switch (action) {
      case "hide":
        cur.hidden = true;
        break;
      case "show":
        cur.hidden = false;
        break;
      case "require":
        cur.required = true;
        break;
      case "optional":
        cur.required = false;
        break;
      case "readonly":
        cur.readonly = true;
        break;
      case "set_value":
        cur.forceValue = value ?? null;
        break;
      default:
        break;
    }
    fields[targetId] = cur;
  }

  return { fields, blocks };
}

export function collectFormRequiredErrors(
  config: FormViewConfig,
  builtins: Array<{ key: string; label: string; required?: boolean }>,
  customDefs: Array<{ code: string; label: string; required: boolean }>,
  values: Record<string, unknown>,
  customValues: CustomFieldsMap,
  role?: string | null,
): string[] {
  const evaled = evaluateFormRules(config, values, customValues, role);
  const builtinMap = new Map(builtins.map((b) => [b.key, b]));
  const customMap = new Map(customDefs.map((d) => [d.code, d]));
  const errors: string[] = [];

  walkFormFields(config.page.root, (field: FormFieldRef) => {
    const st = evaled.fields[field.id];
    if (st?.hidden) return;
    const required =
      st?.required ??
      field.required ??
      (field.source === "system"
        ? builtinMap.get(field.key)?.required
        : customMap.get(field.key)?.required);
    if (!required) return;
    const v =
      field.source === "custom" ? customValues[field.key] : values[field.key];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
      const label =
        field.label ||
        (field.source === "system"
          ? builtinMap.get(field.key)?.label
          : customMap.get(field.key)?.label) ||
        field.key;
      errors.push(label);
    }
  });

  return errors;
}

export function applyFieldDefaults(
  config: FormViewConfig,
  values: Record<string, unknown>,
  customValues: CustomFieldsMap,
): { values: Record<string, unknown>; customValues: CustomFieldsMap } {
  const nextValues = { ...values };
  const nextCustom = { ...customValues };
  walkFormFields(config.page.root, (field) => {
    if (field.defaultValue == null || field.defaultValue === "") return;
    if (field.source === "system") {
      if (nextValues[field.key] == null || nextValues[field.key] === "") {
        nextValues[field.key] = field.defaultValue;
      }
    } else if (nextCustom[field.key] == null || nextCustom[field.key] === "") {
      nextCustom[field.key] = field.defaultValue as never;
    }
  });
  return { values: nextValues, customValues: nextCustom };
}
