"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightLeft, Loader2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
export type CoverageLine = {
  sourceLineId: string;
  description: string;
  productId: string | null;
  quantity: number;
  covered: number;
  remaining: number;
  unitPrice: number;
  vatRate: number;
  selected: number;
};

export type TransformPreview = {
  rule: {
    id: string;
    code: string;
    name: string;
    handlerKey: string;
    sourceKind: string;
    targetKind: string;
    allowPartial: boolean;
    coverageMode: string;
    issueMode: string;
    copyNotes: boolean;
    defaultSeriesId: string | null;
  };
  source: {
    id: string;
    number: string;
    kind: string;
    status: string;
  };
  lines: CoverageLine[];
  canExecute: boolean;
  blockingReason?: string;
};

type AvailableRule = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  handlerKey: string;
  targetKind: string;
  allowPartial: boolean;
  remainingQty: number;
  canExecute: boolean;
  blockingReason?: string;
};

export function TransformActionButton({
  sourceKind,
  sourceId,
  canWrite,
  label = "Μετασχηματισμός",
  iconOnly = false,
}: {
  sourceKind: string;
  sourceId: string;
  canWrite: boolean;
  label?: string;
  iconOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canWrite) return null;
  return (
    <>
      <Button
        size={iconOnly ? "icon" : "sm"}
        variant={iconOnly ? "ghost" : "secondary"}
        type="button"
        onClick={() => setOpen(true)}
        title={label}
        aria-label={label}
        className={
          iconOnly
            ? "h-9 w-9 shrink-0 rounded-xl shadow-none"
            : undefined
        }
      >
        <ArrowRightLeft size={iconOnly ? 16 : 14} />
        {iconOnly ? null : label}
      </Button>
      {open ? (
        <TransformDialog
          sourceKind={sourceKind}
          sourceId={sourceId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function TransformDialog({
  sourceKind,
  sourceId,
  onClose,
}: {
  sourceKind: string;
  sourceId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState<AvailableRule[]>([]);
  const [ruleId, setRuleId] = useState<string>("");
  const [preview, setPreview] = useState<TransformPreview | null>(null);
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");
  const [issueMode, setIssueMode] = useState<"DRAFT" | "ISSUE_NOW" | "">("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/document-transforms/available?sourceKind=${encodeURIComponent(sourceKind)}&sourceId=${encodeURIComponent(sourceId)}`,
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Αποτυχία");
        if (cancelled) return;
        const items = (data.items ?? []) as AvailableRule[];
        setRules(items);
        const first = items.find((r) => r.canExecute) ?? items[0];
        if (first) setRuleId(first.id);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceKind, sourceId]);

  useEffect(() => {
    if (!ruleId) return;
    let cancelled = false;
    startTransition(async () => {
      try {
        const res = await fetch("/api/document-transforms/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleId, sourceId }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Preview failed");
        if (cancelled) return;
        const p = data.preview as TransformPreview;
        setPreview(p);
        setIssueMode(p.rule.issueMode as "DRAFT" | "ISSUE_NOW");
        const map: Record<string, number> = {};
        for (const l of p.lines) {
          if (l.remaining > 0) map[l.sourceLineId] = l.remaining;
        }
        setQtyMap(map);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [ruleId, sourceId]);

  const selectedLines = useMemo(() => {
    return Object.entries(qtyMap)
      .filter(([, q]) => q > 0)
      .map(([sourceLineId, quantity]) => ({ sourceLineId, quantity }));
  }, [qtyMap]);

  const selectedTotal = selectedLines.reduce((s, l) => s + l.quantity, 0);

  function setLineQty(line: CoverageLine, value: number) {
    const clamped = Math.max(0, Math.min(line.remaining, value));
    setQtyMap((prev) => ({ ...prev, [line.sourceLineId]: clamped }));
  }

  function execute() {
    if (!ruleId || selectedLines.length === 0) return;
    startTransition(async () => {
      try {
        const res = await fetch("/api/document-transforms/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ruleId,
            sourceId,
            notes: notes || null,
            issueMode: issueMode || undefined,
            lines: selectedLines,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Αποτυχία");
        toast.success(`Δημιουργήθηκε ${data.item.targetNumber}`);
        onClose();
        if (data.item.href) router.push(data.item.href);
        else router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-ink-950">
              Μετασχηματισμός παραστατικού
            </h2>
            <p className="text-xs text-slate-500">
              Επιλέξτε κανόνα, γραμμές και ποσότητες κάλυψης
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
          >
            Κλείσιμο
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              Φόρτωση κανόνων…
            </div>
          ) : rules.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              Δεν υπάρχουν ενεργοί κανόνες για αυτόν τον τύπο. Ρυθμίστε στο{" "}
              <a
                href="/settings/document-transforms"
                className="text-teal-800 underline"
              >
                Μετασχηματισμοί
              </a>
              .
            </p>
          ) : (
            <>
              <label className="block text-sm">
                <span className="mb-1 block text-slate-600">Κανόνας</span>
                <select
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500/30"
                  value={ruleId}
                  onChange={(e) => setRuleId(e.target.value)}
                >
                  {rules.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                      {!r.canExecute && r.blockingReason
                        ? ` — ${r.blockingReason}`
                        : ` · υπόλ. ${r.remainingQty}`}
                    </option>
                  ))}
                </select>
              </label>

              {preview?.blockingReason ? (
                <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {preview.blockingReason}
                </p>
              ) : null}

              {preview ? (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs text-slate-500">
                      <tr>
                        <th className="px-3 py-2 font-medium">Γραμμή</th>
                        <th className="px-3 py-2 font-medium">Σύνολο</th>
                        <th className="px-3 py-2 font-medium">Καλυμμένο</th>
                        <th className="px-3 py-2 font-medium">Υπόλοιπο</th>
                        <th className="px-3 py-2 font-medium">Προς εκτέλεση</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {preview.lines.map((line) => (
                        <tr key={line.sourceLineId}>
                          <td className="px-3 py-2 font-medium text-ink-900">
                            {line.description}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {line.quantity}
                          </td>
                          <td className="px-3 py-2 tabular-nums text-slate-500">
                            {line.covered}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {line.remaining}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min={0}
                              max={line.remaining}
                              step="0.001"
                              disabled={
                                line.remaining <= 0 || !preview.rule.allowPartial
                              }
                              value={qtyMap[line.sourceLineId] ?? 0}
                              onChange={(e) =>
                                setLineQty(line, Number(e.target.value) || 0)
                              }
                              className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-sm tabular-nums outline-none focus:border-teal-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Έκδοση</span>
                  <select
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                    value={issueMode}
                    onChange={(e) =>
                      setIssueMode(e.target.value as "DRAFT" | "ISSUE_NOW")
                    }
                  >
                    <option value="ISSUE_NOW">Έκδοση τώρα</option>
                    <option value="DRAFT">Πρόχειρο</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Σημειώσεις</span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Προαιρετικά…"
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                  />
                </label>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">
            Επιλεγμένες ποσότητες:{" "}
            <span className="font-semibold tabular-nums text-ink-900">
              {selectedTotal}
            </span>
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}>
              Ακύρωση
            </Button>
            <Button
              size="sm"
              disabled={
                pending ||
                !preview?.canExecute ||
                selectedLines.length === 0 ||
                Boolean(preview?.blockingReason)
              }
              onClick={execute}
            >
              {pending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ArrowRightLeft size={14} />
              )}
              Εκτέλεση
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
