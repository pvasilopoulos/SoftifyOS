"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { SeriesPicker } from "@/modules/documents/series-picker";

export function QuoteConvertOrder({
  quoteId,
  canConvert,
  existingOrderId,
}: {
  quoteId: string;
  canConvert: boolean;
  existingOrderId?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [seriesId, setSeriesId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (existingOrderId) {
    return (
      <Button
        size="md"
        variant="secondary"
        onClick={() => router.push(`/orders/${existingOrderId}`)}
      >
        <ShoppingCart size={15} />
        Άνοιγμα παραγγελίας
      </Button>
    );
  }

  if (!canConvert) return null;

  async function submit() {
    if (!seriesId) {
      setError("Επιλέξτε σειρά παραγγελίας");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch(`/api/orders/${quoteId}/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seriesId, status: "CONFIRMED" }),
    });
    const data = (await res.json()) as {
      item?: { orderId: string };
      orderId?: string;
      error?: string;
    };
    setPending(false);
    if (!res.ok) {
      if (data.orderId) {
        router.push(`/orders/${data.orderId}`);
        return;
      }
      setError(data.error || "Αποτυχία μετατροπής");
      return;
    }
    router.push(`/orders/${data.item!.orderId}`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {!open ? (
        <Button size="md" onClick={() => setOpen(true)}>
          <ShoppingCart size={15} />
          Μετατροπή σε παραγγελία
        </Button>
      ) : (
        <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-semibold text-ink-950">
            Δημιουργία παραγγελίας από προσφορά
          </p>
          <SeriesPicker
            kind="SALES_ORDER"
            value={seriesId}
            onChange={setSeriesId}
            label="Σειρά παραγγελίας *"
            className="block"
          />
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending || !seriesId}
              onClick={() => void submit()}
            >
              {pending ? "Μετατροπή..." : "Μετατροπή"}
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
