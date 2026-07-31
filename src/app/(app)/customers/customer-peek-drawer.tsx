"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  DynamicFormSections,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import {
  collectRequiredErrors,
  normalizeFormConfig,
  parseCustomFields,
  type CustomFieldsMap,
  type FormViewConfig,
} from "@/modules/entity-views/types";

type FormViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: FormViewConfig;
};

export type CustomerPeekData = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  notes?: string | null;
  customFields?: unknown;
};

export function CustomerPeekDrawer({
  open,
  customer,
  formViews,
  customFields,
  preferredFormCode,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerPeekData | null;
  formViews: FormViewOpt[];
  customFields: CustomFieldDef[];
  preferredFormCode?: string | null;
  onClose: () => void;
  onSaved?: (patch: CustomerPeekData) => void;
}) {
  const form =
    (preferredFormCode
      ? formViews.find((f) => f.code === preferredFormCode)
      : null) ??
    formViews.find((f) => f.config.mode === "edit") ??
    formViews.find((f) => f.isDefault) ??
    formViews[0] ??
    null;

  const config = useMemo(
    () => (form ? normalizeFormConfig(form.config) : null),
    [form],
  );

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [customValues, setCustomValues] = useState<CustomFieldsMap>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!customer || !open) return;
    setValues({
      code: customer.code,
      name: customer.name,
      vatNumber: customer.vatNumber ?? "",
      email: customer.email ?? "",
      phone: customer.phone ?? "",
      notes: customer.notes ?? "",
      status: customer.status,
    });
    setCustomValues(parseCustomFields(customer.customFields));
    setError(null);
    setMessage(null);
  }, [customer, open]);

  if (!open || !customer) return null;

  async function save() {
    if (!config || !form) return;
    const missing = collectRequiredErrors(
      config,
      ENTITY_REGISTRY.CUSTOMERS.builtins,
      customFields,
      values,
      customValues,
    );
    if (missing.length) {
      setError(`Υποχρεωτικά: ${missing.join(", ")}`);
      return;
    }
    setPending(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/customers/${customer!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: String(values.code ?? ""),
        name: String(values.name ?? ""),
        vatNumber: values.vatNumber ? String(values.vatNumber) : null,
        email: values.email ? String(values.email) : null,
        phone: values.phone ? String(values.phone) : null,
        notes: values.notes ? String(values.notes) : null,
        status: values.status,
        customFields: customValues,
      }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία αποθήκευσης");
      return;
    }
    const patch: CustomerPeekData = {
      id: customer!.id,
      code: String(values.code ?? ""),
      name: String(values.name ?? ""),
      vatNumber: values.vatNumber ? String(values.vatNumber) : null,
      email: values.email ? String(values.email) : null,
      phone: values.phone ? String(values.phone) : null,
      status: String(values.status ?? customer!.status),
      notes: values.notes ? String(values.notes) : null,
      customFields: customValues,
    };
    setMessage("Αποθηκεύτηκε.");
    onSaved?.(patch);
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              Peek edit · Form Experience
            </p>
            <h2 className="truncate text-base font-semibold text-ink-950">
              {customer.name}
            </h2>
            <p className="text-xs text-slate-500">
              {form?.name ?? "Φόρμα"} · {customer.code}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href={`/customers/${customer.id}`}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50 hover:text-teal-700"
              title="Πλήρης καρτέλα"
            >
              <ExternalLink size={16} />
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="mb-3 rounded-xl bg-teal-50 px-3 py-2 text-sm text-teal-900">
              {message}
            </p>
          ) : null}
          {config ? (
            <DynamicFormSections
              config={config}
              builtins={ENTITY_REGISTRY.CUSTOMERS.builtins}
              customDefs={customFields}
              values={values}
              customValues={customValues}
              onSystemChange={(key, value) =>
                setValues((prev) => ({ ...prev, [key]: value }))
              }
              onCustomChange={(key, value) =>
                setCustomValues((prev) => ({ ...prev, [key]: value }))
              }
              disabled={pending}
              compact
              modeOverride="edit"
              entityModule="CUSTOMERS"
            />
          ) : (
            <p className="text-sm text-slate-500">Δεν υπάρχει διαθέσιμη φόρμα.</p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Κλείσιμο
          </Button>
          <Button disabled={pending || !config} onClick={() => void save()}>
            Αποθήκευση
          </Button>
        </div>
      </aside>
    </div>
  );
}
