"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  BookOpen,
  Cable,
  ChevronDown,
  Copy,
  KeyRound,
  Landmark,
  LayoutDashboard,
  Link2,
  ShieldCheck,
  Store,
  Webhook,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  WEBHOOK_EVENTS,
  type IntegrationTestResult,
  type MyDataEnv,
  type WebhookEventKey,
} from "@/modules/integrations/types";
import type { ApiEndpointDoc } from "@/modules/integrations/api-catalog";
import {
  MarketplaceChannelsPanel,
  type MarketplaceChannelItem,
} from "./marketplace-channels-panel";

type Section =
  | "overview"
  | "webhooks"
  | "mydata"
  | "marketplaces"
  | "developer"
  | "logs";

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  active: boolean;
};

type LogRow = {
  id: string;
  action: string;
  entity: string | null;
  createdAt: string;
  message: string;
  userName: string | null;
  ok: boolean | null;
};

type FormState = {
  webhookUrl: string;
  webhookSecretHint: string;
  webhookEnabled: boolean;
  webhookEvents: WebhookEventKey[];
  hasWebhookSecret: boolean;
  skroutzEnabled: boolean;
  skroutzShopId: string;
  marketplaceNotes: string;
  myDataEnv: MyDataEnv;
  myDataUserId: string;
  myDataSubscriptionKey: string;
  hasMyDataSubscriptionKey: boolean;
  myDataSubscriptionKeyHint: string;
  notes: string;
  erganiEnv: MyDataEnv;
  lastWebhookTest: IntegrationTestResult | null;
  lastMyDataTest: IntegrationTestResult | null;
};

const NAV: Array<{
  group: string;
  items: Array<{ id: Section; label: string; icon: typeof Webhook }>;
}> = [
  {
    group: "Επισκόπηση",
    items: [{ id: "overview", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    group: "Δίαυλοι",
    items: [
      { id: "webhooks", label: "Webhooks", icon: Webhook },
      { id: "mydata", label: "myDATA / ΑΑΔΕ", icon: Landmark },
      { id: "marketplaces", label: "Marketplaces", icon: Store },
    ],
  },
  {
    group: "Platform",
    items: [
      { id: "developer", label: "API endpoints", icon: KeyRound },
      { id: "logs", label: "Monitor / Logs", icon: Activity },
    ],
  },
];

function copyText(value: string) {
  void navigator.clipboard?.writeText(value);
}

export function IntegrationsHubClient({
  canWrite,
  initial,
  tokens: initialTokens,
  status,
  logs: initialLogs,
  endpoints,
  marketplaceChannels: initialChannels,
}: {
  canWrite: boolean;
  initial: FormState;
  tokens: TokenRow[];
  status: {
    pendingMyData: number;
    myDataAccepted: number;
    myDataRejected: number;
    myDataTotal: number;
    activeTokens: number;
  };
  logs: LogRow[];
  endpoints: ApiEndpointDoc[];
  marketplaceChannels: MarketplaceChannelItem[];
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("overview");
  const [form, setForm] = useState(initial);
  const [tokens, setTokens] = useState(initialTokens);
  const [logs, setLogs] = useState(initialLogs);
  const [marketplaceChannels, setMarketplaceChannels] =
    useState(initialChannels);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [newTokenSecret, setNewTokenSecret] = useState<string | null>(null);
  const [tokenName, setTokenName] = useState("ERP Integration");
  const [testBusy, setTestBusy] = useState<"webhook" | "mydata" | null>(null);
  const [openEndpoint, setOpenEndpoint] = useState<string | null>(
    endpoints[0]?.key ?? null,
  );

  const readiness = useMemo(() => {
    const items = [
      {
        label: "Webhook",
        ok: Boolean(form.webhookUrl) && form.webhookEnabled,
        detail: form.lastWebhookTest
          ? form.lastWebhookTest.ok
            ? "τελευταίο test OK"
            : "τελευταίο test FAILED"
          : form.webhookUrl
            ? "χωρίς test"
            : "μη ρυθμισμένο",
      },
      {
        label: "myDATA",
        ok:
          form.myDataEnv === "simulator" ||
          (form.hasMyDataSubscriptionKey && Boolean(form.myDataUserId)),
        detail:
          form.myDataEnv === "simulator"
            ? "simulator"
            : form.hasMyDataSubscriptionKey
              ? form.myDataEnv
              : "λείπουν credentials",
      },
      {
        label: "API tokens",
        ok: tokens.some((t) => t.active),
        detail: `${tokens.filter((t) => t.active).length} ενεργά`,
      },
      {
        label: "Marketplace",
        ok: marketplaceChannels.some(
          (c) => c.status === "ACTIVE" && c.isActive,
        ),
        detail: (() => {
          const active = marketplaceChannels.filter(
            (c) => c.status === "ACTIVE" && c.isActive,
          ).length;
          if (active > 0) return `${active} ενεργά κανάλια`;
          if (marketplaceChannels.length > 0) {
            return `${marketplaceChannels.length} κανάλια (χωρίς ACTIVE)`;
          }
          return "κανένα κανάλι";
        })(),
      },
    ];
    return items;
  }, [form, tokens, marketplaceChannels]);

  const save = (extra?: Record<string, unknown>) => {
    if (!canWrite) return;
    startTransition(() => {
      void (async () => {
        setError(null);
        setMessage(null);
        const res = await fetch("/api/settings/integrations", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webhookUrl: form.webhookUrl || null,
            webhookSecretHint: form.webhookSecretHint || null,
            webhookEnabled: form.webhookEnabled,
            webhookEvents: form.webhookEvents,
            skroutzEnabled: form.skroutzEnabled,
            skroutzShopId: form.skroutzShopId || null,
            marketplaceNotes: form.marketplaceNotes || null,
            myDataEnv: form.myDataEnv,
            myDataUserId: form.myDataUserId || null,
            myDataSubscriptionKey:
              form.myDataSubscriptionKey.trim() || undefined,
            notes: form.notes || null,
            erganiEnv: form.erganiEnv,
            ...extra,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(data.error || "Αποτυχία αποθήκευσης");
          return;
        }
        if (data.webhookSecret) {
          setRevealedSecret(data.webhookSecret);
          setForm((f) => ({
            ...f,
            hasWebhookSecret: true,
            webhookSecretHint: data.integrations?.webhookSecretHint ?? f.webhookSecretHint,
          }));
          setMessage("Νέο webhook secret — αντέγραψέ το τώρα (εμφανίζεται μία φορά)");
        } else {
          setMessage(
            form.myDataEnv === "simulator"
              ? "Integrations αποθηκεύτηκαν (simulator)"
              : "Integrations αποθηκεύτηκαν — live AADE όταν υπάρχουν credentials",
          );
        }
        setForm((f) => ({
          ...f,
          myDataSubscriptionKey: "",
          hasMyDataSubscriptionKey: Boolean(
            data.integrations?.hasMyDataSubscriptionKey ??
              f.hasMyDataSubscriptionKey,
          ),
          myDataSubscriptionKeyHint:
            data.integrations?.myDataSubscriptionKeyHint ??
            f.myDataSubscriptionKeyHint,
        }));
        if (data.integrations?.apiTokens) {
          setTokens(data.integrations.apiTokens);
        }
        router.refresh();
      })();
    });
  };

  const runTest = (target: "webhook" | "mydata") => {
    if (!canWrite) return;
    setTestBusy(target);
    setError(null);
    setMessage(null);
    void (async () => {
      try {
        const res = await fetch("/api/settings/integrations/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Αποτυχία test");
          return;
        }
        const result = data.result as IntegrationTestResult;
        if (target === "webhook") {
          setForm((f) => ({ ...f, lastWebhookTest: result }));
        } else {
          setForm((f) => ({ ...f, lastMyDataTest: result }));
        }
        setMessage(result.message);
        setLogs((prev) => [
          {
            id: `local-${Date.now()}`,
            action:
              target === "webhook"
                ? "integrations.webhook_test"
                : "integrations.mydata_test",
            entity: "tenant_settings",
            createdAt: result.at,
            message: result.message,
            userName: "εσύ",
            ok: result.ok,
          },
          ...prev,
        ]);
      } catch {
        setError("Αποτυχία test");
      } finally {
        setTestBusy(null);
      }
    })();
  };

  const createToken = () => {
    if (!canWrite || !tokenName.trim()) return;
    startTransition(() => {
      void (async () => {
        setError(null);
        const res = await fetch("/api/settings/integrations/tokens", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: tokenName.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Αποτυχία δημιουργίας token");
          return;
        }
        setTokens((prev) => [data.token, ...prev]);
        setNewTokenSecret(data.secret);
        setMessage("API token δημιουργήθηκε — αντέγραψέ το τώρα");
      })();
    });
  };

  const revokeToken = (id: string) => {
    if (!canWrite) return;
    startTransition(() => {
      void (async () => {
        const res = await fetch("/api/settings/integrations/tokens", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, action: "revoke" }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Αποτυχία revoke");
          return;
        }
        setTokens((prev) =>
          prev.map((t) => (t.id === id ? { ...data.token } : t)),
        );
        setMessage("Token revoked");
      })();
    });
  };

  const inputClass =
    "mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-50";

  return (
    <div className="int-hub space-y-5">
      <style jsx global>{`
        .int-hub {
          --int-ink: #0b1f33;
          --int-accent: #0f766e;
        }
        .int-hero {
          background:
            radial-gradient(800px 260px at 0% 0%, rgba(15, 118, 110, 0.14), transparent 55%),
            radial-gradient(700px 220px at 100% 0%, rgba(30, 64, 175, 0.08), transparent 50%),
            linear-gradient(180deg, #eef5f7 0%, #f8fafc 72%);
          border: 1px solid rgba(15, 118, 110, 0.12);
        }
      `}</style>

      <div className="int-hero rounded-[1.75rem] px-5 py-5 sm:px-6">
        <div className="mb-3 text-sm">
          <Link href="/settings" className="text-teal-800 hover:underline">
            ← Ρυθμίσεις
          </Link>
        </div>
        <PageHeader
          title="API & Integrations"
          description="SAP-style integration cockpit · webhooks · myDATA/ΑΑΔΕ · API tokens · monitor"
          actions={
            <div className="flex flex-wrap gap-2">
              <Link
                href="/docs"
                className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium hover:bg-white"
              >
                Docs προϊόντος
              </Link>
              {canWrite ? (
                <Button
                  disabled={pending}
                  onClick={() => save()}
                  className="bg-[var(--int-ink)] hover:bg-slate-900"
                >
                  {pending ? "Αποθήκευση…" : "Αποθήκευση αλλαγών"}
                </Button>
              ) : null}
            </div>
          }
        />

        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="teal">myDATA · {form.myDataEnv}</Badge>
          <Badge tone={form.webhookEnabled && form.webhookUrl ? "emerald" : "slate"}>
            Webhooks {form.webhookEnabled && form.webhookUrl ? "ON" : "OFF"}
          </Badge>
          <Badge tone={status.pendingMyData > 0 ? "rose" : "slate"}>
            {status.pendingMyData} ουρά myDATA
          </Badge>
          <Badge tone="slate">{status.activeTokens} API keys</Badge>
        </div>
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
      {revealedSecret ? (
        <SecretBanner
          label="Webhook HMAC secret (μία φορά)"
          value={revealedSecret}
          onDismiss={() => setRevealedSecret(null)}
        />
      ) : null}
      {newTokenSecret ? (
        <SecretBanner
          label="API token (μία φορά)"
          value={newTokenSecret}
          onDismiss={() => setNewTokenSecret(null)}
        />
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="soft-panel h-fit space-y-4 p-3 lg:sticky lg:top-20">
          {NAV.map((group) => (
            <div key={group.group}>
              <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.group}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = section === item.id;
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => setSection(item.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition",
                          active
                            ? "bg-[var(--int-ink)] text-white shadow-md shadow-slate-900/10"
                            : "text-slate-600 hover:bg-slate-100",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5 opacity-80" />
                        {item.label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="min-w-0 space-y-4">
          {section === "overview" ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {readiness.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() =>
                      setSection(
                        r.label === "Webhook"
                          ? "webhooks"
                          : r.label === "myDATA"
                            ? "mydata"
                            : r.label === "API tokens"
                              ? "developer"
                              : "marketplaces",
                      )
                    }
                    className="soft-panel rounded-2xl px-4 py-3 text-left transition hover:border-teal-300"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{r.label}</p>
                      <Badge tone={r.ok ? "emerald" : "rose"}>
                        {r.ok ? "Ready" : "Setup"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">{r.detail}</p>
                  </button>
                ))}
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="soft-panel space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Γρήγορες ενέργειες</h3>
                    <Cable className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canWrite || testBusy !== null}
                      onClick={() => runTest("webhook")}
                    >
                      Test webhook
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!canWrite || testBusy !== null}
                      onClick={() => runTest("mydata")}
                    >
                      Test myDATA
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setSection("developer")}
                    >
                      API tokens
                    </Button>
                    <Link
                      href="/finance"
                      className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium hover:bg-slate-50"
                    >
                      Ουρά myDATA →
                    </Link>
                  </div>
                  <dl className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-slate-50 px-2 py-2">
                      <dt className="text-slate-500">Accepted</dt>
                      <dd className="mt-0.5 text-base font-semibold tabular-nums">
                        {status.myDataAccepted}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2 py-2">
                      <dt className="text-slate-500">Rejected</dt>
                      <dd className="mt-0.5 text-base font-semibold tabular-nums text-rose-700">
                        {status.myDataRejected}
                      </dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-2 py-2">
                      <dt className="text-slate-500">Σύνολο</dt>
                      <dd className="mt-0.5 text-base font-semibold tabular-nums">
                        {status.myDataTotal}
                      </dd>
                    </div>
                  </dl>
                </section>

                <section className="soft-panel space-y-3 p-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold">Τελευταία activity</h3>
                    <button
                      type="button"
                      className="text-xs font-medium text-teal-700"
                      onClick={() => setSection("logs")}
                    >
                      Όλα →
                    </button>
                  </div>
                  {logs.length === 0 ? (
                    <p className="py-6 text-center text-sm text-slate-400">
                      Καμία εγγραφή ακόμη
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {logs.slice(0, 6).map((l) => (
                        <li
                          key={l.id}
                          className="flex items-start justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">{l.action}</p>
                            <p className="truncate text-xs text-slate-500">
                              {l.message || l.entity || "—"}
                            </p>
                          </div>
                          {l.ok != null ? (
                            <Badge tone={l.ok ? "emerald" : "rose"}>
                              {l.ok ? "OK" : "FAIL"}
                            </Badge>
                          ) : (
                            <span className="shrink-0 text-[10px] text-slate-400">
                              {new Date(l.createdAt).toLocaleString("el-GR")}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            </div>
          ) : null}

          {section === "webhooks" ? (
            <section className="soft-panel space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Outbound Webhooks</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Υπογραφή HMAC-SHA256 (`X-Softify-Signature`) · event routing όπως SAP Event Mesh
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canWrite || testBusy !== null}
                    onClick={() => runTest("webhook")}
                  >
                    {testBusy === "webhook" ? "Testing…" : "Test connection"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canWrite || pending}
                    onClick={() => save({ regenerateWebhookSecret: true })}
                  >
                    Generate secret
                  </Button>
                </div>
              </div>

              {form.lastWebhookTest ? (
                <TestResultBanner result={form.lastWebhookTest} />
              ) : null}

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canWrite}
                  checked={form.webhookEnabled}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, webhookEnabled: e.target.checked }))
                  }
                />
                Webhooks ενεργά
              </label>

              <label className="block text-xs text-slate-600">
                Endpoint URL
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs text-slate-600">
                  Secret hint / vault ref
                  <input
                    disabled={!canWrite}
                    value={form.webhookSecretHint}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        webhookSecretHint: e.target.value,
                      }))
                    }
                    className={inputClass}
                    placeholder="vault:webhook-prod"
                  />
                </label>
                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                  <p className="font-medium text-slate-700">HMAC secret</p>
                  <p className="mt-1 text-slate-500">
                    {form.hasWebhookSecret
                      ? "Αποθηκευμένο server-side (masked)"
                      : "Δεν υπάρχει — πάτα Generate secret"}
                  </p>
                  {form.hasWebhookSecret && canWrite ? (
                    <button
                      type="button"
                      className="mt-2 text-rose-700 hover:underline"
                      onClick={() => save({ clearWebhookSecret: true })}
                    >
                      Clear secret
                    </button>
                  ) : null}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Event subscriptions
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {WEBHOOK_EVENTS.map((ev) => {
                    const checked = form.webhookEvents.includes(ev.key);
                    return (
                      <label
                        key={ev.key}
                        className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          disabled={!canWrite}
                          checked={checked}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              webhookEvents: e.target.checked
                                ? [...f.webhookEvents, ev.key]
                                : f.webhookEvents.filter((k) => k !== ev.key),
                            }))
                          }
                        />
                        <span>
                          <span className="font-medium">{ev.label}</span>
                          <span className="ml-2 font-mono text-[10px] text-slate-400">
                            {ev.key}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}

          {section === "mydata" ? (
            <section className="soft-panel space-y-4 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">myDATA / ΑΑΔΕ</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Live SendInvoices · aade-user-id + ocp-apim-subscription-key · όπως SAP eDocument
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canWrite || testBusy !== null}
                    onClick={() => runTest("mydata")}
                  >
                    {testBusy === "mydata" ? "Testing…" : "Test connection"}
                  </Button>
                  <Link
                    href="/finance"
                    className="inline-flex h-8 items-center rounded-lg border border-slate-200 px-3 text-xs font-medium hover:bg-slate-50"
                  >
                    Άνοιγμα ουράς FI
                  </Link>
                </div>
              </div>

              {form.lastMyDataTest ? (
                <TestResultBanner result={form.lastMyDataTest} />
              ) : null}

              <div className="grid gap-3 sm:grid-cols-3">
                <StatusTile
                  label="Περιβάλλον"
                  value={form.myDataEnv}
                  tone={form.myDataEnv === "prod" ? "rose" : "teal"}
                />
                <StatusTile
                  label="Credentials"
                  value={
                    form.myDataEnv === "simulator"
                      ? "N/A"
                      : form.hasMyDataSubscriptionKey
                        ? "Configured"
                        : "Missing"
                  }
                  tone={
                    form.myDataEnv === "simulator" || form.hasMyDataSubscriptionKey
                      ? "emerald"
                      : "rose"
                  }
                />
                <StatusTile
                  label="Ουρά"
                  value={String(status.pendingMyData)}
                  tone={status.pendingMyData > 0 ? "rose" : "slate"}
                />
              </div>

              <label className="block text-xs text-slate-600">
                Περιβάλλον
                <select
                  disabled={!canWrite}
                  value={form.myDataEnv}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      myDataEnv: e.target.value as MyDataEnv,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="simulator">Simulator (τοπικό)</option>
                  <option value="test">AADE Test (mydataapidev)</option>
                  <option value="prod">AADE Production (mydatapi)</option>
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
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
                      setForm((f) => ({
                        ...f,
                        myDataSubscriptionKey: e.target.value,
                      }))
                    }
                    className={inputClass}
                    autoComplete="new-password"
                    placeholder={
                      form.hasMyDataSubscriptionKey
                        ? `Αποθηκευμένο (${form.myDataSubscriptionKeyHint || "••••"}) — κενό = διατήρηση`
                        : "subscription key"
                    }
                  />
                </label>
              </div>

              {form.hasMyDataSubscriptionKey && canWrite ? (
                <button
                  type="button"
                  className="text-xs text-rose-700 hover:underline"
                  onClick={() => save({ clearMyDataSubscriptionKey: true })}
                >
                  Διαγραφή αποθηκευμένου subscription key
                </button>
              ) : null}

              <label className="block text-xs text-slate-600">
                Εργάνη env (HR bridge)
                <select
                  disabled={!canWrite}
                  value={form.erganiEnv}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      erganiEnv: e.target.value as MyDataEnv,
                    }))
                  }
                  className={inputClass}
                >
                  <option value="simulator">Simulator</option>
                  <option value="test">Test</option>
                  <option value="prod">Production</option>
                </select>
              </label>

              <label className="block text-xs text-slate-600">
                Σημειώσεις σύνδεσης
                <textarea
                  disabled={!canWrite}
                  rows={3}
                  value={form.notes}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  className={inputClass}
                  placeholder="π.χ. credentials vault path, υπεύθυνος, ημερομηνία αίτησης ΑΑΔΕ…"
                />
              </label>
            </section>
          ) : null}

          {section === "marketplaces" ? (
            <MarketplaceChannelsPanel
              canWrite={canWrite}
              initialItems={marketplaceChannels}
              onItemsChange={setMarketplaceChannels}
            />
          ) : null}

          {section === "developer" ? (
            <div className="space-y-4">
              <section className="soft-panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-semibold">API tokens</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Bearer / `X-Softify-Api-Key` · εμφανίζεται μία φορά · hash στο vault JSON
                    </p>
                  </div>
                  <ShieldCheck className="h-4 w-4 text-teal-700" />
                </div>
                {canWrite ? (
                  <div className="flex flex-wrap gap-2">
                    <input
                      className="h-9 min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 text-sm"
                      value={tokenName}
                      onChange={(e) => setTokenName(e.target.value)}
                      placeholder="Όνομα token"
                    />
                    <Button size="sm" disabled={pending} onClick={createToken}>
                      + Generate token
                    </Button>
                  </div>
                ) : null}
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {tokens.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm text-slate-400">
                      Κανένα API token ακόμη
                    </li>
                  ) : (
                    tokens.map((t) => (
                      <li
                        key={t.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                      >
                        <div>
                          <p className="font-medium">
                            {t.name}{" "}
                            <span className="font-mono text-xs text-slate-400">
                              {t.prefix}…
                            </span>
                          </p>
                          <p className="text-xs text-slate-500">
                            {new Date(t.createdAt).toLocaleString("el-GR")}
                            {t.revokedAt ? " · revoked" : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge tone={t.active ? "emerald" : "rose"}>
                            {t.active ? "Active" : "Revoked"}
                          </Badge>
                          {t.active && canWrite ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => revokeToken(t.id)}
                            >
                              Revoke
                            </Button>
                          ) : null}
                        </div>
                      </li>
                    ))
                  )}
                </ul>
              </section>

              <section className="soft-panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="flex items-center gap-2 text-sm font-semibold">
                      <BookOpen className="h-4 w-4 text-teal-700" />
                      Διαθέσιμα API endpoints
                    </h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Αναλυτική αναφορά με auth, παραμέτρους, curl και παράδειγμα
                      απάντησης. Άνοιξε κάθε endpoint για λεπτομέρειες.
                    </p>
                  </div>
                  <Link2 className="h-4 w-4 text-slate-400" />
                </div>

                <div className="rounded-xl border border-teal-100 bg-teal-50/50 px-3 py-2.5 text-xs text-slate-600">
                  <p className="font-semibold text-ink-950">Auth γρήγορα</p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5">
                    <li>
                      Browser / ERP: session cookie μετά από{" "}
                      <code className="rounded bg-white px-1">/login</code>
                    </li>
                    <li>
                      Εξωτερικά:{" "}
                      <code className="rounded bg-white px-1">
                        Authorization: Bearer &lt;token&gt;
                      </code>{" "}
                      ή{" "}
                      <code className="rounded bg-white px-1">
                        X-Softify-Api-Key
                      </code>
                    </li>
                    <li>
                      <code className="rounded bg-white px-1">/api/health</code>{" "}
                      είναι δημόσιο (χωρίς auth)
                    </li>
                  </ul>
                </div>

                <ul className="space-y-3">
                  {endpoints.map((ep) => {
                    const open = openEndpoint === ep.key;
                    return (
                      <li
                        key={ep.key}
                        className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                      >
                        <button
                          type="button"
                          className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50/80"
                          onClick={() =>
                            setOpenEndpoint(open ? null : ep.key)
                          }
                        >
                          <div className="min-w-0">
                            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink-950">
                              <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-white">
                                {ep.method}
                              </span>
                              {ep.title}
                              <span className="font-mono text-[11px] font-normal text-slate-400">
                                {ep.key}
                              </span>
                            </p>
                            <p className="mt-1 font-mono text-xs text-teal-800">
                              {ep.path}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {ep.desc}
                            </p>
                          </div>
                          <ChevronDown
                            className={cn(
                              "mt-1 h-4 w-4 shrink-0 text-slate-400 transition",
                              open && "rotate-180",
                            )}
                          />
                        </button>

                        {open ? (
                          <div className="space-y-4 border-t border-slate-100 bg-slate-50/40 px-4 py-4 text-sm">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <DocBlock label="Authentication" value={ep.auth} />
                              <DocBlock label="Πρόσβαση" value={ep.access} />
                            </div>

                            {ep.headers?.length ? (
                              <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Headers
                                </p>
                                <ul className="space-y-1 text-xs">
                                  {ep.headers.map((h) => (
                                    <li key={h.name}>
                                      <code className="rounded bg-white px-1.5 py-0.5 font-mono text-teal-800">
                                        {h.name}
                                      </code>{" "}
                                      <span className="text-slate-600">
                                        — {h.desc}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {ep.params?.length ? (
                              <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Query / path params
                                </p>
                                <ul className="space-y-1.5 text-xs">
                                  {ep.params.map((p) => (
                                    <li
                                      key={p.name}
                                      className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5"
                                    >
                                      <code className="font-mono text-teal-800">
                                        {p.name}
                                      </code>
                                      {p.required ? (
                                        <Badge tone="rose" className="ml-2">
                                          required
                                        </Badge>
                                      ) : (
                                        <span className="ml-2 text-slate-400">
                                          optional
                                        </span>
                                      )}
                                      <p className="mt-0.5 text-slate-600">
                                        {p.desc}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {ep.body?.length ? (
                              <div>
                                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                                  Request body
                                </p>
                                <ul className="space-y-1.5 text-xs">
                                  {ep.body.map((p) => (
                                    <li
                                      key={p.name}
                                      className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5"
                                    >
                                      <code className="font-mono text-teal-800">
                                        {p.name}
                                      </code>
                                      {p.required ? (
                                        <Badge tone="rose" className="ml-2">
                                          required
                                        </Badge>
                                      ) : (
                                        <span className="ml-2 text-slate-400">
                                          optional
                                        </span>
                                      )}
                                      <p className="mt-0.5 text-slate-600">
                                        {p.desc}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            <CodeExample
                              label="Παράδειγμα curl"
                              code={ep.curl}
                              onCopy={() => copyText(ep.curl)}
                            />
                            <CodeExample
                              label="Παράδειγμα απάντησης"
                              code={ep.responseExample}
                              onCopy={() => copyText(ep.responseExample)}
                            />

                            {ep.notes?.length ? (
                              <ul className="list-inside list-disc space-y-0.5 text-xs text-slate-500">
                                {ep.notes.map((n) => (
                                  <li key={n}>{n}</li>
                                ))}
                              </ul>
                            ) : null}

                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50"
                                onClick={() => copyText(ep.path)}
                              >
                                <Copy className="h-3 w-3" />
                                Copy path
                              </button>
                              <a
                                href={ep.path}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs hover:bg-slate-50"
                              >
                                Άνοιγμα στο browser
                              </a>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            </div>
          ) : null}

          {section === "logs" ? (
            <section className="soft-panel space-y-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold">Integration monitor</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Audit trail για integrations / myDATA / Εργάνη
                  </p>
                </div>
                <Link
                  href="/settings/audit"
                  className="text-xs font-medium text-teal-700 hover:underline"
                >
                  Πλήρες audit →
                </Link>
              </div>
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {logs.length === 0 ? (
                  <li className="px-3 py-8 text-center text-sm text-slate-400">
                    Δεν υπάρχουν events ακόμη — τρέξε ένα Test connection
                  </li>
                ) : (
                  logs.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-start justify-between gap-2 px-3 py-2.5 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-medium">{l.action}</p>
                        <p className="text-xs text-slate-500">
                          {l.message || l.entity || "—"}
                          {l.userName ? ` · ${l.userName}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {l.ok != null ? (
                          <Badge tone={l.ok ? "emerald" : "rose"}>
                            {l.ok ? "OK" : "FAIL"}
                          </Badge>
                        ) : null}
                        <span className="text-[10px] tabular-nums text-slate-400">
                          {new Date(l.createdAt).toLocaleString("el-GR")}
                        </span>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </section>
          ) : null}

          {canWrite &&
          section !== "overview" &&
          section !== "logs" &&
          section !== "marketplaces" &&
          section !== "developer" ? (
            <div className="flex justify-end">
              <Button disabled={pending} onClick={() => save()}>
                {pending ? "Αποθήκευση…" : "Αποθήκευση"}
              </Button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SecretBanner({
  label,
  value,
  onDismiss,
}: {
  label: string;
  value: string;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{label}</p>
          <code className="mt-1 block break-all font-mono text-xs">{value}</code>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" onClick={() => copyText(value)}>
            Copy
          </Button>
          <Button size="sm" variant="secondary" onClick={onDismiss}>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}

function TestResultBanner({ result }: { result: IntegrationTestResult }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2 text-sm",
        result.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-rose-200 bg-rose-50 text-rose-900",
      )}
    >
      <p className="font-medium">{result.message}</p>
      <p className="mt-0.5 text-xs opacity-80">
        {new Date(result.at).toLocaleString("el-GR")}
        {result.latencyMs != null ? ` · ${result.latencyMs}ms` : ""}
        {result.status != null ? ` · HTTP ${result.status}` : ""}
      </p>
    </div>
  );
}

function StatusTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "teal" | "emerald" | "rose" | "slate";
}) {
  return (
    <div className="rounded-xl border border-slate-100 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-1">
        <Badge tone={tone}>{value}</Badge>
      </div>
    </div>
  );
}

function DocBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-xs text-slate-700">{value}</p>
    </div>
  );
}

function CodeExample({
  label,
  code,
  onCopy,
}: {
  label: string;
  code: string;
  onCopy: () => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] hover:bg-slate-50"
          onClick={onCopy}
        >
          <Copy className="h-3 w-3" />
          Copy
        </button>
      </div>
      <pre className="overflow-x-auto rounded-xl border border-slate-200 bg-[#0b1f33] px-3 py-3 font-mono text-[11px] leading-relaxed text-emerald-100">
        {code}
      </pre>
    </div>
  );
}
