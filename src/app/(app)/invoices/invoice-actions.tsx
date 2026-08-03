"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Ban, CheckCircle2, FileDown, Send, Wallet, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { formatEUR } from "@/modules/sales/invoice-utils";
import {
  maybeAutoPrintAfterIssue,
  openInvoicePrint,
  preparePrintWindow,
} from "@/modules/print-forms/open-invoice-print";

type Props = {
  invoiceId: string;
  status: string;
  total: number;
  paidAmount: number;
  /** compact = preview panel sizes */
  size?: "sm" | "md";
  /** Icon-only toolbar (detail header) */
  iconsOnly?: boolean;
  showPdf?: boolean;
  showSend?: boolean;
  showCollect?: boolean;
  showIssue?: boolean;
  showCancel?: boolean;
  onDone?: () => void;
};

export function InvoiceActions({
  invoiceId,
  status,
  total,
  paidAmount,
  size = "sm",
  iconsOnly = false,
  showPdf = true,
  showSend = true,
  showCollect = true,
  showIssue = true,
  showCancel = true,
  onDone,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"send" | "collect" | "issue" | "cancel" | null>(
    null,
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collectOpen, setCollectOpen] = useState(false);
  const balance = Math.max(0, Math.round((total - paidAmount) * 100) / 100);
  const canCollect =
    balance > 0 &&
    status !== "DRAFT" &&
    status !== "CANCELLED" &&
    status !== "PAID";
  const canSend = status !== "CANCELLED";
  const canIssue = status === "DRAFT";
  const canCancel = status !== "CANCELLED" && status !== "PAID" && paidAmount <= 0;

  function notifyOk(text: string) {
    setMessage(text);
    if (iconsOnly) toast.success(text);
  }
  function notifyErr(text: string) {
    setError(text);
    if (iconsOnly) toast.error(text);
  }

  async function sendInvoice() {
    setBusy("send");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/send`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        item?: { message?: string };
        error?: string;
      };
      if (!res.ok) {
        notifyErr(data.error || "Αποτυχία αποστολής");
        return;
      }
      notifyOk(data.item?.message || "Η αποστολή καταχωρήθηκε");
      router.refresh();
      onDone?.();
    } catch {
      notifyErr("Αποτυχία αποστολής");
    } finally {
      setBusy(null);
    }
  }

  async function collectInvoice(
    methods: Array<{ paymentMethodId: string; amount: number }>,
    note: string,
  ) {
    setBusy("collect");
    setError(null);
    setMessage(null);
    const amount = methods.reduce((s, m) => s + m.amount, 0);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          methods: methods.map((m) => ({
            paymentMethodId: m.paymentMethodId,
            amount: m.amount,
          })),
          note: note || null,
        }),
      });
      const data = (await res.json()) as {
        item?: {
          paidAmount: number;
          balance: number;
          status: string;
          settlementNumber?: string;
        };
        error?: string;
      };
      if (!res.ok) {
        notifyErr(data.error || "Αποτυχία είσπραξης");
        return;
      }
      setCollectOpen(false);
      const settle = data.item?.settlementNumber
        ? ` · ${data.item.settlementNumber}`
        : "";
      notifyOk(
        `Είσπραξη ${formatEUR(amount)}${settle} · υπόλοιπο ${formatEUR(data.item!.balance)}`,
      );
      router.refresh();
      onDone?.();
    } catch {
      notifyErr("Αποτυχία είσπραξης");
    } finally {
      setBusy(null);
    }
  }

  async function issueInvoice() {
    setBusy("issue");
    setError(null);
    setMessage(null);
    const printWin = preparePrintWindow();
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/issue`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        warning?: string;
        item?: {
          print?: { copies?: number; printer?: string | null };
          autoSettle?: {
            settlementNumber?: string;
            paymentMethodCode?: string;
          } | null;
          status?: string;
        };
      };
      if (!res.ok) {
        printWin?.close();
        notifyErr(data.error || "Αποτυχία έκδοσης");
        return;
      }
      const settleMsg = data.item?.autoSettle?.settlementNumber
        ? ` · εξόφληση ${data.item.autoSettle.settlementNumber}${
            data.item.autoSettle.paymentMethodCode
              ? ` (${data.item.autoSettle.paymentMethodCode})`
              : ""
          }`
        : "";
      notifyOk(`Το τιμολόγιο εκδόθηκε${settleMsg}`);
      if (data.warning) notifyErr(data.warning);
      if (data.item?.print) {
        maybeAutoPrintAfterIssue(
          invoiceId,
          {
            printPrinter: data.item.print.printer,
            printCopies: data.item.print.copies,
          },
          printWin,
        );
      } else {
        printWin?.close();
      }
      router.refresh();
      onDone?.();
    } catch {
      printWin?.close();
      notifyErr("Αποτυχία έκδοσης");
    } finally {
      setBusy(null);
    }
  }

  async function cancelInvoice() {
    if (!window.confirm("Ακύρωση παραστατικού;")) return;
    setBusy("cancel");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/cancel`, {
        method: "POST",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        notifyErr(data.error || "Αποτυχία ακύρωσης");
        return;
      }
      notifyOk("Το τιμολόγιο ακυρώθηκε");
      router.refresh();
      onDone?.();
    } catch {
      notifyErr("Αποτυχία ακύρωσης");
    } finally {
      setBusy(null);
    }
  }

  const btnSize = iconsOnly ? "icon" : size;
  const iconBtnClass = iconsOnly
    ? "h-9 w-9 shrink-0 rounded-xl shadow-none"
    : size === "sm"
      ? "h-8 w-8"
      : undefined;

  const buttons = (
    <>
      {showIssue && canIssue ? (
        <Button
          size={btnSize}
          disabled={busy === "issue"}
          onClick={() => void issueInvoice()}
          title="Έκδοση"
          aria-label={busy === "issue" ? "Έκδοση…" : "Έκδοση"}
          className={iconsOnly ? "h-9 w-9 shrink-0 rounded-xl" : iconBtnClass}
        >
          <CheckCircle2 size={iconsOnly ? 16 : 14} />
          {iconsOnly ? null : busy === "issue" ? "..." : "Έκδοση"}
        </Button>
      ) : null}
      {showPdf ? (
        <Button
          size={btnSize}
          variant={
            iconsOnly
              ? "ghost"
              : size === "sm" && !canIssue
                ? "primary"
                : "secondary"
          }
          onClick={() => openInvoicePrint(invoiceId, { auto: true })}
          title="PDF / Εκτύπωση"
          aria-label="PDF / Εκτύπωση"
          className={iconBtnClass}
        >
          <FileDown size={iconsOnly ? 16 : 14} />
          {iconsOnly ? null : "PDF"}
        </Button>
      ) : null}
      {showSend ? (
        <Button
          size="icon"
          variant={iconsOnly ? "ghost" : "secondary"}
          disabled={!canSend || busy === "send"}
          onClick={() => void sendInvoice()}
          title="Αποστολή"
          aria-label={busy === "send" ? "Αποστολή…" : "Αποστολή"}
          className={
            iconsOnly
              ? "h-9 w-9 shrink-0 rounded-xl shadow-none"
              : size === "sm"
                ? "h-8 w-8"
                : undefined
          }
        >
          <Send size={iconsOnly ? 16 : 14} />
        </Button>
      ) : null}
      {showCollect ? (
        <Button
          size={btnSize}
          variant={
            iconsOnly
              ? canCollect
                ? "primary"
                : "ghost"
              : size === "md" && !canIssue
                ? "primary"
                : "secondary"
          }
          disabled={!canCollect || busy === "collect"}
          onClick={() => setCollectOpen(true)}
          title="Είσπραξη"
          aria-label="Είσπραξη"
          className={
            iconsOnly
              ? canCollect
                ? "h-9 w-9 shrink-0 rounded-xl"
                : "h-9 w-9 shrink-0 rounded-xl shadow-none"
              : undefined
          }
        >
          <Wallet size={iconsOnly ? 16 : 14} />
          {iconsOnly ? null : "Είσπραξη"}
        </Button>
      ) : null}
      {showCancel && canCancel ? (
        <Button
          size={btnSize}
          variant="ghost"
          disabled={busy === "cancel"}
          onClick={() => void cancelInvoice()}
          title="Ακύρωση"
          aria-label={busy === "cancel" ? "Ακύρωση…" : "Ακύρωση"}
          className={
            iconsOnly
              ? "h-9 w-9 shrink-0 rounded-xl text-rose-600 shadow-none hover:bg-rose-50 hover:text-rose-700"
              : undefined
          }
        >
          <Ban size={iconsOnly ? 16 : 14} />
          {iconsOnly ? null : "Ακύρωση"}
        </Button>
      ) : null}
    </>
  );

  const dialog = collectOpen ? (
    <CollectDialog
      invoiceId={invoiceId}
      balance={balance}
      busy={busy === "collect"}
      onClose={() => setCollectOpen(false)}
      onSubmit={(methods, note) => void collectInvoice(methods, note)}
    />
  ) : null;

  if (iconsOnly) {
    return (
      <>
        {buttons}
        {dialog}
      </>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">{buttons}</div>

      {message ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}

      {dialog}
    </div>
  );
}

type CollectMethod = {
  id: string;
  code: string;
  name: string;
  kind: string;
  isDefault: boolean;
};

type TenderLine = {
  key: string;
  paymentMethodId: string;
  amount: string;
};

function CollectDialog({
  invoiceId,
  balance,
  busy,
  onClose,
  onSubmit,
}: {
  invoiceId: string;
  balance: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (
    methods: Array<{ paymentMethodId: string; amount: number }>,
    note: string,
  ) => void;
}) {
  const [note, setNote] = useState("");
  const [catalog, setCatalog] = useState<CollectMethod[]>([]);
  const [lines, setLines] = useState<TenderLine[]>([]);
  const [loadingMethods, setLoadingMethods] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingMethods(true);
      try {
        const res = await fetch(`/api/invoices/${invoiceId}/collect-methods`);
        const data = (await res.json()) as { items?: CollectMethod[] };
        if (cancelled || !res.ok) return;
        const items = data.items ?? [];
        setCatalog(items);
        const preferred =
          items.find((m) => m.isDefault)?.id ?? items[0]?.id ?? "";
        setLines([
          {
            key: "t0",
            paymentMethodId: preferred,
            amount: balance > 0 ? String(balance) : "",
          },
        ]);
      } finally {
        if (!cancelled) setLoadingMethods(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, balance]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const total = lines.reduce((s, l) => {
    const n = Number(l.amount);
    return s + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const remaining = round2(Math.max(0, balance - total));

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-ink-950/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="collect-title"
        className="flex max-h-[min(90dvh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 id="collect-title" className="text-lg font-semibold text-ink-950">
              Είσπραξη
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Υπόλοιπο {formatEUR(balance)}
              {lines.length > 1 ? (
                <span className="ml-2 text-teal-700">
                  · σύνολο {formatEUR(total)}
                </span>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
            aria-label="Κλείσιμο"
          >
            <X size={16} />
          </button>
        </div>
        <form
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            const methods = lines
              .map((l) => ({
                paymentMethodId: l.paymentMethodId,
                amount: Number(l.amount),
              }))
              .filter(
                (m) =>
                  m.paymentMethodId &&
                  Number.isFinite(m.amount) &&
                  m.amount > 0,
              );
            if (methods.length === 0) return;
            if (round2(methods.reduce((s, m) => s + m.amount, 0)) > balance + 0.001)
              return;
            onSubmit(methods, note.trim());
          }}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Τρόποι πληρωμής *</span>
              <button
                type="button"
                disabled={loadingMethods || catalog.length === 0 || remaining <= 0}
                onClick={() => {
                  const preferred =
                    catalog.find((m) => m.isDefault)?.id ?? catalog[0]?.id ?? "";
                  setLines((prev) => [
                    ...prev,
                    {
                      key: `t${Date.now()}`,
                      paymentMethodId: preferred,
                      amount: remaining > 0 ? String(remaining) : "",
                    },
                  ]);
                }}
                className="text-xs font-medium text-teal-700 hover:underline disabled:opacity-40"
              >
                + Προσθήκη τρόπου
              </button>
            </div>
            {lines.map((line, idx) => (
              <div
                key={line.key}
                className="grid grid-cols-[1fr_7rem_auto] gap-2"
              >
                <select
                  required
                  value={line.paymentMethodId}
                  disabled={loadingMethods || catalog.length === 0}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l) =>
                        l.key === line.key
                          ? { ...l, paymentMethodId: e.target.value }
                          : l,
                      ),
                    )
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                >
                  {loadingMethods ? (
                    <option value="">Φόρτωση…</option>
                  ) : catalog.length === 0 ? (
                    <option value="">Δεν υπάρχουν τρόποι</option>
                  ) : (
                    catalog.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.code})
                      </option>
                    ))
                  )}
                </select>
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={balance}
                  value={line.amount}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((l) =>
                        l.key === line.key
                          ? { ...l, amount: e.target.value }
                          : l,
                      ),
                    )
                  }
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  aria-label={`Ποσό γραμμής ${idx + 1}`}
                />
                <button
                  type="button"
                  disabled={lines.length <= 1}
                  onClick={() =>
                    setLines((prev) => prev.filter((l) => l.key !== line.key))
                  }
                  className="rounded-xl px-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900 disabled:opacity-30"
                  aria-label="Αφαίρεση"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Σημείωση</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="π.χ. αριθμός συναλλαγής"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="submit"
              disabled={
                busy ||
                loadingMethods ||
                lines.every((l) => !l.paymentMethodId) ||
                total <= 0 ||
                total > balance + 0.001
              }
            >
              {busy ? "Αποθήκευση..." : "Καταχώρηση"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Ακύρωση
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setLines((prev) =>
                  prev.length
                    ? [
                        {
                          ...prev[0]!,
                          amount: String(balance),
                        },
                        ...prev.slice(1).map((l) => ({ ...l, amount: "" })),
                      ]
                    : prev,
                )
              }
            >
              Πλήρες υπόλοιπο
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
