"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Play, Plus, Save, Trash2 } from "lucide-react";
import type {
  EntityModule,
  ScriptLifecycle,
  ScriptRuntime,
} from "@/generated/prisma/client";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  ENTITY_MODULES,
  entityLabel,
} from "@/modules/entity-views/registry";
import type { ScriptEventDef } from "@/modules/scripts/events";

type ScriptItem = {
  id: string;
  module: EntityModule;
  code: string;
  name: string;
  description: string | null;
  eventKey: string;
  runtime: ScriptRuntime;
  source: string;
  lifecycle: ScriptLifecycle;
  isActive: boolean;
  sortOrder: number;
  timeoutMs: number;
  createdAt: string;
  updatedAt: string;
};

type SecretItem = {
  id: string;
  key: string;
  createdAt: string;
  updatedAt: string;
};

type AllowItem = { id: string; host: string; createdAt: string };

type SettingsState = {
  scriptsEnabled: boolean;
  maxTimeoutMs: number;
  maxHttpCalls: number;
};

type LogItem = {
  id: string;
  scriptId: string | null;
  module: EntityModule;
  eventKey: string;
  success: boolean;
  durationMs: number;
  error: string | null;
  httpCalls: number;
  createdAt: string;
};

type Tab = "scripts" | "secrets" | "allowlist" | "settings" | "logs";

const RUNTIME_LABEL: Record<ScriptRuntime, string> = {
  SERVER: "Server",
  UI: "UI",
  BOTH: "Both",
};

export function ScriptsSettingsClient({
  initialScripts,
  initialSecrets,
  initialAllowlist,
  initialSettings,
  initialLogs,
  template,
  eventsByModule,
}: {
  initialScripts: ScriptItem[];
  initialSecrets: SecretItem[];
  initialAllowlist: AllowItem[];
  initialSettings: SettingsState;
  initialLogs: LogItem[];
  template: string;
  eventsByModule: Record<EntityModule, ScriptEventDef[]>;
}) {
  const [tab, setTab] = useState<Tab>("scripts");
  const [module, setModule] = useState<EntityModule>("CUSTOMERS");
  const [scripts, setScripts] = useState(initialScripts);
  const [secrets, setSecrets] = useState(initialSecrets);
  const [allowlist, setAllowlist] = useState(initialAllowlist);
  const [settings, setSettings] = useState(initialSettings);
  const [logs] = useState(initialLogs);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialScripts.find((s) => s.module === "CUSTOMERS")?.id ??
      initialScripts[0]?.id ??
      null,
  );
  const [draft, setDraft] = useState<Partial<ScriptItem> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testOut, setTestOut] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [secretKey, setSecretKey] = useState("MARKETPLACE_TOKEN");
  const [secretValue, setSecretValue] = useState("");
  const [hostInput, setHostInput] = useState("api.marketplace.example");

  const events = eventsByModule[module] ?? [];
  const moduleScripts = useMemo(
    () => scripts.filter((s) => s.module === module),
    [scripts, module],
  );
  const selected =
    draft ??
    (selectedId
      ? scripts.find((s) => s.id === selectedId) ?? null
      : null);

  function flash(msg: string) {
    setMessage(msg);
    setTimeout(() => setMessage(null), 3500);
  }

  async function apiJson(url: string, init?: RequestInit) {
    const res = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "Αποτυχία",
      );
    }
    return data;
  }

  function startNew() {
    setSelectedId(null);
    setDraft({
      module,
      code: "my_hook",
      name: "Νέο script",
      description: "",
      eventKey: events[0]?.key ?? "before.create",
      runtime: "SERVER",
      source: template,
      lifecycle: "DRAFT",
      isActive: true,
      sortOrder: moduleScripts.length,
      timeoutMs: 3000,
    });
    setTestOut(null);
  }

  function selectScript(id: string) {
    setSelectedId(id);
    setDraft(null);
    setTestOut(null);
  }

  function updateDraft(patch: Partial<ScriptItem>) {
    if (draft) {
      setDraft({ ...draft, ...patch });
      return;
    }
    if (!selectedId) return;
    setScripts((prev) =>
      prev.map((s) => (s.id === selectedId ? { ...s, ...patch } : s)),
    );
  }

  function saveScript() {
    const current = selected;
    if (!current?.code || !current.name || !current.source || !current.eventKey) {
      flash("Συμπλήρωσε κωδικό, όνομα, event και κώδικα.");
      return;
    }
    startTransition(async () => {
      try {
        if (!selectedId || draft) {
          const data = await apiJson("/api/settings/scripts", {
            method: "POST",
            body: JSON.stringify({
              module: current.module ?? module,
              code: current.code,
              name: current.name,
              description: current.description || null,
              eventKey: current.eventKey,
              runtime: current.runtime ?? "SERVER",
              source: current.source,
              lifecycle: current.lifecycle ?? "DRAFT",
              isActive: current.isActive ?? true,
              sortOrder: current.sortOrder ?? 0,
              timeoutMs: current.timeoutMs ?? 3000,
            }),
          });
          const item = {
            ...data.item,
            createdAt: data.item.createdAt,
            updatedAt: data.item.updatedAt,
          } as ScriptItem;
          setScripts((prev) => [...prev, item]);
          setDraft(null);
          setSelectedId(item.id);
          flash("Το script δημιουργήθηκε.");
        } else {
          const data = await apiJson(`/api/settings/scripts/${selectedId}`, {
            method: "PATCH",
            body: JSON.stringify({
              module: current.module,
              name: current.name,
              description: current.description || null,
              eventKey: current.eventKey,
              runtime: current.runtime,
              source: current.source,
              lifecycle: current.lifecycle,
              isActive: current.isActive,
              sortOrder: current.sortOrder,
              timeoutMs: current.timeoutMs,
            }),
          });
          setScripts((prev) =>
            prev.map((s) =>
              s.id === selectedId
                ? ({
                    ...data.item,
                    createdAt: data.item.createdAt,
                    updatedAt: data.item.updatedAt,
                  } as ScriptItem)
                : s,
            ),
          );
          flash("Αποθηκεύτηκε.");
        }
      } catch (e) {
        flash(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  function deleteScript() {
    if (!selectedId || draft) return;
    if (!confirm("Διαγραφή script;")) return;
    startTransition(async () => {
      try {
        await apiJson(`/api/settings/scripts/${selectedId}`, {
          method: "DELETE",
        });
        setScripts((prev) => prev.filter((s) => s.id !== selectedId));
        setSelectedId(null);
        flash("Διαγράφηκε.");
      } catch (e) {
        flash(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  function runTest() {
    const current = selected;
    if (!current?.source || !current.eventKey) return;
    startTransition(async () => {
      try {
        const data = await apiJson("/api/settings/scripts/test", {
          method: "POST",
          body: JSON.stringify({
            module: current.module ?? module,
            eventKey: current.eventKey,
            source: current.source,
            timeoutMs: current.timeoutMs ?? 3000,
          }),
        });
        setTestOut(JSON.stringify(data.result, null, 2));
        flash(data.result?.ok ? "Test OK" : "Test απέτυχε");
      } catch (e) {
        flash(e instanceof Error ? e.message : "Σφάλμα test");
      }
    });
  }

  function saveSecret(e: FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const data = await apiJson("/api/settings/scripts/secrets", {
          method: "POST",
          body: JSON.stringify({ key: secretKey, value: secretValue }),
        });
        setSecrets((prev) => {
          const rest = prev.filter((s) => s.key !== data.item.key);
          return [...rest, data.item as SecretItem].sort((a, b) =>
            a.key.localeCompare(b.key),
          );
        });
        setSecretValue("");
        flash("Secret αποθηκεύτηκε.");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Σφάλμα");
      }
    });
  }

  function deleteSecret(id: string) {
    if (!confirm("Διαγραφή secret;")) return;
    startTransition(async () => {
      try {
        await apiJson(`/api/settings/scripts/secrets/${id}`, {
          method: "DELETE",
        });
        setSecrets((prev) => prev.filter((s) => s.id !== id));
        flash("Διαγράφηκε.");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Σφάλμα");
      }
    });
  }

  function addHost(e: FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const data = await apiJson("/api/settings/scripts/allowlist", {
          method: "POST",
          body: JSON.stringify({ host: hostInput }),
        });
        setAllowlist((prev) => {
          if (prev.some((a) => a.id === data.item.id)) return prev;
          return [...prev, data.item as AllowItem].sort((a, b) =>
            a.host.localeCompare(b.host),
          );
        });
        setHostInput("");
        flash("Host προστέθηκε.");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Σφάλμα");
      }
    });
  }

  function deleteHost(id: string) {
    startTransition(async () => {
      try {
        await apiJson(`/api/settings/scripts/allowlist/${id}`, {
          method: "DELETE",
        });
        setAllowlist((prev) => prev.filter((a) => a.id !== id));
        flash("Αφαιρέθηκε.");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Σφάλμα");
      }
    });
  }

  function saveSettings() {
    startTransition(async () => {
      try {
        const data = await apiJson("/api/settings/scripts/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        });
        setSettings({
          scriptsEnabled: data.item.scriptsEnabled,
          maxTimeoutMs: data.item.maxTimeoutMs,
          maxHttpCalls: data.item.maxHttpCalls,
        });
        flash("Ρυθμίσεις αποθηκεύτηκαν.");
      } catch (err) {
        flash(err instanceof Error ? err.message : "Σφάλμα");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-ink-950"
        >
          <ArrowLeft className="h-4 w-4" /> Ρυθμίσεις
        </Link>
      </div>
      <PageHeader
        title="Script Hooks"
        description="Custom JS ανά module event · sandbox server · api.http + secrets"
      />

      {message ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["scripts", "Scripts"],
            ["secrets", "Secrets"],
            ["allowlist", "HTTP allow-list"],
            ["settings", "Kill switch"],
            ["logs", "Runs"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-sm font-medium",
              tab === id
                ? "bg-ink-950 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "scripts" ? (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {ENTITY_MODULES.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setModule(m);
                    const first = scripts.find((s) => s.module === m);
                    setSelectedId(first?.id ?? null);
                    setDraft(null);
                  }}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs",
                    module === m
                      ? "bg-teal-700 text-white"
                      : "bg-slate-100 text-slate-700",
                  )}
                >
                  {entityLabel(m)}
                </button>
              ))}
            </div>
            <Button type="button" size="sm" onClick={startNew} disabled={pending}>
              <Plus className="h-4 w-4" /> Νέο
            </Button>
            <ul className="space-y-1">
              {moduleScripts.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => selectScript(s.id)}
                    className={cn(
                      "w-full rounded-lg border px-3 py-2 text-left text-sm",
                      selectedId === s.id && !draft
                        ? "border-teal-300 bg-teal-50"
                        : "border-slate-200 bg-white hover:bg-slate-50",
                    )}
                  >
                    <div className="font-medium text-ink-950">{s.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-500">
                      <span>{s.code}</span>
                      <span>·</span>
                      <span>{s.eventKey}</span>
                    </div>
                    <div className="mt-1 flex gap-1">
                      <Badge tone={s.lifecycle === "PUBLISHED" ? "teal" : "slate"}>
                        {s.lifecycle}
                      </Badge>
                      {!s.isActive ? (
                        <Badge tone="slate">off</Badge>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
              {moduleScripts.length === 0 && !draft ? (
                <li className="text-sm text-slate-500">Κανένα script ακόμα.</li>
              ) : null}
            </ul>
          </aside>

          <div className="soft-panel space-y-4 p-4">
            {!selected ? (
              <p className="text-sm text-slate-600">
                Επίλεξε ή δημιούργησε script για {entityLabel(module)}.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Κωδικός</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={selected.code ?? ""}
                      disabled={Boolean(selectedId) && !draft}
                      onChange={(e) =>
                        updateDraft({ code: e.target.value.toLowerCase() })
                      }
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Όνομα</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={selected.name ?? ""}
                      onChange={(e) => updateDraft({ name: e.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Event</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={selected.eventKey ?? ""}
                      onChange={(e) => updateDraft({ eventKey: e.target.value })}
                    >
                      {events.map((ev) => (
                        <option key={ev.key} value={ev.key}>
                          {ev.label} ({ev.key})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Runtime</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={selected.runtime ?? "SERVER"}
                      onChange={(e) =>
                        updateDraft({
                          runtime: e.target.value as ScriptRuntime,
                        })
                      }
                    >
                      {(Object.keys(RUNTIME_LABEL) as ScriptRuntime[]).map(
                        (r) => (
                          <option key={r} value={r}>
                            {RUNTIME_LABEL[r]}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 block text-slate-600">Timeout (ms)</span>
                    <input
                      type="number"
                      className="w-full rounded-lg border border-slate-200 px-3 py-2"
                      value={selected.timeoutMs ?? 3000}
                      onChange={(e) =>
                        updateDraft({ timeoutMs: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="flex items-end gap-2 pb-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected.isActive ?? true}
                      onChange={(e) =>
                        updateDraft({ isActive: e.target.checked })
                      }
                    />
                    Ενεργό
                  </label>
                </div>

                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">Περιγραφή</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 px-3 py-2"
                    value={selected.description ?? ""}
                    onChange={(e) =>
                      updateDraft({ description: e.target.value })
                    }
                  />
                </label>

                <label className="block text-sm">
                  <span className="mb-1 block text-slate-600">
                    JavaScript · async function run(ctx, api)
                  </span>
                  <textarea
                    spellCheck={false}
                    className="min-h-[280px] w-full rounded-lg border border-slate-200 bg-slate-950 px-3 py-2 font-mono text-xs text-emerald-100"
                    value={selected.source ?? ""}
                    onChange={(e) => updateDraft({ source: e.target.value })}
                  />
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" onClick={saveScript} disabled={pending}>
                    <Save className="h-4 w-4" /> Αποθήκευση
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={runTest}
                    disabled={pending}
                  >
                    <Play className="h-4 w-4" /> Test run
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      const next =
                        selected.lifecycle === "PUBLISHED"
                          ? "DRAFT"
                          : "PUBLISHED";
                      updateDraft({ lifecycle: next });
                      // Persist immediately when editing existing
                      if (selectedId && !draft) {
                        startTransition(async () => {
                          try {
                            const data = await apiJson(
                              `/api/settings/scripts/${selectedId}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({ lifecycle: next }),
                              },
                            );
                            setScripts((prev) =>
                              prev.map((s) =>
                                s.id === selectedId
                                  ? ({
                                      ...data.item,
                                      createdAt: data.item.createdAt,
                                      updatedAt: data.item.updatedAt,
                                    } as ScriptItem)
                                  : s,
                              ),
                            );
                            flash(
                              next === "PUBLISHED"
                                ? "Δημοσιεύτηκε."
                                : "Έγινε draft.",
                            );
                          } catch (e) {
                            flash(e instanceof Error ? e.message : "Σφάλμα");
                          }
                        });
                      }
                    }}
                    disabled={pending}
                  >
                    {selected.lifecycle === "PUBLISHED"
                      ? "Σε Draft"
                      : "Publish"}
                  </Button>
                  {selectedId && !draft ? (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={deleteScript}
                      disabled={pending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                  <Badge
                    tone={
                      selected.lifecycle === "PUBLISHED" ? "teal" : "slate"
                    }
                  >
                    {selected.lifecycle}
                  </Badge>
                </div>

                {testOut ? (
                  <pre className="max-h-64 overflow-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-800">
                    {testOut}
                  </pre>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

      {tab === "secrets" ? (
        <div className="soft-panel space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Κλειδιά τύπου <code>MARKETPLACE_TOKEN</code> — διαθέσιμα ως{" "}
            <code>await api.secrets.get(&quot;KEY&quot;)</code>. Δεν εμφανίζεται
            ποτέ η τιμή.
          </p>
          <form onSubmit={saveSecret} className="flex flex-wrap gap-2">
            <input
              className="rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              value={secretKey}
              onChange={(e) =>
                setSecretKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))
              }
              placeholder="KEY"
            />
            <input
              type="password"
              className="min-w-[200px] flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="Τιμή"
            />
            <Button type="submit" disabled={pending || !secretValue}>
              Αποθήκευση
            </Button>
          </form>
          <ul className="divide-y divide-slate-100">
            {secrets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="font-mono">{s.key}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-600"
                  onClick={() => deleteSecret(s.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {secrets.length === 0 ? (
              <li className="py-2 text-sm text-slate-500">Κανένα secret.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {tab === "allowlist" ? (
        <div className="soft-panel space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Μόνο αυτά τα hosts επιτρέπονται σε <code>api.http.*</code> (π.χ.
            marketplace API). Υποστηρίζεται <code>*.example.com</code>.
          </p>
          <form onSubmit={addHost} className="flex flex-wrap gap-2">
            <input
              className="min-w-[240px] flex-1 rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              placeholder="api.example.com"
            />
            <Button type="submit" disabled={pending || !hostInput.trim()}>
              Προσθήκη
            </Button>
          </form>
          <ul className="divide-y divide-slate-100">
            {allowlist.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="font-mono">{a.host}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-red-600"
                  onClick={() => deleteHost(a.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
            {allowlist.length === 0 ? (
              <li className="py-2 text-sm text-slate-500">Κενή λίστα.</li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {tab === "settings" ? (
        <div className="soft-panel space-y-4 p-4 max-w-lg">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.scriptsEnabled}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  scriptsEnabled: e.target.checked,
                }))
              }
            />
            Scripts ενεργά (kill switch)
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Max timeout (ms)</span>
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={settings.maxTimeoutMs}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  maxTimeoutMs: Number(e.target.value),
                }))
              }
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Max HTTP calls / run</span>
            <input
              type="number"
              className="w-full rounded-lg border border-slate-200 px-3 py-2"
              value={settings.maxHttpCalls}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  maxHttpCalls: Number(e.target.value),
                }))
              }
            />
          </label>
          <Button type="button" onClick={saveSettings} disabled={pending}>
            Αποθήκευση
          </Button>
        </div>
      ) : null}

      {tab === "logs" ? (
        <div className="soft-panel overflow-x-auto p-4">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="pb-2 pr-3">Χρόνος</th>
                <th className="pb-2 pr-3">Module</th>
                <th className="pb-2 pr-3">Event</th>
                <th className="pb-2 pr-3">OK</th>
                <th className="pb-2 pr-3">ms</th>
                <th className="pb-2 pr-3">HTTP</th>
                <th className="pb-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-t border-slate-100">
                  <td className="py-2 pr-3 whitespace-nowrap text-slate-600">
                    {new Date(l.createdAt).toLocaleString("el-GR")}
                  </td>
                  <td className="py-2 pr-3">{l.module}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{l.eventKey}</td>
                  <td className="py-2 pr-3">
                    {l.success ? "✓" : "✗"}
                  </td>
                  <td className="py-2 pr-3">{l.durationMs}</td>
                  <td className="py-2 pr-3">{l.httpCalls}</td>
                  <td className="py-2 max-w-xs truncate text-xs text-red-700">
                    {l.error}
                  </td>
                </tr>
              ))}
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-slate-500">
                    Δεν υπάρχουν runs ακόμα.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
