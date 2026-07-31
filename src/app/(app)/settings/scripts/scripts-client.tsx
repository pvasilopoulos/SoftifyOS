"use client";

import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import type { editor } from "monaco-editor";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Code2,
  FileCode2,
  Globe,
  KeyRound,
  Play,
  Plus,
  Power,
  Save,
  ScrollText,
  Shield,
  Trash2,
  XCircle,
} from "lucide-react";
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
import {
  ScriptCodeEditor,
  SCRIPT_SNIPPETS,
  SCRIPT_SNIPPET_CATEGORIES,
} from "@/modules/scripts/script-code-editor";
import { ScriptRunsPanel } from "@/modules/scripts/script-runs-panel";

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
type EditorPane = "props" | "snippets" | "test" | "help";

const RUNTIME_LABEL: Record<ScriptRuntime, string> = {
  SERVER: "Server",
  UI: "UI",
  BOTH: "Both",
};

const TABS: Array<{
  id: Tab;
  label: string;
  icon: typeof Code2;
}> = [
  { id: "scripts", label: "Scripts", icon: Code2 },
  { id: "secrets", label: "Secrets", icon: KeyRound },
  { id: "allowlist", label: "HTTP", icon: Globe },
  { id: "settings", label: "Kill switch", icon: Power },
  { id: "logs", label: "Runs", icon: ScrollText },
];

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
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [pending, startTransition] = useTransition();
  const [pane, setPane] = useState<EditorPane>("props");
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [scriptQuery, setScriptQuery] = useState("");
  const [snippetQuery, setSnippetQuery] = useState("");
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const [secretKey, setSecretKey] = useState("MARKETPLACE_TOKEN");
  const [secretValue, setSecretValue] = useState("");
  const [hostInput, setHostInput] = useState("api.marketplace.example");

  const events = eventsByModule[module] ?? [];
  const moduleScripts = useMemo(
    () => scripts.filter((s) => s.module === module),
    [scripts, module],
  );
  const countsByModule = useMemo(() => {
    const map = Object.fromEntries(
      ENTITY_MODULES.map((m) => [m, 0]),
    ) as Record<EntityModule, number>;
    for (const s of scripts) map[s.module] = (map[s.module] ?? 0) + 1;
    return map;
  }, [scripts]);

  const selected =
    draft ??
    (selectedId
      ? scripts.find((s) => s.id === selectedId) ?? null
      : null);

  const selectedEvent = events.find((e) => e.key === selected?.eventKey);

  const scriptsByEvent = useMemo(() => {
    const q = scriptQuery.trim().toLowerCase();
    const filtered = moduleScripts.filter((s) => {
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.eventKey.toLowerCase().includes(q)
      );
    });
    const map = new Map<string, ScriptItem[]>();
    for (const ev of events) map.set(ev.key, []);
    for (const s of filtered) {
      const list = map.get(s.eventKey) ?? [];
      list.push(s);
      map.set(s.eventKey, list);
    }
    return [...map.entries()].filter(([, list]) => list.length > 0 || !q);
  }, [moduleScripts, events, scriptQuery]);

  const filteredSnippets = useMemo(() => {
    const q = snippetQuery.trim().toLowerCase();
    if (!q) return SCRIPT_SNIPPETS;
    return SCRIPT_SNIPPETS.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q),
    );
  }, [snippetQuery]);

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

  useEffect(() => {
    function onSave() {
      if (selected) saveScript();
    }
    window.addEventListener("softify:script-save", onSave);
    return () => window.removeEventListener("softify:script-save", onSave);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, selectedId, draft]);

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
    setTestOk(null);
    setPane("props");
  }

  function selectScript(id: string) {
    setSelectedId(id);
    setDraft(null);
    setTestOut(null);
    setTestOk(null);
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

  function insertSnippet(code: string) {
    const ed = editorRef.current;
    if (ed) {
      const sel = ed.getSelection();
      if (sel) {
        ed.executeEdits("snippet", [
          {
            range: sel,
            text: code,
            forceMoveMarkers: true,
          },
        ]);
        ed.focus();
        return;
      }
    }
    updateDraft({
      source: `${selected?.source ?? ""}\n${code}`,
    });
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

  function publishToggle() {
    if (!selected) return;
    const next =
      selected.lifecycle === "PUBLISHED" ? "DRAFT" : "PUBLISHED";
    updateDraft({ lifecycle: next });
    if (selectedId && !draft) {
      startTransition(async () => {
        try {
          const data = await apiJson(`/api/settings/scripts/${selectedId}`, {
            method: "PATCH",
            body: JSON.stringify({ lifecycle: next }),
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
          flash(next === "PUBLISHED" ? "Δημοσιεύτηκε." : "Έγινε draft.");
        } catch (e) {
          flash(e instanceof Error ? e.message : "Σφάλμα");
        }
      });
    }
  }

  function runTest() {
    const current = selected;
    if (!current?.source || !current.eventKey) return;
    setPane("test");
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
        setTestOk(Boolean(data.result?.ok));
        flash(data.result?.ok ? "Test OK" : "Test απέτυχε");
      } catch (e) {
        setTestOk(false);
        setTestOut(String(e instanceof Error ? e.message : e));
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-2">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-ink-950"
          >
            <ArrowLeft className="h-4 w-4" /> Ρυθμίσεις
          </Link>
          <PageHeader
            title="Script Hooks"
            description="IDE για custom JavaScript hooks · sandbox · HTTP allow-list · secrets"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={settings.scriptsEnabled ? "emerald" : "rose"}>
            {settings.scriptsEnabled ? "Scripts ON" : "Scripts OFF"}
          </Badge>
          <Badge tone="slate">{scripts.length} scripts</Badge>
          <a
            href="https://github.com/pvasilopoulos/SoftifyOS/blob/cursor/entity-views-fields-c396/docs/script-hooks-engine.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <BookOpen size={14} /> Docs
          </a>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </div>
      ) : null}

      <nav className="flex flex-wrap gap-1 rounded-2xl border border-slate-200/80 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition",
                active
                  ? "bg-ink-950 text-white"
                  : "text-slate-600 hover:bg-slate-50 hover:text-ink-950",
              )}
            >
              <Icon size={15} />
              {t.label}
              {t.id === "secrets" ? (
                <span className="text-[10px] opacity-70">{secrets.length}</span>
              ) : null}
              {t.id === "allowlist" ? (
                <span className="text-[10px] opacity-70">{allowlist.length}</span>
              ) : null}
              {t.id === "logs" ? (
                <span className="text-[10px] opacity-70">{logs.length}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {tab === "scripts" ? (
        <div className="grid min-h-[720px] gap-3 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
          {/* Explorer */}
          <aside className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="border-b border-slate-100 px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Modules
              </p>
              <div className="mt-2 space-y-0.5">
                {ENTITY_MODULES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setModule(m);
                      const first = scripts.find((s) => s.module === m);
                      setSelectedId(first?.id ?? null);
                      setDraft(null);
                      setScriptQuery("");
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm transition",
                      module === m
                        ? "bg-teal-50 font-medium text-teal-900"
                        : "text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <span className="truncate">{entityLabel(m)}</span>
                    <span
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[10px] tabular-nums",
                        module === m
                          ? "bg-teal-700 text-white"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      {countsByModule[m]}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2">
              <input
                value={scriptQuery}
                onChange={(e) => setScriptQuery(e.target.value)}
                placeholder="Φίλτρο scripts…"
                className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-teal-300"
              />
              <Button type="button" size="sm" onClick={startNew} disabled={pending}>
                <Plus size={14} />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {draft ? (
                <button
                  type="button"
                  className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-2.5 py-2 text-left text-sm text-amber-900"
                >
                  <FileCode2 size={14} />
                  <span className="truncate font-medium">
                    {draft.name || "Νέο script"} · unsaved
                  </span>
                </button>
              ) : null}

              {scriptsByEvent.length === 0 ? (
                <div className="px-2 py-8 text-center text-xs text-slate-500">
                  Κανένα script στο {entityLabel(module)}.
                  <button
                    type="button"
                    onClick={startNew}
                    className="mt-2 block w-full font-medium text-teal-700 hover:underline"
                  >
                    Δημιούργησε το πρώτο
                  </button>
                </div>
              ) : (
                scriptsByEvent.map(([eventKey, list]) => {
                  const ev = events.find((e) => e.key === eventKey);
                  return (
                    <div key={eventKey} className="mb-3">
                      <p className="mb-1 flex items-center gap-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                        <ChevronRight size={10} />
                        {ev?.label ?? eventKey}
                      </p>
                      <ul className="space-y-0.5">
                        {list.map((s) => {
                          const active = selectedId === s.id && !draft;
                          return (
                            <li key={s.id}>
                              <button
                                type="button"
                                onClick={() => selectScript(s.id)}
                                className={cn(
                                  "flex w-full flex-col rounded-lg px-2.5 py-2 text-left transition",
                                  active
                                    ? "bg-ink-950 text-white"
                                    : "hover:bg-slate-50",
                                )}
                              >
                                <span
                                  className={cn(
                                    "truncate text-sm font-medium",
                                    active ? "text-white" : "text-ink-950",
                                  )}
                                >
                                  {s.name}
                                </span>
                                <span
                                  className={cn(
                                    "mt-0.5 flex items-center gap-1.5 font-mono text-[10px]",
                                    active ? "text-slate-300" : "text-slate-500",
                                  )}
                                >
                                  {s.code}
                                  <span>·</span>
                                  {s.lifecycle === "PUBLISHED" ? "pub" : "draft"}
                                  {!s.isActive ? " · off" : ""}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                        {list.length === 0 ? (
                          <li className="px-2 py-1 text-[11px] text-slate-400">
                            — κενό
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          {/* Editor */}
          <section className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            {!selected ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                  <Code2 size={28} />
                </div>
                <p className="text-base font-semibold text-ink-950">
                  Script workspace · {entityLabel(module)}
                </p>
                <p className="max-w-md text-sm text-slate-500">
                  Επίλεξε script από τον explorer ή δημιούργησε νέο hook με
                  Monaco editor, snippets και test run.
                </p>
                <Button type="button" onClick={startNew}>
                  <Plus size={16} /> Νέο script
                </Button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2.5">
                  <FileCode2 size={16} className="text-teal-700" />
                  <input
                    value={selected.name ?? ""}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    className="min-w-[140px] flex-1 border-0 bg-transparent text-sm font-semibold text-ink-950 outline-none"
                    placeholder="Όνομα script"
                  />
                  <Badge
                    tone={
                      selected.lifecycle === "PUBLISHED" ? "teal" : "slate"
                    }
                  >
                    {selected.lifecycle}
                  </Badge>
                  <Badge tone="slate">
                    {RUNTIME_LABEL[selected.runtime ?? "SERVER"]}
                  </Badge>
                  <div className="ml-auto flex flex-wrap gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={runTest}
                      disabled={pending}
                    >
                      <Play size={14} /> Test
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={publishToggle}
                      disabled={pending}
                    >
                      {selected.lifecycle === "PUBLISHED"
                        ? "Unpublish"
                        : "Publish"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={saveScript}
                      disabled={pending}
                    >
                      <Save size={14} /> Αποθήκευση
                    </Button>
                    {selectedId && !draft ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={deleteScript}
                        disabled={pending}
                      >
                        <Trash2 size={14} />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="flex items-center gap-2 border-b border-slate-800/40 bg-[#0f172a] px-3 py-1.5 text-[11px] text-slate-400">
                  <span className="font-mono text-emerald-400/90">
                    async function run(ctx, api)
                  </span>
                  <span className="text-slate-600">·</span>
                  <span>{selected.eventKey}</span>
                  <span className="text-slate-600">·</span>
                  <span>⌘/Ctrl+S αποθήκευση</span>
                  <span className="ml-auto tabular-nums">
                    Ln {cursor.line}, Col {cursor.col}
                  </span>
                </div>

                <div className="min-h-0 flex-1">
                  <ScriptCodeEditor
                    value={selected.source ?? ""}
                    onChange={(source) => updateDraft({ source })}
                    height="520px"
                    onCursorChange={(line, col) =>
                      setCursor({ line, col })
                    }
                    editorRef={editorRef}
                  />
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                  <span>
                    {(selected.source ?? "").split("\n").length} γραμμές ·{" "}
                    {(selected.source ?? "").length} chars · timeout{" "}
                    {selected.timeoutMs ?? 3000}ms
                  </span>
                  <span className="font-mono">{selected.code}</span>
                </div>
              </>
            )}
          </section>

          {/* Side panel */}
          <aside className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="flex border-b border-slate-100">
              {(
                [
                  ["props", "Ιδιότητες"],
                  ["snippets", "Snippets"],
                  ["test", "Test"],
                  ["help", "API"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setPane(id)}
                  className={cn(
                    "flex-1 px-2 py-2.5 text-center text-xs font-medium",
                    pane === id
                      ? "border-b-2 border-teal-600 text-teal-800"
                      : "text-slate-500 hover:text-ink-900",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              {!selected && pane !== "help" ? (
                <p className="text-sm text-slate-500">
                  Επίλεξε script για ιδιότητες, snippets και test output.
                </p>
              ) : null}

              {selected && pane === "props" ? (
                <div className="space-y-3">
                  <Field label="Κωδικός">
                    <input
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                      value={selected.code ?? ""}
                      disabled={Boolean(selectedId) && !draft}
                      onChange={(e) =>
                        updateDraft({
                          code: e.target.value.toLowerCase(),
                        })
                      }
                    />
                  </Field>
                  <Field label="Event">
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                      value={selected.eventKey ?? ""}
                      onChange={(e) =>
                        updateDraft({ eventKey: e.target.value })
                      }
                    >
                      {events.map((ev) => (
                        <option key={ev.key} value={ev.key}>
                          {ev.label} · {ev.key}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {selectedEvent ? (
                    <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                      {selectedEvent.description}
                      <span className="mt-1 block text-[10px] uppercase text-slate-400">
                        phase · {selectedEvent.phase}
                      </span>
                    </p>
                  ) : null}
                  <Field label="Runtime">
                    <select
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
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
                  </Field>
                  <Field label="Timeout (ms)">
                    <input
                      type="number"
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                      value={selected.timeoutMs ?? 3000}
                      onChange={(e) =>
                        updateDraft({ timeoutMs: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="Περιγραφή">
                    <textarea
                      className="min-h-[72px] w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                      value={selected.description ?? ""}
                      onChange={(e) =>
                        updateDraft({ description: e.target.value })
                      }
                    />
                  </Field>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
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
              ) : null}

              {pane === "snippets" ? (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500">
                    Εισαγωγή στο σημείο του cursor · {filteredSnippets.length}{" "}
                    snippets
                  </p>
                  <input
                    type="search"
                    placeholder="Αναζήτηση…"
                    value={snippetQuery}
                    onChange={(e) => setSnippetQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                  />
                  {SCRIPT_SNIPPET_CATEGORIES.map((cat) => {
                    const items = filteredSnippets.filter(
                      (s) => s.category === cat,
                    );
                    if (items.length === 0) return null;
                    return (
                      <div key={cat} className="space-y-1.5">
                        <p className="sticky top-0 z-[1] bg-white/95 px-0.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {cat}
                        </p>
                        {items.map((sn) => (
                          <button
                            key={sn.id}
                            type="button"
                            disabled={!selected}
                            onClick={() => {
                              insertSnippet(sn.code);
                              setPane("props");
                            }}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-left hover:border-teal-300 hover:bg-teal-50/40 disabled:opacity-40"
                          >
                            <p className="text-sm font-medium text-ink-950">
                              {sn.label}
                            </p>
                            <p className="text-xs text-slate-500">
                              {sn.description}
                            </p>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                  {filteredSnippets.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      Κανένα snippet για «{snippetQuery}».
                    </p>
                  ) : null}
                </div>
              ) : null}

              {pane === "test" ? (
                <div className="space-y-2">
                  {testOk == null && !testOut ? (
                    <p className="text-sm text-slate-500">
                      Πάτα <strong>Test</strong> για εκτέλεση στο sandbox με
                      sample context.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-sm">
                        {testOk ? (
                          <CheckCircle2 className="text-emerald-600" size={16} />
                        ) : (
                          <XCircle className="text-rose-600" size={16} />
                        )}
                        <span className="font-medium">
                          {testOk ? "Επιτυχία" : "Αποτυχία"}
                        </span>
                      </div>
                      <pre className="max-h-[480px] overflow-auto rounded-xl bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-emerald-100">
                        {testOut}
                      </pre>
                    </>
                  )}
                </div>
              ) : null}

              {pane === "help" ? (
                <div className="space-y-3 text-xs leading-relaxed text-slate-600">
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="font-semibold text-ink-950">ctx</p>
                    <p className="font-mono text-[11px]">
                      module, eventKey, record, previous, user
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-3">
                    <p className="font-semibold text-ink-950">api</p>
                    <ul className="mt-1 list-inside list-disc font-mono text-[11px]">
                      <li>get / set / fail / log</li>
                      <li>secrets.get(KEY)</li>
                      <li>http.get|post|put|patch|delete</li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      Παραδείγματα
                    </p>
                    {(
                      [
                        {
                          id: "api_fail",
                          title: "Validation · api.fail",
                          code: `async function run(ctx, api) {
  const vat = String(ctx.record.vatNumber || "").trim();
  if (!/^\\d{9}$/.test(vat)) {
    api.fail("Απαιτείται έγκυρο ΑΦΜ (9 ψηφία)");
  }
}`,
                        },
                        {
                          id: "api_set",
                          title: "Defaults · api.set",
                          code: `async function run(ctx, api) {
  if (!ctx.record.status) api.set("status", "ACTIVE");
  api.set("customFields.source", "script");
  api.log("defaults", ctx.record.code);
}`,
                        },
                        {
                          id: "api_diff",
                          title: "Update · previous → record",
                          code: `async function run(ctx, api) {
  const prev = ctx.previous || {};
  if (prev.status === "ACTIVE" && ctx.record.status === "INACTIVE") {
    api.log("deactivating", ctx.record.code, ctx.user);
  }
}`,
                        },
                        {
                          id: "api_http",
                          title: "Marketplace · secrets + http",
                          code: `async function run(ctx, api) {
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.post(
    "https://api.marketplace.example/v1/customers",
    { id: ctx.record.id, name: ctx.record.name },
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok) api.fail("Sync failed: " + res.status);
  api.log("synced", res.status);
}`,
                        },
                        {
                          id: "api_form",
                          title: "Form · onFieldChange",
                          code: `async function run(ctx, api) {
  if (ctx.field === "vatNumber") {
    const vat = String(ctx.value || "").trim();
    if (vat && !/^\\d{9}$/.test(vat)) {
      api.fail("Το ΑΦΜ πρέπει να έχει 9 ψηφία");
    }
  }
}`,
                        },
                      ] as const
                    ).map((ex) => (
                      <div
                        key={ex.id}
                        className="overflow-hidden rounded-xl border border-slate-200"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-2.5 py-1.5">
                          <p className="text-[11px] font-medium text-ink-950">
                            {ex.title}
                          </p>
                          <button
                            type="button"
                            disabled={!selected}
                            onClick={() => insertSnippet(ex.code + "\n")}
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-40"
                          >
                            Εισαγωγή
                          </button>
                        </div>
                        <pre className="overflow-x-auto bg-slate-950 p-2.5 font-mono text-[10px] leading-relaxed text-slate-200">
                          {ex.code}
                        </pre>
                      </div>
                    ))}
                  </div>

                  <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
                    <Shield size={14} className="mt-0.5 shrink-0" />
                    <p>
                      Μόνο <strong>PUBLISHED</strong> + ενεργά scripts τρέχουν
                      στην παραγωγή. HTTP μόνο σε allow-listed hosts.
                    </p>
                  </div>
                  <p>
                    Πλήρης οδηγός:{" "}
                    <code className="rounded bg-slate-100 px-1">
                      docs/script-hooks-engine.md
                    </code>
                  </p>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "secrets" ? (
        <PanelCard
          title="Secrets"
          description="Κλειδιά τύπου MARKETPLACE_TOKEN — διαθέσιμα ως await api.secrets.get('KEY'). Η τιμή δεν εμφανίζεται μετά την αποθήκευση."
        >
          <form onSubmit={saveSecret} className="flex flex-wrap gap-2">
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
              value={secretKey}
              onChange={(e) =>
                setSecretKey(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""),
                )
              }
              placeholder="KEY"
            />
            <input
              type="password"
              className="min-w-[220px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={secretValue}
              onChange={(e) => setSecretValue(e.target.value)}
              placeholder="Τιμή"
            />
            <Button type="submit" disabled={pending || !secretValue}>
              Αποθήκευση
            </Button>
          </form>
          <ul className="mt-4 divide-y divide-slate-100">
            {secrets.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span className="inline-flex items-center gap-2 font-mono">
                  <KeyRound size={14} className="text-slate-400" />
                  {s.key}
                </span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-rose-600"
                  onClick={() => deleteSecret(s.id)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
            {secrets.length === 0 ? (
              <li className="py-4 text-sm text-slate-500">Κανένα secret.</li>
            ) : null}
          </ul>
        </PanelCard>
      ) : null}

      {tab === "allowlist" ? (
        <PanelCard
          title="HTTP allow-list"
          description="Μόνο αυτά τα hosts επιτρέπονται σε api.http.* (χωρίς https://). Υποστηρίζεται *.example.com."
        >
          <form onSubmit={addHost} className="flex flex-wrap gap-2">
            <input
              className="min-w-[260px] flex-1 rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
              placeholder="api.example.com"
            />
            <Button type="submit" disabled={pending || !hostInput.trim()}>
              Προσθήκη
            </Button>
          </form>
          <ul className="mt-4 divide-y divide-slate-100">
            {allowlist.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between py-2.5 text-sm"
              >
                <span className="inline-flex items-center gap-2 font-mono">
                  <Globe size={14} className="text-slate-400" />
                  {a.host}
                </span>
                <button
                  type="button"
                  className="text-slate-400 hover:text-rose-600"
                  onClick={() => deleteHost(a.id)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
            {allowlist.length === 0 ? (
              <li className="py-4 text-sm text-slate-500">Κενή λίστα.</li>
            ) : null}
          </ul>
        </PanelCard>
      ) : null}

      {tab === "settings" ? (
        <PanelCard
          title="Kill switch & όρια"
          description="Καθολικός διακόπτης και όρια timeout / HTTP κλήσεων ανά tenant."
        >
          <div className="max-w-md space-y-4">
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
              Scripts ενεργά
            </label>
            <Field label="Max timeout (ms)">
              <input
                type="number"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                value={settings.maxTimeoutMs}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    maxTimeoutMs: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Field label="Max HTTP calls / run">
              <input
                type="number"
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-300 focus:ring-2 focus:ring-teal-500/20"
                value={settings.maxHttpCalls}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    maxHttpCalls: Number(e.target.value),
                  }))
                }
              />
            </Field>
            <Button type="button" onClick={saveSettings} disabled={pending}>
              Αποθήκευση
            </Button>
          </div>
        </PanelCard>
      ) : null}

      {tab === "logs" ? <ScriptRunsPanel /> : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}

function PanelCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <h2 className="text-base font-semibold text-ink-950">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}
