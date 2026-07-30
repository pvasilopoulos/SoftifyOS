"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, Ruler, Search, Trash2, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  unitOfMeasureKindLabel,
} from "@/modules/units/labels";
import type { UnitOfMeasureKind } from "@/generated/prisma/client";

export type UnitItem = {
  id: string;
  code: string;
  name: string;
  symbol: string;
  kind: UnitOfMeasureKind;
  decimals: number;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
  isSystem: boolean;
  productCount: number;
};

type Draft = {
  code: string;
  name: string;
  symbol: string;
  kind: UnitOfMeasureKind;
  decimals: number;
  description: string;
  sortOrder: number;
  isActive: boolean;
  isDefault: boolean;
};

function emptyDraft(): Draft {
  return {
    code: "",
    name: "",
    symbol: "",
    kind: "COUNT",
    decimals: 0,
    description: "",
    sortOrder: 100,
    isActive: true,
    isDefault: false,
  };
}

function fromItem(u: UnitItem): Draft {
  return {
    code: u.code,
    name: u.name,
    symbol: u.symbol,
    kind: u.kind,
    decimals: u.decimals,
    description: u.description ?? "",
    sortOrder: u.sortOrder,
    isActive: u.isActive,
    isDefault: u.isDefault,
  };
}

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2";

export function UnitsSettingsClient({
  initialItems,
}: {
  initialItems: UnitItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | UnitOfMeasureKind>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = useMemo(
    () => items.find((i) => i.id === editingId) ?? null,
    [items, editingId],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((u) => {
      if (kindFilter !== "all" && u.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        u.code.toLowerCase().includes(q) ||
        u.name.toLowerCase().includes(q) ||
        u.symbol.toLowerCase().includes(q)
      );
    });
  }, [items, query, kindFilter]);

  const openCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setMessage(null);
  };

  const openEdit = (u: UnitItem) => {
    setCreating(false);
    setEditingId(u.id);
    setDraft(fromItem(u));
    setError(null);
    setMessage(null);
  };

  const closeDrawer = () => {
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const refresh = async () => {
    const res = await fetch("/api/settings/units");
    const data = await res.json();
    if (!res.ok) return;
    setItems(
      (data.items as UnitItem[]).map((u) => ({
        ...u,
        productCount:
          items.find((x) => x.id === u.id)?.productCount ?? u.productCount ?? 0,
      })),
    );
    router.refresh();
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const payload = {
        ...draft,
        description: draft.description || null,
      };
      const res = creating
        ? await fetch("/api/settings/units", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/settings/units/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage(creating ? "Η μονάδα δημιουργήθηκε." : "Η μονάδα ενημερώθηκε.");
      closeDrawer();
      await refresh();
    });
  };

  const onDelete = () => {
    if (!editing || editing.isSystem) return;
    if (!confirm(`Διαγραφή μονάδας «${editing.name}»;`)) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/settings/units/${editing.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία διαγραφής");
        return;
      }
      closeDrawer();
      await refresh();
    });
  };

  const drawerOpen = creating || editing !== null;

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Ρυθμίσεις
      </Link>

      <PageHeader
        title="Μονάδες μέτρησης"
        description="Παραμετρικός κατάλογος μονάδων για προϊόντα, παραγγελίες και αποθήκη."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus size={15} />
            Νέα μονάδα
          </Button>
        }
      />

      {message ? (
        <p className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error && !drawerOpen ? (
        <p className="rounded-xl border border-rose-200/80 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            active={kindFilter === "all"}
            onClick={() => setKindFilter("all")}
            label="Όλες"
          />
          {(Object.keys(unitOfMeasureKindLabel) as UnitOfMeasureKind[]).map(
            (k) => (
              <FilterChip
                key={k}
                active={kindFilter === k}
                onClick={() => setKindFilter(k)}
                label={unitOfMeasureKindLabel[k]}
              />
            ),
          )}
        </div>
        <label className="relative block w-full lg:max-w-xs">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση κωδικού, ονόματος…"
            className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none ring-teal-500/30 placeholder:text-slate-400 focus:ring-2"
          />
        </label>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 lg:grid lg:grid-cols-[5rem_minmax(0,1.2fr)_5rem_minmax(0,1fr)_4rem_5rem_6rem]">
          <span>Κωδικός</span>
          <span>Όνομα</span>
          <span>Σύμβολο</span>
          <span>Κατηγορία</span>
          <span>Δεκ.</span>
          <span>Προϊόντα</span>
          <span>Κατάσταση</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {visible.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => openEdit(u)}
                className={cn(
                  "grid w-full gap-2 px-4 py-3.5 text-left transition hover:bg-slate-50/90",
                  "lg:grid-cols-[5rem_minmax(0,1.2fr)_5rem_minmax(0,1fr)_4rem_5rem_6rem] lg:items-center",
                  editingId === u.id && "bg-teal-50/40",
                )}
              >
                <span className="inline-flex w-fit items-center rounded-md bg-ink-950 px-2 py-1 font-mono text-[11px] font-semibold text-white">
                  {u.code}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-semibold text-ink-950">
                      {u.name}
                    </span>
                    {u.isDefault ? <Badge tone="teal">Default</Badge> : null}
                    {u.isSystem ? (
                      <Badge tone="slate" className="!px-1.5 !py-0 text-[10px]">
                        sys
                      </Badge>
                    ) : null}
                  </span>
                  {u.description ? (
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {u.description}
                    </span>
                  ) : null}
                </span>
                <span className="font-mono text-sm text-ink-800">{u.symbol}</span>
                <span className="text-sm text-slate-600">
                  {unitOfMeasureKindLabel[u.kind]}
                </span>
                <span className="tabular-nums text-sm text-slate-600">
                  {u.decimals}
                </span>
                <span className="tabular-nums text-sm text-slate-600">
                  {u.productCount}
                </span>
                <span>
                  <Badge tone={u.isActive ? "emerald" : "slate"}>
                    {u.isActive ? "Ενεργή" : "Ανενεργή"}
                  </Badge>
                </span>
              </button>
            </li>
          ))}
          {visible.length === 0 ? (
            <li className="px-4 py-16 text-center text-sm text-slate-500">
              Δεν βρέθηκαν μονάδες
            </li>
          ) : null}
        </ul>
      </section>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/40">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Κλείσιμο"
            onClick={closeDrawer}
          />
          <form
            onSubmit={onSubmit}
            className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700">
                  <Ruler size={16} />
                </span>
                <h2 className="text-lg font-semibold text-ink-950">
                  {creating ? "Νέα μονάδα" : `Επεξεργασία · ${editing?.code}`}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Κωδικός *</span>
                  <input
                    className={cn(inputCls, "uppercase font-mono")}
                    value={draft.code}
                    disabled={!creating && editing?.isSystem}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, code: e.target.value }))
                    }
                    required
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Σύμβολο *</span>
                  <input
                    className={cn(inputCls, "font-mono")}
                    value={draft.symbol}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, symbol: e.target.value }))
                    }
                    placeholder="τεμ"
                    required
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Όνομα *</span>
                <input
                  className={inputCls}
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  required
                />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Κατηγορία</span>
                  <select
                    className={inputCls}
                    value={draft.kind}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        kind: e.target.value as UnitOfMeasureKind,
                      }))
                    }
                  >
                    {(
                      Object.keys(unitOfMeasureKindLabel) as UnitOfMeasureKind[]
                    ).map((k) => (
                      <option key={k} value={k}>
                        {unitOfMeasureKindLabel[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Δεκαδικά ποσότητας</span>
                  <input
                    type="number"
                    min={0}
                    max={6}
                    className={inputCls}
                    value={draft.decimals}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        decimals: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </label>
              </div>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Σειρά</span>
                <input
                  type="number"
                  className={inputCls}
                  value={draft.sortOrder}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      sortOrder: Number(e.target.value) || 0,
                    }))
                  }
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Περιγραφή</span>
                <textarea
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </label>

              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-teal-600"
                  checked={draft.isDefault}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, isDefault: e.target.checked }))
                  }
                />
                Προεπιλογή για νέα προϊόντα
              </label>
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 text-teal-600"
                  checked={draft.isActive}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, isActive: e.target.checked }))
                  }
                />
                Ενεργή μονάδα
              </label>
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending ? "Αποθήκευση…" : "Αποθήκευση"}
              </Button>
              {!creating && editing && !editing.isSystem ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={onDelete}
                >
                  <Trash2 size={15} />
                </Button>
              ) : null}
              <Button type="button" variant="secondary" onClick={closeDrawer}>
                Ακύρωση
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
        active
          ? "border-ink-900 bg-ink-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
      )}
    >
      {label}
    </button>
  );
}
