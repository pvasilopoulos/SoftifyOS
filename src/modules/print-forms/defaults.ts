import type { DocumentKind } from "@/generated/prisma/client";
import {
  DEFAULT_INVOICE_CSS,
  DEFAULT_INVOICE_HTML,
  DEFAULT_RECEIPT_CSS,
  DEFAULT_RECEIPT_HTML,
} from "./html-presets";

export type PrintBlockType =
  | "header"
  | "parties"
  | "meta"
  | "lines"
  | "totals"
  | "notes"
  | "footer"
  | "text"
  | "spacer";

export type PrintBlock = {
  id: string;
  type: PrintBlockType;
  label?: string;
  text?: string;
  showPaidBalance?: boolean;
};

/** Legacy block layout */
export type PrintFormBodyV1 = {
  version: 1;
  blocks: PrintBlock[];
};

/** Advanced HTML template engine */
export type PrintFormBodyV2 = {
  version: 2;
  engine: "html" | "blocks";
  html: string;
  css: string;
  /** Optional fallback / co-edit blocks */
  blocks?: PrintBlock[];
};

export type PrintFormBody = PrintFormBodyV1 | PrintFormBodyV2;

export const DEFAULT_BLOCKS: PrintBlock[] = [
  { id: "hdr", type: "header" },
  { id: "parties", type: "parties" },
  { id: "meta", type: "meta" },
  { id: "lines", type: "lines" },
  { id: "totals", type: "totals", showPaidBalance: true },
  { id: "notes", type: "notes" },
  {
    id: "footer",
    type: "footer",
    text: "Ευχαριστούμε για τη συνεργασία.",
  },
];

export const DEFAULT_INVOICE_PRINT_BODY: PrintFormBodyV2 = {
  version: 2,
  engine: "html",
  html: DEFAULT_INVOICE_HTML,
  css: DEFAULT_INVOICE_CSS,
  blocks: DEFAULT_BLOCKS,
};

export const DEFAULT_RECEIPT_PRINT_BODY: PrintFormBodyV2 = {
  version: 2,
  engine: "html",
  html: DEFAULT_RECEIPT_HTML,
  css: DEFAULT_RECEIPT_CSS,
  blocks: [
    { id: "hdr", type: "header" },
    { id: "meta", type: "meta" },
    { id: "lines", type: "lines" },
    { id: "totals", type: "totals", showPaidBalance: false },
    {
      id: "footer",
      type: "footer",
      text: "Απόδειξη λιανικής · SoftifyOS",
    },
  ],
};

export function isHtmlBody(
  body: PrintFormBody,
): body is PrintFormBodyV2 & { engine: "html" } {
  return (
    body.version === 2 &&
    body.engine === "html" &&
    typeof body.html === "string"
  );
}

export function parseBodyJson(raw: unknown): PrintFormBody {
  if (!raw || typeof raw !== "object") {
    return DEFAULT_INVOICE_PRINT_BODY;
  }
  const body = raw as Record<string, unknown>;

  if (body.version === 2) {
    const engine = body.engine === "blocks" ? "blocks" : "html";
    const blocks = Array.isArray(body.blocks) ? (body.blocks as PrintBlock[]) : [];
    return {
      version: 2,
      engine,
      html:
        typeof body.html === "string" && body.html.trim()
          ? body.html
          : DEFAULT_INVOICE_HTML,
      css: typeof body.css === "string" ? body.css : DEFAULT_INVOICE_CSS,
      blocks: blocks.length ? blocks : DEFAULT_BLOCKS,
    };
  }

  if (Array.isArray(body.blocks) && body.blocks.length > 0) {
    return { version: 1, blocks: body.blocks as PrintBlock[] };
  }

  return DEFAULT_INVOICE_PRINT_BODY;
}

/** Upgrade legacy v1 blocks → HTML template body (non-destructive copy) */
export function upgradeBodyToHtml(body: PrintFormBody): PrintFormBodyV2 {
  if (body.version === 2 && body.engine === "html") {
    return {
      version: 2,
      engine: "html",
      html: body.html || DEFAULT_INVOICE_HTML,
      css: body.css || DEFAULT_INVOICE_CSS,
      blocks: body.blocks?.length ? body.blocks : DEFAULT_BLOCKS,
    };
  }
  const blocks =
    body.version === 1
      ? body.blocks
      : body.blocks && body.blocks.length
        ? body.blocks
        : DEFAULT_BLOCKS;
  return {
    version: 2,
    engine: "html",
    html: DEFAULT_INVOICE_HTML,
    css: DEFAULT_INVOICE_CSS,
    blocks,
  };
}

export const DEFAULT_PRINT_FORMS: Array<{
  code: string;
  name: string;
  documentKind: DocumentKind;
  body: PrintFormBody;
  isDefault: boolean;
}> = [
  {
    code: "INV-STD",
    name: "Τιμολόγιο — HTML φόρμα",
    documentKind: "SALES_INVOICE",
    body: DEFAULT_INVOICE_PRINT_BODY,
    isDefault: true,
  },
  {
    code: "APY-STD",
    name: "ΑΠΥ — HTML φόρμα",
    documentKind: "RETAIL_RECEIPT",
    body: DEFAULT_RECEIPT_PRINT_BODY,
    isDefault: true,
  },
  {
    code: "CR-STD",
    name: "Πιστωτικό — HTML φόρμα",
    documentKind: "SALES_CREDIT",
    body: DEFAULT_INVOICE_PRINT_BODY,
    isDefault: true,
  },
];
