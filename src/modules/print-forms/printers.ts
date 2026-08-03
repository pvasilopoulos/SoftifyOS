/** Series / print-job destinations (ERP-style). */
export const PRINT_PRINTER_OPTIONS = [
  { code: "BROWSER", label: "Browser (διάλογος εκτύπωσης)" },
  { code: "PDF", label: "Αποθήκευση PDF" },
  { code: "NETWORK_FRONT", label: "Δικτυακός — Reception" },
  { code: "NETWORK_BACK", label: "Δικτυακός — Back office" },
  { code: "NETWORK_WAREHOUSE", label: "Δικτυακός — Αποθήκη" },
  { code: "FISCAL", label: "Φορολογικός μηχανισμός" },
  { code: "LABEL", label: "Εκτυπωτής ετικετών" },
] as const;

export type PrintPrinterCode = (typeof PRINT_PRINTER_OPTIONS)[number]["code"];

export const DEFAULT_PRINT_PRINTER: PrintPrinterCode = "BROWSER";
export const DEFAULT_PRINT_COPIES = 1;
export const MAX_PRINT_COPIES = 9;

export function printPrinterLabel(code: string | null | undefined): string {
  if (!code) return PRINT_PRINTER_OPTIONS[0]!.label;
  const known = PRINT_PRINTER_OPTIONS.find((p) => p.code === code);
  return known?.label ?? code;
}

export function normalizePrintCopies(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_PRINT_COPIES;
  return Math.min(MAX_PRINT_COPIES, Math.max(1, Math.trunc(n)));
}

export function normalizePrintPrinter(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === DEFAULT_PRINT_PRINTER) return null;
  return s.slice(0, 80);
}

/** Effective printer code for UI / print jobs (null → BROWSER). */
export function effectivePrintPrinter(
  code: string | null | undefined,
): string {
  return code?.trim() || DEFAULT_PRINT_PRINTER;
}

/**
 * Browser can drive BROWSER + PDF (Save as PDF in the print dialog).
 * Network / fiscal / label need an agent — we still open the preview.
 */
export function isBrowserPrintDestination(
  code: string | null | undefined,
): boolean {
  const p = effectivePrintPrinter(code);
  return p === "BROWSER" || p === "PDF";
}

/**
 * After issue / create-as-issued: open print when series has an explicit
 * destination (PDF, network, …). Default BROWSER (null) stays manual
 * via the PDF button — unless copies > 1.
 */
export function shouldAutoPrintAfterIssue(input: {
  printPrinter?: string | null;
  printCopies?: number | null;
}): boolean {
  if (input.printPrinter) return true;
  return normalizePrintCopies(input.printCopies ?? 1) > 1;
}

export function invoicePrintPath(
  invoiceId: string,
  opts?: { auto?: boolean },
): string {
  const q = opts?.auto ? "?auto=1" : "";
  return `/invoices/${invoiceId}/print${q}`;
}
