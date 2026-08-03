import type { SettlementPolicy } from "@/generated/prisma/client";

export type { SettlementPolicy };

export const SETTLEMENT_POLICY_VALUES = [
  "NONE",
  "NO",
  "YES",
  "AUTO",
] as const satisfies readonly SettlementPolicy[];

export const SETTLEMENT_POLICY_LABELS: Record<SettlementPolicy, string> = {
  NONE: "Καθόλου",
  NO: "Όχι",
  YES: "Ναι",
  AUTO: "Αυτόματα",
};

/** Feature not in scope for this series (hide UI). */
export function policyHidden(p: SettlementPolicy): boolean {
  return p === "NONE";
}

/** Explicit deny or not applicable → block action. */
export function policyForbidden(p: SettlementPolicy): boolean {
  return p === "NO" || p === "NONE";
}

/** User may trigger the action. */
export function policyAllowsManual(p: SettlementPolicy): boolean {
  return p === "YES" || p === "AUTO";
}

/** System may apply without prompt when conditions hold. */
export function policyAllowsAuto(p: SettlementPolicy): boolean {
  return p === "AUTO";
}

/** Normalize API/form input; booleans map for backward compat. */
export function parseSettlementPolicy(
  raw: unknown,
  fallback: SettlementPolicy,
): SettlementPolicy {
  if (raw === true) return "YES";
  if (raw === false) return "NO";
  if (typeof raw === "string") {
    const v = raw.trim().toUpperCase();
    if (v === "NONE" || v === "NO" || v === "YES" || v === "AUTO") return v;
    if (v === "IMMEDIATE") return "NO";
    if (v === "CLEARING") return "AUTO";
  }
  return fallback;
}

export const settlementPolicyZod = {
  // used by zod as z.enum — re-export list
  values: SETTLEMENT_POLICY_VALUES,
};
