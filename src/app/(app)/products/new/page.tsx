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

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      sku: String(form.get("sku") || ""),
      barcode: String(form.get("barcode") || "") || null,
      name: String(form.get("name") || ""),
      unit: String(form.get("unit") || "τεμ") || "τεμ",
      vatRate: Number(form.get("vatRate") || 24),
      price: Number(form.get("price") || 0),
      notes: String(form.get("notes") || "") || null,
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
        description="SKU, τιμή και ΦΠΑ για χρήση σε παραγγελίες."
      />
      <form onSubmit={onSubmit} className="soft-panel space-y-4 p-5">
        <Field name="sku" label="SKU *" required placeholder="SKU-001" />
        <Field
          name="barcode"
          label="Barcode / EAN"
          placeholder="5200123456789 ή ίσο με SKU"
        />
        <Field
          name="name"
          label="Όνομα *"
          required
          placeholder="Αποθήκευση παλετών"
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="unit" label="Μονάδα" placeholder="τεμ" />
          <Field
            name="price"
            label="Τιμή (€) *"
            required
            type="number"
            placeholder="0.00"
          />
          <Field name="vatRate" label="ΦΠΑ %" type="number" placeholder="24" />
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
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        required={required}
        type={type}
        step={type === "number" ? "any" : undefined}
        min={type === "number" ? "0" : undefined}
        defaultValue={name === "vatRate" ? "24" : name === "unit" ? "τεμ" : undefined}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
      />
    </label>
  );
}
