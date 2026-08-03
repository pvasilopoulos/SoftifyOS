"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Printer } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DEFAULT_PRINT_COPIES,
  DEFAULT_PRINT_PRINTER,
  MAX_PRINT_COPIES,
  PRINT_PRINTER_OPTIONS,
  effectivePrintPrinter,
  isBrowserPrintDestination,
  normalizePrintCopies,
  printPrinterLabel,
} from "@/modules/print-forms/printers";

export function PrintControls({
  invoiceNumber,
  defaultCopies = DEFAULT_PRINT_COPIES,
  defaultPrinter = DEFAULT_PRINT_PRINTER,
  autoPrint = false,
}: {
  invoiceNumber: string;
  defaultCopies?: number;
  defaultPrinter?: string | null;
  /** When true (e.g. after issue), open the print dialog once loaded. */
  autoPrint?: boolean;
}) {
  const [copies, setCopies] = useState(() =>
    normalizePrintCopies(defaultCopies),
  );
  const [printer, setPrinter] = useState(() =>
    effectivePrintPrinter(defaultPrinter),
  );
  const [hint, setHint] = useState<string | null>(null);
  const autoDone = useRef(false);

  const printerOptions = useMemo(() => {
    const codes = new Set(PRINT_PRINTER_OPTIONS.map((p) => p.code as string));
    if (printer && !codes.has(printer)) {
      return [
        ...PRINT_PRINTER_OPTIONS,
        { code: printer, label: printPrinterLabel(printer) },
      ];
    }
    return PRINT_PRINTER_OPTIONS;
  }, [printer]);

  const runPrint = () => {
    setHint(null);
    const n = normalizePrintCopies(copies);
    const dest = effectivePrintPrinter(printer);

    // Clone preview N times for physical multi-copy print sets.
    const root = document.getElementById("invoice-print-root");
    const host = document.getElementById("invoice-print-copies-host");
    if (root && host && n > 1 && isBrowserPrintDestination(dest)) {
      host.innerHTML = "";
      for (let i = 1; i < n; i += 1) {
        const clone = root.cloneNode(true) as HTMLElement;
        clone.removeAttribute("id");
        clone.classList.add("print-copy-clone");
        const badge = document.createElement("div");
        badge.className = "print-copy-badge";
        badge.textContent = `Αντίτυπο ${i + 1}/${n}`;
        clone.prepend(badge);
        host.appendChild(clone);
      }
      const firstBadge = root.querySelector(".print-copy-badge");
      if (!firstBadge) {
        const badge = document.createElement("div");
        badge.className = "print-copy-badge";
        badge.textContent = `Αντίτυπο 1/${n}`;
        root.prepend(badge);
      } else {
        firstBadge.textContent = `Αντίτυπο 1/${n}`;
      }
    } else if (host) {
      host.innerHTML = "";
      root?.querySelector(".print-copy-badge")?.remove();
    }

    if (!isBrowserPrintDestination(dest)) {
      setHint(
        `Ουρά προς ${printPrinterLabel(dest)} · ${n} αντίτυπ${n === 1 ? "ο" : "α"} (απαιτείται print agent/spooler).`,
      );
      return;
    }

    if (dest === "PDF") {
      setHint(
        "Στον διάλογο εκτύπωσης επίλεξε προορισμό «Αποθήκευση ως PDF» / Save as PDF.",
      );
    }
    window.print();
  };

  useEffect(() => {
    if (!autoPrint || autoDone.current) return;
    autoDone.current = true;
    const t = window.setTimeout(() => runPrint(), 450);
    return () => window.clearTimeout(t);
    // Intentionally once on mount when autoPrint is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint]);

  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-slate-600">
          Προεπισκόπηση PDF ·{" "}
          <span className="font-medium text-ink-900">{invoiceNumber}</span>
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-xs text-slate-500">
            Αντίτυπα
            <input
              type="number"
              min={1}
              max={MAX_PRINT_COPIES}
              value={copies}
              onChange={(e) => setCopies(normalizePrintCopies(e.target.value))}
              className="mt-1 h-9 w-16 rounded-lg border border-slate-200 px-2 text-sm text-ink-900"
            />
          </label>
          <label className="block text-xs text-slate-500">
            Εκτυπωτής
            <select
              value={printer}
              onChange={(e) => setPrinter(e.target.value)}
              className="mt-1 h-9 min-w-[11rem] rounded-lg border border-slate-200 px-2 text-sm text-ink-900"
            >
              {printerOptions.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <Button size="sm" onClick={runPrint}>
            <Printer size={14} />
            Εκτύπωση
          </Button>
        </div>
      </div>
      {hint ? (
        <p className="mx-auto mt-2 max-w-3xl text-xs text-amber-800">{hint}</p>
      ) : null}
      <style>{`
        .print-copy-badge { display: none; }
        @media print {
          .print-copy-badge {
            display: block;
            font-size: 10px;
            font-weight: 600;
            letter-spacing: 0.04em;
            text-transform: uppercase;
            color: #64748b;
            margin-bottom: 8px;
          }
          .print-copy-clone {
            break-before: page;
            page-break-before: always;
          }
        }
      `}</style>
    </div>
  );
}
