"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileDown, Send, Wallet, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatEUR } from "@/modules/sales/invoice-utils";

type Props = {
  invoiceId: string;
  status: string;
  total: number;
  paidAmount: number;
  /** compact = preview panel sizes */
  size?: "sm" | "md";
  showPdf?: boolean;
  showSend?: boolean;
  showCollect?: boolean;
  onDone?: () => void;
};

export function InvoiceActions({
  invoiceId,
  status,
  total,
  paidAmount,
  size = "sm",
  showPdf = true,
  showSend = true,
  showCollect = true,
  onDone,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"send" | "collect" | null>(null);
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
        setError(data.error || "Αποτυχία αποστολής");
        return;
      }
      setMessage(data.item?.message || "Η αποστολή καταχωρήθηκε");
      router.refresh();
      onDone?.();
    } catch {
      setError("Αποτυχία αποστολής");
    } finally {
      setBusy(null);
    }
  }

  async function collectInvoice(amount: number, note: string) {
    setBusy("collect");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/collect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, note: note || null }),
      });
      const data = (await res.json()) as {
        item?: { paidAmount: number; balance: number; status: string };
        error?: string;
      };
      if (!res.ok) {
        setError(data.error || "Αποτυχία είσπραξης");
        return;
      }
      setCollectOpen(false);
      setMessage(
        `Είσπραξη ${formatEUR(amount)} · υπόλοιπο ${formatEUR(data.item!.balance)}`,
      );
      router.refresh();
      onDone?.();
    } catch {
      setError("Αποτυχία είσπραξης");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {showPdf ? (
          <Button
            size={size}
            variant={size === "sm" ? "primary" : "secondary"}
            onClick={() =>
              window.open(`/invoices/${invoiceId}/print`, "_blank", "noopener")
            }
          >
            <FileDown size={14} />
            PDF
          </Button>
        ) : null}
        {showSend ? (
          <Button
            size={size}
            variant="secondary"
            disabled={!canSend || busy === "send"}
            onClick={() => void sendInvoice()}
          >
            <Send size={14} />
            {busy === "send" ? "..." : "Αποστολή"}
          </Button>
        ) : null}
        {showCollect ? (
          <Button
            size={size}
            variant={size === "md" ? "primary" : "secondary"}
            disabled={!canCollect || busy === "collect"}
            onClick={() => setCollectOpen(true)}
          >
            <Wallet size={14} />
            Είσπραξη
          </Button>
        ) : null}
      </div>

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

      {collectOpen ? (
        <CollectDialog
          balance={balance}
          busy={busy === "collect"}
          onClose={() => setCollectOpen(false)}
          onSubmit={(amount, note) => void collectInvoice(amount, note)}
        />
      ) : null}
    </div>
  );
}

function CollectDialog({
  balance,
  busy,
  onClose,
  onSubmit,
}: {
  balance: number;
  busy: boolean;
  onClose: () => void;
  onSubmit: (amount: number, note: string) => void;
}) {
  const [amount, setAmount] = useState(
    balance > 0 ? String(balance) : "",
  );
  const [note, setNote] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="collect-title"
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 id="collect-title" className="text-lg font-semibold text-ink-950">
              Είσπραξη
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Υπόλοιπο {formatEUR(balance)}
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
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const value = Number(amount);
            if (!Number.isFinite(value) || value <= 0) return;
            onSubmit(value, note.trim());
          }}
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Ποσό (€) *</span>
            <input
              required
              type="number"
              min="0.01"
              step="0.01"
              max={balance}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Σημείωση</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="π.χ. έμβασμα / μετρητά"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
          </label>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="submit" disabled={busy}>
              {busy ? "Αποθήκευση..." : "Καταχώρηση"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Ακύρωση
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setAmount(String(balance))}
            >
              Πλήρες υπόλοιπο
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
