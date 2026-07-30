"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import { documentKindLabel } from "@/modules/documents/series";
import {
  DEFAULT_INVOICE_PRINT_BODY,
  parseBodyJson,
  type PrintBlock,
  type PrintFormBody,
} from "@/modules/print-forms/defaults";

type Kind = keyof typeof documentKindLabel;

type Item = {
  id: string;
  code: string;
  name: string;
  documentKind: Kind;
  paper: "A4" | "A5" | "RECEIPT_80";
  orientation: "PORTRAIT" | "LANDSCAPE";
  bodyJson: unknown;
  isDefault: boolean;
  isSystem: boolean;
  isActive: boolean;
};

const BLOCK_OPTIONS: Array<{ type: PrintBlock["type"]; label: string }> = [
  { type: "header", label: "Κεφαλίδα εταιρείας" },
  { type: "parties", label: "Πελάτης / μέρη" },
  { type: "meta", label: "Μεταδεδομένα (ημ/νίες)" },
  { type: "lines", label: "Γραμμές ειδών" },
  { type: "totals", label: "Σύνολα" },
  { type: "notes", label: "Σημειώσεις" },
  { type: "footer", label: "Υποσέλιδο" },
  { type: "text", label: "Ελεύθερο κείμενο" },
  { type: "spacer", label: "Κενό" },
];

export function PrintFormsClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [selectedId, setSelectedId] = useState(initialItems[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) ?? null,
    [items, selectedId],
  );

  const refresh = async () => {
    const res = await fetch("/api/settings/print-forms");
    const data = await res.json();
    if (res.ok) setItems(data.items);
  };

  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/settings/print-forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") || ""),
          name: String(form.get("name") || ""),
          documentKind: String(form.get("documentKind") || "SALES_INVOICE"),
          paper: "A4",
          orientation: "PORTRAIT",
          bodyJson: DEFAULT_INVOICE_PRINT_BODY,
          isDefault: false,
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setCreating(false);
      setMessage("Η φόρμα δημιουργήθηκε.");
      await refresh();
      setSelectedId(data.item.id);
    });
  };

  const saveSelected = (patch: Partial<Item> & { bodyJson?: PrintFormBody }) => {
    if (!selected) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/settings/print-forms/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage("Αποθηκεύτηκε.");
      await refresh();
    });
  };

  const body = selected
    ? parseBodyJson(selected.bodyJson)
    : DEFAULT_INVOICE_PRINT_BODY;

  const toggleBlock = (type: PrintBlock["type"]) => {
    if (!selected) return;
    const exists = body.blocks.some((b) => b.type === type);
    const next: PrintFormBody = {
      version: 1,
      blocks: exists
        ? body.blocks.filter((b) => b.type !== type)
        : [
            ...body.blocks,
            {
              id: `${type}_${Date.now().toString(36)}`,
              type,
              ...(type === "footer" || type === "text"
                ? { text: "" }
                : {}),
              ...(type === "totals" ? { showPaidBalance: true } : {}),
            },
          ],
    };
    if (next.blocks.length === 0) return;
    setItems((prev) =>
      prev.map((i) => (i.id === selected.id ? { ...i, bodyJson: next } : i)),
    );
  };

  const moveBlock = (index: number, dir: -1 | 1) => {
    if (!selected) return;
    const nextIdx = index + dir;
    if (nextIdx < 0 || nextIdx >= body.blocks.length) return;
    const blocks = [...body.blocks];
    const tmp = blocks[index]!;
    blocks[index] = blocks[nextIdx]!;
    blocks[nextIdx] = tmp;
    const next = { version: 1 as const, blocks };
    setItems((prev) =>
      prev.map((i) => (i.id === selected.id ? { ...i, bodyJson: next } : i)),
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
          >
            <ArrowLeft size={14} /> Ρυθμίσεις
          </Link>
          <PageHeader
            title="Print Form Builder"
            description="Φόρμες εκτύπωσης ανά τύπο παραστατικού — συνδέονται στις σειρές."
          />
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
          <Plus size={16} /> Νέα φόρμα
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {creating ? (
        <form
          onSubmit={create}
          className="soft-panel grid gap-3 p-4 sm:grid-cols-4"
        >
          <input
            name="code"
            required
            placeholder="Κωδικός *"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            name="name"
            required
            placeholder="Όνομα *"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <select
            name="documentKind"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            defaultValue="SALES_INVOICE"
          >
            {(Object.keys(documentKindLabel) as Kind[]).map((k) => (
              <option key={k} value={k}>
                {documentKindLabel[k]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={pending}>
              Δημιουργία
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setCreating(false)}
            >
              Ακύρωση
            </Button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="soft-panel max-h-[70vh] overflow-y-auto p-2">
          <ul className="space-y-1">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={cn(
                    "w-full rounded-xl px-3 py-2.5 text-left text-sm transition",
                    selectedId === item.id
                      ? "bg-teal-50 text-teal-900"
                      : "hover:bg-slate-50",
                  )}
                >
                  <div className="font-medium">{item.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1 text-[11px] text-slate-500">
                    <span className="font-mono">{item.code}</span>
                    {item.isDefault ? <Badge tone="teal">Default</Badge> : null}
                    {!item.isActive ? <Badge tone="slate">Off</Badge> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        {selected ? (
          <div className="soft-panel space-y-4 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Όνομα</span>
                <input
                  value={selected.name}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((i) =>
                        i.id === selected.id
                          ? { ...i, name: e.target.value }
                          : i,
                      ),
                    )
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Τύπος</span>
                <div className="flex h-10 items-center rounded-xl border border-slate-100 bg-slate-50 px-3 text-sm text-slate-600">
                  {documentKindLabel[selected.documentKind]}
                </div>
              </label>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Blocks φόρμας
              </p>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {BLOCK_OPTIONS.map((b) => {
                  const on = body.blocks.some((x) => x.type === b.type);
                  return (
                    <button
                      key={b.type}
                      type="button"
                      onClick={() => toggleBlock(b.type)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
                        on
                          ? "border-teal-600 bg-teal-600 text-white"
                          : "border-slate-200 bg-white text-slate-600",
                      )}
                    >
                      {b.label}
                    </button>
                  );
                })}
              </div>
              <ul className="space-y-1.5">
                {body.blocks.map((block, index) => (
                  <li
                    key={block.id}
                    className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 flex-1 font-medium">
                      {BLOCK_OPTIONS.find((b) => b.type === block.type)?.label ??
                        block.type}
                    </span>
                    <button
                      type="button"
                      className="rounded px-1.5 text-xs text-slate-500 hover:bg-slate-100"
                      onClick={() => moveBlock(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 text-xs text-slate-500 hover:bg-slate-100"
                      onClick={() => moveBlock(index, 1)}
                    >
                      ↓
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  saveSelected({
                    name: selected.name,
                    bodyJson: parseBodyJson(selected.bodyJson),
                    isDefault: selected.isDefault,
                    isActive: selected.isActive,
                  })
                }
              >
                <Save size={15} /> Αποθήκευση
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => {
                  setItems((prev) =>
                    prev.map((i) =>
                      i.id === selected.id
                        ? { ...i, isDefault: true }
                        : i.documentKind === selected.documentKind
                          ? { ...i, isDefault: false }
                          : i,
                    ),
                  );
                  saveSelected({ isDefault: true });
                }}
              >
                Ορισμός default
              </Button>
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={selected.isActive}
                  onChange={(e) => {
                    const isActive = e.target.checked;
                    setItems((prev) =>
                      prev.map((i) =>
                        i.id === selected.id ? { ...i, isActive } : i,
                      ),
                    );
                    saveSelected({ isActive });
                  }}
                />
                Ενεργή
              </label>
            </div>
          </div>
        ) : (
          <div className="soft-panel grid place-items-center p-10 text-sm text-slate-500">
            Επιλέξτε φόρμα
          </div>
        )}
      </div>
    </div>
  );
}
