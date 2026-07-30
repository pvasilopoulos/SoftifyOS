"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Building2, Hash, Pencil, Plus, Search, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  customerEffectLabel,
  documentKindGroup,
  documentKindGroupLabel,
  documentKindLabel,
  inventoryEffectLabel,
} from "@/modules/documents/series";
import { MYDATA_INVOICE_TYPES } from "@/modules/documents/schemas";

type Kind = keyof typeof documentKindLabel;
type KindGroup = keyof typeof documentKindGroupLabel;

const kinds = Object.keys(documentKindLabel) as Kind[];
const kindGroups = Object.keys(documentKindGroupLabel) as KindGroup[];

const kindsByGroup = kindGroups.map((group) => ({
  group,
  label: documentKindGroupLabel[group],
  kinds: kinds.filter((k) => documentKindGroup[k] === group),
}));

type Site = {
  id: string;
  code: string;
  name: string;
  kind: "BRANCH" | "TILL";
  parentId: string | null;
};

type Series = {
  id: string;
  code: string;
  name: string;
  kind: Kind;
  prefix: string;
  nextNumber?: number;
  padLength?: number;
  resetPolicy?: "NEVER" | "YEARLY";
  previewNumber: string;
  siteId: string | null;
  site: { code: string; name: string; kind: string } | null;
  affectsCustomer: keyof typeof customerEffectLabel;
  affectsInventory: keyof typeof inventoryEffectLabel;
  allowPartial: boolean;
  myDataEnabled: boolean;
  myDataInvoiceType: string | null;
  glDebitAccount: string | null;
  glCreditAccount: string | null;
  glVatAccount: string | null;
  isDefault: boolean;
  isActive: boolean;
};

function payloadFromForm(form: FormData) {
  return {
    code: String(form.get("code") || ""),
    name: String(form.get("name") || ""),
    kind: String(form.get("kind") || ""),
    prefix: String(form.get("prefix") || ""),
    nextNumber: Number(form.get("nextNumber") || 1),
    padLength: Number(form.get("padLength") || 5),
    resetPolicy: String(form.get("resetPolicy") || "YEARLY"),
    siteId: String(form.get("siteId") || "") || null,
    affectsCustomer: String(form.get("affectsCustomer") || "NONE"),
    affectsInventory: String(form.get("affectsInventory") || "NONE"),
    allowPartial: form.get("allowPartial") === "on",
    myDataEnabled: form.get("myDataEnabled") === "on",
    myDataInvoiceType: String(form.get("myDataInvoiceType") || "") || null,
    myDataVatCategory: String(form.get("myDataVatCategory") || "") || "1",
    glDebitAccount: String(form.get("glDebitAccount") || "") || null,
    glCreditAccount: String(form.get("glCreditAccount") || "") || null,
    glVatAccount: String(form.get("glVatAccount") || "") || null,
    isDefault: form.get("isDefault") === "on",
    isActive: form.get("isActive") === "on",
  };
}

export function SeriesSettingsClient({
  initialSites,
  initialSeries,
}: {
  initialSites: Site[];
  initialSeries: Series[];
}) {
  const [tab, setTab] = useState<"series" | "org">("series");
  const [kindFilter, setKindFilter] = useState<"all" | KindGroup>("all");
  const [query, setQuery] = useState("");
  const [sites, setSites] = useState(initialSites);
  const [series, setSeries] = useState(initialSeries);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Series | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const drawerOpen = creating || editing !== null;

  async function reload() {
    const [sRes, serRes] = await Promise.all([
      fetch("/api/sites"),
      fetch("/api/document-series"),
    ]);
    const sData = (await sRes.json()) as { items?: Site[]; error?: string };
    const serData = (await serRes.json()) as { items?: Series[]; error?: string };
    if (!sRes.ok || !serRes.ok) {
      setError(sData.error || serData.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setSites(sData.items ?? []);
      setSeries(serData.items ?? []);
    });
  }

  const visibleSeries = useMemo(() => {
    const q = query.trim().toLowerCase();
    return series.filter((s) => {
      if (kindFilter !== "all" && documentKindGroup[s.kind] !== kindFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        documentKindLabel[s.kind].toLowerCase().includes(q) ||
        (s.site?.code.toLowerCase().includes(q) ?? false)
      );
    });
  }, [series, kindFilter, query]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: series.length };
    for (const g of kindGroups) map[g] = 0;
    for (const s of series) {
      const g = documentKindGroup[s.kind];
      map[g] = (map[g] ?? 0) + 1;
    }
    return map;
  }, [series]);

  function closeDrawer() {
    setCreating(false);
    setEditing(null);
  }

  function openCreate() {
    setEditing(null);
    setCreating(true);
    setError(null);
    setMessage(null);
  }

  function openEdit(s: Series) {
    setCreating(false);
    setEditing(s);
    setError(null);
    setMessage(null);
  }

  async function onCreateSite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/sites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        name: form.get("name"),
        kind: form.get("kind"),
        parentId: form.get("parentId") || null,
      }),
    });
    const data = (await res.json()) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    (e.target as HTMLFormElement).reset();
    setMessage("Το υποκατάστημα/ταμείο αποθηκεύτηκε");
    await reload();
  }

  async function onSaveSeries(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    setMessage(null);
    const payload = payloadFromForm(new FormData(e.currentTarget));
    const res = editing
      ? await fetch(`/api/document-series/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/document-series", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    const data = (await res.json()) as { error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία αποθήκευσης σειράς");
      return;
    }
    closeDrawer();
    setMessage(editing ? "Η σειρά ενημερώθηκε" : "Η σειρά δημιουργήθηκε");
    await reload();
  }

  const branches = sites.filter((s) => s.kind === "BRANCH");

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
        title="Σειρές & Τύποι"
        description="Αρίθμηση παραστατικών, λογιστικοί λογαριασμοί και κανόνες κινήσεων ανά σειρά."
        actions={
          tab === "series" ? (
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} />
              Νέα σειρά
            </Button>
          ) : null
        }
      />

      <div className="border-b border-slate-200">
        <div className="-mb-px flex gap-6">
          <TabButton
            active={tab === "series"}
            onClick={() => setTab("series")}
            label="Σειρές"
            count={series.length}
          />
          <TabButton
            active={tab === "org"}
            onClick={() => setTab("org")}
            label="Οργάνωση"
            count={sites.length}
          />
        </div>
      </div>

      {message ? (
        <p className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-rose-200/80 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {tab === "series" ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-1.5">
              <FilterChip
                active={kindFilter === "all"}
                onClick={() => setKindFilter("all")}
                label="Όλες"
                count={counts.all ?? 0}
              />
              {kindGroups.map((g) => (
                <FilterChip
                  key={g}
                  active={kindFilter === g}
                  onClick={() => setKindFilter(g)}
                  label={documentKindGroupLabel[g]}
                  count={counts[g] ?? 0}
                />
              ))}
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
            <div className="hidden border-b border-slate-100 bg-slate-50/80 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-500 lg:grid lg:grid-cols-[5.5rem_minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_5rem_minmax(0,1.6fr)_2.5rem] lg:gap-3">
              <span>Κωδικός</span>
              <span>Όνομα</span>
              <span>Τύπος</span>
              <span>Επόμενο</span>
              <span>Τοποθεσία</span>
              <span>Κανόνες</span>
              <span className="sr-only">Ενέργειες</span>
            </div>

            <ul className="divide-y divide-slate-100">
              {visibleSeries.map((s) => {
                const selected = editing?.id === s.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => openEdit(s)}
                      className={cn(
                        "group grid w-full gap-3 px-4 py-3.5 text-left transition",
                        "hover:bg-slate-50/90 focus-visible:bg-slate-50 focus-visible:outline-none",
                        selected && "bg-teal-50/40 hover:bg-teal-50/55",
                        "lg:grid-cols-[5.5rem_minmax(0,1.4fr)_minmax(0,1fr)_8.5rem_5rem_minmax(0,1.6fr)_2.5rem] lg:items-center lg:gap-3 lg:py-3",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 lg:contents">
                        <div className="flex min-w-0 flex-1 flex-col gap-2 lg:contents">
                          <div className="flex flex-wrap items-center gap-2 lg:block">
                            <span className="inline-flex items-center rounded-md bg-ink-950 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-white">
                              {s.code}
                            </span>
                            <div className="flex flex-wrap gap-1 lg:hidden">
                              {s.isDefault ? <Badge tone="teal">Default</Badge> : null}
                              {s.allowPartial ? <Badge tone="amber">Μερική</Badge> : null}
                              {!s.isActive ? <Badge tone="slate">Ανενεργή</Badge> : null}
                            </div>
                          </div>

                          <div className="min-w-0 space-y-1.5">
                            <p className="truncate text-sm font-semibold text-ink-950">
                              {s.name}
                            </p>
                            <div className="hidden flex-wrap gap-1 lg:flex">
                              {s.isDefault ? <Badge tone="teal">Default</Badge> : null}
                              {s.allowPartial ? <Badge tone="amber">Μερική</Badge> : null}
                              {s.myDataEnabled ? (
                                <Badge tone="emerald">
                                  myDATA {s.myDataInvoiceType ?? ""}
                                </Badge>
                              ) : null}
                              {!s.isActive ? <Badge tone="slate">Ανενεργή</Badge> : null}
                            </div>
                          </div>

                          <div className="space-y-0.5 lg:min-w-0">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                              Τύπος
                            </p>
                            <p className="text-sm text-slate-700 lg:truncate">
                              {documentKindLabel[s.kind]}
                            </p>
                            {s.myDataEnabled ? (
                              <p className="text-[11px] text-emerald-700 lg:hidden">
                                myDATA {s.myDataInvoiceType ?? ""}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-0.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                              Επόμενο
                            </p>
                            <p className="inline-flex items-center gap-1.5 font-mono text-[12px] text-ink-800">
                              <Hash size={12} className="shrink-0 text-slate-400" />
                              {s.previewNumber}
                            </p>
                          </div>

                          <div className="space-y-0.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                              Τοποθεσία
                            </p>
                            <p className="text-sm text-slate-600">
                              {s.site?.code ?? "—"}
                            </p>
                          </div>

                          <div className="space-y-1.5 lg:min-w-0">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400 lg:hidden">
                              Κανόνες
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              <MetaChip
                                label="Πελάτης"
                                value={customerEffectLabel[s.affectsCustomer]}
                              />
                              <MetaChip
                                label="Αποθήκη"
                                value={inventoryEffectLabel[s.affectsInventory]}
                              />
                              {s.glDebitAccount || s.glCreditAccount ? (
                                <MetaChip
                                  label="Λογ."
                                  value={`${s.glDebitAccount ?? "—"}${s.glCreditAccount ? ` / ${s.glCreditAccount}` : ""}`}
                                  mono
                                />
                              ) : null}
                            </div>
                          </div>
                        </div>

                        <span
                          className={cn(
                            "inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-slate-400 transition",
                            "group-hover:border-slate-200 group-hover:bg-white group-hover:text-ink-800 group-hover:shadow-sm",
                            "lg:justify-self-end",
                          )}
                          aria-hidden
                        >
                          <Pencil size={14} />
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
              {visibleSeries.length === 0 ? (
                <li className="px-4 py-16 text-center">
                  <p className="text-sm font-medium text-ink-900">
                    Δεν βρέθηκαν σειρές
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Δοκιμάστε άλλο φίλτρο ή δημιουργήστε νέα σειρά.
                  </p>
                </li>
              ) : null}
            </ul>
          </section>
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-950">
                Υποκαταστήματα & ταμεία
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Δέσμευση σειρών ανά τοποθεσία της εταιρείας.
              </p>
            </div>
            <ul className="divide-y divide-slate-100">
              {sites.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-4 py-3.5"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div
                      className={cn(
                        "mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl",
                        s.kind === "TILL"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-teal-50 text-teal-700",
                      )}
                    >
                      <Building2 size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ink-900">
                        <span className="font-mono text-[12px] text-slate-500">
                          {s.code}
                        </span>
                        <span className="mx-1.5 text-slate-300">·</span>
                        {s.name}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {s.kind === "BRANCH" ? "Υποκατάστημα" : "Ταμείο"}
                        {s.parentId
                          ? ` · κάτω από ${sites.find((p) => p.id === s.parentId)?.code ?? "—"}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <Badge tone={s.kind === "TILL" ? "amber" : "teal"}>
                    {s.kind === "BRANCH" ? "Υποκ." : "Ταμείο"}
                  </Badge>
                </li>
              ))}
              {sites.length === 0 ? (
                <li className="px-4 py-12 text-center text-sm text-slate-500">
                  Δεν έχουν οριστεί τοποθεσίες
                </li>
              ) : null}
            </ul>
          </section>

          <form
            onSubmit={onCreateSite}
            className="h-fit space-y-3 rounded-2xl border border-slate-200/90 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-5"
          >
            <div>
              <h2 className="text-sm font-semibold text-ink-950">Νέα τοποθεσία</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Προσθήκη υποκαταστήματος ή ταμείου.
              </p>
            </div>
            <input
              name="code"
              required
              placeholder="Κωδικός *"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
            <input
              name="name"
              required
              placeholder="Όνομα *"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
            />
            <select
              name="kind"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              defaultValue="BRANCH"
            >
              <option value="BRANCH">Υποκατάστημα</option>
              <option value="TILL">Ταμείο</option>
            </select>
            <select
              name="parentId"
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              defaultValue=""
            >
              <option value="">Χωρίς parent</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={pending} className="h-11 w-full">
              Προσθήκη
            </Button>
          </form>
        </div>
      )}

      {drawerOpen ? (
        <SeriesDrawer
          key={editing?.id ?? "new"}
          title={editing ? `Επεξεργασία ${editing.code}` : "Νέα σειρά"}
          sites={sites}
          initial={editing}
          pending={pending}
          onSubmit={onSaveSeries}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}

function MetaChip({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full items-baseline gap-1 rounded-md border border-slate-200/90 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-600">
      <span className="shrink-0 font-medium text-slate-400">{label}</span>
      <span className={cn("truncate text-ink-800", mono && "font-mono")}>{value}</span>
    </span>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative pb-3 text-sm font-medium transition",
        active ? "text-ink-950" : "text-slate-500 hover:text-ink-800",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1.5 tabular-nums",
          active ? "text-teal-700" : "text-slate-400",
        )}
      >
        {count}
      </span>
      {active ? (
        <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-teal-600" />
      ) : null}
    </button>
  );
}

function FilterChip({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition",
        active
          ? "border-ink-900 bg-ink-900 text-white"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink-900",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1 tabular-nums",
          active ? "text-white/70" : "text-slate-400",
        )}
      >
        {count}
      </span>
    </button>
  );
}

function SeriesDrawer({
  title,
  sites,
  initial,
  pending,
  onSubmit,
  onClose,
}: {
  title: string;
  sites: Site[];
  initial: Series | null;
  pending: boolean;
  onSubmit: (e: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/40">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="series-drawer-title"
        className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl animate-fade-in"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 id="series-drawer-title" className="text-lg font-semibold text-ink-950">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
            aria-label="Κλείσιμο"
          >
            <X size={18} />
          </button>
        </div>

        <form
          onSubmit={onSubmit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            <Section title="Βασικά">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  name="code"
                  label="Κωδικός *"
                  required
                  defaultValue={initial?.code}
                />
                <Field
                  name="name"
                  label="Όνομα *"
                  required
                  defaultValue={initial?.name}
                />
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1.5 block font-medium">Τύπος</span>
                  <select
                    name="kind"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3"
                    defaultValue={initial?.kind ?? "SALES_INVOICE"}
                  >
                    {kindsByGroup.map(({ group, label, kinds: groupKinds }) => (
                      <optgroup key={group} label={label}>
                        {groupKinds.map((k) => (
                          <option key={k} value={k}>
                            {documentKindLabel[k]}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              </div>
            </Section>

            <Section title="Αρίθμηση">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  name="prefix"
                  label="Πρόθεμα *"
                  required
                  placeholder="ΤΙΜ-{YYYY}-"
                  defaultValue={initial?.prefix}
                />
                <Field
                  name="nextNumber"
                  label="Επόμενος αριθμός"
                  type="number"
                  defaultValue={String(initial?.nextNumber ?? 1)}
                />
                <Field
                  name="padLength"
                  label="Ψηφία"
                  type="number"
                  defaultValue={String(initial?.padLength ?? 5)}
                />
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Reset</span>
                  <select
                    name="resetPolicy"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3"
                    defaultValue={initial?.resetPolicy ?? "YEARLY"}
                  >
                    <option value="YEARLY">Ανά έτος</option>
                    <option value="NEVER">Ποτέ</option>
                  </select>
                </label>
              </div>
            </Section>

            <Section title="Οργάνωση & κινήσεις">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1.5 block font-medium">
                    Υποκατάστημα / ταμείο
                  </span>
                  <select
                    name="siteId"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3"
                    defaultValue={initial?.siteId ?? ""}
                  >
                    <option value="">— Χωρίς δέσμευση —</option>
                    {sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name} (
                        {s.kind === "BRANCH" ? "υποκ." : "ταμείο"})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Κίνηση πελάτη</span>
                  <select
                    name="affectsCustomer"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3"
                    defaultValue={initial?.affectsCustomer ?? "DEBIT"}
                  >
                    {Object.entries(customerEffectLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Κίνηση αποθήκης</span>
                  <select
                    name="affectsInventory"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3"
                    defaultValue={initial?.affectsInventory ?? "OUT"}
                  >
                    {Object.entries(inventoryEffectLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </Section>

            <Section title="myDATA & λογιστικά">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1.5 block font-medium">Τύπος myDATA</span>
                  <select
                    name="myDataInvoiceType"
                    className="h-11 w-full rounded-xl border border-slate-200 px-3"
                    defaultValue={initial?.myDataInvoiceType ?? ""}
                  >
                    <option value="">—</option>
                    {MYDATA_INVOICE_TYPES.map((t) => (
                      <option key={t.code} value={t.code}>
                        {t.code} · {t.label}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  name="glDebitAccount"
                  label="Λογαριασμός χρέωσης"
                  placeholder="30.00.00"
                  defaultValue={initial?.glDebitAccount ?? ""}
                />
                <Field
                  name="glCreditAccount"
                  label="Λογαριασμός πίστωσης"
                  placeholder="70.00.00"
                  defaultValue={initial?.glCreditAccount ?? ""}
                />
                <Field
                  name="glVatAccount"
                  label="Λογαριασμός ΦΠΑ"
                  placeholder="54.00.00"
                  defaultValue={initial?.glVatAccount ?? ""}
                />
              </div>
            </Section>

            <Section title="Επιλογές">
              <div className="flex flex-col gap-2.5 text-sm">
                <Check
                  name="allowPartial"
                  label="Επιτρέπει μερική εκτέλεση / τιμολόγηση"
                  defaultChecked={initial?.allowPartial ?? false}
                />
                <Check
                  name="myDataEnabled"
                  label="Ενεργό myDATA"
                  defaultChecked={initial?.myDataEnabled ?? true}
                />
                <Check
                  name="isDefault"
                  label="Προεπιλογή για τον τύπο"
                  defaultChecked={initial?.isDefault ?? false}
                />
                <Check
                  name="isActive"
                  label="Ενεργή σειρά"
                  defaultChecked={initial?.isActive ?? true}
                />
              </div>
            </Section>
          </div>

          <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
            <Button type="submit" disabled={pending} className="flex-1">
              {pending ? "Αποθήκευση..." : "Αποθήκευση"}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Ακύρωση
            </Button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  required,
  placeholder,
  defaultValue,
  type = "text",
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string | null;
  type?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium">{label}</span>
      <input
        name={name}
        required={required}
        type={type}
        min={type === "number" ? 1 : undefined}
        placeholder={placeholder}
        defaultValue={defaultValue ?? ""}
        className="h-11 w-full rounded-xl border border-slate-200 px-3 outline-none ring-teal-500/30 focus:ring-2"
      />
    </label>
  );
}

function Check({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="inline-flex items-center gap-2.5">
      <input
        type="checkbox"
        name={name}
        defaultChecked={defaultChecked}
        className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
      />
      {label}
    </label>
  );
}
