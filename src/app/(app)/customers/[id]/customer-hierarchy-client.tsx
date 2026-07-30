"use client";

import { FormEvent, useState, useTransition } from "react";
import { Building2, MapPin, Plus } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { spaceTypeLabel } from "@/modules/master-data/schemas";

type Space = {
  id: string;
  code: string;
  name: string;
  type: keyof typeof spaceTypeLabel;
  floorLabel: string | null;
  areaSqm: number | null;
  notes: string | null;
};

type Branch = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  phone: string | null;
  isPrimary: boolean;
  spaces: Space[];
};

export function CustomerHierarchyClient({
  customerId,
  initialBranches,
  canEdit,
}: {
  customerId: string;
  initialBranches: Branch[];
  canEdit: boolean;
}) {
  const [branches, setBranches] = useState(initialBranches);
  const [openBranchId, setOpenBranchId] = useState<string | null>(
    initialBranches[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [showSpaceFormFor, setShowSpaceFormFor] = useState<string | null>(null);

  async function reload() {
    const res = await fetch(`/api/customers/${customerId}`, { cache: "no-store" });
    const data = (await res.json()) as { item?: { branches: Branch[] }; error?: string };
    if (!res.ok || !data.item) {
      setError(data.error || "Αποτυχία ανανέωσης");
      return;
    }
    startTransition(() => setBranches(data.item!.branches));
  }

  async function createBranch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/customers/${customerId}/branches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        name: form.get("name"),
        address: form.get("address") || null,
        city: form.get("city") || null,
        postalCode: form.get("postalCode") || null,
        phone: form.get("phone") || null,
        isPrimary: form.get("isPrimary") === "on",
      }),
    });
    const data = (await res.json()) as { error?: string; item?: { id: string } };
    if (!res.ok) {
      setError(data.error || "Αποτυχία");
      return;
    }
    setShowBranchForm(false);
    await reload();
    if (data.item) setOpenBranchId(data.item.id);
  }

  async function createSpace(e: FormEvent<HTMLFormElement>, branchId: string) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await fetch(`/api/branches/${branchId}/spaces`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: form.get("code"),
        name: form.get("name"),
        type: form.get("type") || "OTHER",
        floorLabel: form.get("floorLabel") || null,
        areaSqm: form.get("areaSqm") ? Number(form.get("areaSqm")) : null,
        notes: form.get("notes") || null,
      }),
    });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      setError(data.error || "Αποτυχία");
      return;
    }
    setShowSpaceFormFor(null);
    await reload();
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink-950">Υποκαταστήματα</h2>
          <p className="text-sm text-slate-500">
            Κάθε υποκατάστημα περιέχει χώρους (γραφεία, αποθήκες, όροφοι…)
          </p>
        </div>
        {canEdit ? (
          <Button
            size="sm"
            onClick={() => setShowBranchForm((v) => !v)}
            disabled={isPending}
          >
            <Plus size={15} />
            Υποκατάστημα
          </Button>
        ) : null}
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {showBranchForm ? (
        <form onSubmit={createBranch} className="soft-panel grid gap-3 p-4 sm:grid-cols-2">
          <Input name="code" label="Κωδικός *" required placeholder="BR-ATH" />
          <Input name="name" label="Όνομα *" required placeholder="Αθήνα Κέντρο" />
          <Input name="address" label="Διεύθυνση" className="sm:col-span-2" />
          <Input name="city" label="Πόλη" />
          <Input name="postalCode" label="Τ.Κ." />
          <Input name="phone" label="Τηλέφωνο" />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="isPrimary" className="rounded border-slate-300" />
            Κύριο υποκατάστημα
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm">
              Αποθήκευση
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setShowBranchForm(false)}
            >
              Ακύρωση
            </Button>
          </div>
        </form>
      ) : null}

      {branches.length === 0 ? (
        <div className="soft-panel px-4 py-10 text-center text-sm text-slate-500">
          Δεν υπάρχουν υποκαταστήματα ακόμη.
        </div>
      ) : (
        <ul className="space-y-3">
          {branches.map((branch) => {
            const open = openBranchId === branch.id;
            return (
              <li key={branch.id} className="soft-panel overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenBranchId(open ? null : branch.id)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50"
                >
                  <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
                    <Building2 size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink-950">{branch.name}</p>
                      <span className="font-mono text-xs text-slate-500">
                        {branch.code}
                      </span>
                      {branch.isPrimary ? <Badge tone="teal">Κύριο</Badge> : null}
                    </div>
                    <p className="text-sm text-slate-500">
                      {[branch.address, branch.city, branch.postalCode]
                        .filter(Boolean)
                        .join(", ") || "Χωρίς διεύθυνση"}
                      {" · "}
                      {branch.spaces.length} χώροι
                    </p>
                  </div>
                </button>

                {open ? (
                  <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <p className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-900">
                        <MapPin size={14} />
                        Χώροι
                      </p>
                      {canEdit ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() =>
                            setShowSpaceFormFor((v) =>
                              v === branch.id ? null : branch.id,
                            )
                          }
                        >
                          <Plus size={14} />
                          Χώρος
                        </Button>
                      ) : null}
                    </div>

                    {showSpaceFormFor === branch.id ? (
                      <form
                        onSubmit={(e) => createSpace(e, branch.id)}
                        className="mb-3 grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 sm:grid-cols-2"
                      >
                        <Input name="code" label="Κωδικός *" required placeholder="WH-01" />
                        <Input name="name" label="Όνομα *" required placeholder="Αποθήκη Α" />
                        <label className="block text-sm">
                          <span className="mb-1.5 block font-medium">Τύπος</span>
                          <select
                            name="type"
                            defaultValue="WAREHOUSE"
                            className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                          >
                            {Object.entries(spaceTypeLabel).map(([k, v]) => (
                              <option key={k} value={k}>
                                {v}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Input name="floorLabel" label="Όροφος/ετικέτα" placeholder="Ισόγειο" />
                        <Input name="areaSqm" label="τ.μ." type="number" />
                        <Input name="notes" label="Σημειώσεις" />
                        <div className="flex gap-2 sm:col-span-2">
                          <Button type="submit" size="sm">
                            Αποθήκευση χώρου
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowSpaceFormFor(null)}
                          >
                            Ακύρωση
                          </Button>
                        </div>
                      </form>
                    ) : null}

                    {branch.spaces.length === 0 ? (
                      <p className="text-sm text-slate-500">Δεν υπάρχουν χώροι.</p>
                    ) : (
                      <ul className="space-y-2">
                        {branch.spaces.map((space) => (
                          <li
                            key={space.id}
                            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5"
                          >
                            <div>
                              <p className="text-sm font-medium text-ink-900">
                                {space.name}{" "}
                                <span className="font-mono text-xs text-slate-500">
                                  {space.code}
                                </span>
                              </p>
                              <p className="text-xs text-slate-500">
                                {spaceTypeLabel[space.type]}
                                {space.floorLabel ? ` · ${space.floorLabel}` : ""}
                                {space.areaSqm != null ? ` · ${space.areaSqm} τ.μ.` : ""}
                              </p>
                            </div>
                            <Badge tone="slate">{spaceTypeLabel[space.type]}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Input({
  name,
  label,
  required,
  placeholder,
  type = "text",
  className,
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <label className={`block text-sm ${className ?? ""}`}>
      <span className="mb-1.5 block font-medium">{label}</span>
      <input
        name={name}
        required={required}
        type={type}
        step={type === "number" ? "0.01" : undefined}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
      />
    </label>
  );
}
