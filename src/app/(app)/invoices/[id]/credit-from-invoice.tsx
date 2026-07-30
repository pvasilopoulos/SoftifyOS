"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileMinus2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { SeriesPicker } from "@/modules/documents/series-picker";

export function CreditFromInvoice({
  invoiceId,
  canCredit,
}: {
  invoiceId: string;
  canCredit: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seriesId, setSeriesId] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "ISSUED">("DRAFT");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canCredit) return null;

  async function submit() {
    if (!seriesId) {
      setError("Επιλέξτε σειρά πιστωτικού");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/invoices/${invoiceId}/credit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId, status }),
    });
    const data = (await res.json()) as {
      item?: { id: string };
      error?: string;
    };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία δημιουργίας πιστωτικού");
      return;
    }
    setOpen(false);
    router.push(`/invoices/${data.item!.id}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <Button
          size="md"
          variant="secondary"
          onClick={() => setOpen(true)}
        >
          <FileMinus2 size={15} />
          Έκδοση πιστωτικού
        </Button>
      ) : (
        <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-950">
            Νέο πιστωτικό από αυτό το παραστατικό
          </p>
          <p className="text-xs text-slate-500">
            Αντιγράφονται όλες οι γραμμές. Μπορείτε να επεξεργαστείτε πρόχειρο
            μετά.
          </p>
          <SeriesPicker
            kind="SALES_CREDIT"
            value={seriesId}
            onChange={setSeriesId}
            label="Σειρά πιστωτικού *"
            className="block"
          />
          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Κατάσταση</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "DRAFT" | "ISSUED")}
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
            >
              <option value="DRAFT">Πρόχειρο</option>
              <option value="ISSUED">Έκδοση τώρα</option>
            </select>
          </label>
          {error ? (
            <p className="text-xs text-rose-700">{error}</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !seriesId}
              onClick={() => void submit()}
            >
              {pending ? "Δημιουργία..." : "Δημιουργία πιστωτικού"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Άκυρο
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
