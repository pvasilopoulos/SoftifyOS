"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  LayoutDashboard,
  Package,
  Store,
  Warehouse,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

type Section = "overview" | "tenants" | "companies" | "branches" | "warehouses";

type TenantRow = {
  id: string;
  slug: string;
  name: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  counts: {
    customers: number;
    sites: number;
    legalEntities: number;
    invoices: number;
  };
};

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  isDefault: boolean;
  isActive: boolean;
};

type SiteRow = {
  id: string;
  code: string;
  name: string;
  kind: "BRANCH" | "WAREHOUSE" | "TILL";
  isActive: boolean;
  parentId: string | null;
  parent: { id: string; code: string; name: string } | null;
  childCount: number;
  binCount: number;
};

type BinRow = {
  id: string;
  code: string;
  name: string;
  zone: string | null;
  isActive: boolean;
  siteId: string;
  siteCode: string;
  siteName: string;
};

const NAV: Array<{
  id: Section;
  label: string;
  icon: typeof Building2;
}> = [
  { id: "overview", label: "Επισκόπηση", icon: LayoutDashboard },
  { id: "tenants", label: "Tenants", icon: Building2 },
  { id: "companies", label: "Companies", icon: Store },
  { id: "branches", label: "Branches", icon: Package },
  { id: "warehouses", label: "Warehouses", icon: Warehouse },
];

const inputClass =
  "h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm disabled:bg-slate-50";

export function OrgStructureClient({
  canWrite,
  currentTenantId,
  currentRole,
  tenants: initialTenants,
  companies: initialCompanies,
  sites: initialSites,
  bins: initialBins,
}: {
  canWrite: boolean;
  currentTenantId: string;
  currentRole: string;
  tenants: TenantRow[];
  companies: CompanyRow[];
  sites: SiteRow[];
  bins: BinRow[];
}) {
  const router = useRouter();
  const [section, setSection] = useState<Section>("overview");
  const [tenants, setTenants] = useState(initialTenants);
  const [companies, setCompanies] = useState(initialCompanies);
  const [sites, setSites] = useState(initialSites);
  const [bins, setBins] = useState(initialBins);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [tenantForm, setTenantForm] = useState<{
    id?: string;
    name: string;
    slug: string;
  } | null>(null);
  const [companyForm, setCompanyForm] = useState<{
    id?: string;
    code: string;
    name: string;
    vatNumber: string;
    isDefault: boolean;
  } | null>(null);
  const [siteForm, setSiteForm] = useState<{
    id?: string;
    code: string;
    name: string;
    kind: "BRANCH" | "WAREHOUSE" | "TILL";
    parentId: string;
    isActive: boolean;
  } | null>(null);
  const [binForm, setBinForm] = useState<{
    id?: string;
    siteId: string;
    code: string;
    name: string;
    zone: string;
  } | null>(null);

  const branches = useMemo(
    () => sites.filter((s) => s.kind === "BRANCH"),
    [sites],
  );
  const warehouses = useMemo(
    () => sites.filter((s) => s.kind === "WAREHOUSE" || s.kind === "BRANCH"),
    [sites],
  );
  const pureWarehouses = useMemo(
    () => sites.filter((s) => s.kind === "WAREHOUSE"),
    [sites],
  );

  const flash = (msg: string) => {
    setMessage(msg);
    setError(null);
  };
  const fail = (msg: string) => {
    setError(msg);
    setMessage(null);
  };

  const switchTenant = (tenantId: string) => {
    startTransition(() => {
      void (async () => {
        const res = await fetch("/api/tenants/switch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tenantId }),
        });
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία αλλαγής");
          return;
        }
        flash(`Ενεργός οργανισμός: ${data.tenant.name}`);
        window.location.href = "/settings/org-structure";
      })();
    });
  };

  const saveTenant = () => {
    if (!tenantForm || !canWrite) return;
    startTransition(() => {
      void (async () => {
        const isEdit = Boolean(tenantForm.id);
        const res = await fetch("/api/tenants", {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEdit
              ? {
                  id: tenantForm.id,
                  name: tenantForm.name,
                  slug: tenantForm.slug || undefined,
                }
              : {
                  name: tenantForm.name,
                  slug: tenantForm.slug || null,
                  switchTo: false,
                },
          ),
        });
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        setTenantForm(null);
        flash(isEdit ? "Tenant ενημερώθηκε" : "Tenant δημιουργήθηκε");
        router.refresh();
        const list = await fetch("/api/tenants").then((r) => r.json());
        if (list.items) setTenants(list.items);
      })();
    });
  };

  const deleteTenant = (id: string) => {
    if (!canWrite) return;
    if (!window.confirm("Διαγραφή κενού tenant; Δεν αναιρείται.")) return;
    startTransition(() => {
      void (async () => {
        const res = await fetch(`/api/tenants?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία διαγραφής");
          return;
        }
        flash("Tenant διαγράφηκε");
        if (data.switched) {
          window.location.href = "/settings/org-structure";
          return;
        }
        setTenants((prev) => prev.filter((t) => t.id !== id));
      })();
    });
  };

  const saveCompany = () => {
    if (!companyForm || !canWrite) return;
    startTransition(() => {
      void (async () => {
        const isEdit = Boolean(companyForm.id);
        const res = await fetch("/api/settings/companies", {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isEdit
              ? {
                  id: companyForm.id,
                  code: companyForm.code,
                  name: companyForm.name,
                  vatNumber: companyForm.vatNumber || null,
                  isDefault: companyForm.isDefault,
                }
              : {
                  code: companyForm.code,
                  name: companyForm.name,
                  vatNumber: companyForm.vatNumber || null,
                  isDefault: companyForm.isDefault,
                },
          ),
        });
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        setCompanyForm(null);
        flash(isEdit ? "Company ενημερώθηκε" : "Company δημιουργήθηκε");
        const list = await fetch("/api/settings/companies").then((r) =>
          r.json(),
        );
        if (list.items) setCompanies(list.items);
      })();
    });
  };

  const deleteCompany = (id: string) => {
    if (!canWrite) return;
    if (!window.confirm("Διαγραφή / απενεργοποίηση εταιρείας;")) return;
    startTransition(() => {
      void (async () => {
        const res = await fetch(
          `/api/settings/companies?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        flash("Company διαγράφηκε / απενεργοποιήθηκε");
        const list = await fetch("/api/settings/companies").then((r) =>
          r.json(),
        );
        if (list.items) setCompanies(list.items);
      })();
    });
  };

  const saveSite = () => {
    if (!siteForm || !canWrite) return;
    startTransition(() => {
      void (async () => {
        const isEdit = Boolean(siteForm.id);
        const payload = {
          code: siteForm.code,
          name: siteForm.name,
          kind: siteForm.kind,
          parentId: siteForm.parentId || null,
          isActive: siteForm.isActive,
        };
        const res = await fetch(
          isEdit ? `/api/sites/${siteForm.id}` : "/api/sites",
          {
            method: isEdit ? "PATCH" : "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        setSiteForm(null);
        flash(isEdit ? "Ενημερώθηκε" : "Δημιουργήθηκε");
        const list = await fetch("/api/sites").then((r) => r.json());
        if (list.items) {
          setSites(
            list.items.map(
              (s: SiteRow & { _count?: { children: number; stockBins: number } }) => ({
                id: s.id,
                code: s.code,
                name: s.name,
                kind: s.kind,
                isActive: s.isActive,
                parentId: s.parentId,
                parent: s.parent,
                childCount: s._count?.children ?? s.childCount ?? 0,
                binCount: s._count?.stockBins ?? s.binCount ?? 0,
              }),
            ),
          );
        }
      })();
    });
  };

  const deleteSite = (id: string) => {
    if (!canWrite) return;
    if (!window.confirm("Διαγραφή site; Αν έχει σειρές θα απενεργοποιηθεί."))
      return;
    startTransition(() => {
      void (async () => {
        const res = await fetch(`/api/sites/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        flash("Site διαγράφηκε / απενεργοποιήθηκε");
        const list = await fetch("/api/sites").then((r) => r.json());
        if (list.items) {
          setSites(
            list.items.map(
              (s: SiteRow & { _count?: { children: number; stockBins: number } }) => ({
                id: s.id,
                code: s.code,
                name: s.name,
                kind: s.kind,
                isActive: s.isActive,
                parentId: s.parentId,
                parent: s.parent,
                childCount: s._count?.children ?? 0,
                binCount: s._count?.stockBins ?? 0,
              }),
            ),
          );
        }
      })();
    });
  };

  const saveBin = () => {
    if (!binForm || !canWrite) return;
    startTransition(() => {
      void (async () => {
        const res = await fetch("/api/inventory/bins", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: binForm.id,
            siteId: binForm.siteId,
            code: binForm.code,
            name: binForm.name,
            zone: binForm.zone || null,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        setBinForm(null);
        flash(binForm.id ? "Bin ενημερώθηκε" : "Bin δημιουργήθηκε");
        const list = await fetch("/api/inventory/bins").then((r) => r.json());
        if (list.items) {
          setBins(
            list.items.map(
              (b: {
                id: string;
                code: string;
                name: string;
                zone: string | null;
                isActive: boolean;
                siteId: string;
                site: { code: string; name: string };
              }) => ({
                id: b.id,
                code: b.code,
                name: b.name,
                zone: b.zone,
                isActive: b.isActive,
                siteId: b.siteId,
                siteCode: b.site.code,
                siteName: b.site.name,
              }),
            ),
          );
        }
      })();
    });
  };

  const deleteBin = (id: string) => {
    if (!canWrite) return;
    if (!window.confirm("Διαγραφή bin;")) return;
    startTransition(() => {
      void (async () => {
        const res = await fetch(
          `/api/inventory/bins?id=${encodeURIComponent(id)}`,
          { method: "DELETE" },
        );
        const data = await res.json();
        if (!res.ok) {
          fail(data.error || "Αποτυχία");
          return;
        }
        flash("Bin διαγράφηκε");
        setBins((prev) => prev.filter((b) => b.id !== id));
      })();
    });
  };

  return (
    <div className="org-hub space-y-5">
      <style jsx global>{`
        .org-hub {
          --org-ink: #0b1f33;
        }
        .org-hero {
          background:
            radial-gradient(820px 260px at 0% 0%, rgba(15, 118, 110, 0.14), transparent 55%),
            linear-gradient(180deg, #eef5f7 0%, #f8fafc 70%);
          border: 1px solid rgba(15, 118, 110, 0.12);
        }
      `}</style>

      <div className="org-hero rounded-[1.75rem] px-5 py-5 sm:px-6">
        <div className="mb-3 text-sm">
          <Link href="/settings" className="text-teal-800 hover:underline">
            ← Ρυθμίσεις
          </Link>
        </div>
        <PageHeader
          title="Οργανωτική δομή"
          description="Tenants · Companies (Legal Entities) · Branches · Warehouses — πλήρες CRUD"
          actions={
            <Link
              href="/settings/organization"
              className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white/90 px-3 text-sm font-medium hover:bg-white"
            >
              Στοιχεία εταιρείας
            </Link>
          }
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone="teal">{tenants.length} tenants</Badge>
          <Badge tone="slate">{companies.length} companies</Badge>
          <Badge tone="slate">{branches.length} branches</Badge>
          <Badge tone="emerald">{pureWarehouses.length} warehouses</Badge>
          <Badge tone="slate">ρόλος {currentRole}</Badge>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}
      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="soft-panel h-fit space-y-1 p-3 lg:sticky lg:top-20">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = section === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-medium transition",
                  active
                    ? "bg-[var(--org-ink)] text-white"
                    : "text-slate-600 hover:bg-slate-100",
                )}
              >
                <Icon className="h-3.5 w-3.5 opacity-80" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-4">
          {section === "overview" ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {(
                [
                  ["Tenants", tenants.length, "tenants"],
                  ["Companies", companies.filter((c) => c.isActive).length, "companies"],
                  ["Branches", branches.filter((b) => b.isActive).length, "branches"],
                  [
                    "Warehouses",
                    pureWarehouses.filter((w) => w.isActive).length ||
                      branches.filter((b) => b.isActive).length,
                    "warehouses",
                  ],
                ] as const
              ).map(([label, count, target]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setSection(target)}
                  className="soft-panel rounded-2xl px-4 py-3 text-left transition hover:border-teal-300"
                >
                  <p className="text-xs uppercase tracking-wide text-slate-500">
                    {label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {count}
                  </p>
                  <p className="mt-1 text-xs text-teal-700">Διαχείριση →</p>
                </button>
              ))}
            </div>
          ) : null}

          {section === "tenants" ? (
            <EntityPanel
              title="Tenants"
              subtitle="Οργανισμοί στους οποίους έχεις membership · New / Edit / Delete / Switch"
              canWrite={canWrite}
              onNew={() =>
                setTenantForm({ name: "", slug: "" })
              }
              newLabel="+ Tenant"
            >
              {tenantForm ? (
                <div className="mb-3 grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
                  <input
                    className={inputClass}
                    placeholder="Επωνυμία"
                    value={tenantForm.name}
                    onChange={(e) =>
                      setTenantForm((f) =>
                        f ? { ...f, name: e.target.value } : f,
                      )
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="slug (προαιρετικό)"
                    value={tenantForm.slug}
                    onChange={(e) =>
                      setTenantForm((f) =>
                        f ? { ...f, slug: e.target.value } : f,
                      )
                    }
                  />
                  <div className="flex gap-2 sm:col-span-2">
                    <Button size="sm" disabled={pending} onClick={saveTenant}>
                      Αποθήκευση
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setTenantForm(null)}
                    >
                      Ακύρωση
                    </Button>
                  </div>
                </div>
              ) : null}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {tenants.map((t) => (
                  <li
                    key={t.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        {t.name}{" "}
                        <span className="font-mono text-xs text-slate-400">
                          {t.slug}
                        </span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {t.role} · {t.counts.legalEntities} co ·{" "}
                        {t.counts.sites} sites · {t.counts.customers} πελάτες
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {t.id === currentTenantId ? (
                        <Badge tone="emerald">Active</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => switchTenant(t.id)}
                        >
                          Switch
                        </Button>
                      )}
                      {canWrite && (t.role === "OWNER" || t.role === "ADMIN") ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setTenantForm({
                                id: t.id,
                                name: t.name,
                                slug: t.slug,
                              })
                            }
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => deleteTenant(t.id)}
                          >
                            Delete
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </EntityPanel>
          ) : null}

          {section === "companies" ? (
            <EntityPanel
              title="Companies (Legal Entities)"
              subtitle="Εταιρείες / Company codes εντός του ενεργού tenant — FI consolidation"
              canWrite={canWrite}
              onNew={() =>
                setCompanyForm({
                  code: "",
                  name: "",
                  vatNumber: "",
                  isDefault: false,
                })
              }
              newLabel="+ Company"
            >
              {companyForm ? (
                <div className="mb-3 grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
                  <input
                    className={inputClass}
                    placeholder="Κωδικός"
                    value={companyForm.code}
                    disabled={Boolean(companyForm.id)}
                    onChange={(e) =>
                      setCompanyForm((f) =>
                        f ? { ...f, code: e.target.value } : f,
                      )
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="Επωνυμία"
                    value={companyForm.name}
                    onChange={(e) =>
                      setCompanyForm((f) =>
                        f ? { ...f, name: e.target.value } : f,
                      )
                    }
                  />
                  <input
                    className={inputClass}
                    placeholder="ΑΦΜ"
                    value={companyForm.vatNumber}
                    onChange={(e) =>
                      setCompanyForm((f) =>
                        f ? { ...f, vatNumber: e.target.value } : f,
                      )
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={companyForm.isDefault}
                      onChange={(e) =>
                        setCompanyForm((f) =>
                          f ? { ...f, isDefault: e.target.checked } : f,
                        )
                      }
                    />
                    Default company
                  </label>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button size="sm" disabled={pending} onClick={saveCompany}>
                      Αποθήκευση
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCompanyForm(null)}
                    >
                      Ακύρωση
                    </Button>
                  </div>
                </div>
              ) : null}
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                {companies.map((c) => (
                  <li
                    key={c.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                  >
                    <div>
                      <p className="font-medium">
                        <span className="font-mono text-xs text-slate-400">
                          {c.code}
                        </span>{" "}
                        {c.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {c.vatNumber || "χωρίς ΑΦΜ"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.isDefault ? <Badge tone="teal">Default</Badge> : null}
                      <Badge tone={c.isActive ? "emerald" : "rose"}>
                        {c.isActive ? "Active" : "Inactive"}
                      </Badge>
                      {canWrite ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setCompanyForm({
                                id: c.id,
                                code: c.code,
                                name: c.name,
                                vatNumber: c.vatNumber ?? "",
                                isDefault: c.isDefault,
                              })
                            }
                          >
                            Edit
                          </Button>
                          {!c.isDefault ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => deleteCompany(c.id)}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </EntityPanel>
          ) : null}

          {section === "branches" ? (
            <SitePanel
              title="Branches"
              subtitle="Υποκαταστήματα εταιρείας (Site kind = BRANCH)"
              canWrite={canWrite}
              rows={branches}
              parentOptions={sites.filter((s) => s.kind === "BRANCH")}
              form={
                siteForm?.kind === "BRANCH" ||
                (siteForm &&
                  sites.find((s) => s.id === siteForm.id)?.kind === "BRANCH")
                  ? siteForm
                  : null
              }
              onNew={() =>
                setSiteForm({
                  code: "",
                  name: "",
                  kind: "BRANCH",
                  parentId: "",
                  isActive: true,
                })
              }
              onEdit={(s) =>
                setSiteForm({
                  id: s.id,
                  code: s.code,
                  name: s.name,
                  kind: "BRANCH",
                  parentId: s.parentId ?? "",
                  isActive: s.isActive,
                })
              }
              onCancel={() => setSiteForm(null)}
              onChange={setSiteForm}
              onSave={saveSite}
              onDelete={deleteSite}
              pending={pending}
              kindFixed="BRANCH"
            />
          ) : null}

          {section === "warehouses" ? (
            <div className="space-y-4">
              <SitePanel
                title="Warehouses (Whouses)"
                subtitle="Αποθήκες αποθέματος (Site kind = WAREHOUSE) · parent μπορεί να είναι Branch"
                canWrite={canWrite}
                rows={pureWarehouses}
                parentOptions={branches}
                form={siteForm?.kind === "WAREHOUSE" ? siteForm : null}
                onNew={() =>
                  setSiteForm({
                    code: "",
                    name: "",
                    kind: "WAREHOUSE",
                    parentId: branches[0]?.id ?? "",
                    isActive: true,
                  })
                }
                onEdit={(s) =>
                  setSiteForm({
                    id: s.id,
                    code: s.code,
                    name: s.name,
                    kind: "WAREHOUSE",
                    parentId: s.parentId ?? "",
                    isActive: s.isActive,
                  })
                }
                onCancel={() => setSiteForm(null)}
                onChange={setSiteForm}
                onSave={saveSite}
                onDelete={deleteSite}
                pending={pending}
                kindFixed="WAREHOUSE"
              />

              <EntityPanel
                title="Bins / θέσεις"
                subtitle="Θέσεις αποθήκευσης μέσα σε warehouse"
                canWrite={canWrite}
                onNew={() =>
                  setBinForm({
                    siteId: pureWarehouses[0]?.id ?? warehouses[0]?.id ?? "",
                    code: "",
                    name: "",
                    zone: "",
                  })
                }
                newLabel="+ Bin"
              >
                {binForm ? (
                  <div className="mb-3 grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
                    <select
                      className={inputClass}
                      value={binForm.siteId}
                      onChange={(e) =>
                        setBinForm((f) =>
                          f ? { ...f, siteId: e.target.value } : f,
                        )
                      }
                    >
                      <option value="">Αποθήκη</option>
                      {(pureWarehouses.length
                        ? pureWarehouses
                        : warehouses
                      ).map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.code} · {w.name}
                        </option>
                      ))}
                    </select>
                    <input
                      className={inputClass}
                      placeholder="Κωδικός"
                      value={binForm.code}
                      onChange={(e) =>
                        setBinForm((f) =>
                          f ? { ...f, code: e.target.value } : f,
                        )
                      }
                    />
                    <input
                      className={inputClass}
                      placeholder="Όνομα"
                      value={binForm.name}
                      onChange={(e) =>
                        setBinForm((f) =>
                          f ? { ...f, name: e.target.value } : f,
                        )
                      }
                    />
                    <input
                      className={inputClass}
                      placeholder="Ζώνη"
                      value={binForm.zone}
                      onChange={(e) =>
                        setBinForm((f) =>
                          f ? { ...f, zone: e.target.value } : f,
                        )
                      }
                    />
                    <div className="flex gap-2 sm:col-span-2">
                      <Button size="sm" disabled={pending} onClick={saveBin}>
                        Αποθήκευση
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setBinForm(null)}
                      >
                        Ακύρωση
                      </Button>
                    </div>
                  </div>
                ) : null}
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
                  {bins.length === 0 ? (
                    <li className="px-3 py-6 text-center text-sm text-slate-400">
                      Κανένα bin ακόμη
                    </li>
                  ) : (
                    bins.map((b) => (
                      <li
                        key={b.id}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
                      >
                        <div>
                          <p className="font-medium">
                            <span className="font-mono text-xs text-slate-400">
                              {b.code}
                            </span>{" "}
                            {b.name}
                          </p>
                          <p className="text-xs text-slate-500">
                            {b.siteCode} · {b.siteName}
                            {b.zone ? ` · zone ${b.zone}` : ""}
                          </p>
                        </div>
                        {canWrite ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setBinForm({
                                  id: b.id,
                                  siteId: b.siteId,
                                  code: b.code,
                                  name: b.name,
                                  zone: b.zone ?? "",
                                })
                              }
                            >
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={pending}
                              onClick={() => deleteBin(b.id)}
                            >
                              Delete
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    ))
                  )}
                </ul>
              </EntityPanel>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EntityPanel({
  title,
  subtitle,
  canWrite,
  onNew,
  newLabel,
  children,
}: {
  title: string;
  subtitle: string;
  canWrite: boolean;
  onNew: () => void;
  newLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="soft-panel space-y-3 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-slate-500">{subtitle}</p>
        </div>
        {canWrite ? (
          <Button size="sm" onClick={onNew}>
            {newLabel}
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SitePanel({
  title,
  subtitle,
  canWrite,
  rows,
  parentOptions,
  form,
  onNew,
  onEdit,
  onCancel,
  onChange,
  onSave,
  onDelete,
  pending,
  kindFixed,
}: {
  title: string;
  subtitle: string;
  canWrite: boolean;
  rows: SiteRow[];
  parentOptions: SiteRow[];
  form: {
    id?: string;
    code: string;
    name: string;
    kind: "BRANCH" | "WAREHOUSE" | "TILL";
    parentId: string;
    isActive: boolean;
  } | null;
  onNew: () => void;
  onEdit: (s: SiteRow) => void;
  onCancel: () => void;
  onChange: (
    updater:
      | {
          id?: string;
          code: string;
          name: string;
          kind: "BRANCH" | "WAREHOUSE" | "TILL";
          parentId: string;
          isActive: boolean;
        }
      | null
      | ((
          prev: {
            id?: string;
            code: string;
            name: string;
            kind: "BRANCH" | "WAREHOUSE" | "TILL";
            parentId: string;
            isActive: boolean;
          } | null,
        ) => {
          id?: string;
          code: string;
          name: string;
          kind: "BRANCH" | "WAREHOUSE" | "TILL";
          parentId: string;
          isActive: boolean;
        } | null),
  ) => void;
  onSave: () => void;
  onDelete: (id: string) => void;
  pending: boolean;
  kindFixed: "BRANCH" | "WAREHOUSE";
}) {
  return (
    <EntityPanel
      title={title}
      subtitle={subtitle}
      canWrite={canWrite}
      onNew={onNew}
      newLabel={kindFixed === "BRANCH" ? "+ Branch" : "+ Warehouse"}
    >
      {form && form.kind === kindFixed ? (
        <div className="mb-3 grid gap-2 rounded-xl border border-teal-100 bg-teal-50/40 p-3 sm:grid-cols-2">
          <input
            className={inputClass}
            placeholder="Κωδικός"
            value={form.code}
            onChange={(e) =>
              onChange((f) => (f ? { ...f, code: e.target.value } : f))
            }
          />
          <input
            className={inputClass}
            placeholder="Όνομα"
            value={form.name}
            onChange={(e) =>
              onChange((f) => (f ? { ...f, name: e.target.value } : f))
            }
          />
          <select
            className={inputClass}
            value={form.parentId}
            onChange={(e) =>
              onChange((f) => (f ? { ...f, parentId: e.target.value } : f))
            }
          >
            <option value="">Χωρίς parent</option>
            {parentOptions
              .filter((p) => p.id !== form.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                onChange((f) =>
                  f ? { ...f, isActive: e.target.checked } : f,
                )
              }
            />
            Active
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={pending} onClick={onSave}>
              Αποθήκευση
            </Button>
            <Button size="sm" variant="secondary" onClick={onCancel}>
              Ακύρωση
            </Button>
          </div>
        </div>
      ) : null}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
        {rows.length === 0 ? (
          <li className="px-3 py-6 text-center text-sm text-slate-400">
            Κανένα ακόμη — πάτα New
          </li>
        ) : (
          rows.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm"
            >
              <div>
                <p className="font-medium">
                  <span className="font-mono text-xs text-slate-400">
                    {s.code}
                  </span>{" "}
                  {s.name}
                </p>
                <p className="text-xs text-slate-500">
                  {s.parent ? `parent ${s.parent.code}` : "root"}
                  {s.binCount ? ` · ${s.binCount} bins` : ""}
                  {s.childCount ? ` · ${s.childCount} children` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={s.isActive ? "emerald" : "rose"}>
                  {s.isActive ? "Active" : "Inactive"}
                </Badge>
                {canWrite ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onEdit(s)}
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => onDelete(s.id)}
                    >
                      Delete
                    </Button>
                  </>
                ) : null}
              </div>
            </li>
          ))
        )}
      </ul>
    </EntityPanel>
  );
}
