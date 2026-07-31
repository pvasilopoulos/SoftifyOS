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
import {
  ArrowLeft,
  Code2,
  Eye,
  Plus,
  Save,
  Sparkles,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { documentKindLabel } from "@/modules/documents/series";
import {
  DEFAULT_INVOICE_PRINT_BODY,
  isHtmlBody,
  parseBodyJson,
  upgradeBodyToHtml,
  type PrintFormBody,
  type PrintFormBodyV2,
} from "@/modules/print-forms/defaults";
import {
  DEFAULT_INVOICE_CSS,
  DEFAULT_INVOICE_HTML,
  DEFAULT_RECEIPT_CSS,
  DEFAULT_RECEIPT_HTML,
  PRINT_MERGE_FIELDS,
  SAMPLE_PRINT_CONTEXT,
} from "@/modules/print-forms/html-presets";
import {
  buildPrintDocument,
  renderPrintTemplate,
} from "@/modules/print-forms/template-engine";

type Kind = keyof typeof documentKindLabel;

type Item = {
  id: string;
  code: string;
  name: string;
  documentKind: Kind;
  paper: "A4" | "A5" | "RECEIPT_80";
  orientation: "PORTRAIT" | "LANDSCAPE";
  bodyJson: unknown;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
};

type EditorTab = "html" | "css" | "preview";

function toHtmlBody(raw: unknown): PrintFormBodyV2 {
  return upgradeBodyToHtml(parseBodyJson(raw));
}

export function PrintFormsClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState(initialItems[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<EditorTab>("preview");
  const [fieldQuery, setFieldQuery] = useState("");
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const cssRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const body = selected ? toHtmlBody(selected.bodyJson) : DEFAULT_INVOICE_PRINT_BODY;

  useEffect(() => {
    setTab("preview");
    setFieldQuery("");
  }, [selectedId]);

  const previewDoc = useMemo(() => {
    const rendered = renderPrintTemplate(body.html, SAMPLE_PRINT_CONTEXT);
    return buildPrintDocument(rendered, body.css);
  }, [body.html, body.css]);

  const filteredGroups = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    if (!q) return PRINT_MERGE_FIELDS;
    return PRINT_MERGE_FIELDS.map((g) => ({
      ...g,
      fields: g.fields.filter(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.token.toLowerCase().includes(q),
      ),
    })).filter((g) => g.fields.length > 0);
  }, [fieldQuery]);

  const refresh = async () => {
    const res = await fetch("/api/settings/print-forms");
    const data = await res.json();
    if (res.ok) setItems(data.items);
  };

  const patchLocalBody = (next: PrintFormBody) => {
    if (!selected) return;
    setItems((prev) =>
      prev.map((i) => (i.id === selected.id ? { ...i, bodyJson: next } : i)),
    );
  };

  const insertToken = (token: string) => {
    if (!selected) return;
    const el = tab === "css" ? cssRef.current : htmlRef.current;
    const field: "html" | "css" = tab === "css" ? "css" : "html";
    const current = body[field];
    if (el) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const nextValue = current.slice(0, start) + token + current.slice(end);
      patchLocalBody({ ...body, [field]: nextValue });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + token.length;
        el.setSelectionRange(pos, pos);
      });
      setTab(field);
      return;
    }
    patchLocalBody({ ...body, html: `${body.html}\n${token}` });
    setTab("html");
  };

  const applyPreset = (kind: "invoice" | "receipt") => {
    if (!selected) return;
    patchLocalBody({
      version: 2,
      engine: "html",
      html: kind === "invoice" ? DEFAULT_INVOICE_HTML : DEFAULT_RECEIPT_HTML,
      css: kind === "invoice" ? DEFAULT_INVOICE_CSS : DEFAULT_RECEIPT_CSS,
      blocks: body.blocks,
    });
    setTab("preview");
    setMessage(
      kind === "invoice"
        ? "Φορτώθηκε preset τιμολογίου HTML."
        : "Φορτώθηκε preset ΑΠΥ HTML.",
    );
  };

  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const documentKind = String(form.get("documentKind") || "SALES_INVOICE");
    const starter =
      documentKind === "RETAIL_RECEIPT"
        ? {
            version: 2 as const,
            engine: "html" as const,
            html: DEFAULT_RECEIPT_HTML,
            css: DEFAULT_RECEIPT_CSS,
          }
        : DEFAULT_INVOICE_PRINT_BODY;
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/settings/print-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") || ""),
          name: String(form.get("name") || ""),
          documentKind,
          paper: documentKind === "RETAIL_RECEIPT" ? "RECEIPT_80" : "A4",
          orientation: "PORTRAIT",
          bodyJson: starter,
          isDefault: false,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setCreating(false);
      setMessage("Η φόρμα δημιουργήθηκε.");
      await refresh();
      setSelectedId(data.item.id);
    });
  };

  const saveSelected = (patch?: {
    name?: string;
    bodyJson?: PrintFormBody;
    isDefault?: boolean;
    isActive?: boolean;
    paper?: Item["paper"];
    orientation?: Item["orientation"];
  }) => {
    if (!selected) return;
    const bodyJson = patch?.bodyJson ?? toHtmlBody(selected.bodyJson);
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/settings/print-forms/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: patch?.name ?? selected.name,
          paper: patch?.paper ?? selected.paper,
          orientation: patch?.orientation ?? selected.orientation,
          bodyJson,
          isDefault: patch?.isDefault ?? selected.isDefault,
          isActive: patch?.isActive ?? selected.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage("Αποθηκεύτηκε το HTML template.");
      await refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
          >
            <ArrowLeft size={14} /> Ρυθμίσεις
          </Link>
          <PageHeader
            title="Print Form Builder"
            description="Advanced HTML builder με merge fields, CSS και live preview — συνδέεται στις σειρές."
          />
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
          <Plus size={16} /> Νέα φόρμα
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {creating ? (
        <form
          onSubmit={create}
          className="soft-panel grid gap-3 p-4 sm:grid-cols-4"
        >
          <input
            name="code"
            required
            placeholder="Κωδικός *"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            name="name"
            required
            placeholder="Όνομα *"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <select
            name="documentKind"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            defaultValue="SALES_INVOICE"
          >
            {(Object.keys(documentKindLabel) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {documentKindLabel[k]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Δημιουργία
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCreating(false)}
            >
              Ακύρωση
            </Button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)_260px]">
        <aside className="soft-panel max-h-[78vh] overflow-y-auto p-2">
          <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Φόρμες
          </p>
          <ul className="space-y-1">
            {items.map((item) => {
              const parsed = parseBodyJson(item.bodyJson);
              const htmlMode = isHtmlBody(parsed);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2.5 text-left text-sm transition",
                      selectedId === item.id
                        ? "bg-teal-50 text-teal-900"
                        : "hover:bg-slate-50",
                    )}
                  >
                    <div className="font-medium">{item.name}</div>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-500">
                      <span className="font-mono">{item.code}</span>
                      <Badge tone={htmlMode ? "teal" : "slate"}>
                        {htmlMode ? "HTML" : "Blocks"}
                      </Badge>
                      {item.isDefault ? <Badge tone="emerald">Default</Badge> : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {selected ? (
          <div className="soft-panel flex min-h-[78vh] flex-col overflow-hidden">
            <div className="space-y-3 border-b border-slate-100 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1 block font-medium">Όνομα</span>
                  <input
                    value={selected.name}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === selected.id
                            ? { ...i, name: e.target.value }
                            : i,
                        ),
                      )
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 px-3"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Χαρτί</span>
                  <select
                    value={selected.paper}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === selected.id
                            ? {
                                ...i,
                                paper: e.target.value as Item["paper"],
                              }
                            : i,
                        ),
                      )
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 px-3"
                  >
                    <option value="A4">A4</option>
                    <option value="A5">A5</option>
                    <option value="RECEIPT_80">Απόδειξη 80mm</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                  {(
                    [
                      ["html", "HTML", Code2],
                      ["css", "CSS", Sparkles],
                      ["preview", "Preview", Eye],
                    ] as const
                  ).map(([id, label, Icon]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium",
                        tab === id
                          ? "bg-white text-ink-950 shadow-sm"
                          : "text-slate-500 hover:text-ink-900",
                      )}
                    >
                      <Icon size={13} />
                      {label}
                    </button>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => applyPreset("invoice")}
                >
                  Preset τιμολόγιο
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={() => applyPreset("receipt")}
                >
                  Preset ΑΠΥ
                </Button>
                <div className="ml-auto flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      saveSelected({
                        name: selected.name,
                        paper: selected.paper,
                        bodyJson: body,
                      })
                    }
                  >
                    <Save size={15} /> Αποθήκευση
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => {
                      setItems((prev) =>
                        prev.map((i) =>
                          i.id === selected.id
                            ? { ...i, isDefault: true }
                            : i.documentKind === selected.documentKind
                              ? { ...i, isDefault: false }
                              : i,
                        ),
                      );
                      saveSelected({ isDefault: true, bodyJson: body });
                    }}
                  >
                    Default
                  </Button>
                  <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                    <input
                      type="checkbox"
                      checked={selected.isActive}
                      onChange={(e) => {
                        const isActive = e.target.checked;
                        setItems((prev) =>
                          prev.map((i) =>
                            i.id === selected.id ? { ...i, isActive } : i,
                          ),
                        );
                        saveSelected({ isActive, bodyJson: body });
                      }}
                    />
                    Ενεργή
                  </label>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                {documentKindLabel[selected.documentKind]} · engine HTML ·{" "}
                <span className="font-mono">{selected.code}</span>
              </p>
            </div>

            <div className="min-h-0 flex-1">
              {tab === "html" ? (
                <textarea
                  ref={htmlRef}
                  value={body.html}
                  onChange={(e) =>
                    patchLocalBody({ ...body, html: e.target.value })
                  }
                  spellCheck={false}
                  className="h-full min-h-[520px] w-full resize-none border-0 bg-[#0b1220] p-4 font-mono text-[12.5px] leading-relaxed text-emerald-100 outline-none"
                  placeholder="HTML template με {{merge fields}}…"
                />
              ) : null}
              {tab === "css" ? (
                <textarea
                  ref={cssRef}
                  value={body.css}
                  onChange={(e) =>
                    patchLocalBody({ ...body, css: e.target.value })
                  }
                  spellCheck={false}
                  className="h-full min-h-[520px] w-full resize-none border-0 bg-[#0b1220] p-4 font-mono text-[12.5px] leading-relaxed text-sky-100 outline-none"
                  placeholder="CSS για τη φόρμα…"
                />
              ) : null}
              {tab === "preview" ? (
                <iframe
                  title="Print preview"
                  className="h-full min-h-[520px] w-full border-0 bg-slate-100"
                  sandbox=""
                  srcDoc={previewDoc}
                />
              ) : null}
            </div>
          </div>
        ) : (
          <div className="soft-panel grid place-items-center p-10 text-sm text-slate-500">
            Επιλέξτε φόρμα
          </div>
        )}

        <aside className="soft-panel flex max-h-[78vh] flex-col overflow-hidden">
          <div className="border-b border-slate-100 p-3">
            <p className="text-sm font-semibold text-ink-950">Merge fields</p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Κλικ για εισαγωγή στο HTML (ή CSS).
            </p>
            <input
              value={fieldQuery}
              onChange={(e) => setFieldQuery(e.target.value)}
              placeholder="Αναζήτηση…"
              className="mt-2 h-9 w-full rounded-lg border border-slate-200 px-2.5 text-sm"
            />
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-3">
            {filteredGroups.map((group) => (
              <div key={group.title}>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {group.title}
                </p>
                <ul className="space-y-1">
                  {group.fields.map((f) => (
                    <li key={f.token + f.label}>
                      <button
                        type="button"
                        onClick={() => insertToken(f.token)}
                        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition hover:border-teal-300 hover:bg-teal-50/50"
                      >
                        <span className="block text-xs font-medium text-ink-900">
                          {f.label}
                        </span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-400">
                          {f.token.replace(/\s+/g, " ").slice(0, 64)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {filteredGroups.length === 0 ? (
              <p className="text-center text-xs text-slate-500">Καμία αντιστοιχία</p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
