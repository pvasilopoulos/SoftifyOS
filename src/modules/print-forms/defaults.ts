import type { DocumentKind, PrintOrientation, PrintPaperSize } from "@/generated/prisma/client";
import {
  DEFAULT_INVOICE_CSS,
  DEFAULT_INVOICE_HTML,
  DEFAULT_RECEIPT_CSS,
  DEFAULT_RECEIPT_HTML,
} from "./html-presets";
import {
  ADVANCED_DELIVERY_CSS,
  ADVANCED_DELIVERY_HTML,
  ADVANCED_INVOICE_BILINGUAL_CSS,
  ADVANCED_INVOICE_BILINGUAL_HTML,
  ADVANCED_INVOICE_PRO_CSS,
  ADVANCED_INVOICE_PRO_HTML,
  ADVANCED_INVOICE_VAT_CSS,
  ADVANCED_INVOICE_VAT_HTML,
  ADVANCED_ORDER_CSS,
  ADVANCED_ORDER_HTML,
  ADVANCED_QUOTE_CSS,
  ADVANCED_QUOTE_HTML,
  ADVANCED_RECEIPT_58_CSS,
  ADVANCED_RECEIPT_58_HTML,
  bodyFromHtmlCss,
} from "./advanced-presets";
import {
  DEFAULT_PAGE_SETTINGS,
  normalizePageSettings,
  type PrintPageSettings,
} from "./page-geometry";

export type { PrintPageSettings };

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
  /** Page box (mm) — drives @page + preview */
  page?: PrintPageSettings;
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
  page: { ...DEFAULT_PAGE_SETTINGS },
  blocks: DEFAULT_BLOCKS,
};

export const DEFAULT_RECEIPT_PRINT_BODY: PrintFormBodyV2 = {
  version: 2,
  engine: "html",
  html: DEFAULT_RECEIPT_HTML,
  css: DEFAULT_RECEIPT_CSS,
  page: {
    widthMm: 80,
    heightMm: 297,
    marginTopMm: 4,
    marginRightMm: 4,
    marginBottomMm: 4,
    marginLeftMm: 4,
  },
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

function parsePage(raw: unknown): PrintPageSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return normalizePageSettings(raw as Partial<PrintPageSettings>);
}

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
    const page = parsePage(body.page);
    return {
      version: 2,
      engine,
      html:
        typeof body.html === "string" && body.html.trim()
          ? body.html
          : DEFAULT_INVOICE_HTML,
      css: typeof body.css === "string" ? body.css : DEFAULT_INVOICE_CSS,
      ...(page ? { page } : {}),
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
      page: body.page ? normalizePageSettings(body.page) : { ...DEFAULT_PAGE_SETTINGS },
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
    page: { ...DEFAULT_PAGE_SETTINGS },
    blocks,
  };
}

export const DEFAULT_PRINT_FORMS: Array<{
  code: string;
  name: string;
  documentKind: DocumentKind;
  body: PrintFormBody;
  isDefault: boolean;
  paper?: PrintPaperSize;
  orientation?: PrintOrientation;
}> = [
  {
    code: "INV-STD",
    name: "Τιμολόγιο — HTML φόρμα",
    documentKind: "SALES_INVOICE",
    body: DEFAULT_INVOICE_PRINT_BODY,
    isDefault: true,
    paper: "A4",
  },
  {
    code: "INV-PRO",
    name: "Τιμολόγιο Pro — τράπεζα & υπογραφές",
    documentKind: "SALES_INVOICE",
    body: bodyFromHtmlCss(ADVANCED_INVOICE_PRO_HTML, ADVANCED_INVOICE_PRO_CSS),
    isDefault: false,
    paper: "A4",
  },
  {
    code: "INV-BIL",
    name: "Τιμολόγιο δίγλωσσο EL/EN",
    documentKind: "SALES_INVOICE",
    body: bodyFromHtmlCss(
      ADVANCED_INVOICE_BILINGUAL_HTML,
      ADVANCED_INVOICE_BILINGUAL_CSS,
    ),
    isDefault: false,
    paper: "A4",
  },
  {
    code: "INV-VAT",
    name: "Τιμολόγιο — ανάλυση ΦΠΑ",
    documentKind: "SALES_INVOICE",
    body: bodyFromHtmlCss(ADVANCED_INVOICE_VAT_HTML, ADVANCED_INVOICE_VAT_CSS),
    isDefault: false,
    paper: "A4",
  },
  {
    code: "APY-STD",
    name: "ΑΠΥ — HTML φόρμα",
    documentKind: "RETAIL_RECEIPT",
    body: DEFAULT_RECEIPT_PRINT_BODY,
    isDefault: true,
    paper: "RECEIPT_80",
  },
  {
    code: "APY-58",
    name: "ΑΠΥ Thermal 58mm",
    documentKind: "RETAIL_RECEIPT",
    body: bodyFromHtmlCss(ADVANCED_RECEIPT_58_HTML, ADVANCED_RECEIPT_58_CSS, {
      widthMm: 58,
      heightMm: 200,
      marginTopMm: 2,
      marginRightMm: 2,
      marginBottomMm: 2,
      marginLeftMm: 2,
    }),
    isDefault: false,
    paper: "CUSTOM",
  },
  {
    code: "CR-STD",
    name: "Πιστωτικό — HTML φόρμα",
    documentKind: "SALES_CREDIT",
    body: DEFAULT_INVOICE_PRINT_BODY,
    isDefault: true,
    paper: "A4",
  },
  {
    code: "CR-PRO",
    name: "Πιστωτικό Pro",
    documentKind: "SALES_CREDIT",
    body: bodyFromHtmlCss(ADVANCED_INVOICE_PRO_HTML, ADVANCED_INVOICE_PRO_CSS),
    isDefault: false,
    paper: "A4",
  },
  {
    code: "QUO-PRO",
    name: "Προσφορά / Proforma",
    documentKind: "SALES_QUOTE",
    body: bodyFromHtmlCss(ADVANCED_QUOTE_HTML, ADVANCED_QUOTE_CSS),
    isDefault: true,
    paper: "A4",
  },
  {
    code: "ORD-CONF",
    name: "Επιβεβαίωση παραγγελίας",
    documentKind: "SALES_ORDER",
    body: bodyFromHtmlCss(ADVANCED_ORDER_HTML, ADVANCED_ORDER_CSS),
    isDefault: true,
    paper: "A4",
  },
  {
    code: "DN-PACK",
    name: "Δελτίο αποστολής / Packing list",
    documentKind: "DELIVERY_NOTE",
    body: bodyFromHtmlCss(ADVANCED_DELIVERY_HTML, ADVANCED_DELIVERY_CSS),
    isDefault: true,
    paper: "A4",
  },
];
