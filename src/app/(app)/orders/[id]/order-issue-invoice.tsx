"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { SeriesPicker } from "@/modules/documents/series-picker";

export function OrderIssueInvoice({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seriesId, setSeriesId] = useState("");

  async function issue() {
    if (!seriesId) {
      setError("Επιλέξτε σειρά τιμολογίου");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/orders/${orderId}/invoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId }),
    });
    const data = (await res.json()) as {
      item?: { invoiceId: string };
      error?: string;
      invoiceId?: string;
    };
    setPending(false);
    if (!res.ok) {
      if (data.invoiceId) {
        router.push(`/invoices/${data.invoiceId}`);
        return;
      }
      setError(data.error || "Αποτυχία έκδοσης");
      return;
    }
    router.push(`/invoices/${data.item!.invoiceId}`);
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <SeriesPicker
        kind="SALES_INVOICE"
        value={seriesId}
        onChange={setSeriesId}
        label="Σειρά τιμολογίου *"
        className="block"
      />
      <Button
        size="sm"
        disabled={pending || !seriesId}
        onClick={() => void issue()}
        className="w-full sm:w-auto"
      >
        <FileText size={15} />
        {pending ? "Έκδοση..." : "Έκδοση τιμολογίου"}
      </Button>
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
