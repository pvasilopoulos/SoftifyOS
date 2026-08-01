"use client";

import { useEffect, useMemo, useState } from "react";
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
import { applyFieldDefaults } from "@/modules/entity-views/form-rules";
import {
  collectRequiredErrors,
  normalizeFormConfig,
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

export function NewCustomerForm({
  formViews,
  initialFormId,
  customFields,
  role,
}: {
  formViews: FormViewOpt[];
  initialFormId: string;
  customFields: CustomFieldDef[];
  role?: string | null;
}) {
  const router = useRouter();
  const [formId, setFormId] = useState(initialFormId);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({
    status: "ACTIVE",
  });
  const [customValues, setCustomValues] = useState<CustomFieldsMap>({});

  const publishedViews = useMemo(
    () =>
      formViews.filter((f) => {
        const life = normalizeFormConfig(f.config).lifecycle ?? "published";
        return life === "published";
      }),
    [formViews],
  );

  const active = useMemo(
    () =>
      publishedViews.find((f) => f.id === formId) ??
      publishedViews[0] ??
      null,
    [publishedViews, formId],
  );

  useEffect(() => {
    if (!active) return;
    const seeded = applyFieldDefaults(
      normalizeFormConfig(active.config),
      { status: "ACTIVE" },
      {},
    );
    setValues(seeded.values);
    setCustomValues(seeded.customValues);
  }, [active?.id]);

  const [beforeSubmitFn, setBeforeSubmitFn] = useState<
    (() => Promise<{ ok: boolean; error?: string }>) | null
  >(null);

  async function onSubmit() {
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
    if (beforeSubmitFn) {
      const gate = await beforeSubmitFn();
      if (!gate.ok) {
        setError(gate.error || "Έλεγχος φόρμας απέτυχε");
        return;
      }
    }
    setPending(true);
    setError(null);
    const { customerBodyFromValues } = await import(
      "@/modules/customers/payload"
    );
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(customerBodyFromValues(values, customValues)),
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
          views={publishedViews}
          value={active?.id ?? formId}
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
            entityModule="CUSTOMERS"
            modeOverride="create"
            role={role}
            onScriptFail={(msg) => setError(msg)}
            onBeforeSubmitReady={(fn) => setBeforeSubmitFn(() => fn)}
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
