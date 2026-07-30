"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function OrderIssueInvoice({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setPending(true);
    setError(null);
    const res = await fetch(`/api/orders/${orderId}/invoice`, {
      method: "POST",
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
    <div className="space-y-2">
      <Button size="sm" disabled={pending} onClick={() => void issue()}>
        <FileText size={15} />
        {pending ? "Έκδοση..." : "Έκδοση τιμολογίου"}
      </Button>
      {error ? (
        <p className="max-w-xs text-xs text-rose-700">{error}</p>
      ) : null}
    </div>
  );
}
