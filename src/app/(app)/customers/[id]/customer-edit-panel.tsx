"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/shared/ui/button";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  DynamicFormSections,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import {
  collectRequiredErrors,
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

export function CustomerEditPanel({
  customerId,
  initial,
  formViews,
  customFields,
  canEdit,
  role,
}: {
  customerId: string;
  initial: {
    code: string;
    name: string;
    vatNumber: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    status: string;
    customFields: unknown;
  };
  formViews: FormViewOpt[];
  customFields: CustomFieldDef[];
  canEdit: boolean;
  role?: string | null;
}) {
  const router = useRouter();
  const defaultForm =
    formViews.find((f) => f.isDefault) ?? formViews[0] ?? null;
  const [formId, setFormId] = useState(defaultForm?.id ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({
    code: initial.code,
    name: initial.name,
    vatNumber: initial.vatNumber ?? "",
    email: initial.email ?? "",
    phone: initial.phone ?? "",
    notes: initial.notes ?? "",
    status: initial.status,
  });
  const [customValues, setCustomValues] = useState<CustomFieldsMap>(() =>
    parseCustomFields(initial.customFields),
  );

  const active = useMemo(
    () => formViews.find((f) => f.id === formId) ?? defaultForm,
    [formViews, formId, defaultForm],
  );

  async function save() {
    if (active) {
      const missing = collectRequiredErrors(
        active.config,
        ENTITY_REGISTRY.CUSTOMERS.builtins,
        customFields,
        values,
        customValues,
      );
      if (missing.length) {
        setError(`Υποχρεωτικά πεδία: ${missing.join(", ")}`);
        return;
      }
    }
    setPending(true);
    setError(null);
    setMessage(null);
    const res = await fetch(`/api/customers/${customerId}`, {
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
    setMessage("Αποθηκεύτηκε.");
    setEditing(false);
    router.refresh();
  }

  if (!active) return null;

  return (
    <section className="soft-panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink-950">Στοιχεία πελάτη</h2>
          <p className="text-xs text-slate-500">
            Φόρμα από Entity Form Views
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitcher
            label="Φόρμα"
            views={formViews}
            value={formId}
            onChange={setFormId}
          />
          {canEdit ? (
            editing ? (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false);
                    setValues({
                      code: initial.code,
                      name: initial.name,
                      vatNumber: initial.vatNumber ?? "",
                      email: initial.email ?? "",
                      phone: initial.phone ?? "",
                      notes: initial.notes ?? "",
                      status: initial.status,
                    });
                    setCustomValues(parseCustomFields(initial.customFields));
                  }}
                >
                  Ακύρωση
                </Button>
                <Button size="sm" disabled={pending} onClick={() => void save()}>
                  Αποθήκευση
                </Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                Επεξεργασία
              </Button>
            )
          ) : null}
        </div>
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

      <DynamicFormSections
        config={active.config}
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
        disabled={!editing || pending}
        entityModule="CUSTOMERS"
        modeOverride="edit"
        role={role}
        onScriptFail={(msg) => setError(msg)}
      />
    </section>
  );
}
