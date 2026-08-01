"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  INVOICE_WORKFLOWS,
  invoiceStatusLabel,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";

export type InvoiceStatusItem = {
  id: string;
  code: string;
  name: string;
  workflow: InvoiceStatusKey;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  selectableOnCreate: boolean;
  tone: string;
};

type Draft = {
  code: string;
  name: string;
  workflow: InvoiceStatusKey;
  sortOrder: number;
  isActive: boolean;
  selectableOnCreate: boolean;
  tone: string;
};

function emptyDraft(): Draft {
  return {
    code: "",
    name: "",
    workflow: "ISSUED",
    sortOrder: 100,
    isActive: true,
    selectableOnCreate: true,
    tone: "teal",
  };
}

function fromItem(m: InvoiceStatusItem): Draft {
  return {
    code: m.code,
    name: m.name,
    workflow: m.workflow,
    sortOrder: m.sortOrder,
    isActive: m.isActive,
    selectableOnCreate: m.selectableOnCreate,
    tone: m.tone,
  };
}

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500/30";

const TONES = ["slate", "teal", "amber", "emerald", "rose"] as const;

export function InvoiceStatusesClient({
  initialItems,
}: {
  initialItems: InvoiceStatusItem[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = useMemo(
    () => items.find((i) => i.id === editingId) ?? null,
    [items, editingId],
  );

  const openCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setMessage(null);
  };

  const openEdit = (m: InvoiceStatusItem) => {
    setCreating(false);
    setEditingId(m.id);
    setDraft(fromItem(m));
    setError(null);
    setMessage(null);
  };

  const closeDrawer = () => {
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const payload = {
        code: draft.code,
        name: draft.name,
        workflow: draft.workflow,
        sortOrder: draft.sortOrder,
        isActive: draft.isActive,
        selectableOnCreate: draft.selectableOnCreate,
        tone: draft.tone,
      };

      const res = creating
        ? await fetch("/api/settings/invoice-statuses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/settings/invoice-statuses/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage(creating ? "Δημιουργήθηκε." : "Αποθηκεύτηκε.");
      if (creating) {
        setItems((prev) =>
          [...prev, data.item].sort((a, b) => a.sortOrder - b.sortOrder),
        );
        setCreating(false);
        setEditingId(data.item.id);
      } else {
        setItems((prev) =>
          prev
            .map((i) => (i.id === data.item.id ? data.item : i))
            .sort((a, b) => a.sortOrder - b.sortOrder),
        );
      }
      router.refresh();
    });
  };

  const remove = () => {
    if (!editing || editing.isSystem) return;
    if (!confirm(`Διαγραφή «${editing.name}»;`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/settings/invoice-statuses/${editing.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία διαγραφής");
        return;
      }
      setItems((prev) => prev.filter((i) => i.id !== editing.id));
      closeDrawer();
      router.refresh();
    });
  };

  const drawerOpen = creating || !!editingId;

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
            title="Καταστάσεις τιμολογίου"
            description="Παραμετρικές ετικέτες με αντιστοίχιση σε workflow (πρόχειρο, έκδοση…)."
          />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus size={16} /> Νέα κατάσταση
        </Button>
      </div>

      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <div className="soft-panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Κωδικός</th>
              <th className="px-4 py-3 font-semibold">Όνομα</th>
              <th className="px-4 py-3 font-semibold">Workflow</th>
              <th className="px-4 py-3 font-semibold">Νέα φόρμα</th>
              <th className="px-4 py-3 font-semibold">Κατάσταση</th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{m.code}</td>
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3 text-slate-600">
                  {invoiceStatusLabel[m.workflow] ?? m.workflow}
                </td>
                <td className="px-4 py-3">
                  {m.selectableOnCreate ? (
                    <Badge tone="teal">Ναι</Badge>
                  ) : (
                    <Badge tone="slate">Όχι</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={m.isActive ? "emerald" : "slate"}>
                    {m.isActive ? "Ενεργή" : "Ανενεργή"}
                  </Badge>
                  {m.isSystem ? (
                    <Badge tone="slate" className="ml-1">
                      sys
                    </Badge>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(m)}
                  >
                    <Pencil size={14} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink-950/30 backdrop-blur-[1px]">
          <form
            onSubmit={save}
            className="flex h-full w-full max-w-lg flex-col bg-white shadow-xl"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <h2 className="font-semibold text-ink-950">
                {creating
                  ? "Νέα κατάσταση"
                  : `Επεξεργασία · ${editing?.code}`}
              </h2>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </p>
              ) : null}

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Κωδικός *</span>
                <input
                  className={inputCls}
                  value={draft.code}
                  disabled={!!editing?.isSystem}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                  required
                  placeholder="ON_HOLD"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Όνομα *</span>
                <input
                  className={inputCls}
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  required
                  placeholder="Σε αναμονή"
                />
              </label>

              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Workflow *</span>
                <select
                  className={inputCls}
                  value={draft.workflow}
                  disabled={!!editing?.isSystem}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      workflow: e.target.value as InvoiceStatusKey,
                    }))
                  }
                >
                  {INVOICE_WORKFLOWS.map((w) => (
                    <option key={w} value={w}>
                      {invoiceStatusLabel[w]} ({w})
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-xs text-slate-500">
                  Το workflow καθορίζει τις επιτρεπτές ενέργειες (τιμολόγηση,
                  ακύρωση κ.λπ.).
                </span>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Σειρά</span>
                  <input
                    type="number"
                    className={inputCls}
                    value={draft.sortOrder}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        sortOrder: Number(e.target.value) || 0,
                      }))
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1.5 block font-medium">Tone</span>
                  <select
                    className={inputCls}
                    value={draft.tone}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, tone: e.target.value }))
                    }
                  >
                    {TONES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.selectableOnCreate}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      selectableOnCreate: e.target.checked,
                    }))
                  }
                />
                Εμφάνιση στη φόρμα νέας τιμολόγιος/προσφοράς
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, isActive: e.target.checked }))
                  }
                />
                Ενεργή
              </label>
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
              {editing && !editing.isSystem ? (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={remove}
                  className="text-rose-700"
                >
                  Διαγραφή
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={closeDrawer}>
                  Άκυρο
                </Button>
                <Button type="submit" disabled={pending}>
                  Αποθήκευση
                </Button>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
