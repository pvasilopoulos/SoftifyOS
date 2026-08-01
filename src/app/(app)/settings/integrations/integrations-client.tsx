"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Integrations = {
  webhookUrl: string;
  webhookSecretHint: string;
  skroutzEnabled: boolean;
  myDataEnv: "simulator" | "test" | "prod";
  myDataUserId: string;
  myDataSubscriptionKey: string;
  hasMyDataSubscriptionKey: boolean;
  notes: string;
};

export function IntegrationsClient({
  initial,
  endpoints,
  canWrite,
}: {
  initial: Integrations;
  endpoints: Record<string, string>;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookUrl: form.webhookUrl || null,
          webhookSecretHint: form.webhookSecretHint || null,
          skroutzEnabled: form.skroutzEnabled,
          myDataEnv: form.myDataEnv,
          myDataUserId: form.myDataUserId || null,
          myDataSubscriptionKey:
            form.myDataSubscriptionKey.trim() ||
            (form.hasMyDataSubscriptionKey ? undefined : null),
          notes: form.notes || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Αποτυχία");
      setMessage(
        form.myDataEnv === "simulator"
          ? "Οι integrations αποθηκεύτηκαν (simulator)"
          : "Οι integrations αποθηκεύτηκαν — live AADE ενεργό όταν υπάρχουν credentials",
      );
      setForm((f) => ({
        ...f,
        myDataSubscriptionKey: "",
        hasMyDataSubscriptionKey: Boolean(
          data.integrations?.hasMyDataSubscriptionKey ??
            (f.hasMyDataSubscriptionKey || Boolean(form.myDataSubscriptionKey)),
        ),
      }));
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Σφάλμα");
    } finally {
      setBusy(false);
    }
  }

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50";

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="text-sm">
        <Link href="/settings" className="text-teal-700 hover:underline">
          ← Ρυθμίσεις
        </Link>
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
        <h2 className="text-sm font-semibold text-ink-950">Webhooks</h2>
        <label className="block text-xs text-slate-600">
          Webhook URL
          <input
            disabled={!canWrite}
            type="url"
            placeholder="https://hooks.example.com/softifyos"
            value={form.webhookUrl}
            onChange={(e) =>
              setForm((f) => ({ ...f, webhookUrl: e.target.value }))
            }
            className={inputClass}
          />
        </label>
        <label className="block text-xs text-slate-600">
          Secret hint (όχι το πραγματικό secret)
          <input
            disabled={!canWrite}
            value={form.webhookSecretHint}
            onChange={(e) =>
              setForm((f) => ({ ...f, webhookSecretHint: e.target.value }))
            }
            className={inputClass}
            placeholder="π.χ. vault:webhook-prod"
          />
        </label>
      </section>

      <section className="soft-panel space-y-4 p-5">
        <h2 className="text-sm font-semibold text-ink-950">myDATA / ΑΑΔΕ</h2>
        <p className="text-xs text-slate-500">
          Test/Prod καλούν πραγματικά το SendInvoices της ΑΑΔΕ (XML + headers).
          Απαιτούνται user id &amp; subscription key από το myDATA REST API registry.
        </p>
        <label className="block text-xs text-slate-600">
          Περιβάλλον
          <select
            disabled={!canWrite}
            value={form.myDataEnv}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                myDataEnv: e.target.value as Integrations["myDataEnv"],
              }))
            }
            className={inputClass}
          >
            <option value="simulator">Simulator (τοπικό)</option>
            <option value="test">AADE Test (mydataapidev)</option>
            <option value="prod">AADE Production (mydatapi)</option>
          </select>
        </label>
        <label className="block text-xs text-slate-600">
          aade-user-id
          <input
            disabled={!canWrite}
            value={form.myDataUserId}
            onChange={(e) =>
              setForm((f) => ({ ...f, myDataUserId: e.target.value }))
            }
            className={inputClass}
            autoComplete="off"
            placeholder="username από ΑΑΔΕ registry"
          />
        </label>
        <label className="block text-xs text-slate-600">
          ocp-apim-subscription-key
          <input
            disabled={!canWrite}
            type="password"
            value={form.myDataSubscriptionKey}
            onChange={(e) =>
              setForm((f) => ({ ...f, myDataSubscriptionKey: e.target.value }))
            }
            className={inputClass}
            autoComplete="new-password"
            placeholder={
              form.hasMyDataSubscriptionKey
                ? "Αποθηκευμένο — άφησε κενό για διατήρηση"
                : "subscription key"
            }
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            disabled={!canWrite}
            checked={form.skroutzEnabled}
            onChange={(e) =>
              setForm((f) => ({ ...f, skroutzEnabled: e.target.checked }))
            }
          />
          Skroutz / marketplace sync (μέσω Script Hooks)
        </label>
        <label className="block text-xs text-slate-600">
          Σημειώσεις
          <textarea
            disabled={!canWrite}
            rows={3}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            className={inputClass}
          />
        </label>
      </section>

      <section className="soft-panel space-y-3 p-5">
        <h2 className="text-sm font-semibold text-ink-950">
          Διαθέσιμα API endpoints
        </h2>
        <ul className="space-y-2 text-sm">
          {Object.entries(endpoints).map(([key, path]) => (
            <li
              key={key}
              className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"
            >
              <span className="text-slate-600">{key}</span>
              <code className="font-mono text-xs text-ink-900">{path}</code>
            </li>
          ))}
        </ul>
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
      ) : null}
    </form>
  );
}
