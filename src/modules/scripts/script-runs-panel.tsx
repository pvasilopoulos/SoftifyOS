"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  CheckCircle2,
  Download,
  Eye,
  Filter,
  RefreshCw,
  Search,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import type { EntityModule } from "@/generated/prisma/client";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  ENTITY_MODULES,
  entityLabel,
} from "@/modules/entity-views/registry";

export type RunListItem = {
  id: string;
  scriptId: string | null;
  module: EntityModule;
  eventKey: string;
  success: boolean;
  durationMs: number;
  error: string | null;
  httpCalls: number;
  source: "PRODUCTION" | "TEST";
  scriptCode: string | null;
  scriptName: string | null;
  userId: string | null;
  userEmail: string | null;
  userName: string | null;
  userRole: string | null;
  recordId: string | null;
  recordCode: string | null;
  createdAt: string;
};

type RunDetail = RunListItem & {
  logsJson: unknown;
  recordSnapshot: unknown;
};

type Filters = {
  q: string;
  module: "" | EntityModule;
  eventKey: string;
  success: "" | "true" | "false";
  source: "" | "PRODUCTION" | "TEST";
  hasHttp: "" | "true" | "false";
  from: string;
  to: string;
};

const EMPTY_FILTERS: Filters = {
  q: "",
  module: "",
  eventKey: "",
  success: "",
  source: "",
  hasHttp: "",
  from: "",
  to: "",
};

function fromLocalInputValue(local: string) {
  if (!local) return "";
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function ScriptRunsPanel() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [items, setItems] = useState<RunListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [stats, setStats] = useState({ ok: 0, fail: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [retentionDays, setRetentionDays] = useState(30);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q) n += 1;
    if (filters.module) n += 1;
    if (filters.eventKey) n += 1;
    if (filters.success) n += 1;
    if (filters.source) n += 1;
    if (filters.hasHttp) n += 1;
    if (filters.from) n += 1;
    if (filters.to) n += 1;
    return n;
  }, [filters]);

  const buildParams = useCallback(
    (f: Filters, cursor?: string | null) => {
      const params = new URLSearchParams({ limit: "50" });
      if (cursor) params.set("cursor", cursor);
      if (f.q.trim()) params.set("q", f.q.trim());
      if (f.module) params.set("module", f.module);
      if (f.eventKey.trim()) params.set("eventKey", f.eventKey.trim());
      if (f.success) params.set("success", f.success);
      if (f.source) params.set("source", f.source);
      if (f.hasHttp) params.set("hasHttp", f.hasHttp);
      if (f.from) params.set("from", f.from);
      if (f.to) params.set("to", f.to);
      return params;
    },
    [],
  );

  const load = useCallback(
    (f: Filters, mode: "replace" | "append" = "replace", cursor?: string | null) => {
      setError(null);
      startTransition(async () => {
        try {
          const params = buildParams(f, mode === "append" ? cursor : null);
          const res = await fetch(`/api/settings/scripts/runs?${params}`, {
            cache: "no-store",
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Αποτυχία φόρτωσης");
          setStats(data.stats ?? { ok: 0, fail: 0, total: 0 });
          setNextCursor(data.nextCursor ?? null);
          setItems((prev) =>
            mode === "append"
              ? [...prev, ...(data.items as RunListItem[])]
              : (data.items as RunListItem[]),
          );
          if (mode === "replace") setSelected(new Set());
        } catch (e) {
          setError(e instanceof Error ? e.message : "Σφάλμα");
        }
      });
    },
    [buildParams],
  );

  useEffect(() => {
    load(EMPTY_FILTERS, "replace");
  }, [load]);

  function applyFilters() {
    const isoFilters: Filters = {
      ...draft,
      from: fromLocalInputValue(draft.from),
      to: fromLocalInputValue(draft.to),
    };
    setFilters(isoFilters);
    load(isoFilters, "replace");
  }

  function clearFilters() {
    setDraft(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    load(EMPTY_FILTERS, "replace");
  }

  async function openDetail(id: string) {
    setError(null);
    const res = await fetch(`/api/settings/scripts/runs/${id}`, {
      cache: "no-store",
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία");
      return;
    }
    setDetail(data.item as RunDetail);
    setDetailOpen(true);
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === items.length) setSelected(new Set());
    else setSelected(new Set(items.map((i) => i.id)));
  }

  async function deleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`Διαγραφή ${selected.size} εγγραφών;`)) return;
    const res = await fetch("/api/settings/scripts/runs", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: [...selected] }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία διαγραφής");
      return;
    }
    setDetailOpen(false);
    load(filters, "replace");
  }

  async function deleteOne(id: string) {
    if (!confirm("Διαγραφή αυτού του run;")) return;
    const res = await fetch(`/api/settings/scripts/runs/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Αποτυχία");
      return;
    }
    if (detail?.id === id) setDetailOpen(false);
    load(filters, "replace");
  }

  async function runRetention() {
    if (
      !confirm(
        `Διαγραφή runs παλαιότερων από ${retentionDays} ημέρες;`,
      )
    ) {
      return;
    }
    const res = await fetch("/api/settings/scripts/runs", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ olderThanDays: retentionDays }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία cleanup");
      return;
    }
    alert(`Διαγράφηκαν ${data.deleted} εγγραφές`);
    load(filters, "replace");
  }

  function exportCsv() {
    const rows = items.filter((i) =>
      selected.size ? selected.has(i.id) : true,
    );
    const header = [
      "createdAt",
      "source",
      "module",
      "eventKey",
      "scriptCode",
      "scriptName",
      "success",
      "durationMs",
      "httpCalls",
      "userName",
      "userEmail",
      "userRole",
      "recordCode",
      "recordId",
      "error",
    ];
    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.createdAt,
          r.source,
          r.module,
          r.eventKey,
          r.scriptCode,
          r.scriptName,
          r.success,
          r.durationMs,
          r.httpCalls,
          r.userName,
          r.userEmail,
          r.userRole,
          r.recordCode,
          r.recordId,
          r.error,
        ]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "script-runs.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Σύνολο (φίλτρο εύρους)"
          value={stats.total}
          tone="slate"
        />
        <Stat label="Επιτυχίες" value={stats.ok} tone="emerald" />
        <Stat label="Αποτυχίες" value={stats.fail} tone="rose" />
      </div>

      <div className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <h2 className="text-sm font-semibold text-ink-950">Φίλτρα</h2>
            {activeFilterCount > 0 ? (
              <Badge tone="teal">{activeFilterCount} ενεργά</Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => load(filters, "replace")}
              disabled={pending}
            >
              <RefreshCw size={14} /> Ανανέωση
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={exportCsv}>
              <Download size={14} /> CSV
            </Button>
          </div>
        </div>

        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <label className="soft-surface flex items-center gap-2 px-3 py-2 md:col-span-2">
            <Search size={14} className="text-slate-400" />
            <input
              value={draft.q}
              onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyFilters();
              }}
              placeholder="Αναζήτηση script, χρήστη, error, record…"
              className="w-full bg-transparent text-sm outline-none"
            />
          </label>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={draft.module}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                module: e.target.value as Filters["module"],
              }))
            }
          >
            <option value="">Όλα τα modules</option>
            {ENTITY_MODULES.map((m) => (
              <option key={m} value={m}>
                {entityLabel(m)}
              </option>
            ))}
          </select>
          <input
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="Event (π.χ. before.create)"
            value={draft.eventKey}
            onChange={(e) =>
              setDraft((d) => ({ ...d, eventKey: e.target.value }))
            }
          />
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={draft.success}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                success: e.target.value as Filters["success"],
              }))
            }
          >
            <option value="">Όλα (OK / Fail)</option>
            <option value="true">Μόνο επιτυχίες</option>
            <option value="false">Μόνο αποτυχίες</option>
          </select>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={draft.source}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                source: e.target.value as Filters["source"],
              }))
            }
          >
            <option value="">Production + Test</option>
            <option value="PRODUCTION">Production</option>
            <option value="TEST">Test</option>
          </select>
          <select
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={draft.hasHttp}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                hasHttp: e.target.value as Filters["hasHttp"],
              }))
            }
          >
            <option value="">HTTP: όλα</option>
            <option value="true">Με HTTP κλήσεις</option>
            <option value="false">Χωρίς HTTP</option>
          </select>
          <input
            type="datetime-local"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={draft.from}
            onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
            title="Από"
          />
          <input
            type="datetime-local"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
            value={draft.to}
            onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
            title="Έως"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={applyFilters} disabled={pending}>
            Εφαρμογή
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={clearFilters}
            disabled={pending}
          >
            Καθαρισμός
          </Button>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span>Retention</span>
            <input
              type="number"
              min={1}
              className="w-16 rounded-lg border border-slate-200 px-2 py-1"
              value={retentionDays}
              onChange={(e) => setRetentionDays(Number(e.target.value) || 30)}
            />
            <span>ημέρες</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void runRetention()}
            >
              Cleanup
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm">
          <span className="font-medium text-teal-900">
            {selected.size} επιλεγμένα
          </span>
          <Button size="sm" variant="secondary" onClick={exportCsv}>
            Εξαγωγή
          </Button>
          <Button size="sm" variant="danger" onClick={() => void deleteSelected()}>
            <Trash2 size={14} /> Διαγραφή
          </Button>
          <button
            type="button"
            className="text-xs text-teal-700 underline"
            onClick={() => setSelected(new Set())}
          >
            Καθαρισμός επιλογής
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={
                      items.length > 0 && selected.size === items.length
                    }
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-3 py-2.5">Χρόνος</th>
                <th className="px-3 py-2.5">Πηγή</th>
                <th className="px-3 py-2.5">Script</th>
                <th className="px-3 py-2.5">Module / Event</th>
                <th className="px-3 py-2.5">Χρήστης</th>
                <th className="px-3 py-2.5">Record</th>
                <th className="px-3 py-2.5">OK</th>
                <th className="px-3 py-2.5">ms</th>
                <th className="px-3 py-2.5">HTTP</th>
                <th className="px-3 py-2.5">Error</th>
                <th className="px-3 py-2.5 text-right">Ενέργειες</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  className={cn(
                    "border-t border-slate-100 hover:bg-slate-50/70",
                    !r.success && "bg-rose-50/30",
                  )}
                >
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">
                    {new Date(r.createdAt).toLocaleString("el-GR")}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={r.source === "TEST" ? "amber" : "slate"}>
                      {r.source === "TEST" ? "Test" : "Prod"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink-950">
                      {r.scriptName || "—"}
                    </div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {r.scriptCode || "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div>{r.module}</div>
                    <div className="font-mono text-[11px] text-slate-500">
                      {r.eventKey}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="text-ink-950">
                      {r.userName || r.userEmail || "—"}
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {[r.userEmail, r.userRole].filter(Boolean).join(" · ") ||
                        "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-mono text-xs">
                      {r.recordCode || "—"}
                    </div>
                    <div className="max-w-[120px] truncate font-mono text-[10px] text-slate-400">
                      {r.recordId}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.success ? (
                      <CheckCircle2 size={16} className="text-emerald-600" />
                    ) : (
                      <XCircle size={16} className="text-rose-600" />
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{r.durationMs}</td>
                  <td className="px-3 py-2.5 tabular-nums">{r.httpCalls}</td>
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-xs text-rose-700">
                    {r.error}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-ink-900"
                        title="Λεπτομέρειες"
                        onClick={() => void openDetail(r.id)}
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-700"
                        title="Διαγραφή"
                        onClick={() => void deleteOne(r.id)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && !pending ? (
                <tr>
                  <td
                    colSpan={12}
                    className="px-3 py-10 text-center text-slate-500"
                  >
                    Δεν βρέθηκαν runs με αυτά τα φίλτρα.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            Εμφανίζονται {items.length}
            {pending ? " · φόρτωση…" : ""}
          </span>
          {nextCursor ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => load(filters, "append", nextCursor)}
            >
              Περισσότερα
            </Button>
          ) : (
            <span>Τέλος αποτελεσμάτων</span>
          )}
        </div>
      </div>

      {detailOpen && detail ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/30 backdrop-blur-[1px]">
          <button
            type="button"
            className="flex-1"
            aria-label="Κλείσιμο"
            onClick={() => setDetailOpen(false)}
          />
          <aside className="flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink-950">
                  Run detail
                </p>
                <p className="font-mono text-[11px] text-slate-500">
                  {detail.id}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
                onClick={() => setDetailOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge tone={detail.success ? "emerald" : "rose"}>
                  {detail.success ? "OK" : "FAIL"}
                </Badge>
                <Badge tone={detail.source === "TEST" ? "amber" : "slate"}>
                  {detail.source}
                </Badge>
                <Badge tone="slate">{detail.durationMs} ms</Badge>
                <Badge tone="slate">{detail.httpCalls} HTTP</Badge>
              </div>

              <Dl
                rows={[
                  ["Χρόνος", new Date(detail.createdAt).toLocaleString("el-GR")],
                  ["Script", `${detail.scriptName ?? "—"} (${detail.scriptCode ?? "—"})`],
                  ["Module", detail.module],
                  ["Event", detail.eventKey],
                  [
                    "Χρήστης",
                    [detail.userName, detail.userEmail, detail.userRole]
                      .filter(Boolean)
                      .join(" · ") || "—",
                  ],
                  ["User ID", detail.userId || "—"],
                  ["Record", detail.recordCode || "—"],
                  ["Record ID", detail.recordId || "—"],
                  ["Error", detail.error || "—"],
                ]}
              />

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Logs
                </h3>
                <pre className="max-h-48 overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] text-emerald-100">
                  {Array.isArray(detail.logsJson)
                    ? (detail.logsJson as string[]).join("\n") || "(κενό)"
                    : JSON.stringify(detail.logsJson, null, 2) || "(κενό)"}
                </pre>
              </section>

              <section>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Record snapshot
                </h3>
                <pre className="max-h-56 overflow-auto rounded-xl bg-slate-100 p-3 font-mono text-[11px] text-slate-800">
                  {JSON.stringify(detail.recordSnapshot, null, 2) || "(κενό)"}
                </pre>
              </section>
            </div>
            <div className="border-t border-slate-100 p-3">
              <Button
                variant="danger"
                className="w-full"
                onClick={() => void deleteOne(detail.id)}
              >
                <Trash2 size={14} /> Διαγραφή run
              </Button>
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "emerald" | "rose";
}) {
  const tones = {
    slate: "border-slate-200 bg-white",
    emerald: "border-emerald-200 bg-emerald-50",
    rose: "border-rose-200 bg-rose-50",
  };
  return (
    <div className={cn("rounded-2xl border p-4", tones[tone])}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-950">
        {value}
      </p>
    </div>
  );
}

function Dl({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[100px_1fr] gap-2">
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="break-all text-sm text-ink-950">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
