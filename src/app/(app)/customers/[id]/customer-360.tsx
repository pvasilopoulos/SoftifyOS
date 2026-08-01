"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";

type Props = {
  customerId: string;
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
  canWrite: boolean;
};

export function Customer360({
  customerId,
  openBalance,
  openInvoices,
  invoices,
  orders,
  activities: initialActivities,
  canWrite,
}: Props) {
  const [tab, setTab] = useState<"invoices" | "orders" | "activity">("invoices");
  const [activities, setActivities] = useState(initialActivities);
  const [title, setTitle] = useState("");
  const [pending, startTransition] = useTransition();

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
    <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="soft-panel px-4 py-3">
          <p className="text-xs text-slate-500">Ανοιχτό υπόλοιπο</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-950">
            {formatEUR(openBalance)}
          </p>
        </div>
        <div className="soft-panel px-4 py-3">
          <p className="text-xs text-slate-500">Ανοιχτά παραστατικά</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-950">
            {openInvoices}
          </p>
        </div>
        <div className="soft-panel px-4 py-3">
          <p className="text-xs text-slate-500">Παραγγελίες / προσφορές</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-950">
            {orders.length}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-slate-200 pb-2">
        {(
          [
            ["invoices", "Παραστατικά"],
            ["orders", "Παραγγελίες"],
            ["activity", "Δραστηριότητα"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === key
                ? "bg-ink-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "invoices" ? (
        <ul className="soft-panel divide-y divide-slate-100 overflow-hidden">
          {invoices.length === 0 ? (
            <li className="px-4 py-8 text-center text-sm text-slate-500">
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
                      {formatEUR(inv.balance > 0 ? inv.balance : inv.total)}
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
            <li className="px-4 py-8 text-center text-sm text-slate-500">
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
                      {o.kind === "SALES_QUOTE" ? "Προσφορά" : "Παραγγελία"} ·{" "}
                      {o.status}
                    </p>
                  </div>
                  <p className="font-semibold tabular-nums">{formatEUR(o.total)}</p>
                </Link>
              </li>
            ))
          )}
        </ul>
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
              <li className="px-4 py-8 text-center text-sm text-slate-500">
                Δεν υπάρχουν δραστηριότητες
              </li>
            ) : (
              activities.map((a) => (
                <li key={a.id} className="px-4 py-3">
                  <p className="text-sm font-medium text-ink-900">{a.title}</p>
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
    </section>
  );
}
