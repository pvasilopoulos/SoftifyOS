"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { unitOfMeasureKindLabel } from "@/modules/units/labels";
import type { UnitOfMeasureKind } from "@/generated/prisma/client";

type UnitOption = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  kind: UnitOfMeasureKind;
  decimals: number;
  isDefault: boolean;
};

const inputCls =
  "h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2";

export function NewProductForm({
  units,
  defaultUnitId,
}: {
  units: UnitOption[];
  defaultUnitId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unitId, setUnitId] = useState(defaultUnitId);

  const selected = useMemo(
    () => units.find((u) => u.id === unitId) ?? units[0] ?? null,
    [units, unitId],
  );

  const unitsByKind = useMemo(() => {
    const map = new Map<UnitOfMeasureKind, UnitOption[]>();
    for (const u of units) {
      const list = map.get(u.kind) ?? [];
      list.push(u);
      map.set(u.kind, list);
    }
    return [...map.entries()];
  }, [units]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      sku: String(form.get("sku") || ""),
      barcode: String(form.get("barcode") || "") || null,
      name: String(form.get("name") || ""),
      unitId: unitId || null,
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
        <label className="block sm:col-span-1">
          <span className="mb-1.5 flex items-center justify-between text-sm font-medium">
            <span>Μονάδα *</span>
            <Link
              href="/settings/units"
              className="text-xs font-normal text-teal-700 hover:underline"
            >
              Διαχείριση
            </Link>
          </span>
          <select
            name="unitId"
            required
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            className={inputCls}
          >
            {units.length === 0 ? (
              <option value="">— Δεν υπάρχουν μονάδες —</option>
            ) : (
              unitsByKind.map(([kind, list]) => (
                <optgroup key={kind} label={unitOfMeasureKindLabel[kind]}>
                  {list.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.symbol} · {u.name}
                      {u.isDefault ? " (προεπιλογή)" : ""}
                    </option>
                  ))}
                </optgroup>
              ))
            )}
          </select>
          {selected ? (
            <span className="mt-1 block text-[11px] text-slate-500">
              {unitOfMeasureKindLabel[selected.kind]} · έως {selected.decimals}{" "}
              δεκαδικά ποσότητας
            </span>
          ) : null}
        </label>
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
      <Button type="submit" disabled={pending || !unitId} className="w-full sm:w-auto">
        {pending ? "Αποθήκευση..." : "Αποθήκευση"}
      </Button>
    </form>
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
        defaultValue={name === "vatRate" ? "24" : undefined}
        placeholder={placeholder}
        className={inputCls}
      />
    </label>
  );
}
