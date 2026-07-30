"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import {
  calcInvoiceTotals,
  calcLineTotals,
  formatEUR,
} from "@/modules/sales/invoice-utils";

type CustomerOption = { id: string; code: string; name: string };
type BranchOption = {
  id: string;
  code: string;
  name: string;
  spaces: Array<{ id: string; code: string; name: string }>;
};
type ProductOption = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  vatRate: number;
};
type LineDraft = {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: "",
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "24",
  };
}

export default function NewOrderPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "CONFIRMED">("CONFIRMED");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingCustomers(true);
      try {
        const [custRes, prodRes] = await Promise.all([
          fetch("/api/customers?limit=50&status=ACTIVE"),
          fetch("/api/products?limit=100&status=ACTIVE"),
        ]);
        const custData = (await custRes.json()) as { items?: CustomerOption[] };
        const prodData = (await prodRes.json()) as { items?: ProductOption[] };
        if (!cancelled) {
          setCustomers(custData.items ?? []);
          setProducts(prodData.items ?? []);
        }
      } catch {
        if (!cancelled) setError("Αποτυχία φόρτωσης δεδομένων");
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      setLoadingHierarchy(true);
      try {
        const res = await fetch(`/api/customers/${customerId}`);
        const data = (await res.json()) as {
          item?: { branches: BranchOption[] };
        };
        if (!cancelled) setBranches(data.item?.branches ?? []);
      } catch {
        if (!cancelled) setError("Αποτυχία φόρτωσης υποκαταστημάτων");
      } finally {
        if (!cancelled) setLoadingHierarchy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  const spaces = useMemo(() => {
    return branches.find((b) => b.id === branchId)?.spaces ?? [];
  }, [branches, branchId]);

  const totals = useMemo(() => {
    return calcInvoiceTotals(
      lines.map((line) => ({
        quantity: Number(line.quantity) || 0,
        unitPrice: Number(line.unitPrice) || 0,
        vatRate: Number(line.vatRate) || 0,
      })),
    );
  }, [lines]);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function applyProduct(key: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    if (!product) {
      updateLine(key, { productId: "" });
      return;
    }
    updateLine(key, {
      productId,
      description: product.name,
      unitPrice: String(product.price),
      vatRate: String(product.vatRate),
    });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    if (!customerId) {
      setError("Επιλέξτε πελάτη");
      setPending(false);
      return;
    }

    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        branchId: branchId || null,
        spaceId: spaceId || null,
        status,
        notes: notes.trim() || null,
        lines: lines.map((line) => ({
          productId: line.productId || null,
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
        })),
      }),
    });
    const data = (await res.json()) as { item?: { id: string }; error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    router.push(`/orders/${data.item!.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link
        href="/orders"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω στις παραγγελίες
      </Link>
      <PageHeader
        title="Νέα παραγγελία"
        description="Επιλέξτε πελάτη και προϊόντα από τον κατάλογο."
      />

      <form onSubmit={onSubmit} className="space-y-5">
        <section className="soft-panel space-y-4 p-5">
          <h2 className="text-sm font-semibold text-ink-900">Στοιχεία</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Πελάτης *</span>
              <select
                required
                value={customerId}
                disabled={loadingCustomers}
                onChange={(e) => {
                  setCustomerId(e.target.value);
                  setBranches([]);
                  setBranchId("");
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                <option value="">
                  {loadingCustomers ? "Φόρτωση..." : "Επιλέξτε πελάτη"}
                </option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Υποκατάστημα</span>
              <select
                value={branchId}
                disabled={!customerId || loadingHierarchy}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Χώρος</span>
              <select
                value={spaceId}
                disabled={!branchId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Κατάσταση</span>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "DRAFT" | "CONFIRMED")
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                <option value="DRAFT">Πρόχειρη</option>
                <option value="CONFIRMED">Επιβεβαιωμένη</option>
              </select>
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">Σημειώσεις</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
            </label>
          </div>
        </section>

        <section className="soft-panel space-y-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-900">Γραμμές</h2>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus size={14} />
              Γραμμή
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => {
              const { lineTotal } = calcLineTotals({
                quantity: Number(line.quantity) || 0,
                unitPrice: Number(line.unitPrice) || 0,
                vatRate: Number(line.vatRate) || 0,
              });
              return (
                <div
                  key={line.key}
                  className="space-y-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3"
                >
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-500">
                      Προϊόν {idx + 1}
                    </span>
                    <select
                      value={line.productId}
                      onChange={(e) => applyProduct(line.key, e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    >
                      <option value="">— Χωρίς SKU / ελεύθερο κείμενο —</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} — {p.name} ({formatEUR(p.price)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid gap-3 sm:grid-cols-12">
                    <label className="block sm:col-span-5">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Περιγραφή *
                      </span>
                      <input
                        required
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, { description: e.target.value })
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Ποσότητα
                      </span>
                      <input
                        required
                        type="number"
                        min="0.001"
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, { quantity: e.target.value })
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Τιμή
                      </span>
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          updateLine(line.key, { unitPrice: e.target.value })
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <label className="block sm:col-span-1">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        ΦΠΑ %
                      </span>
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={line.vatRate}
                        onChange={(e) =>
                          updateLine(line.key, { vatRate: e.target.value })
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <div className="flex items-end justify-between gap-2 sm:col-span-2">
                      <p className="h-10 content-center text-sm font-medium tabular-nums">
                        {formatEUR(lineTotal)}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={lines.length <= 1}
                        onClick={() =>
                          setLines((prev) =>
                            prev.length <= 1
                              ? prev
                              : prev.filter((l) => l.key !== line.key),
                          )
                        }
                      >
                        <Trash2 size={16} className="text-slate-500" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex flex-col items-end gap-1 border-t border-slate-100 pt-4 text-sm">
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>Καθαρή αξία</span>
              <span className="tabular-nums">{formatEUR(totals.subtotal)}</span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-slate-600">
              <span>ΦΠΑ</span>
              <span className="tabular-nums">{formatEUR(totals.vatAmount)}</span>
            </div>
            <div className="flex w-full max-w-xs justify-between text-base font-semibold text-ink-900">
              <span>Σύνολο</span>
              <span className="tabular-nums">{formatEUR(totals.total)}</span>
            </div>
          </div>
        </section>

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={pending}>
            {pending ? "Αποθήκευση..." : "Αποθήκευση παραγγελίας"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/orders")}
          >
            Ακύρωση
          </Button>
        </div>
      </form>
    </div>
  );
}
