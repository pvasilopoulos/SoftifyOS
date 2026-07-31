"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { ENTITY_REGISTRY } from "@/modules/entity-views/registry";
import {
  DynamicFormSections,
  type CustomFieldDef,
} from "@/modules/entity-views/dynamic-ui";
import {
  collectRequiredErrors,
  normalizeFormConfig,
  type CustomFieldsMap,
  type FormViewConfig,
} from "@/modules/entity-views/types";
import { applyFieldDefaults } from "@/modules/entity-views/form-rules";

type FormViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: FormViewConfig;
};

export function CustomerQuickDrawer({
  open,
  onClose,
  formViews,
  customFields,
}: {
  open: boolean;
  onClose: () => void;
  formViews: FormViewOpt[];
  customFields: CustomFieldDef[];
}) {
  const router = useRouter();
  const quick =
    formViews.find((f) => f.config.mode === "quick") ??
    formViews.find((f) => f.code === "quick") ??
    formViews.find((f) => f.isDefault) ??
    formViews[0] ??
    null;

  const config = useMemo(
    () => (quick ? normalizeFormConfig(quick.config) : null),
    [quick],
  );

  const seeded = useMemo(() => {
    if (!config) return { values: { status: "ACTIVE" }, customValues: {} as CustomFieldsMap };
    return applyFieldDefaults(config, { status: "ACTIVE" }, {});
  }, [config]);

  const [values, setValues] = useState<Record<string, unknown>>(seeded.values);
  const [customValues, setCustomValues] = useState<CustomFieldsMap>(
    seeded.customValues,
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function save() {
    if (!config || !quick) return;
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
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: String(values.code ?? ""),
        name: String(values.name ?? ""),
        vatNumber: values.vatNumber ? String(values.vatNumber) : null,
        email: values.email ? String(values.email) : null,
        phone: values.phone ? String(values.phone) : null,
        notes: values.notes ? String(values.notes) : null,
        status: (values.status as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
        customFields: customValues,
      }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία");
      return;
    }
    onClose();
    router.push(`/customers/${data.item.id}`);
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/30">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Κλείσιμο"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-ink-950">
              Γρήγορη καταχώριση
            </h2>
            <p className="text-xs text-slate-500">
              {quick?.name ?? "Quick form"} · Form Experience
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
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
              modeOverride="quick"
            />
          ) : (
            <p className="text-sm text-slate-500">Δεν υπάρχει quick φόρμα.</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <Button variant="secondary" disabled={pending} onClick={onClose}>
            Ακύρωση
          </Button>
          <Button disabled={pending || !config} onClick={() => void save()}>
            Αποθήκευση
          </Button>
        </div>
      </aside>
    </div>
  );
}
