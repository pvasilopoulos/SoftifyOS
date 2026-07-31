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
  Copy,
  Eye,
  Plus,
  Save,
  Sparkles,
  Ruler,
  RotateCw,
  ZoomIn,
  ZoomOut,
  AlertTriangle,
  Blocks,
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
  type PrintPageSettings,
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
import {
  PAPER_PRESETS,
  pageFromPaperPreset,
  resolvePageSettings,
  type PrintPaperPreset,
} from "@/modules/print-forms/page-geometry";

type Kind = keyof typeof documentKindLabel;
type Paper = PrintPaperPreset;
type Orientation = "PORTRAIT" | "LANDSCAPE";

type Item = {
  id: string;
  code: string;
  name: string;
  documentKind: Kind;
  paper: Paper;
  orientation: Orientation;
  bodyJson: unknown;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
};

type EditorTab = "html" | "css" | "preview" | "page";

const HTML_SNIPPETS = [
  {
    id: "hr",
    label: "Οριζόντια γραμμή",
    code: `<hr style="border:0;border-top:1px solid #e2e8f0;margin:12px 0;" />\n`,
  },
  {
    id: "title",
    label: "Τίτλος εγγράφου",
    code: `<h1 style="margin:0 0 8px;font-size:20px;">{{doc.kindLabel}}</h1>\n`,
  },
  {
    id: "two_col",
    label: "Δύο στήλες",
    code: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
  <div>{{customer.name}}</div>
  <div style="text-align:right;">{{doc.number}}</div>
</div>\n`,
  },
  {
    id: "lines_table",
    label: "Πίνακας γραμμών",
    code: `<table style="width:100%;border-collapse:collapse;font-size:12px;">
  <thead>
    <tr>
      <th style="text-align:left;border-bottom:1px solid #cbd5e1;padding:6px;">Περιγραφή</th>
      <th style="text-align:right;border-bottom:1px solid #cbd5e1;padding:6px;">Ποσ.</th>
      <th style="text-align:right;border-bottom:1px solid #cbd5e1;padding:6px;">Τιμή</th>
      <th style="text-align:right;border-bottom:1px solid #cbd5e1;padding:6px;">Σύνολο</th>
    </tr>
  </thead>
  <tbody>
  {{#each lines}}
    <tr>
      <td style="padding:6px;border-bottom:1px solid #f1f5f9;">{{this.description}}</td>
      <td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:right;">{{this.quantity|number}}</td>
      <td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:right;">{{this.unitPrice|eur}}</td>
      <td style="padding:6px;border-bottom:1px solid #f1f5f9;text-align:right;">{{this.lineTotal|eur}}</td>
    </tr>
  {{/each}}
  </tbody>
</table>\n`,
  },
  {
    id: "totals",
    label: "Σύνολα",
    code: `<div style="margin-top:16px;text-align:right;">
  <div>Καθαρή αξία: <strong>{{doc.subtotal|eur}}</strong></div>
  <div>ΦΠΑ: <strong>{{doc.vatAmount|eur}}</strong></div>
  <div style="font-size:16px;margin-top:4px;">Σύνολο: <strong>{{doc.total|eur}}</strong></div>
</div>\n`,
  },
  {
    id: "if_notes",
    label: "Σημειώσεις (if)",
    code: `{{#if doc.notes}}
<p style="margin-top:16px;font-size:12px;color:#64748b;">
  <strong>Σημειώσεις:</strong> {{doc.notes}}
</p>
{{/if}}\n`,
  },
] as const;

const KNOWN_TOKENS = new Set(
  PRINT_MERGE_FIELDS.flatMap((g) =>
    g.fields.flatMap((f) => {
      const m = f.token.match(/\{\{\s*([\w.@|]+)/g);
      if (!m) return [];
      return m.map((t) => t.replace(/^\{\{\s*/, "").split("|")[0]!.trim());
    }),
  ).concat([
    "this",
    "this.description",
    "this.quantity",
    "this.unitPrice",
    "this.vatRate",
    "this.lineTotal",
    "@index",
    "@number",
    "lines",
    "doc.notes",
    "doc.subtotal",
    "doc.vatAmount",
    "doc.total",
    "doc.kindLabel",
    "doc.number",
  ]),
);

function toHtmlBody(raw: unknown): PrintFormBodyV2 {
  return upgradeBodyToHtml(parseBodyJson(raw));
}

function findUnknownTokens(html: string): string[] {
  const found = new Set<string>();
  const re = /\{\{(?:#(?:each|if|unless)\s+)?([\w.@]+)(?:\|[\w]+)?\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const path = m[1];
    if (!path) continue;
    if (path === "each" || path === "if" || path === "unless") continue;
    if (!KNOWN_TOKENS.has(path) && !path.startsWith("this.")) {
      found.add(path);
    }
  }
  return [...found].sort();
}

function MmInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-xs">
      <span className="mb-1 block font-medium text-slate-600">{label}</span>
      <div className="relative">
        <input
          type="number"
          min={0}
          step={0.5}
          disabled={disabled}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 pr-9 text-sm outline-none focus:border-teal-300 disabled:bg-slate-50 disabled:text-slate-400"
        />
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-slate-400">
          mm
        </span>
      </div>
    </label>
  );
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
  const [zoom, setZoom] = useState(0.85);
  const [dirty, setDirty] = useState(false);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const cssRef = useRef<HTMLTextAreaElement>(null);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const body = selected ? toHtmlBody(selected.bodyJson) : DEFAULT_INVOICE_PRINT_BODY;

  const page = useMemo(
    () =>
      resolvePageSettings({
        paper: selected?.paper ?? "A4",
        orientation: selected?.orientation ?? "PORTRAIT",
        page: body.page,
      }),
    [selected?.paper, selected?.orientation, body.page],
  );

  useEffect(() => {
    setTab("preview");
    setFieldQuery("");
    setDirty(false);
    setZoom(selected?.paper === "RECEIPT_80" ? 1.1 : 0.85);
  }, [selectedId, selected?.paper]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (selected) saveSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, body, items]);

  const previewDoc = useMemo(() => {
    const rendered = renderPrintTemplate(body.html, SAMPLE_PRINT_CONTEXT);
    return buildPrintDocument(rendered, body.css, page);
  }, [body.html, body.css, page]);

  const unknownTokens = useMemo(
    () => findUnknownTokens(body.html),
    [body.html],
  );

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
    if (res.ok) {
      setItems(data.items);
      setDirty(false);
    }
  };

  const patchLocalItem = (patch: Partial<Item>) => {
    if (!selected) return;
    setDirty(true);
    setItems((prev) =>
      prev.map((i) => (i.id === selected.id ? { ...i, ...patch } : i)),
    );
  };

  const patchLocalBody = (next: PrintFormBody) => {
    if (!selected) return;
    setDirty(true);
    setItems((prev) =>
      prev.map((i) => (i.id === selected.id ? { ...i, bodyJson: next } : i)),
    );
  };

  const patchPage = (partial: Partial<PrintPageSettings>, paper?: Paper) => {
    if (!selected) return;
    const nextPaper = paper ?? selected.paper;
    const nextPage =
      nextPaper === "CUSTOM"
        ? { ...page, ...partial }
        : pageFromPaperPreset(nextPaper, selected.orientation, {
            ...page,
            ...partial,
          });
    patchLocalBody({ ...body, page: nextPage });
    if (paper) patchLocalItem({ paper });
  };

  const setPaper = (paper: Paper) => {
    if (!selected) return;
    if (paper === "CUSTOM") {
      patchLocalItem({ paper });
      patchLocalBody({ ...body, page: { ...page } });
      return;
    }
    const next = pageFromPaperPreset(paper, selected.orientation, {
      marginTopMm: page.marginTopMm,
      marginRightMm: page.marginRightMm,
      marginBottomMm: page.marginBottomMm,
      marginLeftMm: page.marginLeftMm,
    });
    patchLocalItem({ paper });
    patchLocalBody({ ...body, page: next });
  };

  const setOrientation = (orientation: Orientation) => {
    if (!selected) return;
    const next =
      selected.paper === "CUSTOM"
        ? page
        : pageFromPaperPreset(selected.paper, orientation, {
            marginTopMm: page.marginTopMm,
            marginRightMm: page.marginRightMm,
            marginBottomMm: page.marginBottomMm,
            marginLeftMm: page.marginLeftMm,
          });
    patchLocalItem({ orientation });
    patchLocalBody({ ...body, page: next });
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
    const receipt = kind === "receipt";
    patchLocalBody({
      version: 2,
      engine: "html",
      html: receipt ? DEFAULT_RECEIPT_HTML : DEFAULT_INVOICE_HTML,
      css: receipt ? DEFAULT_RECEIPT_CSS : DEFAULT_INVOICE_CSS,
      page: receipt
        ? pageFromPaperPreset("RECEIPT_80", "PORTRAIT")
        : pageFromPaperPreset("A4", selected.orientation),
      blocks: body.blocks,
    });
    patchLocalItem({
      paper: receipt ? "RECEIPT_80" : "A4",
      orientation: receipt ? "PORTRAIT" : selected.orientation,
    });
    setTab("preview");
    setMessage(
      receipt
        ? "Φορτώθηκε preset ΑΠΥ HTML."
        : "Φορτώθηκε preset τιμολογίου HTML.",
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
            page: pageFromPaperPreset("RECEIPT_80", "PORTRAIT"),
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

  const duplicate = () => {
    if (!selected) return;
    const code = `${selected.code}-COPY`.slice(0, 40);
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/settings/print-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: `${selected.name} (αντίγραφο)`,
          documentKind: selected.documentKind,
          paper: selected.paper,
          orientation: selected.orientation,
          bodyJson: body,
          isDefault: false,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αντιγραφής");
        return;
      }
      setMessage("Δημιουργήθηκε αντίγραφο.");
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
    const bodyJson = patch?.bodyJson ?? {
      ...toHtmlBody(selected.bodyJson),
      page,
    };
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
      setMessage(
        unknownTokens.length
          ? `Αποθηκεύτηκε · προσοχή: άγνωστα tokens (${unknownTokens.slice(0, 3).join(", ")}${unknownTokens.length > 3 ? "…" : ""})`
          : "Αποθηκεύτηκε το HTML template.",
      );
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
            description="HTML/CSS, διαστάσεις χαρτιού, περιθώρια, merge fields και live preview."
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
                      <Badge tone="slate">{item.paper}</Badge>
                      {item.isDefault ? (
                        <Badge tone="emerald">Default</Badge>
                      ) : null}
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
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_160px]">
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Όνομα</span>
                  <input
                    value={selected.name}
                    onChange={(e) => patchLocalItem({ name: e.target.value })}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Χαρτί</span>
                  <select
                    value={selected.paper}
                    onChange={(e) => setPaper(e.target.value as Paper)}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3"
                  >
                    {(Object.keys(PAPER_PRESETS) as Array<
                      Exclude<Paper, "CUSTOM">
                    >).map((key) => (
                      <option key={key} value={key}>
                        {PAPER_PRESETS[key].label}
                      </option>
                    ))}
                    <option value="CUSTOM">Προσαρμοσμένο…</option>
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block font-medium">Προσανατολισμός</span>
                  <select
                    value={selected.orientation}
                    disabled={selected.paper === "RECEIPT_80"}
                    onChange={(e) =>
                      setOrientation(e.target.value as Orientation)
                    }
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 disabled:bg-slate-50"
                  >
                    <option value="PORTRAIT">Portrait</option>
                    <option value="LANDSCAPE">Landscape</option>
                  </select>
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                  {(
                    [
                      ["html", "HTML", Code2],
                      ["css", "CSS", Sparkles],
                      ["page", "Σελίδα", Ruler],
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
                <Button
                  size="sm"
                  variant="secondary"
                  type="button"
                  onClick={duplicate}
                  disabled={pending}
                >
                  <Copy size={14} /> Αντίγραφο
                </Button>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  {dirty ? (
                    <span className="text-[11px] font-medium text-amber-700">
                      Μη αποθηκευμένες αλλαγές
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      saveSelected({
                        name: selected.name,
                        paper: selected.paper,
                        orientation: selected.orientation,
                        bodyJson: { ...body, page },
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
                      saveSelected({
                        isDefault: true,
                        bodyJson: { ...body, page },
                      });
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
                        patchLocalItem({ isActive });
                        saveSelected({
                          isActive,
                          bodyJson: { ...body, page },
                        });
                      }}
                    />
                    Ενεργή
                  </label>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                {documentKindLabel[selected.documentKind]} ·{" "}
                {page.widthMm}×{page.heightMm} mm · περιθώρια{" "}
                {page.marginTopMm}/{page.marginRightMm}/{page.marginBottomMm}/
                {page.marginLeftMm} ·{" "}
                <span className="font-mono">{selected.code}</span>
                <span className="ml-2 text-slate-400">⌘/Ctrl+S αποθήκευση</span>
              </p>
              {unknownTokens.length > 0 ? (
                <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  Πιθανά άγνωστα merge tokens:{" "}
                  <span className="font-mono">
                    {unknownTokens.slice(0, 8).join(", ")}
                    {unknownTokens.length > 8 ? "…" : ""}
                  </span>
                </p>
              ) : null}
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
              {tab === "page" ? (
                <div className="space-y-5 overflow-y-auto p-5">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-950">
                      Διαστάσεις χαρτιού
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Οι τιμές περνάνε στο <code>@page size</code> για εκτύπωση
                      και στο live preview. Επίλεξε preset ή «Προσαρμοσμένο».
                    </p>
                  </div>
                  <div className="grid max-w-xl gap-3 sm:grid-cols-2">
                    <MmInput
                      label="Πλάτος"
                      value={page.widthMm}
                      disabled={selected.paper !== "CUSTOM"}
                      onChange={(widthMm) =>
                        patchPage({ widthMm }, "CUSTOM")
                      }
                    />
                    <MmInput
                      label="Ύψος"
                      value={page.heightMm}
                      disabled={selected.paper !== "CUSTOM"}
                      onChange={(heightMm) =>
                        patchPage({ heightMm }, "CUSTOM")
                      }
                    />
                  </div>
                  {selected.paper !== "CUSTOM" ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      type="button"
                      onClick={() => setPaper("CUSTOM")}
                    >
                      <Ruler size={14} /> Ξεκλείδωμα προσαρμοσμένων διαστάσεων
                    </Button>
                  ) : null}

                  <div>
                    <h3 className="text-sm font-semibold text-ink-950">
                      Περιθώρια (mm)
                    </h3>
                    <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <MmInput
                        label="Πάνω"
                        value={page.marginTopMm}
                        onChange={(marginTopMm) => patchPage({ marginTopMm })}
                      />
                      <MmInput
                        label="Δεξιά"
                        value={page.marginRightMm}
                        onChange={(marginRightMm) =>
                          patchPage({ marginRightMm })
                        }
                      />
                      <MmInput
                        label="Κάτω"
                        value={page.marginBottomMm}
                        onChange={(marginBottomMm) =>
                          patchPage({ marginBottomMm })
                        }
                      />
                      <MmInput
                        label="Αριστερά"
                        value={page.marginLeftMm}
                        onChange={(marginLeftMm) =>
                          patchPage({ marginLeftMm })
                        }
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-ink-900">
                      <RotateCw size={14} className="text-slate-400" />
                      Προεπισκόπηση πλαισίου
                    </div>
                    <div className="mt-3 flex justify-center overflow-auto py-4">
                      <div
                        className="relative bg-white shadow-md ring-1 ring-slate-200"
                        style={{
                          width: `${Math.max(60, page.widthMm * 0.45)}px`,
                          height: `${Math.max(80, page.heightMm * 0.45)}px`,
                        }}
                      >
                        <div
                          className="absolute inset-0 border border-dashed border-teal-300/80"
                          style={{
                            top: `${page.marginTopMm * 0.45}px`,
                            right: `${page.marginRightMm * 0.45}px`,
                            bottom: `${page.marginBottomMm * 0.45}px`,
                            left: `${page.marginLeftMm * 0.45}px`,
                          }}
                        />
                      </div>
                    </div>
                    <p className="text-center text-[11px] text-slate-500">
                      Λευκό = φύλλο · διακεκομμένο = printable area
                    </p>
                  </div>
                </div>
              ) : null}
              {tab === "preview" ? (
                <div className="flex h-full min-h-[520px] flex-col bg-slate-200/70">
                  <div className="flex items-center gap-2 border-b border-slate-200 bg-white/80 px-3 py-2">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() =>
                        setZoom((z) => Math.max(0.4, Number((z - 0.1).toFixed(2))))
                      }
                    >
                      <ZoomOut size={15} />
                    </button>
                    <span className="min-w-[3.5rem] text-center text-xs font-medium text-slate-600">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
                      onClick={() =>
                        setZoom((z) => Math.min(1.6, Number((z + 0.1).toFixed(2))))
                      }
                    >
                      <ZoomIn size={15} />
                    </button>
                    <span className="ml-auto text-[11px] text-slate-500">
                      {page.widthMm}×{page.heightMm} mm
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto p-4">
                    <div
                      className="mx-auto origin-top bg-white shadow-lg"
                      style={{
                        width: `${page.widthMm}mm`,
                        minHeight: `${page.heightMm}mm`,
                        transform: `scale(${zoom})`,
                        transformOrigin: "top center",
                      }}
                    >
                      <iframe
                        title="Print preview"
                        className="h-full min-h-[520px] w-full border-0"
                        style={{
                          height: `${page.heightMm}mm`,
                          width: `${page.widthMm}mm`,
                        }}
                        sandbox=""
                        srcDoc={previewDoc}
                      />
                    </div>
                  </div>
                </div>
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
            <div>
              <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                <Blocks size={11} /> HTML snippets
              </p>
              <ul className="space-y-1">
                {HTML_SNIPPETS.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => insertToken(s.code)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left text-xs font-medium text-ink-900 transition hover:border-teal-300 hover:bg-teal-50/50"
                    >
                      {s.label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
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
              <p className="text-center text-xs text-slate-500">
                Καμία αντιστοιχία
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </div>
  );
}
