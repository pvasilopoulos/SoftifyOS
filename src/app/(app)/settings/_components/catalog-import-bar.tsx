"use client";

import { useRef, useState, useTransition } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/shared/ui/button";

type CatalogKind = "payment-methods" | "units" | "roles";

export function CatalogImportBar({
  kind,
  onImported,
}: {
  kind: CatalogKind;
  onImported: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const onFile = (file: File) => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const res = await fetch("/api/settings/catalogs/import", {
        method: "POST",
        body: form,
      });
      const data = (await res.json()) as {
        error?: string;
        result?: {
          created: number;
          updated: number;
          skipped: number;
          errors: Array<{ row: number; message: string }>;
        };
      };
      if (!res.ok || !data.result) {
        setError(data.error || "Αποτυχία εισαγωγής");
        return;
      }
      const { created, updated, skipped, errors } = data.result;
      setMessage(
        `Εισαγωγή: ${created} νέα, ${updated} ενημερώθηκαν${skipped ? `, ${skipped} παραλείφθηκαν` : ""}${
          errors.length ? `, ${errors.length} σφάλματα` : ""
        }.`,
      );
      if (errors[0]) {
        setError(`Γραμμή ${errors[0].row}: ${errors[0].message}`);
      }
      await onImported();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onFile(file);
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={15} />
          {pending ? "Εισαγωγή..." : "Εισαγωγή CSV/Excel"}
        </Button>
        <a
          href={`/api/settings/catalogs/templates?kind=${kind}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-ink-900 shadow-sm hover:bg-slate-50"
        >
          <Download size={14} />
          Template
        </a>
      </div>
      {message ? (
        <p className="text-xs text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
