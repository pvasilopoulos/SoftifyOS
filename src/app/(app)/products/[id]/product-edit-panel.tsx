"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";

type UnitOpt = {
  id: string;
  code: string;
  name: string;
  symbol: string;
};

export function ProductEditPanel({
  productId,
  initial,
  units,
  canEdit,
}: {
  productId: string;
  initial: {
    sku: string;
    barcode: string | null;
    name: string;
    unitId: string | null;
    unit: string;
    vatRate: number;
    price: number;
    notes: string | null;
    status: string;
    trackInventory: boolean;
  };
  units: UnitOpt[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    sku: initial.sku,
    barcode: initial.barcode ?? "",
    name: initial.name,
    unitId: initial.unitId ?? units[0]?.id ?? "",
    vatRate: String(initial.vatRate),
    price: String(initial.price),
    notes: initial.notes ?? "",
    status: initial.status,
    trackInventory: initial.trackInventory,
  });

  if (!canEdit) return null;

  async function save() {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku: form.sku,
          barcode: form.barcode || null,
          name: form.name,
          unitId: form.unitId || null,
          vatRate: Number(form.vatRate),
          price: Number(form.price),
          notes: form.notes || null,
          status: form.status,
          trackInventory: form.trackInventory,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage("Αποθηκεύτηκε.");
      setEditing(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="soft-panel p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-950">Στοιχεία προϊόντος</h2>
        {!editing ? (
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Επεξεργασία
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={pending}
            >
              Ακύρωση
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={pending}>
              Αποθήκευση
            </Button>
          </div>
        )}
      </div>

      {error ? (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-3 rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {!editing ? (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-slate-400">SKU</dt>
            <dd className="font-mono font-medium">{initial.sku}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Barcode</dt>
            <dd>{initial.barcode || "—"}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-slate-400">Όνομα</dt>
            <dd className="font-medium">{initial.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-400">Παρακολούθηση stock</dt>
            <dd>{initial.trackInventory ? "Ναι" : "Όχι"}</dd>
          </div>
        </dl>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">SKU</span>
            <input
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.sku}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Barcode</span>
            <input
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.barcode}
              onChange={(e) =>
                setForm((f) => ({ ...f, barcode: e.target.value }))
              }
            />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Όνομα</span>
            <input
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Μονάδα</span>
            <select
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.unitId}
              onChange={(e) =>
                setForm((f) => ({ ...f, unitId: e.target.value }))
              }
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.symbol} · {u.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Κατάσταση</span>
            <select
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({ ...f, status: e.target.value }))
              }
            >
              <option value="ACTIVE">Ενεργό</option>
              <option value="INACTIVE">Ανενεργό</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Τιμή</span>
            <input
              type="number"
              min={0}
              step="0.01"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.price}
              onChange={(e) =>
                setForm((f) => ({ ...f, price: e.target.value }))
              }
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">ΦΠΑ %</span>
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              value={form.vatRate}
              onChange={(e) =>
                setForm((f) => ({ ...f, vatRate: e.target.value }))
              }
            />
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.trackInventory}
              onChange={(e) =>
                setForm((f) => ({ ...f, trackInventory: e.target.checked }))
              }
            />
            Παρακολούθηση αποθέματος
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Σημειώσεις</span>
            <textarea
              className="min-h-[80px] w-full rounded-xl border border-slate-200 px-3 py-2"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </label>
        </div>
      )}
    </section>
  );
}
