/** Safe-ish HTML sanitize for admin-authored print templates */
import { buildPageCss } from "./page-geometry";

export function sanitizePrintHtml(input: string): string {
  let html = input;
  html = html.replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, "");
  html = html.replace(/<\s*iframe[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, "");
  html = html.replace(/<\s*object[^>]*>[\s\S]*?<\s*\/\s*object\s*>/gi, "");
  html = html.replace(/<\s*embed[^>]*\/?>/gi, "");
  html = html.replace(/<\s*link[^>]*\/?>/gi, "");
  html = html.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  html = html.replace(
    /(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi,
    '$1=$2#$2',
  );
  return html;
}

export function sanitizePrintCss(input: string): string {
  let css = input;
  css = css.replace(/@import\b[^;]*;?/gi, "");
  css = css.replace(/expression\s*\(/gi, "/*blocked*/(");
  css = css.replace(/javascript\s*:/gi, "blocked:");
  css = css.replace(/url\s*\(\s*["']?\s*javascript:/gi, "url(blocked:");
  return css;
}

function getPath(ctx: Record<string, unknown>, path: string): unknown {
  const parts = path.trim().split(".").filter(Boolean);
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function escapeHtml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatValue(value: unknown, filter?: string): string {
  if (value == null) return "";
  if (filter === "raw") return String(value);
  if (filter === "eur") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n)) return escapeHtml(value);
    return escapeHtml(
      new Intl.NumberFormat("el-GR", {
        style: "currency",
        currency: "EUR",
      }).format(n),
    );
  }
  if (filter === "date") {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return escapeHtml(value);
    return escapeHtml(d.toLocaleDateString("el-GR"));
  }
  if (filter === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(n)) return escapeHtml(value);
    return escapeHtml(
      new Intl.NumberFormat("el-GR", { maximumFractionDigits: 3 }).format(n),
    );
  }
  if (typeof value === "boolean") return value ? "Ναι" : "Όχι";
  return escapeHtml(value);
}

/**
 * Minimal template engine:
 * - {{path}} {{path|eur}} {{path|date}} {{path|number}} {{path|raw}}
 * - {{#each lines}} ... {{this.field}} ... {{/each}}
 * - {{#if path}} ... {{/if}}
 * - {{#unless path}} ... {{/unless}}
 */
export function renderPrintTemplate(
  template: string,
  context: Record<string, unknown>,
): string {
  let out = template;

  // each loops (non-greedy, nested one level ok for lines)
  out = out.replace(
    /\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g,
    (_m, path: string, inner: string) => {
      const arr = getPath(context, path);
      if (!Array.isArray(arr) || arr.length === 0) return "";
      return arr
        .map((item, index) => {
          const rowCtx: Record<string, unknown> = {
            ...context,
            this: item,
            "@index": index,
            "@number": index + 1,
          };
          return renderPrintTemplate(inner, rowCtx);
        })
        .join("");
    },
  );

  out = out.replace(
    /\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g,
    (_m, path: string, inner: string) => {
      const v = getPath(context, path);
      const ok = Array.isArray(v) ? v.length > 0 : Boolean(v);
      return ok ? renderPrintTemplate(inner, context) : "";
    },
  );

  out = out.replace(
    /\{\{#unless\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/unless\}\}/g,
    (_m, path: string, inner: string) => {
      const v = getPath(context, path);
      const ok = Array.isArray(v) ? v.length > 0 : Boolean(v);
      return ok ? "" : renderPrintTemplate(inner, context);
    },
  );

  out = out.replace(
    /\{\{\s*([\w.@]+)(?:\|(\w+))?\s*\}\}/g,
    (_m, path: string, filter?: string) => {
      if (path === "this") return formatValue(context.this, filter);
      if (path.startsWith("this.")) {
        return formatValue(
          getPath({ this: context.this }, path),
          filter,
        );
      }
      return formatValue(getPath(context, path), filter);
    },
  );

  return out;
}

export function buildPrintDocument(
  html: string,
  css: string,
  page?: {
    widthMm: number;
    heightMm: number;
    marginTopMm: number;
    marginRightMm: number;
    marginBottomMm: number;
    marginLeftMm: number;
  },
): string {
  const safeHtml = sanitizePrintHtml(html);
  const safeCss = sanitizePrintCss(css);
  const pageCss = page
    ? buildPageCss(page)
    : `@page { margin: 12mm; }
html, body { margin: 0; padding: 0; font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif; color: #0f172a; font-size: 12px; }
* { box-sizing: border-box; }`;
  return `<!DOCTYPE html><html lang="el"><head><meta charset="utf-8"/><style>
${pageCss}
${safeCss}
</style></head><body>${safeHtml}</body></html>`;
}
