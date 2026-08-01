"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { HANDLER_CATALOG } from "@/modules/document-transforms";

type Item = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  sourceKind: string;
  targetKind: string;
  handlerKey: string;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  allowPartial: boolean;
  coverageMode: string;
  issueMode: string;
  copyNotes: boolean;
  defaultSeriesId: string | null;
  sourceLabel: string;
  targetLabel: string;
};

type SeriesOpt = {
  id: string;
  code: string;
  name: string;
  kind: string;
  label: string;
};

type Draft = {
  code: string;
  name: string;
  description: string;
  handlerKey: string;
  isActive: boolean;
  sortOrder: number;
  allowPartial: boolean;
  coverageMode: "FULL_COPY" | "QUANTITY";
  issueMode: "DRAFT" | "ISSUE_NOW";
  copyNotes: boolean;
  defaultSeriesId: string;
};

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500/30";

function emptyDraft(): Draft {
  const h = HANDLER_CATALOG[0]!;
  return {
    code: "",
    name: h.label,
    description: h.description,
    handlerKey: h.key,
    isActive: true,
    sortOrder: 100,
    allowPartial: h.defaultAllowPartial,
    coverageMode: h.defaultCoverage,
    issueMode: "ISSUE_NOW",
    copyNotes: true,
    defaultSeriesId: "",
  };
}

export function TransformsSettingsClient({
  initialItems,
  series,
}: {
  initialItems: Item[];
  series: SeriesOpt[];
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

  const handler = HANDLER_CATALOG.find((h) => h.key === draft.handlerKey);

  const seriesForTarget = series.filter(
    (s) => s.kind === (handler?.targetKind ?? editing?.targetKind),
  );

  function openCreate() {
    setCreating(true);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setMessage(null);
  }

  function openEdit(m: Item) {
    setCreating(false);
    setEditingId(m.id);
    setDraft({
      code: m.code,
      name: m.name,
      description: m.description ?? "",
      handlerKey: m.handlerKey,
      isActive: m.isActive,
      sortOrder: m.sortOrder,
      allowPartial: m.allowPartial,
      coverageMode: m.coverageMode as "FULL_COPY" | "QUANTITY",
      issueMode: m.issueMode as "DRAFT" | "ISSUE_NOW",
      copyNotes: m.copyNotes,
      defaultSeriesId: m.defaultSeriesId ?? "",
    });
    setError(null);
    setMessage(null);
  }

  function applyHandler(key: string) {
    const h = HANDLER_CATALOG.find((x) => x.key === key);
    if (!h) return;
    setDraft((d) => ({
      ...d,
      handlerKey: key,
      name: d.name || h.label,
      description: d.description || h.description,
      allowPartial: h.defaultAllowPartial,
      coverageMode: h.defaultCoverage,
      defaultSeriesId: "",
    }));
  }

  function save() {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      try {
        if (creating) {
          const h = HANDLER_CATALOG.find((x) => x.key === draft.handlerKey);
          if (!h) throw new Error("Handler");
          const res = await fetch("/api/settings/document-transforms", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code: draft.code || draft.handlerKey,
              name: draft.name,
              description: draft.description || null,
              sourceKind: h.sourceKind,
              targetKind: h.targetKind,
              handlerKey: draft.handlerKey,
              isActive: draft.isActive,
              sortOrder: draft.sortOrder,
              allowPartial: draft.allowPartial,
              coverageMode: draft.coverageMode,
              issueMode: draft.issueMode,
              copyNotes: draft.copyNotes,
              defaultSeriesId: draft.defaultSeriesId || null,
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Αποτυχία");
          setMessage("Ο κανόνας δημιουργήθηκε");
          setCreating(false);
          router.refresh();
          setItems((prev) => [
            ...prev,
            {
              ...data.item,
              sourceLabel: h.label.split("→")[0]?.trim() ?? h.sourceKind,
              targetLabel: h.label.split("→")[1]?.trim() ?? h.targetKind,
            },
          ]);
          return;
        }
        if (!editingId) return;
        const res = await fetch(
          `/api/settings/document-transforms/${editingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: draft.name,
              description: draft.description || null,
              isActive: draft.isActive,
              sortOrder: draft.sortOrder,
              allowPartial: draft.allowPartial,
              coverageMode: draft.coverageMode,
              issueMode: draft.issueMode,
              copyNotes: draft.copyNotes,
              defaultSeriesId: draft.defaultSeriesId || null,
              ...(!editing?.isSystem
                ? {
                    code: draft.code,
                    handlerKey: draft.handlerKey,
                    sourceKind: handler?.sourceKind,
                    targetKind: handler?.targetKind,
                  }
                : {}),
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Αποτυχία");
        setMessage("Αποθηκεύτηκε");
        setItems((prev) =>
          prev.map((i) =>
            i.id === editingId
              ? {
                  ...i,
                  ...data.item,
                  sourceLabel: i.sourceLabel,
                  targetLabel: i.targetLabel,
                }
              : i,
          ),
        );
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Σφάλμα");
      }
    });
  }

  function toggleActive(m: Item) {
    startTransition(async () => {
      const res = await fetch(`/api/settings/document-transforms/${m.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !m.isActive }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setItems((prev) =>
        prev.map((i) =>
          i.id === m.id ? { ...i, isActive: data.item.isActive } : i,
        ),
      );
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/settings"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} />
          Ρυθμίσεις
        </Link>
        <PageHeader
          title="Μετασχηματισμοί παραστατικών"
          description="Ορίστε τι μετατρέπεται σε τι, μερική κάλυψη γραμμών και έκδοση."
          actions={
            <Button size="sm" onClick={openCreate}>
              <Plus size={15} />
              Κανόνας
            </Button>
          }
        />
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {(creating || editing) && (
        <section className="soft-panel space-y-4 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-ink-950">
            {creating ? "Νέος κανόνας" : `Επεξεργασία · ${editing?.code}`}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Handler</span>
              <select
                className={inputCls}
                value={draft.handlerKey}
                disabled={Boolean(editing?.isSystem)}
                onChange={(e) => applyHandler(e.target.value)}
              >
                {HANDLER_CATALOG.map((h) => (
                  <option key={h.key} value={h.key}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Κωδικός</span>
              <input
                className={inputCls}
                value={draft.code}
                disabled={Boolean(editing?.isSystem)}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, code: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Όνομα</span>
              <input
                className={inputCls}
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="mb-1 block text-slate-600">Περιγραφή</span>
              <input
                className={inputCls}
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Κάλυψη</span>
              <select
                className={inputCls}
                value={draft.coverageMode}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    coverageMode: e.target.value as Draft["coverageMode"],
                  }))
                }
              >
                <option value="QUANTITY">Υπόλοιπα ποσοτήτων</option>
                <option value="FULL_COPY">Πλήρης αντιγραφή</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Έκδοση</span>
              <select
                className={inputCls}
                value={draft.issueMode}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    issueMode: e.target.value as Draft["issueMode"],
                  }))
                }
              >
                <option value="ISSUE_NOW">Έκδοση τώρα</option>
                <option value="DRAFT">Πρόχειρο</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">
                Προεπιλεγμένη σειρά
              </span>
              <select
                className={inputCls}
                value={draft.defaultSeriesId}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    defaultSeriesId: e.target.value,
                  }))
                }
              >
                <option value="">Προεπιλογή συστήματος</option>
                {seriesForTarget.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Σειρά εμφάνισης</span>
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
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.allowPartial}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, allowPartial: e.target.checked }))
                }
              />
              Μερικός μετασχηματισμός (γραμμές/ποσότητες)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.copyNotes}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, copyNotes: e.target.checked }))
                }
              />
              Αντιγραφή σημειώσεων
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, isActive: e.target.checked }))
                }
              />
              Ενεργός
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" disabled={pending} onClick={save}>
              Αποθήκευση
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pending}
              onClick={() => {
                setCreating(false);
                setEditingId(null);
              }}
            >
              Ακύρωση
            </Button>
          </div>
        </section>
      )}

      <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
        {items.map((m) => (
          <li
            key={m.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-medium text-ink-950">{m.name}</p>
                <Badge tone={m.isActive ? "emerald" : "slate"}>
                  {m.isActive ? "Ενεργός" : "Ανενεργός"}
                </Badge>
                {m.isSystem ? <Badge tone="slate">System</Badge> : null}
                {m.allowPartial ? (
                  <Badge tone="teal">Μερικός</Badge>
                ) : (
                  <Badge tone="amber">Πλήρης</Badge>
                )}
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
                <span>{m.sourceLabel}</span>
                <ArrowRight size={12} className="text-slate-400" />
                <span>{m.targetLabel}</span>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-xs">{m.code}</span>
                <span className="text-slate-400">·</span>
                <span className="text-xs">{m.coverageMode}</span>
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() => toggleActive(m)}
              >
                {m.isActive ? "Απενεργοποίηση" : "Ενεργοποίηση"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openEdit(m)}
              >
                <Pencil size={14} />
                Επεξεργασία
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
