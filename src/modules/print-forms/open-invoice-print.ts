"use client";

import {
  invoicePrintPath,
  shouldAutoPrintAfterIssue,
} from "@/modules/print-forms/printers";

/** Open a blank tab synchronously (avoids popup blockers after await). */
export function preparePrintWindow(): Window | null {
  if (typeof window === "undefined") return null;
  try {
    return window.open("about:blank", "_blank");
  } catch {
    return null;
  }
}

export function navigatePrintWindow(
  win: Window | null | undefined,
  invoiceId: string,
  opts?: { auto?: boolean },
) {
  if (typeof window === "undefined") return;
  const url = invoicePrintPath(invoiceId, opts);
  if (win && !win.closed) {
    win.location.href = url;
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Open invoice print preview (new tab). */
export function openInvoicePrint(
  invoiceId: string,
  opts?: { auto?: boolean },
) {
  navigatePrintWindow(null, invoiceId, opts);
}

/** After issue / issued-create: open print when series asks for it. */
export function maybeAutoPrintAfterIssue(
  invoiceId: string,
  series?: {
    printPrinter?: string | null;
    printCopies?: number | null;
  } | null,
  preparedWindow?: Window | null,
) {
  if (!series || !shouldAutoPrintAfterIssue(series)) {
    if (preparedWindow && !preparedWindow.closed) preparedWindow.close();
    return false;
  }
  navigatePrintWindow(preparedWindow, invoiceId, { auto: true });
  return true;
}
