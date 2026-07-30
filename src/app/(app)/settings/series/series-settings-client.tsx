"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  customerEffectLabel,
  documentKindLabel,
  inventoryEffectLabel,
} from "@/modules/documents/series";
import { MYDATA_INVOICE_TYPES } from "@/modules/documents/schemas";

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
  kind: keyof typeof documentKindLabel;
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

const kinds = Object.keys(documentKindLabel) as Array<
  keyof typeof documentKindLabel
>;

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
  const [sites, setSites] = useState(initialSites);
  const [series, setSeries] = useState(initialSeries);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<Series | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [, startTransition] = useTransition();

  const formOpen = creating || editing !== null;

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

  const grouped = useMemo(() => {
    const map = new Map<string, Series[]>();
    for (const k of kinds) map.set(k, []);
    for (const s of series) {
      const list = map.get(s.kind) ?? [];
      list.push(s);
      map.set(s.kind, list);
    }
    return map;
  }, [series]);

  function closeForm() {
    setCreating(false);
    setEditing(null);
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
      setError(data.error || "Αποτυχία site");
      return;
    }
    (e.target as HTMLFormElement).reset();
    setMessage("Το site αποθηκεύτηκε");
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
    closeForm();
    setMessage(editing ? "Η σειρά ενημερώθηκε" : "Η σειρά αποθηκεύτηκε");
    await reload();
  }

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Ρυθμίσεις
      </Link>
      <PageHeader
        title="Σειρές & Τύποι"
        description="Αρίθμηση, υποκατάστημα/ταμείο, κινήσεις, myDATA, λογιστικά άρθρα."
        actions={
          <Button
            size="sm"
            onClick={() => {
              setEditing(null);
              setCreating(true);
            }}
          >
            <Plus size={15} />
            Νέα σειρά
          </Button>
        }
      />

      {message ? (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <section className="soft-panel space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-950">
          Υποκαταστήματα & ταμεία εταιρείας
        </h2>
        <ul className="divide-y divide-slate-100 text-sm">
          {sites.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2">
              <div>
                <p className="font-medium text-ink-900">
                  {s.code} — {s.name}
                </p>
                <p className="text-xs text-slate-500">
                  {s.kind === "BRANCH" ? "Υποκατάστημα" : "Ταμείο"}
                </p>
              </div>
              <Badge tone={s.kind === "TILL" ? "amber" : "teal"}>{s.kind}</Badge>
            </li>
          ))}
        </ul>
        <form
          onSubmit={onCreateSite}
          className="grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-4"
        >
          <input
            name="code"
            required
            placeholder="Κωδικός"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            name="name"
            required
            placeholder="Όνομα"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <select
            name="kind"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            defaultValue="BRANCH"
          >
            <option value="BRANCH">Υποκατάστημα</option>
            <option value="TILL">Ταμείο</option>
          </select>
          <Button type="submit" disabled={pending} size="sm">
            Προσθήκη site
          </Button>
        </form>
      </section>

      {formOpen ? (
        <SeriesForm
          key={editing?.id ?? "new"}
          title={editing ? `Επεξεργασία · ${editing.code}` : "Νέα σειρά"}
          sites={sites}
          initial={editing}
          pending={pending}
          onSubmit={onSaveSeries}
          onClose={closeForm}
        />
      ) : null}

      {kinds.map((kind) => {
        const rows = grouped.get(kind) ?? [];
        return (
          <section key={kind} className="soft-panel overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-ink-950">
                {documentKindLabel[kind]}
              </h2>
            </div>
            <ul className="divide-y divide-slate-100">
              {rows.map((s) => (
                <li key={s.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink-950">
                        {s.code} — {s.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        Επόμενο:{" "}
                        <span className="font-mono">{s.previewNumber}</span>
                        {s.site ? ` · ${s.site.code}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {s.isDefault ? <Badge tone="teal">Default</Badge> : null}
                      {s.allowPartial ? (
                        <Badge tone="amber">Μερική</Badge>
                      ) : null}
                      {s.myDataEnabled ? (
                        <Badge tone="emerald">
                          myDATA {s.myDataInvoiceType ?? ""}
                        </Badge>
                      ) : null}
                      {!s.isActive ? (
                        <Badge tone="slate">Ανενεργή</Badge>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        aria-label={`Επεξεργασία ${s.code}`}
                        onClick={() => {
                          setCreating(false);
                          setEditing(s);
                          setMessage(null);
                          setError(null);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <Pencil size={14} />
                        Edit
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-slate-500">
                    Πελάτης: {customerEffectLabel[s.affectsCustomer]} · Αποθήκη:{" "}
                    {inventoryEffectLabel[s.affectsInventory]}
                    {s.glDebitAccount
                      ? ` · Λογ. ${s.glDebitAccount}/${s.glCreditAccount ?? "—"}/${s.glVatAccount ?? "—"}`
                      : ""}
                  </p>
                </li>
              ))}
              {rows.length === 0 ? (
                <li className="px-4 py-6 text-sm text-slate-500">Καμία σειρά</li>
              ) : null}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function SeriesForm({
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
    <form
      onSubmit={onSubmit}
      className="soft-panel space-y-4 border border-teal-200 p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold text-ink-950">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
          aria-label="Κλείσιμο"
        >
          <X size={16} />
        </button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Κωδικός *</span>
          <input
            name="code"
            required
            defaultValue={initial?.code ?? ""}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Όνομα *</span>
          <input
            name="name"
            required
            defaultValue={initial?.name ?? ""}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Τύπος</span>
          <select
            name="kind"
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
            defaultValue={initial?.kind ?? "SALES_INVOICE"}
          >
            {kinds.map((k) => (
              <option key={k} value={k}>
                {documentKindLabel[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Πρόθεμα *</span>
          <input
            name="prefix"
            required
            placeholder="ΤΙΜ-{YYYY}-"
            defaultValue={initial?.prefix ?? ""}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Επόμενος αριθμός</span>
          <input
            name="nextNumber"
            type="number"
            min={1}
            defaultValue={initial?.nextNumber ?? 1}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Ψηφία (pad)</span>
          <input
            name="padLength"
            type="number"
            min={3}
            max={10}
            defaultValue={initial?.padLength ?? 5}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Reset αρίθμησης</span>
          <select
            name="resetPolicy"
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
            defaultValue={initial?.resetPolicy ?? "YEARLY"}
          >
            <option value="YEARLY">Ανά έτος</option>
            <option value="NEVER">Ποτέ</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Site</span>
          <select
            name="siteId"
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
            defaultValue={initial?.siteId ?? ""}
          >
            <option value="">— Όλα / χωρίς —</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} — {s.name}
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
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">myDATA τύπος</span>
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
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Λογ. χρέωση</span>
          <input
            name="glDebitAccount"
            placeholder="30.00.00"
            defaultValue={initial?.glDebitAccount ?? ""}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Λογ. πίστωση</span>
          <input
            name="glCreditAccount"
            placeholder="70.00.00"
            defaultValue={initial?.glCreditAccount ?? ""}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1.5 block font-medium">Λογ. ΦΠΑ</span>
          <input
            name="glVatAccount"
            placeholder="54.00.00"
            defaultValue={initial?.glVatAccount ?? ""}
            className="h-11 w-full rounded-xl border border-slate-200 px-3"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="allowPartial"
            defaultChecked={initial?.allowPartial ?? false}
          />{" "}
          Μερική εκτέλεση/τιμολόγηση
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="myDataEnabled"
            defaultChecked={initial?.myDataEnabled ?? true}
          />{" "}
          myDATA
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="isDefault"
            defaultChecked={initial?.isDefault ?? false}
          />{" "}
          Default τύπου
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="checkbox"
            name="isActive"
            defaultChecked={initial?.isActive ?? true}
          />{" "}
          Ενεργή
        </label>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Αποθήκευση..." : "Αποθήκευση"}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Ακύρωση
        </Button>
      </div>
    </form>
  );
}
