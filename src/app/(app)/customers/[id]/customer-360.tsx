"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import {
  Building2,
  FileText,
  Mail,
  Phone,
  ShoppingCart,
} from "lucide-react";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { CustomerEditPanel } from "./customer-edit-panel";
import { CustomerHierarchyClient } from "./customer-hierarchy-client";
import type { CustomFieldDef } from "@/modules/entity-views/dynamic-ui";
import type { FormViewConfig } from "@/modules/entity-views/types";

type TabKey =
  | "invoices"
  | "orders"
  | "profile"
  | "branches"
  | "activity";

const TAB_LABEL: Record<TabKey, string> = {
  invoices: "Παραστατικά",
  orders: "Παραγγελίες",
  profile: "Στοιχεία",
  branches: "Υποκαταστήματα",
  activity: "Δραστηριότητα",
};

type FormViewOpt = {
  id: string;
  code: string;
  name: string;
  isDefault: boolean;
  config: FormViewConfig;
};

type Branch = Parameters<
  typeof CustomerHierarchyClient
>[0]["initialBranches"][number];

type Props = {
  customerId: string;
  customer: {
    code: string;
    name: string;
    vatNumber: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    status: string;
    customFields: unknown;
  };
  openBalance: number;
  openInvoices: number;
  invoices: Array<{
    id: string;
    number: string;
    status: string;
    total: number;
    balance: number;
    issuedAt: string | null;
  }>;
  orders: Array<{
    id: string;
    number: string;
    status: string;
    kind: string;
    total: number;
  }>;
  activities: Array<{
    id: string;
    kind: string;
    title: string;
    dueAt: string | null;
    createdAt: string;
  }>;
  branches: Branch[];
  formViews: FormViewOpt[];
  customFields: CustomFieldDef[];
  canWrite: boolean;
};

export function Customer360({
  customerId,
  customer,
  openBalance,
  openInvoices,
  invoices,
  orders,
  activities: initialActivities,
  branches,
  formViews,
  customFields,
  canWrite,
}: Props) {
  const [tab, setTab] = useState<TabKey>("invoices");
  const [activities, setActivities] = useState(initialActivities);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

  const primaryBranch = useMemo(
    () => branches.find((b) => b.isPrimary) ?? branches[0] ?? null,
    [branches],
  );

  const counts: Record<TabKey, number> = {
    invoices: invoices.length,
    orders: orders.length,
    profile: 0,
    branches: branches.length,
    activity: activities.length,
  };

  function addActivity() {
    if (!title.trim()) return;
    startTransition(async () => {
      const res = await fetch("/api/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          kind: "TASK",
          title: title.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία");
        return;
      }
      setActivities((prev) => [data.item, ...prev]);
      setTitle("");
      toast.success("Δραστηριότητα καταχωρήθηκε");
    });
  }

  return (
    <div className="space-y-5">
      {/* Region: KPIs */}
      <section
        aria-label="Σύνοψη"
        className="grid gap-3 sm:grid-cols-3"
      >
        <div className="soft-panel px-4 py-3">
          <p className="text-xs font-medium text-slate-500">Ανοιχτό υπόλοιπο</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink-950">
            {formatEUR(openBalance)}
          </p>
        </div>
        <div className="soft-panel px-4 py-3">
          <p className="text-xs font-medium text-slate-500">
            Ανοιχτά παραστατικά
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink-950">
            {openInvoices}
          </p>
        </div>
        <div className="soft-panel px-4 py-3">
          <p className="text-xs font-medium text-slate-500">
            Παραγγελίες / προσφορές
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-ink-950">
            {orders.length}
          </p>
        </div>
      </section>

      {/* Region: main + contact */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div
            role="tablist"
            aria-label="Περιοχές πελάτη"
            className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2"
          >
            {(Object.keys(TAB_LABEL) as TabKey[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  tab === key
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                {TAB_LABEL[key]}
                {counts[key] > 0 ? (
                  <span className="ml-1.5 text-xs opacity-70">
                    {counts[key]}
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          {tab === "invoices" ? (
            <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
              {invoices.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχουν παραστατικά
                </li>
              ) : (
                invoices.map((inv) => (
                  <li key={inv.id}>
                    <Link
                      href={`/invoices/${inv.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                    >
                      <div>
                        <p className="font-medium text-ink-900">{inv.number}</p>
                        <p className="text-xs text-slate-500">
                          {inv.issuedAt
                            ? new Date(inv.issuedAt).toLocaleDateString("el-GR")
                            : "—"}
                        </p>
                      </div>
                      <div className="text-right">
                        <Badge tone="slate">{inv.status}</Badge>
                        <p className="mt-1 text-sm font-semibold tabular-nums">
                          {formatEUR(
                            inv.balance > 0 ? inv.balance : inv.total,
                          )}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          {tab === "orders" ? (
            <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
              {orders.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-slate-500">
                  Δεν υπάρχουν παραγγελίες
                </li>
              ) : (
                orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/orders/${o.id}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50"
                    >
                      <div>
                        <p className="font-medium text-ink-900">{o.number}</p>
                        <p className="text-xs text-slate-500">
                          {o.kind === "SALES_QUOTE"
                            ? "Προσφορά"
                            : "Παραγγελία"}{" "}
                          · {o.status}
                        </p>
                      </div>
                      <p className="font-semibold tabular-nums">
                        {formatEUR(o.total)}
                      </p>
                    </Link>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          {tab === "profile" ? (
            <CustomerEditPanel
              customerId={customerId}
              canEdit={canWrite}
              formViews={formViews}
              customFields={customFields}
              initial={{
                code: customer.code,
                name: customer.name,
                vatNumber: customer.vatNumber,
                email: customer.email,
                phone: customer.phone,
                notes: customer.notes,
                status: customer.status,
                customFields: customer.customFields,
              }}
            />
          ) : null}

          {tab === "branches" ? (
            <CustomerHierarchyClient
              customerId={customerId}
              initialBranches={branches}
              canEdit={canWrite}
            />
          ) : null}

          {tab === "activity" ? (
            <div className="space-y-3">
              {canWrite ? (
                <div className="soft-panel flex flex-wrap gap-2 p-3">
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Νέα δραστηριότητα / task…"
                    className="min-w-[200px] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                  />
                  <Button
                    size="sm"
                    disabled={pending || !title.trim()}
                    onClick={addActivity}
                  >
                    Προσθήκη
                  </Button>
                </div>
              ) : null}
              <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
                {activities.length === 0 ? (
                  <li className="px-4 py-10 text-center text-sm text-slate-500">
                    Δεν υπάρχουν δραστηριότητες
                  </li>
                ) : (
                  activities.map((a) => (
                    <li key={a.id} className="px-4 py-3">
                      <p className="text-sm font-medium text-ink-900">
                        {a.title}
                      </p>
                      <p className="text-xs text-slate-500">
                        {a.kind}
                        {a.dueAt
                          ? ` · λήξη ${new Date(a.dueAt).toLocaleDateString("el-GR")}`
                          : ""}{" "}
                        · {new Date(a.createdAt).toLocaleString("el-GR")}
                      </p>
                    </li>
                  ))
                )}
              </ul>
            </div>
          ) : null}
        </div>

        {/* Region: contact / actions */}
        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="soft-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <Building2 size={16} className="text-teal-700" />
              <h2 className="text-sm font-semibold text-ink-950">Επαφή</h2>
            </div>
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Κωδικός</dt>
                <dd className="font-mono font-medium">{customer.code}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">ΑΦΜ</dt>
                <dd className="font-medium">{customer.vatNumber || "—"}</dd>
              </div>
              <div className="flex items-start justify-between gap-2">
                <dt className="text-slate-500">Email</dt>
                <dd className="max-w-[60%] truncate text-right font-medium">
                  {customer.email ? (
                    <a
                      href={`mailto:${customer.email}`}
                      className="inline-flex max-w-full items-center gap-1 text-teal-800 hover:underline"
                    >
                      <Mail size={12} className="shrink-0" />
                      <span className="truncate">{customer.email}</span>
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-slate-500">Τηλ.</dt>
                <dd className="font-medium">
                  {customer.phone ? (
                    <a
                      href={`tel:${customer.phone}`}
                      className="inline-flex items-center gap-1 text-teal-800 hover:underline"
                    >
                      <Phone size={12} />
                      {customer.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              {primaryBranch ? (
                <div className="border-t border-slate-100 pt-2.5">
                  <dt className="text-xs text-slate-500">Κύριο υποκατάστημα</dt>
                  <dd className="mt-1 font-medium text-ink-900">
                    {primaryBranch.name}
                  </dd>
                  <dd className="text-xs text-slate-500">
                    {[
                      primaryBranch.address,
                      primaryBranch.city,
                      primaryBranch.postalCode,
                    ]
                      .filter(Boolean)
                      .join(", ") || "Χωρίς διεύθυνση"}
                  </dd>
                </div>
              ) : null}
              {customer.notes ? (
                <div className="border-t border-slate-100 pt-2.5">
                  <dt className="text-xs text-slate-500">Σημειώσεις</dt>
                  <dd className="mt-1 line-clamp-4 text-slate-700">
                    {customer.notes}
                  </dd>
                </div>
              ) : null}
            </dl>
            <button
              type="button"
              onClick={() => setTab("profile")}
              className="mt-3 text-xs font-medium text-teal-800 hover:underline"
            >
              Επεξεργασία στοιχείων →
            </button>
          </section>

          {canWrite ? (
            <section className="soft-panel space-y-2 p-4">
              <h2 className="text-sm font-semibold text-ink-950">Ενέργειες</h2>
              <Link
                href="/invoices/new"
                className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-ink-900 hover:bg-slate-50"
              >
                <FileText size={15} className="text-teal-700" />
                Νέο τιμολόγιο
              </Link>
              <Link
                href="/orders/new"
                className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-ink-900 hover:bg-slate-50"
              >
                <ShoppingCart size={15} className="text-teal-700" />
                Νέα παραγγελία
              </Link>
              <Link
                href="/quotes/new"
                className="flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm text-ink-900 hover:bg-slate-50"
              >
                <FileText size={15} className="text-amber-700" />
                Νέα προσφορά
              </Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
