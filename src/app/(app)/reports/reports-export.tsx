"use client";

import { Download } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";

export function ReportsExport({
  rows,
  filename,
}: {
  rows: Array<Record<string, string | number>>;
  filename: string;
}) {
  function exportCsv() {
    if (rows.length === 0) {
      toast.error("Δεν υπάρχουν δεδομένα");
      return;
    }
    const keys = Object.keys(rows[0]!);
    const lines = [
      keys.join(","),
      ...rows.map((r) =>
        keys
          .map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Εξαγωγή CSV");
  }

  return (
    <Button size="sm" variant="secondary" onClick={exportCsv}>
      <Download size={14} /> CSV
    </Button>
  );
}
