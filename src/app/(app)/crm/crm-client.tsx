"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  Calendar,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  UserRound,
  Video,
  CheckSquare,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Drawer } from "@/shared/ui/drawer";
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
  customerId: string | null;
  activityCount: number;
};

type Activity = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  dueAt: string | null;
  doneAt: string | null;
  createdAt: string;
};

type ActivityKind = "CALL" | "EMAIL" | "MEETING" | "NOTE" | "TASK";

const COLUMNS = [
  { key: "NEW", label: "Νέα", tone: "slate" as const },
  { key: "CONTACTED", label: "Επικοινωνία", tone: "teal" as const },
  { key: "QUALIFIED", label: "Qualified", tone: "teal" as const },
  { key: "PROPOSAL", label: "Πρόταση", tone: "amber" as const },
  { key: "WON", label: "Κερδήθηκε", tone: "emerald" as const },
  { key: "LOST", label: "Χάθηκε", tone: "rose" as const },
];

const ACTIVITY_KINDS: {
  value: ActivityKind;
  label: string;
  icon: typeof Phone;
}[] = [
  { value: "CALL", label: "Κλήση", icon: Phone },
  { value: "EMAIL", label: "Email", icon: Mail },
  { value: "MEETING", label: "Συνάντηση", icon: Video },
  { value: "NOTE", label: "Σημείωση", icon: MessageSquare },
  { value: "TASK", label: "Εργασία", icon: CheckSquare },
];

function kindLabel(kind: string) {
  return ACTIVITY_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function formatWhen(iso: string | null) {
  if (!iso) return null;
  return new Date(iso).toLocaleString("el-GR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CrmClient({ initialLeads }: { initialLeads: Lead[] }) {
  const [leads, setLeads] = useState(initialLeads);
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [company, setCompany] = useState("");
  const [value, setValue] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activityKind, setActivityKind] = useState<ActivityKind>("NOTE");
  const [activitySubject, setActivitySubject] = useState("");
  const [activityDueAt, setActivityDueAt] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [activityPending, setActivityPending] = useState(false);

  const selectedLead = useMemo(
    () => leads.find((l) => l.id === selectedLeadId) ?? null,
    [leads, selectedLeadId],
  );

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

  /** Weighted forecast: stage probability × value (open pipeline only). */
  const forecast = useMemo(() => {
    const weights: Record<string, number> = {
      NEW: 0.1,
      CONTACTED: 0.25,
      QUALIFIED: 0.45,
      PROPOSAL: 0.65,
    };
    let weighted = 0;
    let openCount = 0;
    for (const l of leads) {
      const w = weights[l.status];
      if (w == null) continue;
      weighted += l.value * w;
      openCount += 1;
    }
    return { weighted, openCount };
  }, [leads]);

  const loadActivities = useCallback(async (leadId: string) => {
    setActivitiesLoading(true);
    try {
      const res = await fetch(`/api/crm/activities?leadId=${encodeURIComponent(leadId)}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία φόρτωσης δραστηριοτήτων");
        setActivities([]);
        return;
      }
      setActivities(data.items ?? []);
    } catch {
      toast.error("Αποτυχία φόρτωσης δραστηριοτήτων");
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedLeadId) {
      setActivities([]);
      return;
    }
    void loadActivities(selectedLeadId);
  }, [selectedLeadId, loadActivities]);

  useEffect(() => {
    if (!selectedLead) return;
    setActivityKind("NOTE");
    setActivitySubject("");
    setActivityDueAt("");
    setActivityNotes("");
  }, [selectedLead?.id]);

  function openLead(leadId: string) {
    setSelectedLeadId(leadId);
  }

  function closeDrawer() {
    setSelectedLeadId(null);
  }

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
        { ...data.item, customerId: data.item.customerId ?? null, activityCount: 0 },
        ...prev,
      ]);
      setTitle("");
      setCompany("");
      setValue("");
      toast.success("Νέο lead δημιουργήθηκε");
    });
  }

  async function patchLead(
    id: string,
    patch: { status?: string; customerId?: string | null },
  ) {
    const res = await fetch(`/api/crm/leads/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || "Αποτυχία ενημέρωσης");
    }
    return data.item as Lead & { customerId?: string | null };
  }

  function moveLead(id: string, status: string) {
    const lead = leads.find((l) => l.id === id);
    if (!lead) return;

    const prev = leads;
    setLeads((list) =>
      list.map((l) => (l.id === id ? { ...l, status } : l)),
    );

    startTransition(async () => {
      try {
        const item = await patchLead(id, { status });
        setLeads((list) =>
          list.map((l) =>
            l.id === id
              ? {
                  ...l,
                  status: item.status,
                  customerId: item.customerId ?? l.customerId,
                }
              : l,
          ),
        );
        toast.success(
          status === "WON" && item.customerId
            ? "Κερδήθηκε · δημιουργήθηκε / συνδέθηκε πελάτης"
            : "Το stage ενημερώθηκε",
        );
      } catch (error) {
        setLeads(prev);
        toast.error(error instanceof Error ? error.message : "Αποτυχία ενημέρωσης");
      }
    });
  }

  async function toggleActivityDone(activity: Activity) {
    const done = !activity.doneAt;
    const res = await fetch(`/api/crm/activities/${activity.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast.error(data.error || "Αποτυχία ενημέρωσης");
      return;
    }
    setActivities((prev) =>
      prev.map((a) => (a.id === activity.id ? data.item : a)),
    );
  }

  async function createActivity() {
    if (!selectedLead || !activitySubject.trim()) return;
    setActivityPending(true);
    try {
      const res = await fetch("/api/crm/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: selectedLead.id,
          kind: activityKind,
          title: activitySubject.trim(),
          body: activityNotes.trim() || null,
          dueAt: activityDueAt
            ? new Date(activityDueAt).toISOString()
            : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία δημιουργίας");
        return;
      }
      setActivities((prev) => [data.item, ...prev]);
      setLeads((list) =>
        list.map((l) =>
          l.id === selectedLead.id
            ? { ...l, activityCount: l.activityCount + 1 }
            : l,
        ),
      );
      setActivitySubject("");
      setActivityDueAt("");
      setActivityNotes("");
      toast.success("Νέα δραστηριότητα");
    } finally {
      setActivityPending(false);
    }
  }

  const selectedColumn = selectedLead
    ? COLUMNS.find((c) => c.key === selectedLead.status)
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title="CRM Pipeline"
        description={`Ανοιχτό pipeline ${formatEUR(pipelineValue)} · ${leads.length} leads · πρόβλεψη ${formatEUR(forecast.weighted)} (${forecast.openCount} ανοιχτά)`}
      />

      <section className="grid gap-2 sm:grid-cols-3">
        <div className="soft-panel px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Ανοιχτό €
          </p>
          <p className="text-lg font-semibold tabular-nums text-ink-950">
            {formatEUR(pipelineValue)}
          </p>
        </div>
        <div className="soft-panel px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Weighted forecast
          </p>
          <p className="text-lg font-semibold tabular-nums text-teal-800">
            {formatEUR(forecast.weighted)}
          </p>
        </div>
        <div className="soft-panel px-3 py-2.5">
          <p className="text-[11px] uppercase tracking-wide text-slate-500">
            Win rate (όλα)
          </p>
          <p className="text-lg font-semibold tabular-nums text-ink-950">
            {leads.length
              ? `${Math.round(
                  (leads.filter((l) => l.status === "WON").length /
                    Math.max(
                      1,
                      leads.filter((l) =>
                        ["WON", "LOST"].includes(l.status),
                      ).length,
                    )) *
                    100,
                )}%`
              : "—"}
          </p>
        </div>
      </section>

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
                <li key={lead.id}>
                  <button
                    type="button"
                    onClick={() => openLead(lead.id)}
                    className="w-full rounded-xl border border-slate-100 bg-white p-2.5 text-left shadow-sm transition hover:border-teal-200 hover:shadow-md"
                  >
                    <p className="text-sm font-semibold text-ink-900">{lead.title}</p>
                    <p className="text-xs text-slate-500">
                      {lead.company || "—"} · {formatEUR(lead.value)}
                    </p>
                    {lead.activityCount > 0 ? (
                      <p className="mt-1 text-[10px] text-slate-400">
                        {lead.activityCount} δραστηριότητ{lead.activityCount === 1 ? "α" : "ες"}
                      </p>
                    ) : null}
                  </button>
                  <select
                    value={lead.status}
                    disabled={pending}
                    onChange={(e) => moveLead(lead.id, e.target.value)}
                    className={cn(
                      "mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]",
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

      <Drawer
        open={Boolean(selectedLead)}
        onClose={closeDrawer}
        title={selectedLead?.title ?? ""}
        subtitle={
          selectedLead
            ? [selectedLead.company, formatEUR(selectedLead.value)]
                .filter(Boolean)
                .join(" · ")
            : undefined
        }
        widthClass="max-w-lg"
        headerExtra={
          selectedColumn ? (
            <Badge tone={selectedColumn.tone}>{selectedColumn.label}</Badge>
          ) : null
        }
      >
        {selectedLead ? (
          <div className="space-y-5">
            <section className="soft-panel space-y-2 p-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Στοιχεία επαφής
              </h3>
              <dl className="grid gap-2 text-sm">
                {selectedLead.contactName ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <UserRound size={14} className="shrink-0 text-slate-400" />
                    <span>{selectedLead.contactName}</span>
                  </div>
                ) : null}
                {selectedLead.email ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Mail size={14} className="shrink-0 text-slate-400" />
                    <a
                      href={`mailto:${selectedLead.email}`}
                      className="truncate text-teal-700 hover:underline"
                    >
                      {selectedLead.email}
                    </a>
                  </div>
                ) : null}
                {selectedLead.phone ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Phone size={14} className="shrink-0 text-slate-400" />
                    <a
                      href={`tel:${selectedLead.phone}`}
                      className="text-teal-700 hover:underline"
                    >
                      {selectedLead.phone}
                    </a>
                  </div>
                ) : null}
                {!selectedLead.contactName &&
                !selectedLead.email &&
                !selectedLead.phone ? (
                  <p className="text-xs text-slate-400">Δεν υπάρχουν στοιχεία επαφής</p>
                ) : null}
              </dl>
              {selectedLead.notes ? (
                <p className="rounded-lg bg-slate-50 px-2.5 py-2 text-xs text-slate-600">
                  {selectedLead.notes}
                </p>
              ) : null}
            </section>

            <section className="soft-panel flex flex-col gap-2 p-3">
              {selectedLead.customerId ? (
                <Link
                  href={`/customers/${selectedLead.customerId}`}
                  className="inline-flex h-8 w-full items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-medium text-ink-900 shadow-sm transition hover:bg-slate-50"
                >
                  Προβολή πελάτη
                </Link>
              ) : null}
              <Link
                href={`/quotes/new?leadId=${selectedLead.id}${
                  selectedLead.customerId
                    ? `&customerId=${selectedLead.customerId}`
                    : ""
                }`}
                className="inline-flex h-8 w-full items-center justify-center rounded-xl bg-teal-700 px-3 text-xs font-medium text-white transition hover:bg-teal-800"
              >
                Νέα προσφορά από lead
              </Link>
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Δραστηριότητες
                </h3>
                <span className="text-[10px] text-slate-400">
                  {activities.length} εγγραφές
                </span>
              </div>

              <form
                className="soft-panel space-y-2.5 p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void createActivity();
                }}
              >
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_KINDS.map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setActivityKind(value)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] transition",
                        activityKind === value
                          ? "border-teal-300 bg-teal-50 text-teal-800"
                          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
                      )}
                    >
                      <Icon size={12} />
                      {label}
                    </button>
                  ))}
                </div>
                <input
                  value={activitySubject}
                  onChange={(e) => setActivitySubject(e.target.value)}
                  placeholder="Θέμα δραστηριότητας"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                  required
                />
                <input
                  type="datetime-local"
                  value={activityDueAt}
                  onChange={(e) => setActivityDueAt(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                />
                <textarea
                  value={activityNotes}
                  onChange={(e) => setActivityNotes(e.target.value)}
                  placeholder="Σημειώσεις (προαιρετικά)"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-teal-300"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={activityPending || !activitySubject.trim()}
                  className="w-full"
                >
                  <Plus size={14} />
                  Προσθήκη δραστηριότητας
                </Button>
              </form>

              {activitiesLoading ? (
                <p className="py-4 text-center text-xs text-slate-400">Φόρτωση…</p>
              ) : activities.length === 0 ? (
                <p className="soft-panel py-6 text-center text-xs text-slate-400">
                  Δεν υπάρχουν δραστηριότητες
                </p>
              ) : (
                <ul className="space-y-2">
                  {activities.map((activity) => (
                    <li
                      key={activity.id}
                      className="soft-panel space-y-1 p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={activity.doneAt ? "emerald" : "slate"}>
                              {kindLabel(activity.kind)}
                            </Badge>
                            <span
                              className={cn(
                                "text-sm font-medium text-ink-900",
                                activity.doneAt && "line-through opacity-60",
                              )}
                            >
                              {activity.title}
                            </span>
                          </div>
                          {activity.body ? (
                            <p className="mt-1 text-xs text-slate-600">{activity.body}</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => void toggleActivityDone(activity)}
                          className="shrink-0 text-[11px] font-medium text-teal-700 hover:underline"
                        >
                          {activity.doneAt ? "Άκυρο" : "Ολοκλήρωση"}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-3 text-[10px] text-slate-400">
                        {activity.dueAt ? (
                          <span className="inline-flex items-center gap-1">
                            <Calendar size={10} />
                            Λήξη {formatWhen(activity.dueAt)}
                          </span>
                        ) : null}
                        {activity.doneAt ? (
                          <span>Ολοκλ. {formatWhen(activity.doneAt)}</span>
                        ) : null}
                        <span>{formatWhen(activity.createdAt)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
