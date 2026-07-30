"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  paymentMethodKindLabel,
  type PaymentMethodKind,
} from "@/modules/payments/labels";

export type PaymentMethodItem = {
  id: string;
  code: string;
  name: string;
  kind: PaymentMethodKind;
  description: string | null;
  glAccount: string | null;
  glContraAccount: string | null;
  glClearingAccount: string | null;
  costCenter: string | null;
  accountingCode: string | null;
  bankIban: string | null;
  bankName: string | null;
  myDataPaymentType: string | null;
  sortOrder: number;
  isActive: boolean;
  showInPos: boolean;
  showInCollect: boolean;
  requiresExternalRef: boolean;
  allowsChange: boolean;
  affectsCashDrawer: boolean;
  isSystem: boolean;
};

type Draft = {
  code: string;
  name: string;
  kind: PaymentMethodKind;
  description: string;
  glAccount: string;
  glContraAccount: string;
  glClearingAccount: string;
  costCenter: string;
  accountingCode: string;
  bankIban: string;
  bankName: string;
  myDataPaymentType: string;
  sortOrder: number;
  isActive: boolean;
  showInPos: boolean;
  showInCollect: boolean;
  requiresExternalRef: boolean;
  allowsChange: boolean;
  affectsCashDrawer: boolean;
};

function emptyDraft(): Draft {
  return {
    code: "",
    name: "",
    kind: "OTHER",
    description: "",
    glAccount: "",
    glContraAccount: "",
    glClearingAccount: "",
    costCenter: "",
    accountingCode: "",
    bankIban: "",
    bankName: "",
    myDataPaymentType: "",
    sortOrder: 100,
    isActive: true,
    showInPos: true,
    showInCollect: true,
    requiresExternalRef: false,
    allowsChange: false,
    affectsCashDrawer: false,
  };
}

function fromItem(m: PaymentMethodItem): Draft {
  return {
    code: m.code,
    name: m.name,
    kind: m.kind,
    description: m.description ?? "",
    glAccount: m.glAccount ?? "",
    glContraAccount: m.glContraAccount ?? "",
    glClearingAccount: m.glClearingAccount ?? "",
    costCenter: m.costCenter ?? "",
    accountingCode: m.accountingCode ?? "",
    bankIban: m.bankIban ?? "",
    bankName: m.bankName ?? "",
    myDataPaymentType: m.myDataPaymentType ?? "",
    sortOrder: m.sortOrder,
    isActive: m.isActive,
    showInPos: m.showInPos,
    showInCollect: m.showInCollect,
    requiresExternalRef: m.requiresExternalRef,
    allowsChange: m.allowsChange,
    affectsCashDrawer: m.affectsCashDrawer,
  };
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink-900">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500/30";

export function PaymentMethodsClient({
  initialItems,
}: {
  initialItems: PaymentMethodItem[];
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

  const openEdit = (m: PaymentMethodItem) => {
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
        ...draft,
        description: draft.description || null,
        glAccount: draft.glAccount || null,
        glContraAccount: draft.glContraAccount || null,
        glClearingAccount: draft.glClearingAccount || null,
        costCenter: draft.costCenter || null,
        accountingCode: draft.accountingCode || null,
        bankIban: draft.bankIban || null,
        bankName: draft.bankName || null,
        myDataPaymentType: draft.myDataPaymentType || null,
      };

      const res = creating
        ? await fetch("/api/settings/payment-methods", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/settings/payment-methods/${editingId}`, {
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
      const res = await fetch(`/api/settings/payment-methods/${editing.id}`, {
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
            title="Τρόποι πληρωμής"
            description="Παραμετρικός κατάλογος για POS & εισπράξεις, με λογιστικούς λογαριασμούς."
          />
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus size={16} /> Νέος τρόπος
        </Button>
      </div>

      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      <div className="soft-panel overflow-x-auto">
        <table className="w-full min-w-[800px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Κωδικός</th>
              <th className="px-4 py-3 font-semibold">Όνομα</th>
              <th className="px-4 py-3 font-semibold">Kind</th>
              <th className="px-4 py-3 font-semibold">Λογ. λογαριασμός</th>
              <th className="px-4 py-3 font-semibold">POS</th>
              <th className="px-4 py-3 font-semibold">Κατάσταση</th>
              <th className="px-4 py-3 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {items.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-mono text-xs">{m.code}</td>
                <td className="px-4 py-3 font-medium">{m.name}</td>
                <td className="px-4 py-3">
                  {paymentMethodKindLabel[m.kind] ?? m.kind}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-600">
                  {m.glAccount || "—"}
                </td>
                <td className="px-4 py-3">
                  {m.showInPos ? (
                    <Badge tone="teal">Ναι</Badge>
                  ) : (
                    <Badge tone="slate">Όχι</Badge>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={m.isActive ? "emerald" : "slate"}>
                    {m.isActive ? "Ενεργός" : "Ανενεργός"}
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
                {creating ? "Νέος τρόπος πληρωμής" : `Επεξεργασία · ${editing?.code}`}
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

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Κωδικός *">
                  <input
                    className={cn(inputCls, "uppercase")}
                    value={draft.code}
                    disabled={!creating && editing?.isSystem}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, code: e.target.value }))
                    }
                    required
                  />
                </Field>
                <Field label="Όνομα *">
                  <input
                    className={inputCls}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    required
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Συμπεριφορά (kind) *">
                  <select
                    className={inputCls}
                    value={draft.kind}
                    disabled={!creating && editing?.isSystem}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        kind: e.target.value as PaymentMethodKind,
                      }))
                    }
                  >
                    {Object.entries(paymentMethodKindLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Σειρά">
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
                </Field>
              </div>

              <Field label="Περιγραφή">
                <textarea
                  rows={2}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, description: e.target.value }))
                  }
                />
              </Field>

              <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Λογιστικά
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Λογαριασμός (χρέωση)">
                    <input
                      className={cn(inputCls, "font-mono")}
                      placeholder="38.00.00"
                      value={draft.glAccount}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, glAccount: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Αντίστοιχος (πίστωση)">
                    <input
                      className={cn(inputCls, "font-mono")}
                      placeholder="30.00.00"
                      value={draft.glContraAccount}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          glContraAccount: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Εκκαθάριση">
                    <input
                      className={cn(inputCls, "font-mono")}
                      placeholder="33.90.01"
                      value={draft.glClearingAccount}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          glClearingAccount: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Κέντρο κόστους">
                    <input
                      className={inputCls}
                      value={draft.costCenter}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, costCenter: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="Κωδ. κίνησης">
                    <input
                      className={inputCls}
                      value={draft.accountingCode}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          accountingCode: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="myDATA τύπος">
                    <input
                      className={inputCls}
                      value={draft.myDataPaymentType}
                      onChange={(e) =>
                        setDraft((d) => ({
                          ...d,
                          myDataPaymentType: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field label="Τράπεζα">
                    <input
                      className={inputCls}
                      value={draft.bankName}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, bankName: e.target.value }))
                      }
                    />
                  </Field>
                  <Field label="IBAN">
                    <input
                      className={cn(inputCls, "font-mono")}
                      value={draft.bankIban}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, bankIban: e.target.value }))
                      }
                    />
                  </Field>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["isActive", "Ενεργός"],
                    ["showInPos", "Εμφάνιση στο POS"],
                    ["showInCollect", "Εμφάνιση σε εισπράξεις"],
                    ["requiresExternalRef", "Απαιτεί external ref"],
                    ["allowsChange", "Επιτρέπει ρέστα"],
                    ["affectsCashDrawer", "Επηρεάζει ταμείο"],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={draft[key]}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [key]: e.target.checked }))
                      }
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-200 px-4 py-3">
              <Button type="submit" disabled={pending}>
                {pending ? "Αποθήκευση…" : "Αποθήκευση"}
              </Button>
              <Button type="button" variant="ghost" onClick={closeDrawer}>
                Κλείσιμο
              </Button>
              {!creating && editing && !editing.isSystem ? (
                <Button
                  type="button"
                  variant="danger"
                  disabled={pending}
                  onClick={remove}
                >
                  Διαγραφή
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
