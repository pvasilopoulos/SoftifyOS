"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";

export function OrderEditPanel({
  orderId,
  status,
  notes: initialNotes,
  canWrite,
}: {
  orderId: string;
  status: string;
  notes: string | null;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const locked =
    status === "CANCELLED" ||
    status === "INVOICED" ||
    status === "PARTIAL_INVOICED";
  const canEdit = canWrite && !locked;
  const canConfirm = canWrite && status === "DRAFT";
  const canCancel =
    canWrite && (status === "DRAFT" || status === "CONFIRMED");

  function patch(body: Record<string, unknown>, ok: string) {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errMsg =
          typeof data.error === "string" ? data.error : "Αποτυχία αποθήκευσης";
        setError(errMsg);
        toast.error(errMsg);
        return;
      }
      setMessage(ok);
      toast.success(ok);
      router.refresh();
    });
  }

  return (
    <section className="soft-panel space-y-3 p-4 sm:p-5">
      <h2 className="text-sm font-semibold text-ink-950">Σημειώσεις & ενέργειες</h2>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        disabled={!canEdit || pending}
        rows={3}
        placeholder="Σημειώσεις παραγγελίας…"
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20 disabled:bg-slate-50"
      />
      <div className="flex flex-wrap gap-2">
        {canEdit ? (
          <Button
            size="sm"
            type="button"
            disabled={pending || notes === (initialNotes ?? "")}
            onClick={() =>
              patch({ notes: notes || null }, "Οι σημειώσεις αποθηκεύτηκαν")
            }
          >
            Αποθήκευση σημειώσεων
          </Button>
        ) : null}
        {canConfirm ? (
          <Button
            size="sm"
            type="button"
            disabled={pending}
            onClick={() =>
              patch({ status: "CONFIRMED" }, "Η παραγγελία επιβεβαιώθηκε")
            }
          >
            Επιβεβαίωση
          </Button>
        ) : null}
        {canCancel ? (
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={pending}
            onClick={() => {
              if (!confirm("Ακύρωση παραγγελίας;")) return;
              patch({ status: "CANCELLED" }, "Η παραγγελία ακυρώθηκε");
            }}
          >
            Ακύρωση
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-rose-700">{error}</p>
      ) : null}
      {message ? (
        <p className="text-sm text-emerald-700">{message}</p>
      ) : null}
      {locked ? (
        <p className="text-xs text-slate-500">
          Κλειδωμένη κατάσταση — δεν επιτρέπονται αλλαγές.
        </p>
      ) : null}
    </section>
  );
}
