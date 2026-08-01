"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { formatEUR } from "@/modules/sales/invoice-utils";
import { cn } from "@/shared/lib/cn";

type Lead = {
  id: string;
  title: string;
  company: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  value: number;
  notes: string | null;
  activityCount: number;
};

const COLUMNS = [
  { key: "NEW", label: "Νέα", tone: "slate" as const },
  { key: "CONTACTED", label: "Επικοινωνία", tone: "teal" as const },
  { key: "QUALIFIED", label: "Qualified", tone: "teal" as const },
  { key: "PROPOSAL", label: "Πρόταση", tone: "amber" as const },
  { key: "WON", label: "Κερδήθηκε", tone: "emerald" as const },
  { key: "LOST", label: "Χάθηκε", tone: "rose" as const },
];

export function CrmClient({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [value, setValue] = useState("");

  const byStatus = useMemo(() => {
    const map: Record<string, Lead[]> = {};
    for (const col of COLUMNS) map[col.key] = [];
    for (const lead of leads) {
      (map[lead.status] ?? map.NEW)!.push(lead);
    }
    return map;
  }, [leads]);

  const pipelineValue = leads
    .filter((l) => !["WON", "LOST"].includes(l.status))
    .reduce((s, l) => s + l.value, 0);

  function createLead() {
    if (!title.trim()) return;
    startTransition(async () => {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          company: company.trim() || null,
          value: Number(value) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία");
        return;
      }
      setLeads((prev) => [
        { ...data.item, activityCount: 0 },
        ...prev,
      ]);
      setTitle("");
      setCompany("");
      setValue("");
      toast.success("Νέο lead δημιουργήθηκε");
    });
  }

  function moveLead(id: string, status: string) {
    const prev = leads;
    setLeads((list) =>
      list.map((l) => (l.id === id ? { ...l, status } : l)),
    );
    startTransition(async () => {
      const res = await fetch(`/api/crm/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        setLeads(prev);
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Αποτυχία ενημέρωσης");
        return;
      }
      toast.success("Το stage ενημερώθηκε");
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="CRM Pipeline"
        description={`Ανοιχτό pipeline ${formatEUR(pipelineValue)} · ${leads.length} leads`}
      />

      <section className="soft-panel flex flex-wrap items-end gap-2 p-4">
        <div className="min-w-[160px] flex-1">
          <label className="text-[11px] font-medium text-slate-500">Τίτλος</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-0.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
            placeholder="π.χ. Νέο project Αιγαίο"
          />
        </div>
        <div className="min-w-[140px] flex-1">
          <label className="text-[11px] font-medium text-slate-500">Εταιρεία</label>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            className="mt-0.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
          />
        </div>
        <div className="w-28">
          <label className="text-[11px] font-medium text-slate-500">Αξία €</label>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-0.5 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
          />
        </div>
        <Button size="sm" disabled={pending || !title.trim()} onClick={createLead}>
          <Plus size={14} /> Lead
        </Button>
      </section>

      <div className="grid gap-3 xl:grid-cols-6 lg:grid-cols-3 sm:grid-cols-2">
        {COLUMNS.map((col) => (
          <section key={col.key} className="soft-panel flex min-h-[280px] flex-col p-3">
            <div className="mb-2 flex items-center justify-between">
              <Badge tone={col.tone}>{col.label}</Badge>
              <span className="text-xs text-slate-400">
                {(byStatus[col.key] || []).length}
              </span>
            </div>
            <ul className="space-y-2">
              {(byStatus[col.key] || []).map((lead) => (
                <li
                  key={lead.id}
                  className="rounded-xl border border-slate-100 bg-white p-2.5 shadow-sm"
                >
                  <p className="text-sm font-semibold text-ink-900">{lead.title}</p>
                  <p className="text-xs text-slate-500">
                    {lead.company || "—"} · {formatEUR(lead.value)}
                  </p>
                  <select
                    value={lead.status}
                    disabled={pending}
                    onChange={(e) => moveLead(lead.id, e.target.value)}
                    className={cn(
                      "mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]",
                    )}
                  >
                    {COLUMNS.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
