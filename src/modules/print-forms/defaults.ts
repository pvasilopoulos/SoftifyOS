import type { DocumentKind } from "@/generated/prisma/client";

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

export type PrintFormBody = {
  version: 1;
  blocks: PrintBlock[];
};

export const DEFAULT_INVOICE_PRINT_BODY: PrintFormBody = {
  version: 1,
  blocks: [
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
  ],
};

export function parseBodyJson(raw: unknown): PrintFormBody {
  if (!raw || typeof raw !== "object") {
    return { version: 1, blocks: [{ id: "hdr", type: "header" }] };
  }
  const body = raw as PrintFormBody;
  if (!Array.isArray(body.blocks)) {
    return { version: 1, blocks: [{ id: "hdr", type: "header" }] };
  }
  return { version: 1, blocks: body.blocks };
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
    name: "Τιμολόγιο — τυπική φόρμα",
    documentKind: "SALES_INVOICE",
    body: DEFAULT_INVOICE_PRINT_BODY,
    isDefault: true,
  },
  {
    code: "APY-STD",
    name: "ΑΠΥ — τυπική φόρμα",
    documentKind: "RETAIL_RECEIPT",
    body: {
      version: 1,
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
    },
    isDefault: true,
  },
  {
    code: "CR-STD",
    name: "Πιστωτικό — τυπική φόρμα",
    documentKind: "SALES_CREDIT",
    body: DEFAULT_INVOICE_PRINT_BODY,
    isDefault: true,
  },
];
