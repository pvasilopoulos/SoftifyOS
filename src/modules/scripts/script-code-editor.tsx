"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { OnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";

const Monaco = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] items-center justify-center bg-[#0f172a] text-sm text-slate-400">
      Φόρτωση editor…
    </div>
  ),
});

export type ScriptCodeEditorHandle = {
  insertSnippet: (code: string) => void;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  height?: string | number;
  onCursorChange?: (line: number, column: number) => void;
  editorRef?: React.MutableRefObject<editor.IStandaloneCodeEditor | null>;
};

export function ScriptCodeEditor({
  value,
  onChange,
  readOnly,
  height = "100%",
  onCursorChange,
  editorRef,
}: Props) {
  const options = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      readOnly: Boolean(readOnly),
      fontSize: 13,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: true, scale: 1, maxColumn: 80 },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      insertSpaces: true,
      wordWrap: "on",
      lineNumbers: "on",
      renderLineHighlight: "line",
      roundedSelection: false,
      padding: { top: 12, bottom: 12 },
      suggestOnTriggerCharacters: true,
      quickSuggestions: true,
      snippetSuggestions: "inline",
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: true },
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
      },
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
    }),
    [readOnly],
  );

  const handleMount: OnMount = (ed, monaco) => {
    if (editorRef) editorRef.current = ed;

    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
      target: monaco.languages.typescript.ScriptTarget.ES2020,
      allowNonTsExtensions: true,
    });

    // SoftifyOS script API hints
    monaco.languages.typescript.javascriptDefaults.addExtraLib(
      `
declare const ctx: {
  module: string;
  eventKey: string;
  record: Record<string, unknown>;
  previous?: Record<string, unknown> | null;
  user?: { id: string; role?: string } | null;
  [key: string]: unknown;
};
declare const api: {
  get(path: string): unknown;
  set(path: string, value: unknown): void;
  fail(message: string): never;
  log(...args: unknown[]): void;
  secrets: { get(key: string): Promise<string> };
  http: {
    get(url: string, options?: { headers?: Record<string,string>; timeoutMs?: number }): Promise<{ok:boolean;status:number;headers:Record<string,string>;body:unknown}>;
    post(url: string, body?: unknown, options?: { headers?: Record<string,string>; timeoutMs?: number }): Promise<{ok:boolean;status:number;headers:Record<string,string>;body:unknown}>;
    put(url: string, body?: unknown, options?: { headers?: Record<string,string>; timeoutMs?: number }): Promise<{ok:boolean;status:number;headers:Record<string,string>;body:unknown}>;
    patch(url: string, body?: unknown, options?: { headers?: Record<string,string>; timeoutMs?: number }): Promise<{ok:boolean;status:number;headers:Record<string,string>;body:unknown}>;
    delete(url: string, options?: { headers?: Record<string,string>; timeoutMs?: number }): Promise<{ok:boolean;status:number;headers:Record<string,string>;body:unknown}>;
  };
};
declare function run(ctx: typeof ctx, api: typeof api): Promise<void> | void;
`,
      "ts:softifyos-script-api.d.ts",
    );

    ed.onDidChangeCursorPosition((e) => {
      onCursorChange?.(e.position.lineNumber, e.position.column);
    });

    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      // parent handles save via keyboard listener optionally
      window.dispatchEvent(new CustomEvent("softify:script-save"));
    });
  };

  return (
    <div className="h-full min-h-[320px] overflow-hidden rounded-b-xl bg-[#0f172a]">
      <Monaco
        language="javascript"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={options}
        onMount={handleMount}
        height={height}
        loading={
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            Φόρτωση Monaco…
          </div>
        }
      />
    </div>
  );
}

export type ScriptSnippet = {
  id: string;
  category: string;
  label: string;
  description: string;
  code: string;
};

export const SCRIPT_SNIPPET_CATEGORIES = [
  "Βασικά",
  "Validation",
  "Defaults",
  "Πελάτες",
  "Προϊόντα",
  "Παραγγελίες / Προσφορές",
  "Τιμολόγια",
  "Δωροκάρτες",
  "Form UI",
  "List / Kanban",
  "Marketplace HTTP",
  "Secrets & Logs",
  "Ρόλοι",
] as const;

export const SCRIPT_SNIPPETS: ScriptSnippet[] = [
  // ── Βασικά ──────────────────────────────────────────
  {
    id: "hello",
    category: "Βασικά",
    label: "Hello / log",
    description: "Ελάχιστο script με api.log",
    code: `  api.log("hello", ctx.module, ctx.eventKey, ctx.record && ctx.record.code);
`,
  },
  {
    id: "get_paths",
    category: "Βασικά",
    label: "api.get paths",
    description: "Ανάγνωση record / πεδίων",
    code: `  const all = api.get("record");
  const vat = api.get("vatNumber");
  const nested = api.get("record.customFields.tier");
  api.log("read", { vat, nested, keys: Object.keys(all || {}) });
`,
  },
  {
    id: "scaffold",
    category: "Βασικά",
    label: "Πλήρες scaffold",
    description: "async function run(ctx, api)",
    code: `async function run(ctx, api) {
  api.log("run", ctx.module, ctx.eventKey);
  // api.set("field", value);
  // api.fail("μήνυμα");
}
`,
  },

  // ── Validation ──────────────────────────────────────
  {
    id: "fail_vat",
    category: "Validation",
    label: "ΑΦΜ υποχρεωτικό",
    description: "api.fail αν λείπει / μη έγκυρο ΑΦΜ",
    code: `  const vat = String(ctx.record.vatNumber || "").trim();
  if (!vat) api.fail("Το ΑΦΜ είναι υποχρεωτικό");
  if (!/^\\d{9}$/.test(vat)) {
    api.fail("Το ΑΦΜ πρέπει να έχει 9 ψηφία");
  }
  api.log("vat ok", vat);
`,
  },
  {
    id: "fail_email_or_phone",
    category: "Validation",
    label: "Email ή τηλέφωνο",
    description: "Απαιτείται τουλάχιστον ένα",
    code: `  if (!ctx.record.email && !ctx.record.phone) {
    api.fail("Συμπλήρωσε email ή τηλέφωνο");
  }
`,
  },
  {
    id: "fail_email_format",
    category: "Validation",
    label: "Μορφή email",
    description: "Βασικός έλεγχος regex",
    code: `  const email = String(ctx.record.email || "").trim();
  if (email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
    api.fail("Μη έγκυρο email");
  }
`,
  },
  {
    id: "fail_code_required",
    category: "Validation",
    label: "Κωδικός υποχρεωτικός",
    description: "Trim + fail αν κενό",
    code: `  const code = String(ctx.record.code || "").trim();
  if (!code) api.fail("Ο κωδικός είναι υποχρεωτικός");
`,
  },
  {
    id: "fail_positive_number",
    category: "Validation",
    label: "Θετικός αριθμός",
    description: "Έλεγχος ποσού / τιμής",
    code: `  const n = Number(ctx.record.amount ?? ctx.record.price ?? ctx.record.total ?? 0);
  if (Number.isNaN(n) || n <= 0) {
    api.fail("Απαιτείται θετικό ποσό");
  }
`,
  },

  // ── Defaults ────────────────────────────────────────
  {
    id: "set_defaults",
    category: "Defaults",
    label: "Status + notes",
    description: "api.set για status / notes",
    code: `  if (!ctx.record.status) api.set("status", "ACTIVE");
  if (!ctx.record.notes) api.set("notes", "Από script hook");
`,
  },
  {
    id: "normalize_code",
    category: "Defaults",
    label: "Κανονικοποίηση code",
    description: "trim + UPPERCASE",
    code: `  const code = String(ctx.record.code || "").trim().toUpperCase();
  if (!code) api.fail("Ο κωδικός είναι υποχρεωτικός");
  api.set("code", code);
`,
  },
  {
    id: "custom_fields_source",
    category: "Defaults",
    label: "customFields.source",
    description: "Ορισμός custom field",
    code: `  api.set("customFields.source", "web");
  if (!api.get("customFields.tier")) {
    api.set("customFields.tier", "STANDARD");
  }
`,
  },
  {
    id: "append_note",
    category: "Defaults",
    label: "Προσθήκη σε notes",
    description: "Append timestamp tag",
    code: `  const stamp = new Date().toISOString().slice(0, 10);
  const notes = String(ctx.record.notes || "");
  if (!notes.includes("[script]")) {
    api.set("notes", (notes ? notes + "\\n" : "") + "[script] " + stamp);
  }
`,
  },

  // ── Πελάτες ─────────────────────────────────────────
  {
    id: "cust_block_vat_change",
    category: "Πελάτες",
    label: "Κλείδωμα ΑΦΜ",
    description: "before.update — απαγόρευση αλλαγής",
    code: `  const prev = ctx.previous || {};
  if (prev.vatNumber && ctx.record.vatNumber !== prev.vatNumber) {
    api.fail("Το ΑΦΜ δεν αλλάζει μετά τη δημιουργία");
  }
`,
  },
  {
    id: "cust_deactivate_note",
    category: "Πελάτες",
    label: "Απενεργοποίηση + σημείωση",
    description: "Απαιτεί λέξη «Απενεργοποίηση»",
    code: `  const prev = ctx.previous || {};
  if (prev.status === "ACTIVE" && ctx.record.status === "INACTIVE") {
    if (!String(ctx.record.notes || "").includes("Απενεργοποίηση")) {
      api.fail("Για απενεργοποίηση συμπλήρωσε σημείωση με τη λέξη «Απενεργοποίηση»");
    }
  }
`,
  },
  {
    id: "cust_reactivate_log",
    category: "Πελάτες",
    label: "Log επανενεργοποίησης",
    description: "INACTIVE → ACTIVE",
    code: `  const prev = ctx.previous || {};
  if (prev.status === "INACTIVE" && ctx.record.status === "ACTIVE") {
    api.log("reactivating customer", ctx.record.code);
  }
`,
  },
  {
    id: "cust_before_delete",
    category: "Πελάτες",
    label: "Μπλοκ διαγραφής ACTIVE",
    description: "before.delete",
    code: `  if (ctx.record.status === "ACTIVE") {
    api.fail("Απενεργοποίησε πρώτα τον πελάτη πριν τη διαγραφή");
  }
  api.log("delete allowed", ctx.record.id);
`,
  },
  {
    id: "cust_vies_enrich",
    category: "Πελάτες",
    label: "Lookup ΑΦΜ (GET)",
    description: "Εμπλουτισμός name από registry",
    code: `  const vat = String(ctx.record.vatNumber || "").trim();
  if (!vat) return;

  const token = await api.secrets.get("VIES_API_KEY");
  const res = await api.http.get(
    "https://registry.example.com/v1/vat/" + encodeURIComponent(vat),
    { headers: { "X-Api-Key": token }, timeoutMs: 4000 },
  );
  if (!res.ok) {
    api.log("registry miss", res.status);
    return;
  }
  if (res.body && res.body.name && !ctx.record.name) {
    api.set("name", res.body.name);
  }
  if (res.body && res.body.address) {
    api.set("notes", "Διεύθυνση registry: " + res.body.address);
  }
`,
  },

  // ── Προϊόντα ────────────────────────────────────────
  {
    id: "prod_price_check",
    category: "Προϊόντα",
    label: "Έλεγχος τιμής / SKU",
    description: "PRODUCTS · before.create",
    code: `  const price = Number(ctx.record.price);
  if (Number.isNaN(price) || price < 0) {
    api.fail("Μη έγκυρη τιμή");
  }
  if (price === 0) {
    api.set("notes", (ctx.record.notes || "") + " [ΔΩΡΕΑΝ]");
  }
  const sku = String(ctx.record.sku || "").trim().toUpperCase();
  api.set("sku", sku);
`,
  },
  {
    id: "prod_min_margin",
    category: "Προϊόντα",
    label: "Ελάχιστο περιθώριο",
    description: "price vs cost",
    code: `  const price = Number(ctx.record.price || 0);
  const cost = Number(ctx.record.cost || 0);
  if (cost > 0 && price < cost * 1.1) {
    api.fail("Η τιμή πρέπει να είναι ≥ 10% πάνω από το κόστος");
  }
`,
  },
  {
    id: "prod_barcode_normalize",
    category: "Προϊόντα",
    label: "Κανονικοποίηση barcode",
    description: "Ψηφία μόνο",
    code: `  const raw = String(ctx.record.barcode || "").replace(/\\D/g, "");
  if (ctx.record.barcode && !raw) {
    api.fail("Μη έγκυρο barcode");
  }
  if (raw) api.set("barcode", raw);
`,
  },

  // ── Παραγγελίες / Προσφορές ──────────────────────────
  {
    id: "order_min_total",
    category: "Παραγγελίες / Προσφορές",
    label: "Ελάχιστο σύνολο παραγγελίας",
    description: "ORDERS · before.create",
    code: `  const total = Number(ctx.record.total || 0);
  if (total > 0 && total < 10) {
    api.fail("Ελάχιστο σύνολο παραγγελίας 10€");
  }
`,
  },
  {
    id: "order_require_customer",
    category: "Παραγγελίες / Προσφορές",
    label: "Υποχρεωτικός πελάτης",
    description: "ORDERS / QUOTES",
    code: `  if (!ctx.record.customerId) {
    api.fail("Επίλεξε πελάτη");
  }
`,
  },
  {
    id: "quote_valid_until",
    category: "Παραγγελίες / Προσφορές",
    label: "Προσφορά · λήξη +30ημ",
    description: "QUOTES · before.create",
    code: `  if (!ctx.record.validUntil) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    api.set("validUntil", d.toISOString().slice(0, 10));
  }
`,
  },
  {
    id: "order_status_guard",
    category: "Παραγγελίες / Προσφορές",
    label: "Φύλαξη status παραγγελίας",
    description: "Απαγόρευση CANCELLED χωρίς λόγο",
    code: `  const prev = ctx.previous || {};
  if (prev.status !== "CANCELLED" && ctx.record.status === "CANCELLED") {
    if (!String(ctx.record.notes || "").trim()) {
      api.fail("Για ακύρωση συμπλήρωσε σημείωση");
    }
  }
`,
  },

  // ── Τιμολόγια ───────────────────────────────────────
  {
    id: "inv_before_issue",
    category: "Τιμολόγια",
    label: "Πριν την έκδοση",
    description: "invoice.beforeIssue",
    code: `  if (!ctx.record.customerId) {
    api.fail("Λείπει πελάτης");
  }
  const total = Number(ctx.record.total || 0);
  if (total <= 0) {
    api.fail("Δεν εκδίδεται τιμολόγιο με μηδενικό σύνολο");
  }
  api.log("issue checks ok", ctx.record.number);
`,
  },
  {
    id: "inv_after_issue_sync",
    category: "Τιμολόγια",
    label: "Μετά έκδοση → marketplace",
    description: "invoice.afterIssue soft sync",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.post(
    "https://api.marketplace.example/v1/invoices",
    {
      externalId: ctx.record.id,
      number: ctx.record.number,
      total: ctx.record.total,
      issuedAt: ctx.record.issuedAt || new Date().toISOString(),
    },
    { headers: { Authorization: "Bearer " + token } },
  );
  if (!res.ok) {
    api.log("invoice sync failed", res.status, res.body);
  } else {
    api.log("invoice synced", res.body);
  }
`,
  },
  {
    id: "inv_require_lines",
    category: "Τιμολόγια",
    label: "Υποχρεωτικές γραμμές",
    description: "before.create / beforeIssue",
    code: `  const lines = ctx.record.lines || ctx.record.items || [];
  if (!Array.isArray(lines) || lines.length === 0) {
    api.fail("Πρόσθεσε τουλάχιστον μία γραμμή");
  }
`,
  },

  // ── Δωροκάρτες ──────────────────────────────────────
  {
    id: "gift_amount_cap",
    category: "Δωροκάρτες",
    label: "Όριο ποσού δωροκάρτας",
    description: "GIFT_CARDS · before.create",
    code: `  const amount = Number(ctx.record.amount || 0);
  if (amount <= 0) api.fail("Το ποσό πρέπει να είναι θετικό");
  if (amount > 500) {
    api.fail("Μέγιστο ποσό δωροκάρτας 500€ χωρίς έγκριση");
  }
`,
  },
  {
    id: "gift_default_currency",
    category: "Δωροκάρτες",
    label: "Default νόμισμα EUR",
    description: "api.set currency",
    code: `  if (!ctx.record.currency) api.set("currency", "EUR");
`,
  },

  // ── Form UI ─────────────────────────────────────────
  {
    id: "form_onload",
    category: "Form UI",
    label: "form.onLoad defaults",
    description: "Defaults σε create mode",
    code: `  api.log("form load", ctx.mode);
  if (ctx.mode === "create" && !ctx.record.status) {
    api.set("status", "ACTIVE");
  }
`,
  },
  {
    id: "form_field_change",
    category: "Form UI",
    label: "form.onFieldChange",
    description: "Αντίδραση σε αλλαγή πεδίου",
    code: `  if (ctx.field === "status" && ctx.value === "INACTIVE") {
    api.log("user set inactive");
  }
  if (ctx.field === "vatNumber") {
    const vat = String(ctx.value || "").trim();
    if (vat && !/^\\d{9}$/.test(vat)) {
      api.fail("Το ΑΦΜ πρέπει να έχει 9 ψηφία");
    }
  }
`,
  },
  {
    id: "form_before_submit",
    category: "Form UI",
    label: "form.beforeSubmit",
    description: "Τελικός έλεγχος πριν το save",
    code: `  if (!ctx.record.email && !ctx.record.phone) {
    api.fail("Συμπλήρωσε email ή τηλέφωνο");
  }
  const name = String(ctx.record.name || "").trim();
  if (!name) api.fail("Το όνομα είναι υποχρεωτικό");
`,
  },
  {
    id: "form_auto_code_from_name",
    category: "Form UI",
    label: "Auto code από name",
    description: "onFieldChange · name → code",
    code: `  if (ctx.field === "name" && ctx.mode === "create") {
    const slug = String(ctx.value || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 20);
    if (slug && !ctx.record.code) api.set("code", slug);
  }
`,
  },

  // ── List / Kanban ───────────────────────────────────
  {
    id: "list_row_click",
    category: "List / Kanban",
    label: "list.onRowClick",
    description: "Log κλικ γραμμής",
    code: `  api.log("row click", ctx.row && ctx.row.id, ctx.row && ctx.row.code);
`,
  },
  {
    id: "kanban_move",
    category: "List / Kanban",
    label: "list.onKanbanMove",
    description: "Έλεγχος μετακίνησης στήλης",
    code: `  api.log("kanban", ctx.from, "→", ctx.to, ctx.row && ctx.row.id);
  if (ctx.to === "INACTIVE" && ctx.user && ctx.user.role === "MEMBER") {
    api.fail("Τα μέλη δεν απενεργοποιούν από kanban");
  }
`,
  },

  // ── Marketplace HTTP ────────────────────────────────
  {
    id: "marketplace_post",
    category: "Marketplace HTTP",
    label: "POST after.create",
    description: "api.http.post + secrets",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.post(
    "https://api.marketplace.example/v1/customers",
    {
      externalId: ctx.record.id,
      code: ctx.record.code,
      name: ctx.record.name,
      vatNumber: ctx.record.vatNumber,
      email: ctx.record.email,
    },
    {
      headers: {
        Authorization: "Bearer " + token,
        "X-Tenant": "softifyos",
      },
      timeoutMs: 5000,
    },
  );
  if (!res.ok) {
    api.fail("Αποτυχία sync marketplace: HTTP " + res.status);
  }
  api.log("marketplace synced", res.body);
`,
  },
  {
    id: "marketplace_soft",
    category: "Marketplace HTTP",
    label: "Soft sync (χωρίς fail)",
    description: "Best-effort · δεν μπλοκάρει save",
    code: `  try {
    const token = await api.secrets.get("MARKETPLACE_TOKEN");
    const res = await api.http.post(
      "https://api.marketplace.example/v1/customers",
      { externalId: ctx.record.id, name: ctx.record.name },
      { headers: { Authorization: "Bearer " + token } },
    );
    api.log("sync", res.status, res.ok);
  } catch (e) {
    api.log("sync skipped", String(e && e.message ? e.message : e));
  }
`,
  },
  {
    id: "marketplace_patch",
    category: "Marketplace HTTP",
    label: "PATCH μόνο αλλαγές",
    description: "after.update · diff fields",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const prev = ctx.previous || {};
  const next = ctx.record || {};
  const changed = {};
  for (const key of ["name", "email", "phone", "status", "vatNumber"]) {
    if (prev[key] !== next[key]) changed[key] = next[key];
  }
  if (Object.keys(changed).length === 0) {
    api.log("no relevant changes");
    return;
  }
  const res = await api.http.patch(
    "https://api.marketplace.example/v1/customers/" + next.id,
    changed,
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("patched", res.status, changed);
`,
  },
  {
    id: "marketplace_delete",
    category: "Marketplace HTTP",
    label: "DELETE after.delete",
    description: "Απομακρυσμένη διαγραφή",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  await api.http.delete(
    "https://api.marketplace.example/v1/customers/" + ctx.record.id,
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("remote deleted", ctx.record.id);
`,
  },
  {
    id: "marketplace_put",
    category: "Marketplace HTTP",
    label: "PUT πλήρες sync",
    description: "api.http.put",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.put(
    "https://api.marketplace.example/v1/customers/" + ctx.record.id,
    {
      code: ctx.record.code,
      name: ctx.record.name,
      status: ctx.record.status,
    },
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("put", res.status, res.ok);
`,
  },
  {
    id: "http_get_enrich",
    category: "Marketplace HTTP",
    label: "GET εμπλουτισμός",
    description: "before.create · external lookup",
    code: `  const code = String(ctx.record.code || "").trim();
  if (!code) return;
  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.get(
    "https://api.marketplace.example/v1/lookup?code=" + encodeURIComponent(code),
    { headers: { Authorization: "Bearer " + token }, timeoutMs: 4000 },
  );
  if (res.ok && res.body) {
    if (res.body.name && !ctx.record.name) api.set("name", res.body.name);
    api.log("enriched", res.body);
  }
`,
  },

  // ── Secrets & Logs ──────────────────────────────────
  {
    id: "secrets_get",
    category: "Secrets & Logs",
    label: "Ανάγνωση secret",
    description: "api.secrets.get",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  api.log("secret loaded", Boolean(token));
`,
  },
  {
    id: "log_context",
    category: "Secrets & Logs",
    label: "Πλούσιο logging",
    description: "module / event / user / keys",
    code: `  api.log("ctx", {
    module: ctx.module,
    event: ctx.eventKey,
    user: ctx.user,
    id: ctx.record && ctx.record.id,
    keys: Object.keys(ctx.record || {}),
  });
`,
  },
  {
    id: "diff_update",
    category: "Secrets & Logs",
    label: "Update diff",
    description: "Σύγκριση previous → record",
    code: `  const prev = ctx.previous || {};
  const next = ctx.record || {};
  const changed = [];
  for (const key of Object.keys(next)) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(next[key])) {
      changed.push(key);
    }
  }
  api.log("changed fields", changed);
  if (prev.status === "ACTIVE" && next.status === "INACTIVE") {
    api.log("deactivating", next.code);
  }
`,
  },

  // ── Ρόλοι ───────────────────────────────────────────
  {
    id: "role_viewer_block",
    category: "Ρόλοι",
    label: "Μπλοκ VIEWER",
    description: "Απαγόρευση επεξεργασίας",
    code: `  if (ctx.user && ctx.user.role === "VIEWER") {
    api.fail("Δεν επιτρέπεται επεξεργασία");
  }
`,
  },
  {
    id: "role_status_admin",
    category: "Ρόλοι",
    label: "Status μόνο ADMIN/OWNER",
    description: "before.update",
    code: `  const prev = ctx.previous || {};
  if (
    prev.status !== ctx.record.status &&
    ctx.user &&
    ctx.user.role !== "OWNER" &&
    ctx.user.role !== "ADMIN"
  ) {
    api.fail("Μόνο διαχειριστής μπορεί να αλλάξει κατάσταση");
  }
`,
  },
  {
    id: "role_member_amount",
    category: "Ρόλοι",
    label: "MEMBER όριο ποσού",
    description: "Μεγάλα ποσά μόνο admin",
    code: `  const amount = Number(ctx.record.total || ctx.record.amount || 0);
  if (
    amount > 1000 &&
    ctx.user &&
    ctx.user.role === "MEMBER"
  ) {
    api.fail("Ποσά > 1000€ απαιτούν διαχειριστή");
  }
`,
  },
];
