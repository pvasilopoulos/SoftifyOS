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

export const SCRIPT_SNIPPETS = [
  {
    id: "fail_vat",
    label: "Validation · ΑΦΜ",
    description: "api.fail αν λείπει ΑΦΜ",
    code: `  const vat = String(ctx.record.vatNumber || "").trim();
  if (!/^\\d{9}$/.test(vat)) {
    api.fail("Απαιτείται έγκυρο ΑΦΜ (9 ψηφία)");
  }
`,
  },
  {
    id: "set_defaults",
    label: "Defaults",
    description: "api.set για status / notes",
    code: `  if (!ctx.record.status) api.set("status", "ACTIVE");
  if (!ctx.record.notes) api.set("notes", "Από script hook");
`,
  },
  {
    id: "marketplace_post",
    label: "Marketplace POST",
    description: "api.http.post + secrets",
    code: `  const token = await api.secrets.get("MARKETPLACE_TOKEN");
  const res = await api.http.post(
    "https://api.marketplace.example/v1/customers",
    {
      externalId: ctx.record.id,
      code: ctx.record.code,
      name: ctx.record.name,
    },
    { headers: { Authorization: "Bearer " + token } },
  );
  api.log("marketplace", res.status, res.ok);
`,
  },
  {
    id: "diff_update",
    label: "Update diff",
    description: "Σύγκριση previous → record",
    code: `  const prev = ctx.previous || {};
  if (prev.status === "ACTIVE" && ctx.record.status === "INACTIVE") {
    api.log("deactivating", ctx.record.code);
  }
`,
  },
] as const;
