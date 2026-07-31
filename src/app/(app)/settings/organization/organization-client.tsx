"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type OrgSettings = {
  legalName: string | null;
  tradeName: string | null;
  vatNumber: string | null;
  taxOffice: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  logoUrl: string | null;
  currency: string;
  locale: string;
  timezone: string;
  maintenanceMode: boolean;
};

const inputClass =
  "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500";

export function OrganizationClient({
  tenant,
  initial,
  canWrite,
}: {
  tenant: { slug: string; name: string };
  initial: OrgSettings;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: initial.legalName ?? tenant.name,
    tradeName: initial.tradeName ?? "",
    vatNumber: initial.vatNumber ?? "",
    taxOffice: initial.taxOffice ?? "",
    address: initial.address ?? "",
    city: initial.city ?? "",
    postalCode: initial.postalCode ?? "",
    country: initial.country || "GR",
    phone: initial.phone ?? "",
    email: initial.email ?? "",
    website: initial.website ?? "",
    logoUrl: initial.logoUrl ?? "",
    currency: initial.currency || "EUR",
    locale: initial.locale || "el-GR",
    timezone: initial.timezone || "Europe/Athens",
    maintenanceMode: initial.maintenanceMode,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function set<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/organization", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          email: form.email || null,
          logoUrl: form.logoUrl || null,
          website: form.website || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setMessage("Οι ρυθμίσεις αποθηκεύτηκαν");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/settings" className="text-teal-700 hover:underline">
          ← Ρυθμίσεις
        </Link>
        <span className="text-slate-400">·</span>
        <span className="font-mono text-xs text-slate-500">{tenant.slug}</span>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <section className="soft-panel space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-950">Ταυτότητα</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-600">
            Επωνυμία *
            <input
              required
              disabled={!canWrite}
              value={form.legalName}
              onChange={(e) => set("legalName", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Διακριτικός τίτλος
            <input
              disabled={!canWrite}
              value={form.tradeName}
              onChange={(e) => set("tradeName", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            ΑΦΜ
            <input
              disabled={!canWrite}
              value={form.vatNumber}
              onChange={(e) => set("vatNumber", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            ΔΟΥ
            <input
              disabled={!canWrite}
              value={form.taxOffice}
              onChange={(e) => set("taxOffice", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600 sm:col-span-2">
            URL λογοτύπου
            <input
              disabled={!canWrite}
              type="url"
              placeholder="https://…"
              value={form.logoUrl}
              onChange={(e) => set("logoUrl", e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <section className="soft-panel space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-950">Επικοινωνία</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs text-slate-600 sm:col-span-2">
            Διεύθυνση
            <input
              disabled={!canWrite}
              value={form.address}
              onChange={(e) => set("address", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Πόλη
            <input
              disabled={!canWrite}
              value={form.city}
              onChange={(e) => set("city", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Τ.Κ.
            <input
              disabled={!canWrite}
              value={form.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Χώρα
            <input
              disabled={!canWrite}
              value={form.country}
              onChange={(e) => set("country", e.target.value.toUpperCase())}
              className={inputClass}
              maxLength={2}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Τηλέφωνο
            <input
              disabled={!canWrite}
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Email
            <input
              disabled={!canWrite}
              type="email"
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block text-xs text-slate-600">
            Website
            <input
              disabled={!canWrite}
              value={form.website}
              onChange={(e) => set("website", e.target.value)}
              className={inputClass}
            />
          </label>
        </div>
      </section>

      <section className="soft-panel space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-950">
          Τοπικοποίηση & λειτουργίες
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block text-xs text-slate-600">
            Νόμισμα
            <select
              disabled={!canWrite}
              value={form.currency}
              onChange={(e) => set("currency", e.target.value)}
              className={inputClass}
            >
              <option value="EUR">EUR — Ευρώ</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Γλώσσα / locale
            <select
              disabled={!canWrite}
              value={form.locale}
              onChange={(e) => set("locale", e.target.value)}
              className={inputClass}
            >
              <option value="el-GR">Ελληνικά (el-GR)</option>
              <option value="en-GB">English (en-GB)</option>
            </select>
          </label>
          <label className="block text-xs text-slate-600">
            Timezone
            <select
              disabled={!canWrite}
              value={form.timezone}
              onChange={(e) => set("timezone", e.target.value)}
              className={inputClass}
            >
              <option value="Europe/Athens">Europe/Athens</option>
              <option value="UTC">UTC</option>
              <option value="Europe/London">Europe/London</option>
            </select>
          </label>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm">
          <input
            type="checkbox"
            disabled={!canWrite}
            checked={form.maintenanceMode}
            onChange={(e) => set("maintenanceMode", e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-ink-900">Maintenance mode</span>
            <span className="mt-0.5 block text-slate-600">
              Εμφανίζει ειδοποίηση συντήρησης στους μη-διαχειριστές. Οι OWNER /
              ADMIN συνεχίζουν κανονικά.
            </span>
          </span>
        </label>
      </section>

      {canWrite ? (
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="h-10 rounded-xl bg-teal-600 px-5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {busy ? "Αποθήκευση…" : "Αποθήκευση"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-slate-500">
          Μόνο ADMIN / OWNER μπορούν να επεξεργαστούν αυτές τις ρυθμίσεις.
        </p>
      )}
    </form>
  );
}
