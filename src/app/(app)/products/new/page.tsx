"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";

export default function NewProductPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTracked, setIsTracked] = useState(true);
  const [price, setPrice] = useState("0");
  const [cost, setCost] = useState("0");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      sku: String(form.get("sku") || ""),
      name: String(form.get("name") || ""),
      category: String(form.get("category") || "") || null,
      brand: String(form.get("brand") || "") || null,
      barcode: String(form.get("barcode") || "") || null,
      unit: String(form.get("unit") || "τεμ") || "τεμ",
      vatRate: Number(form.get("vatRate") || 24),
      price: Number(form.get("price") || 0),
      cost: Number(form.get("cost") || 0),
      stockOnHand: Number(form.get("stockOnHand") || 0),
      minStock: Number(form.get("minStock") || 0),
      reorderQty: Number(form.get("reorderQty") || 0),
      location: String(form.get("location") || "") || null,
      tags: String(form.get("tags") || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      isTracked: form.get("isTracked") === "on",
      notes: String(form.get("notes") || "") || null,
      status: String(form.get("status") || "ACTIVE"),
    };
    const res = await fetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { item?: { id: string }; error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    router.push(`/products/${data.item!.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/products"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω
      </Link>
      <PageHeader
        title="Νέο προϊόν"
        description="Advanced καρτέλα προϊόντος με εμπορικά και αποθεματικά πεδία."
      />
      <form onSubmit={onSubmit} className="soft-panel space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="sku" label="SKU *" required placeholder="SKU-001" />
          <Field name="barcode" label="Barcode" placeholder="520..." />
          <Field name="unit" label="Μονάδα" placeholder="τεμ / κιλά / ώρες" />
        </div>
        <Field name="name" label="Όνομα *" required placeholder="Premium espresso 1kg" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="category" label="Κατηγορία" placeholder="Καφέδες" />
          <Field name="brand" label="Brand" placeholder="Softify Select" />
        </div>
        <div className="grid gap-4 sm:grid-cols-4">
          <Field
            name="price"
            label="Τιμή πώλησης (€) *"
            required
            type="number"
            placeholder="0.00"
            value={price}
            onChange={setPrice}
          />
          <Field
            name="cost"
            label="Κόστος (€)"
            type="number"
            placeholder="0.00"
            value={cost}
            onChange={setCost}
          />
          <Field name="vatRate" label="ΦΠΑ %" type="number" placeholder="24" />
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Περιθώριο
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-ink-900">
              {marginFromInputs(price, cost).toFixed(1)}%
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-ink-900">
            <input
              type="checkbox"
              name="isTracked"
              checked={isTracked}
              onChange={(e) => setIsTracked(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-teal-600"
            />
            Παρακολούθηση αποθέματος
          </label>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field
              name="stockOnHand"
              label="Διαθέσιμο stock"
              type="number"
              placeholder="0"
              disabled={!isTracked}
            />
            <Field
              name="minStock"
              label="Ελάχιστο stock"
              type="number"
              placeholder="0"
              disabled={!isTracked}
            />
            <Field
              name="reorderQty"
              label="Προτεινόμενη αναπλήρωση"
              type="number"
              placeholder="0"
              disabled={!isTracked}
            />
          </div>
          <div className="mt-3">
            <Field name="location" label="Τοποθεσία αποθήκης" placeholder="R1 / Ράφι Α3" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="tags"
            label="Tags (comma separated)"
            placeholder="espresso, premium, horeca"
          />
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">Κατάσταση</span>
            <select
              name="status"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              defaultValue="ACTIVE"
            >
              <option value="ACTIVE">Ενεργό</option>
              <option value="INACTIVE">Ανενεργό</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Σημειώσεις</span>
          <textarea
            name="notes"
            rows={3}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
          />
        </label>
        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Αποθήκευση..." : "Αποθήκευση"}
        </Button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  required,
  placeholder,
  type = "text",
  disabled,
  value,
  onChange,
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
  value?: string;
  onChange?: (next: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        required={required}
        type={type}
        disabled={disabled}
        value={value}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        step={type === "number" ? "any" : undefined}
        min={type === "number" && name !== "stockOnHand" ? "0" : undefined}
        defaultValue={name === "vatRate" ? "24" : name === "unit" ? "τεμ" : undefined}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-100 disabled:text-slate-400"
      />
    </label>
  );
}

function marginFromInputs(price: string, cost: string) {
  const priceNum = Number(price || 0);
  const costNum = Number(cost || 0);
  if (priceNum <= 0) return 0;
  return ((priceNum - costNum) / priceNum) * 100;
}
