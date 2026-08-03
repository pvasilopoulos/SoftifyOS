"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FileCode2,
  RefreshCw,
  Send,
  Settings2,
  XCircle,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { cn } from "@/shared/lib/cn";
import {
  entityHref,
  myDataEntityTypeLabel,
  myDataStatusLabel,
} from "@/modules/mydata/labels";

type MyDataEnv = "simulator" | "test" | "prod";
type ProviderId = "NONE" | "AADE" | "MOCK" | "NOVAON" | "IMPACT";

export type MyDataRow = {
  id: string;
  entityType: string;
  entityId: string;
  entityNumber: string | null;
  invoiceType: string | null;
  vatCategory: string | null;
  status: string;
  mark: string | null;
  uid: string | null;
  errorMessage: string | null;
  attempts: number;
  lastAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
  response?: unknown;
  payload?: unknown;
};

type Counts = {
  PENDING: number;
  SENT: number;
  ACCEPTED: number;
  REJECTED: number;
  CANCELLED: number;
  total: number;
};

function statusTone(
  status: string,
): "teal" | "amber" | "slate" | "rose" | "emerald" {
  switch (status) {
    case "ACCEPTED":
      return "emerald";
    case "PENDING":
    case "SENT":
      return "amber";
    case "REJECTED":
      return "rose";
    case "CANCELLED":
      return "slate";
    default:
      return "teal";
  }
}

function fmtDt(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("el-GR");
  } catch {
    return iso;
  }
}

function prettyJson(value: unknown) {
  try {
    return JSON.stringify(value ?? null, null, 2);
  } catch {
    return String(value);
  }
}

export function MyDataLiveClient({
  canWrite,
  myDataEnv,
  eInvoicingProvider,
  hasCredentials,
  initialItems,
  initialCounts,
}: {
  canWrite: boolean;
  myDataEnv: MyDataEnv;
  eInvoicingProvider: ProviderId;
  hasCredentials: boolean;
  initialItems: MyDataRow[];
  initialCounts: Counts;
}) {
  const [items, setItems] = useState(initialItems);
  const [counts, setCounts] = useState(initialCounts);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialItems[0]?.id ?? null,
  );
  const [detail, setDetail] = useState<MyDataRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null);
  const [status, setStatus] = useState("ALL");
  const [entityType, setEntityType] = useState("ALL");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) ?? null,
    [items, selectedId],
  );

  const load = useCallback(async () => {
    setError(null);
    const params = new URLSearchParams();
    if (status !== "ALL") params.set("status", status);
    if (entityType !== "ALL") params.set("entityType", entityType);
    if (q.trim()) params.set("q", q.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("take", "300");
    const res = await fetch(`/api/mydata/submissions?${params}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    const next = (data.items ?? []) as MyDataRow[];
    setItems(next);
    if (data.counts) setCounts(data.counts as Counts);
    setSelectedId((prev) =>
      prev && next.some((r) => r.id === prev) ? prev : (next[0]?.id ?? null),
    );
  }, [status, entityType, q, from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const res = await fetch(`/api/mydata/submissions/${selectedId}`);
      const data = await res.json().catch(() => ({}));
      if (cancelled) return;
      if (res.ok && data.item) setDetail(data.item as MyDataRow);
      else setDetail(selected);
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selected]);

  async function processOne(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/process`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία διαβίβασης");
      toast.success(`myDATA ${data.item?.status ?? "OK"}`);
      await load();
      setSelectedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelOne(id: string) {
    setBusyId(id);
    setError(null);
    setCancelConfirmId(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/cancel`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία ακύρωσης");
      toast.success("Ακυρώθηκε στην ΑΑΔΕ / ουρά");
      await load();
      setSelectedId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function processBatch() {
    setBusyId("batch");
    setError(null);
    try {
      const res = await fetch("/api/mydata/submissions/process-batch", {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία batch");
      toast.success(`Επεξεργάστηκαν ${data.processed ?? 0} εγγραφές`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  async function previewXml(id: string) {
    setBusyId(`xml-${id}`);
    setError(null);
    try {
      const res = await fetch(`/api/mydata/submissions/${id}/preview`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία preview");
      const xml = data.item?.xml as string | undefined;
      if (!xml) throw new Error("Κενό XML");
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(
          `<pre style="white-space:pre-wrap;font:12px/1.4 ui-monospace,monospace;padding:16px">${xml
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")}</pre>`,
        );
        w.document.title = `myDATA XML · ${data.item?.entityNumber || id}`;
      } else {
        toast.success("Επίτρεψε pop-ups για προεπισκόπηση XML");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusyId(null);
    }
  }

  const entityTypes = useMemo(() => {
    const set = new Set(items.map((i) => i.entityType));
    return [...set].sort();
  }, [items]);

  const view = detail ?? selected;

  return (
    <div className="space-y-5">
      <PageHeader
        title="myDATA Live"
        description="Ουρά διαβίβασης ΑΑΔΕ · επεξεργασία · ακύρωση · XML preview"
        actions={
          <div className="flex flex-wrap gap-2">
            <Badge
              tone={
                myDataEnv === "prod"
                  ? "rose"
                  : myDataEnv === "test"
                    ? "amber"
                    : "teal"
              }
            >
              {myDataEnv}
            </Badge>
            <Badge tone="slate">πάροχος · {eInvoicingProvider}</Badge>
            <Link
              href="/settings/integrations"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm text-ink-900 hover:bg-slate-50"
            >
              <Settings2 className="h-3.5 w-3.5" />
              Integrations
            </Link>
            <Button
              size="sm"
              variant="secondary"
              disabled={busyId !== null}
              onClick={() => void load()}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Ανανέωση
            </Button>
            {canWrite ? (
              <Button
                size="sm"
                disabled={busyId !== null}
                onClick={() => void processBatch()}
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {busyId === "batch" ? "Επεξεργασία…" : "Επεξεργασία ουράς"}
              </Button>
            ) : null}
          </div>
        }
      />

      {myDataEnv !== "simulator" && !hasCredentials ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Λείπουν credentials ΑΑΔΕ για περιβάλλον <strong>{myDataEnv}</strong>.
          Ρύθμισέ τα στο{" "}
          <Link href="/settings/integrations" className="underline">
            Integrations → myDATA
          </Link>
          .
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {(
          [
            ["PENDING", counts.PENDING],
            ["SENT", counts.SENT],
            ["ACCEPTED", counts.ACCEPTED],
            ["REJECTED", counts.REJECTED],
            ["CANCELLED", counts.CANCELLED],
          ] as const
        ).map(([key, n]) => (
          <button
            key={key}
            type="button"
            onClick={() => setStatus((s) => (s === key ? "ALL" : key))}
            className={cn(
              "rounded-2xl border px-4 py-3 text-left transition",
              status === key
                ? "border-teal-300 bg-teal-50 ring-1 ring-teal-200"
                : "border-slate-200 bg-white hover:border-slate-300",
            )}
          >
            <p className="text-xs text-slate-500">
              {myDataStatusLabel[key] ?? key}
            </p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-950">
              {n}
            </p>
          </button>
        ))}
      </div>

      <section className="soft-panel space-y-3 p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs text-slate-600">
            Αναζήτηση
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="αριθμός, MARK, UID, σφάλμα…"
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Κατάσταση
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            >
              <option value="ALL">Όλες</option>
              {Object.keys(myDataStatusLabel).map((s) => (
                <option key={s} value={s}>
                  {myDataStatusLabel[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Οντότητα
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            >
              <option value="ALL">Όλες</option>
              {entityTypes.map((t) => (
                <option key={t} value={t}>
                  {myDataEntityTypeLabel[t] ?? t}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-600">
            Από
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
          </label>
          <label className="text-xs text-slate-600">
            Έως
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            />
          </label>
        </div>
        <p className="text-xs text-slate-500">
          Εμφάνιση {items.length} · σύνολο ουράς {counts.total}
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="soft-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Παραστατικό</th>
                  <th className="px-3 py-2">Τύπος</th>
                  <th className="px-3 py-2">Κατάσταση</th>
                  <th className="px-3 py-2">MARK</th>
                  <th className="px-3 py-2">Ημ/νία</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr
                    key={r.id}
                    onClick={() => setSelectedId(r.id)}
                    className={cn(
                      "cursor-pointer border-t border-slate-100 transition",
                      selectedId === r.id
                        ? "bg-teal-50/70"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs font-semibold">
                        {r.entityNumber || r.id.slice(0, 8)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {myDataEntityTypeLabel[r.entityType] ?? r.entityType}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">{r.invoiceType || "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={statusTone(r.status)}>
                        {myDataStatusLabel[r.status] ?? r.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-slate-600">
                      {r.mark || "—"}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {fmtDt(r.createdAt)}
                    </td>
                  </tr>
                ))}
                {items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-12 text-center text-slate-500"
                    >
                      Δεν υπάρχουν εγγραφές με τα τρέχοντα φίλτρα.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="soft-panel space-y-4 p-4">
          {!view ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Επίλεξε εγγραφή από τη λίστα.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-mono text-sm font-semibold text-ink-950">
                    {view.entityNumber || view.id}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {myDataEntityTypeLabel[view.entityType] ?? view.entityType}
                    {view.invoiceType ? ` · τύπος ${view.invoiceType}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(view.status)}>
                  {myDataStatusLabel[view.status] ?? view.status}
                </Badge>
              </div>

              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-slate-500">MARK</dt>
                  <dd className="font-mono text-xs">{view.mark || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">UID</dt>
                  <dd className="font-mono text-xs">{view.uid || "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Προσπάθειες</dt>
                  <dd className="tabular-nums">{view.attempts}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Τελευταία προσπάθεια</dt>
                  <dd className="text-xs">{fmtDt(view.lastAttemptAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Δημιουργία</dt>
                  <dd className="text-xs">{fmtDt(view.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-slate-500">Ενημέρωση</dt>
                  <dd className="text-xs">{fmtDt(view.updatedAt)}</dd>
                </div>
              </dl>

              {view.errorMessage ? (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {view.errorMessage}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {canWrite &&
                (view.status === "PENDING" ||
                  view.status === "SENT" ||
                  view.status === "REJECTED") ? (
                  <Button
                    size="sm"
                    disabled={busyId === view.id}
                    onClick={() => void processOne(view.id)}
                  >
                    <Send className="mr-1.5 h-3.5 w-3.5" />
                    Διαβίβαση
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === `xml-${view.id}`}
                  onClick={() => void previewXml(view.id)}
                >
                  <FileCode2 className="mr-1.5 h-3.5 w-3.5" />
                  XML
                </Button>
                {canWrite && view.status === "ACCEPTED" && view.mark ? (
                  cancelConfirmId === view.id ? (
                    <>
                      <Button
                        size="sm"
                        className="bg-rose-700 hover:bg-rose-800"
                        disabled={busyId === view.id}
                        onClick={() => void cancelOne(view.id)}
                      >
                        Επιβεβαίωση ακύρωσης
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setCancelConfirmId(null)}
                      >
                        Άκυρο
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === view.id}
                      onClick={() => setCancelConfirmId(view.id)}
                    >
                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                      Ακύρωση ΑΑΔΕ
                    </Button>
                  )
                ) : null}
                {entityHref(view.entityType, view.entityId) ? (
                  <Link
                    href={entityHref(view.entityType, view.entityId)!}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium hover:bg-slate-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Παραστατικό
                  </Link>
                ) : null}
              </div>

              <div>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Response
                </h3>
                <pre className="max-h-64 overflow-auto rounded-xl bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-100">
                  {prettyJson(view.response)}
                </pre>
              </div>

              {view.payload != null ? (
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Payload
                  </h3>
                  <pre className="max-h-48 overflow-auto rounded-xl bg-slate-100 p-3 text-[11px] leading-relaxed text-slate-800">
                    {prettyJson(view.payload)}
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
