"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  DynamicFormSections,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import { ViewSwitcher } from "@/modules/entity-views/view-switcher";
import type { CustomFieldsMap, FormViewConfig } from "@/modules/entity-views/types";

type FormViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: FormViewConfig;
};

export function NewCustomerForm({
  formViews,
  initialFormId,
  customFields,
}: {
  formViews: FormViewOpt[];
  initialFormId: string;
  customFields: CustomFieldDef[];
}) {
  const router = useRouter();
  const [formId, setFormId] = useState(initialFormId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({
    status: "ACTIVE",
  });
  const [customValues, setCustomValues] = useState<CustomFieldsMap>({});

  const active = useMemo(
    () => formViews.find((f) => f.id === formId) ?? formViews[0] ?? null,
    [formViews, formId],
  );

  async function onSubmit() {
    setPending(true);
    setError(null);
    const payload = {
      code: String(values.code ?? ""),
      name: String(values.name ?? ""),
      vatNumber: values.vatNumber ? String(values.vatNumber) : null,
      email: values.email ? String(values.email) : null,
      phone: values.phone ? String(values.phone) : null,
      notes: values.notes ? String(values.notes) : null,
      status: (values.status as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
      customFields: customValues,
    };
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { item?: { id: string }; error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    router.push(`/customers/${data.item!.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Νέος πελάτης"
          description="Η φόρμα ακολουθεί την επιλεγμένη Form View."
        />
        <ViewSwitcher
          label="Φόρμα"
          views={formViews}
          value={formId}
          onChange={setFormId}
        />
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <div className="soft-panel space-y-5 p-5">
        {active ? (
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
            disabled={pending}
          />
        ) : (
          <p className="text-sm text-slate-500">Δεν υπάρχει διαθέσιμη φόρμα.</p>
        )}

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => router.push("/customers")}
          >
            Ακύρωση
          </Button>
          <Button type="button" disabled={pending} onClick={() => void onSubmit()}>
            Αποθήκευση
          </Button>
        </div>
      </div>
    </div>
  );
}
