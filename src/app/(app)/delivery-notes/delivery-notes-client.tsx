"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Customer = { id: string; code: string; name: string };
type Product = { id: string; sku: string; name: string; unit: string };
type Site = { id: string; code: string; name: string };

type Line = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  unit: string;
  product: { id: string; sku: string; name: string; unit: string } | null;
};

type Note = {
  id: string;
  number: string;
  status: string;
  issuedAt: string | null;
  shippingAddress: string | null;
  notes: string | null;
  customer: Customer;
  site: Site | null;
  lines: Line[];
};

type DraftLine = {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
};

const STATUS: Record<string, string> = {
  DRAFT: "Πρόχειρο",
  ISSUED: "Εκδομένο",
  CANCELLED: "Ακυρωμένο",
};

export function DeliveryNotesClient({
  initialNotes,
  customers,
  products,
  sites,
}: {
  initialNotes: Note[];
  customers: Customer[];
  products: Product[];
  sites: Site[];
}) {
  const router = useRouter();
  const [notes, setNotes] = useState(initialNotes);
  const [selectedId, setSelectedId] = useState(initialNotes[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState({
    customerId: customers[0]?.id ?? "",
    siteId: sites[0]?.id ?? "",
    shippingAddress: "",
    notes: "",
    issue: true,
  });
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    { key: "1", productId: "", description: "", quantity: "1", unit: "τεμ" },
  ]);

  const selected = useMemo(
    () => notes.find((n) => n.id === selectedId) ?? null,
    [notes, selectedId],
  );

  useEffect(() => {
    setNotes(initialNotes);
  }, [initialNotes]);

  const refresh = useCallback(() => router.refresh(), [router]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const lines = draftLines
      .filter((l) => l.description.trim() || l.productId)
      .map((l) => ({
        productId: l.productId || null,
        description:
          l.description ||
          products.find((p) => p.id === l.productId)?.name ||
          "Γραμμή",
        quantity: Number(l.quantity) || 0,
        unit: l.unit || "τεμ",
      }));
    if (!form.customerId || lines.length === 0) {
      setError("Πελάτης και τουλάχιστον μία γραμμή απαιτούνται");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/delivery-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: form.customerId,
          siteId: form.siteId || null,
          shippingAddress: form.shippingAddress || null,
          notes: form.notes || null,
          issue: form.issue,
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setMessage(
        form.issue
          ? `Εκδόθηκε ${data.item?.number} — ενημερώθηκε το απόθεμα`
          : `Δημιουργήθηκε ${data.item?.number}`,
      );
      if (data.item?.id) setSelectedId(data.item.id);
      setDraftLines([
        {
          key: String(Date.now()),
          productId: "",
          description: "",
          quantity: "1",
          unit: "τεμ",
        },
      ]);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function issue() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(`/api/delivery-notes/${selected.id}/issue`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setMessage(`Εκδόθηκε ${data.item?.number}`);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/delivery-notes/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setMessage("Ακυρώθηκε");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[280px_1fr_340px]">
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Δελτία ({notes.length})
          </div>
          <ul className="max-h-[70vh] overflow-auto">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  className={`w-full border-b border-slate-50 px-3 py-2.5 text-left ${
                    selectedId === n.id ? "bg-sky-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold">
                      {n.number}
                    </span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {STATUS[n.status] ?? n.status}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-600">
                    {n.customer.name}
                  </div>
                </button>
              </li>
            ))}
            {notes.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-slate-500">
                Κανένα δελτίο.
              </li>
            ) : null}
          </ul>
        </div>

        <div className="space-y-4">
          {selected ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-mono text-lg font-semibold text-slate-900">
                    <a
                      href={`/delivery-notes/${selected.id}`}
                      className="hover:text-teal-800 hover:underline"
                    >
                      {selected.number}
                    </a>
                  </h2>
                  <p className="text-sm text-slate-600">
                    {selected.customer.name} ·{" "}
                    {STATUS[selected.status] ?? selected.status}
                  </p>
                  {selected.shippingAddress ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Αποστολή: {selected.shippingAddress}
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  {selected.status === "DRAFT" ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={issue}
                        className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                      >
                        Έκδοση + απόθεμα OUT
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={cancel}
                        className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 disabled:opacity-50"
                      >
                        Ακύρωση
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              <table className="mt-4 w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Περιγραφή</th>
                    <th className="px-3 py-2 text-right">Ποσότητα</th>
                    <th className="px-3 py-2">Μονάδα</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="px-3 py-2">
                        <div className="font-medium">{line.description}</div>
                        {line.product ? (
                          <div className="font-mono text-[11px] text-slate-500">
                            {line.product.sku}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {line.quantity.toLocaleString("el-GR")}
                      </td>
                      <td className="px-3 py-2">{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center text-sm text-slate-500">
              Επιλέξτε δελτίο ή δημιουργήστε νέο.
            </div>
          )}
        </div>

        <form
          onSubmit={create}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <h2 className="text-sm font-semibold text-slate-900">
            Νέο δελτίο αποστολής
          </h2>
          <label className="block text-xs text-slate-600">
            Πελάτης
            <select
              required
              value={form.customerId}
              onChange={(e) =>
                setForm((f) => ({ ...f, customerId: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            >
              <option value="">—</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Χώρος εξόδου
            <select
              value={form.siteId}
              onChange={(e) =>
                setForm((f) => ({ ...f, siteId: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            >
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Διεύθυνση αποστολής
            <input
              value={form.shippingAddress}
              onChange={(e) =>
                setForm((f) => ({ ...f, shippingAddress: e.target.value }))
              }
              className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={form.issue}
              onChange={(e) =>
                setForm((f) => ({ ...f, issue: e.target.checked }))
              }
            />
            Έκδοση αμέσως (κίνηση OUT)
          </label>

          <div className="space-y-2 border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Γραμμές
            </div>
            {draftLines.map((line, idx) => (
              <div
                key={line.key}
                className="space-y-1 rounded-md border border-slate-100 p-2"
              >
                <select
                  value={line.productId}
                  onChange={(e) => {
                    const product = products.find((p) => p.id === e.target.value);
                    setDraftLines((rows) =>
                      rows.map((r, i) =>
                        i === idx
                          ? {
                              ...r,
                              productId: e.target.value,
                              description: product?.name ?? r.description,
                              unit: product?.unit ?? r.unit,
                            }
                          : r,
                      ),
                    );
                  }}
                  className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                >
                  <option value="">— προϊόν —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} · {p.name}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Περιγραφή"
                  value={line.description}
                  onChange={(e) =>
                    setDraftLines((rows) =>
                      rows.map((r, i) =>
                        i === idx ? { ...r, description: e.target.value } : r,
                      ),
                    )
                  }
                  className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                />
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="number"
                    min={0}
                    step="any"
                    value={line.quantity}
                    onChange={(e) =>
                      setDraftLines((rows) =>
                        rows.map((r, i) =>
                          i === idx ? { ...r, quantity: e.target.value } : r,
                        ),
                      )
                    }
                    className="rounded border border-slate-200 px-1.5 py-1 text-xs"
                  />
                  <input
                    value={line.unit}
                    onChange={(e) =>
                      setDraftLines((rows) =>
                        rows.map((r, i) =>
                          i === idx ? { ...r, unit: e.target.value } : r,
                        ),
                      )
                    }
                    className="rounded border border-slate-200 px-1.5 py-1 text-xs"
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraftLines((rows) => [
                  ...rows,
                  {
                    key: String(Date.now()),
                    productId: "",
                    description: "",
                    quantity: "1",
                    unit: "τεμ",
                  },
                ])
              }
              className="text-xs font-medium text-sky-700 hover:underline"
            >
              + Γραμμή
            </button>
          </div>

          <button
            type="submit"
            disabled={busy || customers.length === 0}
            className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Δημιουργία
          </button>
        </form>
      </div>
    </div>
  );
}
