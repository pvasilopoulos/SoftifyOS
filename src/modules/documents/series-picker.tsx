"use client";

import { useEffect, useState } from "react";
import type { DocumentKindCode } from "@/modules/documents/schemas";

export type SeriesOption = {
  id: string;
  code: string;
  name: string;
  kind: string;
  previewNumber: string;
  isDefault: boolean;
  isActive: boolean;
  myDataEnabled?: boolean;
  myDataInvoiceType?: string | null;
  site: { code: string; name: string; kind: string } | null;
};

export function useSeriesOptions(kind: DocumentKindCode) {
  const [items, setItems] = useState<SeriesOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/document-series?kind=${encodeURIComponent(kind)}`,
        );
        const data = (await res.json()) as {
          items?: SeriesOption[];
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error || "Αποτυχία φόρτωσης σειρών");
          setItems([]);
          return;
        }
        const active = (data.items ?? []).filter((s) => s.isActive);
        setItems(active);
      } catch {
        if (!cancelled) {
          setError("Αποτυχία φόρτωσης σειρών");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  return { items, loading, error };
}

export function pickDefaultSeriesId(items: SeriesOption[]) {
  return items.find((s) => s.isDefault)?.id ?? items[0]?.id ?? "";
}

type SeriesPickerProps = {
  kind: DocumentKindCode;
  value: string;
  onChange: (seriesId: string) => void;
  required?: boolean;
  label?: string;
  className?: string;
};

export function SeriesPicker({
  kind,
  value,
  onChange,
  required = true,
  label = "Σειρά *",
  className,
}: SeriesPickerProps) {
  const { items, loading, error } = useSeriesOptions(kind);

  useEffect(() => {
    if (loading || items.length === 0) return;
    if (value && items.some((s) => s.id === value)) return;
    onChange(pickDefaultSeriesId(items));
  }, [loading, items, value, onChange]);

  const selected = items.find((s) => s.id === value);

  return (
    <label className={className ?? "block sm:col-span-2"}>
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <select
        required={required && items.length > 0}
        value={value}
        disabled={loading || items.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
      >
        {loading ? (
          <option value="">Φόρτωση σειρών...</option>
        ) : items.length === 0 ? (
          <option value="">Δεν υπάρχουν ενεργές σειρές</option>
        ) : (
          items.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
              {s.site ? ` · ${s.site.code}` : ""}
              {s.isDefault ? " (προεπιλογή)" : ""}
              {` · επόμενο ${s.previewNumber}`}
            </option>
          ))
        )}
      </select>
      {error ? (
        <p className="mt-1 text-xs text-rose-700">{error}</p>
      ) : selected ? (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
          <span>
            Επόμενος αριθμός{" "}
            <span className="font-mono text-ink-800">
              {selected.previewNumber}
            </span>
            {selected.site ? ` · ${selected.site.name}` : ""}
          </span>
          {selected.myDataEnabled ? (
            <span className="inline-flex items-center rounded-md bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-800 ring-1 ring-emerald-200/80">
              myDATA
              {selected.myDataInvoiceType
                ? ` ${selected.myDataInvoiceType}`
                : ""}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
              χωρίς myDATA
            </span>
          )}
        </p>
      ) : !loading && items.length === 0 ? (
        <p className="mt-1 text-xs text-amber-700">
          Ρυθμίστε σειρά στο Ρυθμίσεις → Σειρές & Τύποι.
        </p>
      ) : null}
    </label>
  );
}
