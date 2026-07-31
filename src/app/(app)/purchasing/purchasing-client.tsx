"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type Supplier = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  purchaseOrderCount: number;
};

type ProductOption = {
  id: string;
  sku: string;
  name: string;
  price: number;
  vatRate: number;
};

type PoLine = {
  id: string;
  position: number;
  description: string;
  quantity: number;
  quantityReceived: number;
  unitPrice: number;
  vatRate: number;
  lineTotal: number;
  product: { id: string; sku: string; name: string; unit: string } | null;
};

type PurchaseOrder = {
  id: string;
  number: string;
  status: string;
  currency: string;
  orderedAt: string;
  subtotal: number;
  vatAmount: number;
  total: number;
  notes: string | null;
  supplier: { id: string; code: string; name: string };
  site: { id: string; code: string; name: string } | null;
  lines: PoLine[];
};

type SiteOption = { id: string; code: string; name: string };

type DraftLine = {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Πρόχειρη",
  ORDERED: "Παραγγελία",
  PARTIAL: "Μερική παραλαβή",
  RECEIVED: "Παραληφθείσα",
  CANCELLED: "Ακυρωμένη",
};

function money(v: number) {
  return Number.isFinite(v)
    ? v.toLocaleString("el-GR", { style: "currency", currency: "EUR" })
    : "—";
}

function qty(v: number) {
  return Number.isFinite(v)
    ? v.toLocaleString("el-GR", { maximumFractionDigits: 3 })
    : "—";
}

export function PurchasingClient({
  initialSuppliers,
  initialOrders,
  sites,
  products,
}: {
  initialSuppliers: Supplier[];
  initialOrders: PurchaseOrder[];
  sites: SiteOption[];
  products: ProductOption[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"orders" | "suppliers">("orders");
  const [suppliers, setSuppliers] = useState(initialSuppliers);
  const [orders, setOrders] = useState(initialOrders);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialOrders[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);

  const [newSupplier, setNewSupplier] = useState({
    code: "",
    name: "",
    vatNumber: "",
    email: "",
    phone: "",
  });
  const [newPo, setNewPo] = useState({
    supplierId: initialSuppliers[0]?.id ?? "",
    siteId: sites[0]?.id ?? "",
    notes: "",
    confirm: true,
  });
  const [draftLines, setDraftLines] = useState<DraftLine[]>([
    {
      key: "1",
      productId: "",
      description: "",
      quantity: "1",
      unitPrice: "0",
      vatRate: "24",
    },
  ]);
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => orders.find((o) => o.id === selectedId) ?? null,
    [orders, selectedId],
  );

  useEffect(() => {
    setSuppliers(initialSuppliers);
    setOrders(initialOrders);
    if (
      selectedId &&
      !initialOrders.some((o) => o.id === selectedId) &&
      initialOrders[0]
    ) {
      setSelectedId(initialOrders[0].id);
    }
  }, [initialSuppliers, initialOrders, selectedId]);

  useEffect(() => {
    if (!selected) {
      setReceiveQty({});
      return;
    }
    const next: Record<string, string> = {};
    for (const line of selected.lines) {
      const remaining = Math.max(0, line.quantity - line.quantityReceived);
      next[line.id] = remaining > 0 ? String(remaining) : "0";
    }
    setReceiveQty(next);
  }, [selected]);

  const refresh = useCallback(() => router.refresh(), [router]);

  async function createSupplier(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: newSupplier.code,
          name: newSupplier.name,
          vatNumber: newSupplier.vatNumber || null,
          email: newSupplier.email || null,
          phone: newSupplier.phone || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      toast.success("Ο προμηθευτής δημιουργήθηκε");
      setNewSupplier({
        code: "",
        name: "",
        vatNumber: "",
        email: "",
        phone: "",
      });
      if (!newPo.supplierId && data.item?.id) {
        setNewPo((p) => ({ ...p, supplierId: data.item.id }));
      }
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function createOrder(e: FormEvent) {
    e.preventDefault();
    if (!newPo.supplierId) {
      toast.error("Επιλέξτε προμηθευτή");
      return;
    }
    const lines = draftLines
      .filter((l) => l.description.trim() || l.productId)
      .map((l) => ({
        productId: l.productId || null,
        description:
          l.description ||
          products.find((p) => p.id === l.productId)?.name ||
          "Γραμμή",
        quantity: Number(l.quantity) || 0,
        unitPrice: Number(l.unitPrice) || 0,
        vatRate: Number(l.vatRate) || 0,
      }));
    if (lines.length === 0) {
      toast.error("Προσθέστε τουλάχιστον μία γραμμή");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: newPo.supplierId,
          siteId: newPo.siteId || null,
          notes: newPo.notes || null,
          confirm: newPo.confirm,
          lines,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      toast.success(`Δημιουργήθηκε ${data.item?.number ?? "παραγγελία"}`);
      setDraftLines([
        {
          key: String(Date.now()),
          productId: "",
          description: "",
          quantity: "1",
          unitPrice: "0",
          vatRate: "24",
        },
      ]);
      if (data.item?.id) setSelectedId(data.item.id);
      setTab("orders");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status: string) {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      toast.success(`Κατάσταση: ${STATUS_LABEL[status] ?? status}`);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  async function receive() {
    if (!selected) return;
    const items = selected.lines
      .map((line) => ({
        lineId: line.id,
        qty: Number(receiveQty[line.id] || 0),
      }))
      .filter((l) => l.qty > 0);
    if (items.length === 0) {
      toast.error("Δώστε ποσότητες παραλαβής");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/purchase-orders/${selected.id}/receive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      toast.success("Παραλαβή καταχωρήθηκε — ενημερώθηκε το απόθεμα");
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setTab("orders")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab === "orders"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          Παραγγελίες αγοράς
        </button>
        <button
          type="button"
          onClick={() => setTab("suppliers")}
          className={`rounded-md px-3 py-1.5 text-sm font-medium ${
            tab === "suppliers"
              ? "bg-slate-900 text-white"
              : "bg-slate-100 text-slate-700"
          }`}
        >
          Προμηθευτές
        </button>
      </div>

      {tab === "suppliers" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Κωδικός</th>
                  <th className="px-3 py-2">Όνομα</th>
                  <th className="px-3 py-2">ΑΦΜ</th>
                  <th className="px-3 py-2 text-right">Παραγγελίες</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">{s.code}</td>
                    <td className="px-3 py-2 font-medium">{s.name}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {s.vatNumber || "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {s.purchaseOrderCount}
                    </td>
                  </tr>
                ))}
                {suppliers.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-8 text-center text-slate-500"
                    >
                      Δεν υπάρχουν προμηθευτές ακόμη.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <form
            onSubmit={createSupplier}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              Νέος προμηθευτής
            </h2>
            {(
              [
                ["code", "Κωδικός"],
                ["name", "Όνομα"],
                ["vatNumber", "ΑΦΜ"],
                ["email", "Email"],
                ["phone", "Τηλέφωνο"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block text-xs text-slate-600">
                {label}
                <input
                  required={key === "code" || key === "name"}
                  value={newSupplier[key]}
                  onChange={(e) =>
                    setNewSupplier((s) => ({ ...s, [key]: e.target.value }))
                  }
                  className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
                />
              </label>
            ))}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Αποθήκευση
            </button>
          </form>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr_340px]">
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Παραγγελίες ({orders.length})
            </div>
            <ul className="max-h-[70vh] overflow-auto">
              {orders.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(o.id)}
                    className={`w-full border-b border-slate-50 px-3 py-2.5 text-left ${
                      selectedId === o.id ? "bg-sky-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-semibold">
                        {o.number}
                      </span>
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {STATUS_LABEL[o.status] ?? o.status}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-600">
                      {o.supplier.name}
                    </div>
                    <div className="mt-0.5 text-xs font-medium text-slate-800">
                      {money(o.total)}
                    </div>
                  </button>
                </li>
              ))}
              {orders.length === 0 ? (
                <li className="px-3 py-8 text-center text-sm text-slate-500">
                  Καμία παραγγελία.
                </li>
              ) : null}
            </ul>
          </div>

          <div className="space-y-4">
            {selected ? (
              <>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2 className="font-mono text-lg font-semibold text-slate-900">
                        {selected.number}
                      </h2>
                      <p className="text-sm text-slate-600">
                        {selected.supplier.name} ·{" "}
                        {STATUS_LABEL[selected.status] ?? selected.status}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Ημ/νία:{" "}
                        {new Date(selected.orderedAt).toLocaleDateString(
                          "el-GR",
                        )}
                        {selected.site
                          ? ` · Χώρος: ${selected.site.name}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selected.status === "DRAFT" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setStatus("ORDERED")}
                          className="rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                        >
                          Επιβεβαίωση παραγγελίας
                        </button>
                      ) : null}
                      {selected.status === "DRAFT" ||
                      selected.status === "ORDERED" ? (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setStatus("CANCELLED")}
                          className="rounded-md border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 disabled:opacity-50"
                        >
                          Ακύρωση
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-slate-500">Καθαρή</div>
                      <div className="font-medium">
                        {money(selected.subtotal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">ΦΠΑ</div>
                      <div className="font-medium">
                        {money(selected.vatAmount)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Σύνολο</div>
                      <div className="font-semibold">
                        {money(selected.total)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Περιγραφή</th>
                        <th className="px-3 py-2 text-right">Ποσότητα</th>
                        <th className="px-3 py-2 text-right">Παραληφθέντα</th>
                        <th className="px-3 py-2 text-right">Τιμή</th>
                        <th className="px-3 py-2 text-right">Σύνολο</th>
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
                            {qty(line.quantity)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {qty(line.quantityReceived)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {money(line.unitPrice)}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums font-medium">
                            {money(line.lineTotal)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selected.status === "ORDERED" ||
                selected.status === "PARTIAL" ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                    <h3 className="text-sm font-semibold text-emerald-900">
                      Παραλαβή εμπορευμάτων
                    </h3>
                    <p className="mt-1 text-xs text-emerald-800/80">
                      Καταχωρήστε ποσότητες — ενημερώνεται αυτόματα το απόθεμα
                      (κίνηση RECEIPT).
                    </p>
                    <div className="mt-3 space-y-2">
                      {selected.lines.map((line) => {
                        const remaining = Math.max(
                          0,
                          line.quantity - line.quantityReceived,
                        );
                        if (remaining <= 0) return null;
                        return (
                          <div
                            key={line.id}
                            className="flex items-center gap-3 text-sm"
                          >
                            <div className="min-w-0 flex-1 truncate">
                              {line.description}
                            </div>
                            <div className="text-xs text-slate-500">
                              υπόλοιπο {qty(remaining)}
                            </div>
                            <input
                              type="number"
                              min={0}
                              max={remaining}
                              step="any"
                              value={receiveQty[line.id] ?? ""}
                              onChange={(e) =>
                                setReceiveQty((q) => ({
                                  ...q,
                                  [line.id]: e.target.value,
                                }))
                              }
                              className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-right text-sm"
                            />
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={receive}
                      className="mt-3 rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Καταχώρηση παραλαβής
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-16 text-center text-sm text-slate-500">
                Επιλέξτε παραγγελία ή δημιουργήστε νέα.
              </div>
            )}
          </div>

          <form
            onSubmit={createOrder}
            className="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
          >
            <h2 className="text-sm font-semibold text-slate-900">
              Νέα παραγγελία αγοράς
            </h2>
            <label className="block text-xs text-slate-600">
              Προμηθευτής
              <select
                required
                value={newPo.supplierId}
                onChange={(e) =>
                  setNewPo((p) => ({ ...p, supplierId: e.target.value }))
                }
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              >
                <option value="">— επιλογή —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-slate-600">
              Χώρος παραλαβής
              <select
                value={newPo.siteId}
                onChange={(e) =>
                  setNewPo((p) => ({ ...p, siteId: e.target.value }))
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
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={newPo.confirm}
                onChange={(e) =>
                  setNewPo((p) => ({ ...p, confirm: e.target.checked }))
                }
              />
              Επιβεβαίωση αμέσως (ORDERED)
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
                      const product = products.find(
                        (p) => p.id === e.target.value,
                      );
                      setDraftLines((rows) =>
                        rows.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                productId: e.target.value,
                                description: product?.name ?? r.description,
                                unitPrice: product
                                  ? String(product.price)
                                  : r.unitPrice,
                                vatRate: product
                                  ? String(product.vatRate)
                                  : r.vatRate,
                              }
                            : r,
                        ),
                      );
                    }}
                    className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                  >
                    <option value="">— προϊόν (προαιρετικό) —</option>
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
                          i === idx
                            ? { ...r, description: e.target.value }
                            : r,
                        ),
                      )
                    }
                    className="w-full rounded border border-slate-200 px-1.5 py-1 text-xs"
                  />
                  <div className="grid grid-cols-3 gap-1">
                    <input
                      type="number"
                      step="any"
                      min={0}
                      title="Ποσότητα"
                      value={line.quantity}
                      onChange={(e) =>
                        setDraftLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? { ...r, quantity: e.target.value }
                              : r,
                          ),
                        )
                      }
                      className="rounded border border-slate-200 px-1.5 py-1 text-xs"
                    />
                    <input
                      type="number"
                      step="any"
                      min={0}
                      title="Τιμή"
                      value={line.unitPrice}
                      onChange={(e) =>
                        setDraftLines((rows) =>
                          rows.map((r, i) =>
                            i === idx
                              ? { ...r, unitPrice: e.target.value }
                              : r,
                          ),
                        )
                      }
                      className="rounded border border-slate-200 px-1.5 py-1 text-xs"
                    />
                    <input
                      type="number"
                      step="any"
                      min={0}
                      title="ΦΠΑ %"
                      value={line.vatRate}
                      onChange={(e) =>
                        setDraftLines((rows) =>
                          rows.map((r, i) =>
                            i === idx ? { ...r, vatRate: e.target.value } : r,
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
                      unitPrice: "0",
                      vatRate: "24",
                    },
                  ])
                }
                className="text-xs font-medium text-sky-700 hover:underline"
              >
                + Γραμμή
              </button>
            </div>

            <label className="block text-xs text-slate-600">
              Σημειώσεις
              <textarea
                value={newPo.notes}
                onChange={(e) =>
                  setNewPo((p) => ({ ...p, notes: e.target.value }))
                }
                rows={2}
                className="mt-1 w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm"
              />
            </label>

            <button
              type="submit"
              disabled={busy || suppliers.length === 0}
              className="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Δημιουργία παραγγελίας
            </button>
            {suppliers.length === 0 ? (
              <p className="text-xs text-amber-700">
                Πρώτα δημιουργήστε προμηθευτή.
              </p>
            ) : null}
          </form>
        </div>
      )}
    </div>
  );
}
