"use client";

import { Printer } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function PrintControls({ invoiceNumber }: { invoiceNumber: string }) {
  return (
    <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Προεπισκόπηση PDF · <span className="font-medium text-ink-900">{invoiceNumber}</span>
        </p>
        <Button size="sm" onClick={() => window.print()}>
          <Printer size={14} />
          Εκτύπωση / Αποθήκευση PDF
        </Button>
      </div>
    </div>
  );
}
