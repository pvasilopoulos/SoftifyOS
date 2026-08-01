export type FinanceFilters = {
  /** YYYY-MM-DD */
  from: string;
  /** YYYY-MM-DD */
  to: string;
  periodId: string;
  legalEntityId: string;
  q: string;
  /** Journals / myDATA status */
  status: "ALL" | "DRAFT" | "POSTED" | "VOID" | "PENDING" | "ACCEPTED" | "REJECTED";
  /** AR aging bucket */
  aging: "ALL" | "current" | "1-30" | "31-60" | "61-90" | "90+";
};

export function defaultFinanceFilters(year = new Date().getFullYear()): FinanceFilters {
  return {
    from: `${year}-01-01`,
    to: new Date().toISOString().slice(0, 10),
    periodId: "",
    legalEntityId: "",
    q: "",
    status: "ALL",
    aging: "ALL",
  };
}

export function periodPresetDates(
  kind: "month" | "quarter" | "year" | "ytd",
  ref = new Date(),
): { from: string; to: string } {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const to = ref.toISOString().slice(0, 10);
  if (kind === "year") {
    return { from: `${y}-01-01`, to: `${y}-12-31` };
  }
  if (kind === "ytd") {
    return { from: `${y}-01-01`, to };
  }
  if (kind === "quarter") {
    const qStart = Math.floor(m / 3) * 3;
    const from = new Date(y, qStart, 1);
    return { from: from.toISOString().slice(0, 10), to };
  }
  const from = new Date(y, m, 1);
  return { from: from.toISOString().slice(0, 10), to };
}

export function filtersToReportQuery(f: FinanceFilters) {
  const params = new URLSearchParams();
  if (f.from) params.set("from", f.from);
  if (f.to) params.set("to", f.to);
  if (f.legalEntityId) params.set("legalEntityId", f.legalEntityId);
  return params;
}

export function matchesText(haystack: string, q: string) {
  if (!q.trim()) return true;
  return haystack.toLowerCase().includes(q.trim().toLowerCase());
}

export function inDateRange(
  iso: string | null | undefined,
  from: string,
  to: string,
) {
  if (!iso) return true;
  const d = iso.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}
