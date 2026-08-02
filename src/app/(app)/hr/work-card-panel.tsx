"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import QRCode from "qrcode";
import {
  Camera,
  CheckCircle2,
  Clock3,
  IdCard,
  Keyboard,
  Maximize2,
  QrCode,
  RefreshCw,
  Users,
  X,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { toast } from "@/shared/ui/toaster";
import { cn } from "@/shared/lib/cn";
import {
  presenceStatusLabel,
  workCardEventSourceLabel,
  workCardEventTypeLabel,
  workCardStatusLabel,
} from "@/modules/hr/labels";
import { workCardQrPayload } from "@/modules/hr/work-card-qr";

type Employee = {
  id: string;
  code: string;
  firstName: string;
  lastName: string;
  department?: string | null;
  title?: string | null;
};

type SiteOpt = { id: string; code: string; name: string };

type WorkCard = {
  id: string;
  cardNumber: string;
  qrToken?: string | null;
  status: string;
  issuedAt: string;
  employee: Employee;
};

type WorkCardEvent = {
  id: string;
  type: string;
  source: string;
  occurredAt: string;
  erganiStatus: string;
  isLate?: boolean;
  isEarly?: boolean;
  employee: Employee;
  workCard: { id: string; cardNumber: string } | null;
  site: SiteOpt | null;
};

type LiveRow = {
  employee: Employee;
  presence: "OUT" | "IN" | "BREAK";
  lastType: string | null;
  lastAt: string | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  isLate: boolean;
  isEarly: boolean;
  punchCount: number;
  suggestedNext: string;
};

type LiveData = {
  day: string;
  summary: {
    total: number;
    in: number;
    break: number;
    out: number;
    late: number;
    punchesToday: number;
  };
  rows: LiveRow[];
};

function empName(e: { firstName: string; lastName: string; code?: string }) {
  return `${e.lastName} ${e.firstName}${e.code ? ` (${e.code})` : ""}`;
}

function dt(iso: string) {
  return new Date(iso).toLocaleString("el-GR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timeOnly(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("el-GR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Tab = "scanner" | "live" | "today" | "cards" | "manual";

export function WorkCardPanel({
  workCards: initialCards,
  events: initialEvents,
  activeEmployees,
  sites,
  canWrite,
  onRefresh,
}: {
  workCards: WorkCard[];
  events: WorkCardEvent[];
  activeEmployees: Employee[];
  sites: SiteOpt[];
  canWrite: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("scanner");
  const [cards, setCards] = useState(initialCards);
  const [events, setEvents] = useState(initialEvents);
  const [live, setLive] = useState<LiveData | null>(null);
  const [busy, setBusy] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [lastScan, setLastScan] = useState<{
    message: string;
    presence: string;
    at: string;
    ok: boolean;
  } | null>(null);
  const [manualQr, setManualQr] = useState("");
  const [scanSiteId, setScanSiteId] = useState(sites[0]?.id ?? "");
  const [qrPreview, setQrPreview] = useState<{
    card: WorkCard;
    dataUrl: string;
  } | null>(null);
  const [cardForm, setCardForm] = useState({
    employeeId: "",
    cardNumber: "",
    notes: "",
  });
  const [punchForm, setPunchForm] = useState({
    employeeId: "",
    type: "CLOCK_IN",
    siteId: "",
    note: "",
  });
  const [presenceFilter, setPresenceFilter] = useState<
    "ALL" | "IN" | "OUT" | "BREAK" | "LATE"
  >("ALL");

  useEffect(() => setCards(initialCards), [initialCards]);
  useEffect(() => setEvents(initialEvents), [initialEvents]);

  const loadLive = useCallback(async () => {
    const res = await fetch("/api/hr/attendance/live", { cache: "no-store" });
    const data = (await res.json()) as LiveData & { error?: string };
    if (res.ok) setLive(data);
  }, []);

  const loadToday = useCallback(async () => {
    const res = await fetch("/api/hr/work-card-events?day=today", {
      cache: "no-store",
    });
    const data = (await res.json()) as { items?: WorkCardEvent[] };
    if (res.ok) setEvents(data.items ?? []);
  }, []);

  useEffect(() => {
    void loadLive();
    const t = setInterval(() => void loadLive(), 20_000);
    return () => clearInterval(t);
  }, [loadLive]);

  useEffect(() => {
    if (tab === "today") void loadToday();
    if (tab === "live") void loadLive();
  }, [tab, loadLive, loadToday]);

  async function refreshAll() {
    await onRefresh();
    await loadLive();
    if (tab === "today") await loadToday();
  }

  async function doScan(qr: string) {
    if (!canWrite) return;
    const trimmed = qr.trim();
    if (trimmed.length < 4) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hr/work-card-events/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qr: trimmed,
          type: "AUTO",
          siteId: scanSiteId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setLastScan({
          message: data.error || "Αποτυχία scan",
          presence: "—",
          at: new Date().toISOString(),
          ok: false,
        });
        toast.error(data.error || "Αποτυχία scan");
        return;
      }
      const typeLabel =
        workCardEventTypeLabel[
          data.item.type as keyof typeof workCardEventTypeLabel
        ] ?? data.item.type;
      const presence =
        presenceStatusLabel[
          data.presenceAfter as keyof typeof presenceStatusLabel
        ] ?? data.presenceAfter;
      setLastScan({
        message: `${data.employee.lastName} ${data.employee.firstName} · ${typeLabel}`,
        presence,
        at: data.item.occurredAt,
        ok: true,
      });
      toast.success(`${typeLabel} · ${presence}`);
      setManualQr("");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function issueCard(e: FormEvent) {
    e.preventDefault();
    if (!canWrite) return;
    setBusy(true);
    try {
      const res = await fetch("/api/hr/work-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...cardForm,
          notes: cardForm.notes || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία έκδοσης");
        return;
      }
      toast.success(`Εκδόθηκε ${data.item.cardNumber}`);
      setCardForm({ employeeId: "", cardNumber: "", notes: "" });
      await refreshAll();
      if (data.item?.qrToken) {
        const dataUrl = await QRCode.toDataURL(
          workCardQrPayload(data.item.qrToken),
          { width: 280, margin: 1 },
        );
        setQrPreview({ card: data.item, dataUrl });
      }
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(id: string, status: "ACTIVE" | "INACTIVE" | "LOST") {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/work-cards/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία");
        return;
      }
      toast.success("Ενημερώθηκε");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function punch(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch("/api/hr/work-card-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...punchForm,
          siteId: punchForm.siteId || null,
          note: punchForm.note || null,
          source: "MANUAL",
          enforceState: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Αποτυχία χτυπήματος");
        return;
      }
      toast.success("Καταχωρήθηκε");
      await refreshAll();
    } finally {
      setBusy(false);
    }
  }

  async function showQr(card: WorkCard) {
    if (!card.qrToken) {
      toast.error("Η κάρτα δεν έχει QR token — ανανέωσε τη σελίδα");
      return;
    }
    const dataUrl = await QRCode.toDataURL(workCardQrPayload(card.qrToken), {
      width: 280,
      margin: 1,
    });
    setQrPreview({ card, dataUrl });
  }

  const todayEvents = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return events.filter((e) => new Date(e.occurredAt) >= start);
  }, [events]);

  const filteredLive = useMemo(() => {
    const rows = live?.rows ?? [];
    if (presenceFilter === "ALL") return rows;
    if (presenceFilter === "LATE") return rows.filter((r) => r.isLate);
    return rows.filter((r) => r.presence === presenceFilter);
  }, [live, presenceFilter]);

  const activeCards = cards.filter((c) => c.status === "ACTIVE").length;

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            ["Ενεργές κάρτες", activeCards, "teal"],
            ["Εντός τώρα", live?.summary.in ?? 0, "emerald"],
            ["Διάλειμμα", live?.summary.break ?? 0, "amber"],
            ["Εκτός", live?.summary.out ?? 0, "slate"],
            ["Χτυπήματα σήμερα", live?.summary.punchesToday ?? todayEvents.length, "teal"],
          ] as const
        ).map(([label, value, tone]) => (
          <div
            key={label}
            className="rounded-2xl border border-slate-100 bg-white px-3 py-2.5 shadow-sm"
          >
            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
              {label}
            </p>
            <p
              className={cn(
                "mt-0.5 text-2xl font-semibold tabular-nums",
                tone === "emerald" && "text-emerald-700",
                tone === "amber" && "text-amber-700",
                tone === "teal" && "text-teal-800",
                tone === "slate" && "text-slate-700",
              )}
            >
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-slate-100/80 p-1">
        {(
          [
            ["scanner", "QR Scanner", QrCode],
            ["live", "Live board", Users],
            ["today", "Σήμερα", Clock3],
            ["cards", "Κάρτες", IdCard],
            ["manual", "Χειροκίνητα", Keyboard],
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition",
              tab === id
                ? "bg-white text-ink-950 shadow-sm"
                : "text-slate-600 hover:text-ink-900",
            )}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void refreshAll()}
          >
            <RefreshCw size={14} />
          </Button>
          {canWrite ? (
            <Button size="sm" variant="secondary" onClick={() => setKiosk(true)}>
              <Maximize2 size={14} />
              Kiosk
            </Button>
          ) : null}
        </div>
      </div>

      {tab === "scanner" ? (
        <ScannerPane
          canWrite={canWrite}
          busy={busy}
          sites={sites}
          scanSiteId={scanSiteId}
          setScanSiteId={setScanSiteId}
          manualQr={manualQr}
          setManualQr={setManualQr}
          lastScan={lastScan}
          onScan={(qr) => void doScan(qr)}
        />
      ) : null}

      {tab === "live" ? (
        <section className="soft-panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Live παρουσία</h3>
              <p className="text-xs text-slate-500">
                {live?.day
                  ? new Date(live.day).toLocaleDateString("el-GR")
                  : "Σήμερα"}{" "}
                · ενημέρωση κάθε 20″
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ["ALL", "Όλοι"],
                  ["IN", "Εντός"],
                  ["BREAK", "Διάλειμμα"],
                  ["OUT", "Εκτός"],
                  ["LATE", "Καθυστέρηση"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setPresenceFilter(k)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11px] font-semibold",
                    presenceFilter === k
                      ? "bg-slate-900 text-white"
                      : "bg-slate-100 text-slate-600",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-[28rem] overflow-auto">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Εργαζόμενος</th>
                  <th className="px-3 py-2">Κατάσταση</th>
                  <th className="px-3 py-2">Έναρξη</th>
                  <th className="px-3 py-2">Λήξη</th>
                  <th className="px-3 py-2">Χτυπ.</th>
                  <th className="px-3 py-2">Επόμενο</th>
                </tr>
              </thead>
              <tbody>
                {filteredLive.map((r) => (
                  <tr key={r.employee.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">
                      <p className="font-medium">{empName(r.employee)}</p>
                      <p className="text-[11px] text-slate-500">
                        {[r.employee.department, r.employee.title]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </p>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        tone={
                          r.presence === "IN"
                            ? "emerald"
                            : r.presence === "BREAK"
                              ? "amber"
                              : "slate"
                        }
                      >
                        {presenceStatusLabel[r.presence]}
                      </Badge>
                      {r.isLate ? (
                        <span className="ml-1 text-[10px] font-semibold text-rose-600">
                          LATE
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {timeOnly(r.clockInAt)}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {timeOnly(r.clockOutAt)}
                    </td>
                    <td className="px-3 py-2 text-xs tabular-nums">
                      {r.punchCount}
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {workCardEventTypeLabel[
                        r.suggestedNext as keyof typeof workCardEventTypeLabel
                      ] ?? r.suggestedNext}
                    </td>
                  </tr>
                ))}
                {filteredLive.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-10 text-center text-slate-500"
                    >
                      Δεν υπάρχουν εργαζόμενοι στο φίλτρο.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "today" ? (
        <section className="soft-panel overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold">Χτυπήματα σήμερα</h3>
            <p className="text-xs text-slate-500">
              {todayEvents.length} καταγραφές · πηγή QR / χειροκίνητα / app
            </p>
          </div>
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Ώρα</th>
                <th className="px-3 py-2">Εργαζόμενος</th>
                <th className="px-3 py-2">Τύπος</th>
                <th className="px-3 py-2">Πηγή</th>
                <th className="px-3 py-2">Site</th>
                <th className="px-3 py-2">Flags</th>
                <th className="px-3 py-2">Εργάνη</th>
              </tr>
            </thead>
            <tbody>
              {todayEvents.map((ev) => (
                <tr key={ev.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 text-xs tabular-nums text-slate-600">
                    {dt(ev.occurredAt)}
                  </td>
                  <td className="px-3 py-2">{empName(ev.employee)}</td>
                  <td className="px-3 py-2">
                    {workCardEventTypeLabel[
                      ev.type as keyof typeof workCardEventTypeLabel
                    ] || ev.type}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-600">
                    {workCardEventSourceLabel[
                      ev.source as keyof typeof workCardEventSourceLabel
                    ] || ev.source}
                  </td>
                  <td className="px-3 py-2 text-xs">{ev.site?.code || "—"}</td>
                  <td className="px-3 py-2 text-[11px]">
                    {ev.isLate ? (
                      <span className="mr-1 font-semibold text-rose-600">
                        LATE
                      </span>
                    ) : null}
                    {ev.isEarly ? (
                      <span className="font-semibold text-amber-600">EARLY</span>
                    ) : null}
                    {!ev.isLate && !ev.isEarly ? "—" : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{ev.erganiStatus}</td>
                </tr>
              ))}
              {todayEvents.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-10 text-center text-slate-500"
                  >
                    Δεν υπάρχουν χτυπήματα σήμερα — δοκίμασε το QR Scanner.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      ) : null}

      {tab === "cards" ? (
        <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
          {canWrite ? (
            <form onSubmit={issueCard} className="soft-panel h-fit space-y-3 p-4">
              <h3 className="text-sm font-semibold">Έκδοση κάρτας + QR</h3>
              <p className="text-xs text-slate-500">
                Δημιουργεί μοναδικό QR token για check-in/out στον scanner /
                kiosk.
              </p>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Εργαζόμενος
                </span>
                <select
                  required
                  value={cardForm.employeeId}
                  onChange={(ev) =>
                    setCardForm((f) => ({ ...f, employeeId: ev.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                >
                  <option value="">—</option>
                  {activeEmployees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {empName(e)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Αριθμός κάρτας
                </span>
                <input
                  required
                  value={cardForm.cardNumber}
                  onChange={(ev) =>
                    setCardForm((f) => ({ ...f, cardNumber: ev.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm"
                  placeholder="WC-0001"
                />
              </label>
              <Button type="submit" size="sm" disabled={busy}>
                Έκδοση
              </Button>
            </form>
          ) : null}
          <section className="soft-panel overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Κάρτα</th>
                  <th className="px-3 py-2">Εργαζόμενος</th>
                  <th className="px-3 py-2">Κατάσταση</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs">
                      {c.cardNumber}
                    </td>
                    <td className="px-3 py-2">{empName(c.employee)}</td>
                    <td className="px-3 py-2">
                      {canWrite ? (
                        <select
                          className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                          value={c.status}
                          disabled={busy}
                          onChange={(ev) =>
                            void patchStatus(
                              c.id,
                              ev.target.value as "ACTIVE" | "INACTIVE" | "LOST",
                            )
                          }
                        >
                          {Object.entries(workCardStatusLabel).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </select>
                      ) : (
                        workCardStatusLabel[
                          c.status as keyof typeof workCardStatusLabel
                        ] || c.status
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void showQr(c)}
                      >
                        <QrCode size={14} />
                        QR
                      </Button>
                    </td>
                  </tr>
                ))}
                {cards.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-10 text-center text-slate-500"
                    >
                      Δεν έχουν εκδοθεί κάρτες.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        </div>
      ) : null}

      {tab === "manual" ? (
        <form
          onSubmit={punch}
          className="soft-panel mx-auto max-w-lg space-y-3 p-4"
        >
          <h3 className="text-sm font-semibold">Χειροκίνητο χτύπημα</h3>
          <p className="text-xs text-slate-500">
            Εφαρμόζεται state machine (π.χ. δεν γίνεται λήξη χωρίς έναρξη).
          </p>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Εργαζόμενος
            </span>
            <select
              required
              value={punchForm.employeeId}
              onChange={(ev) =>
                setPunchForm((f) => ({ ...f, employeeId: ev.target.value }))
              }
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              disabled={!canWrite}
            >
              <option value="">—</option>
              {activeEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {empName(e)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Τύπος
            </span>
            <select
              value={punchForm.type}
              onChange={(ev) =>
                setPunchForm((f) => ({ ...f, type: ev.target.value }))
              }
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            >
              {Object.entries(workCardEventTypeLabel).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {sites.length ? (
            <label className="block text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Εγκατάσταση
              </span>
              <select
                value={punchForm.siteId}
                onChange={(ev) =>
                  setPunchForm((f) => ({ ...f, siteId: ev.target.value }))
                }
                className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
              >
                <option value="">—</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Button type="submit" size="sm" disabled={busy || !canWrite}>
            Καταχώρηση
          </Button>
        </form>
      ) : null}

      {qrPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">
                  QR · {qrPreview.card.cardNumber}
                </p>
                <p className="text-xs text-slate-500">
                  {empName(qrPreview.card.employee)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setQrPreview(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"
              >
                <X size={16} />
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrPreview.dataUrl}
              alt="QR κάρτας"
              className="mx-auto mt-4 rounded-xl border border-slate-100"
            />
            <p className="mt-3 break-all text-center font-mono text-[10px] text-slate-400">
              {qrPreview.card.qrToken
                ? workCardQrPayload(qrPreview.card.qrToken)
                : ""}
            </p>
            <p className="mt-2 text-center text-xs text-slate-500">
              Εκτύπωσε ή δείξε στο kiosk για check-in/out.
            </p>
          </div>
        </div>
      ) : null}

      {kiosk ? (
        <KioskOverlay
          sites={sites}
          scanSiteId={scanSiteId}
          setScanSiteId={setScanSiteId}
          lastScan={lastScan}
          busy={busy}
          onClose={() => setKiosk(false)}
          onScan={(qr) => void doScan(qr)}
          live={live}
        />
      ) : null}
    </div>
  );
}

function ScannerPane({
  canWrite,
  busy,
  sites,
  scanSiteId,
  setScanSiteId,
  manualQr,
  setManualQr,
  lastScan,
  onScan,
}: {
  canWrite: boolean;
  busy: boolean;
  sites: SiteOpt[];
  scanSiteId: string;
  setScanSiteId: (v: string) => void;
  manualQr: string;
  setManualQr: (v: string) => void;
  lastScan: {
    message: string;
    presence: string;
    at: string;
    ok: boolean;
  } | null;
  onScan: (qr: string) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
      <div className="soft-panel space-y-3 overflow-hidden p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold">QR Scanner παρουσίας</h3>
            <p className="text-xs text-slate-500">
              Σάρωσε την κάρτα εργαζομένου — αυτόματο check-in / check-out /
              διάλειμμα.
            </p>
          </div>
          <Badge tone="teal">AUTO</Badge>
        </div>
        {sites.length ? (
          <label className="block text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Εγκατάσταση χτυπήματος
            </span>
            <select
              value={scanSiteId}
              onChange={(e) => setScanSiteId(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
            >
              <option value="">— χωρίς site —</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {canWrite ? (
          <QrCameraScanner disabled={busy} onDecode={onScan} />
        ) : (
          <p className="rounded-xl bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
            Δεν έχεις δικαίωμα καταχώρησης χτυπημάτων.
          </p>
        )}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onScan(manualQr);
          }}
        >
          <input
            value={manualQr}
            onChange={(e) => setManualQr(e.target.value)}
            placeholder="Ή πληκτρολόγησε QR / αριθμό κάρτας…"
            className="h-10 flex-1 rounded-xl border border-slate-200 px-3 font-mono text-sm"
            disabled={!canWrite || busy}
          />
          <Button type="submit" size="sm" disabled={!canWrite || busy}>
            Scan
          </Button>
        </form>
      </div>

      <div className="space-y-3">
        <div
          className={cn(
            "soft-panel flex min-h-[12rem] flex-col items-center justify-center p-6 text-center",
            lastScan?.ok && "border-emerald-200 bg-emerald-50/40",
            lastScan && !lastScan.ok && "border-rose-200 bg-rose-50/40",
          )}
        >
          {lastScan ? (
            <>
              {lastScan.ok ? (
                <CheckCircle2 className="text-emerald-600" size={36} />
              ) : (
                <AlertTriangle className="text-rose-600" size={36} />
              )}
              <p className="mt-3 text-lg font-semibold text-ink-950">
                {lastScan.message}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Κατάσταση: <strong>{lastScan.presence}</strong>
              </p>
              <p className="mt-1 text-xs text-slate-400">{dt(lastScan.at)}</p>
            </>
          ) : (
            <>
              <Camera className="text-slate-300" size={36} />
              <p className="mt-3 text-sm font-medium text-slate-600">
                Αναμονή σάρωσης
              </p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">
                Το σύστημα επιλέγει αυτόματα έναρξη ή λήξη με βάση το τελευταίο
                χτύπημα της ημέρας.
              </p>
            </>
          )}
        </div>
        <div className="soft-panel space-y-2 p-4 text-xs leading-relaxed text-slate-600">
          <p className="font-semibold text-ink-900">Πώς δουλεύει</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Έκδοση κάρτας → QR badge για τον εργαζόμενο</li>
            <li>Scan → αυτόματο CLOCK_IN / CLOCK_OUT / διάλειμμα</li>
            <li>Καθυστέρηση vs ωράριο (αν υπάρχει ανάθεση)</li>
            <li>Ουρά Εργάνη για κάθε χτύπημα</li>
            <li>Kiosk mode για είσοδο εργοστασίου / καταστήματος</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function QrCameraScanner({
  onDecode,
  disabled,
}: {
  onDecode: (text: string) => void;
  disabled?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const lastRef = useRef<{ text: string; at: number }>({ text: "", at: 0 });
  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void | Promise<void>;
  } | null>(null);

  useEffect(() => {
    if (!active || disabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!hostRef.current || cancelled) return;
        const id = "workcard-qr-reader";
        hostRef.current.innerHTML = `<div id="${id}"></div>`;
        const scanner = new Html5Qrcode(id);
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 8, qrbox: { width: 240, height: 240 } },
          (decoded) => {
            const now = Date.now();
            if (
              decoded === lastRef.current.text &&
              now - lastRef.current.at < 2500
            ) {
              return;
            }
            lastRef.current = { text: decoded, at: now };
            onDecode(decoded);
          },
          () => undefined,
        );
        setError(null);
      } catch {
        setError(
          "Δεν άνοιξε η κάμερα. Επίτρεψε πρόσβαση ή χρησιμοποίησε χειροκίνητο QR.",
        );
        setActive(false);
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      scannerRef.current = null;
      if (s) {
        void s
          .stop()
          .then(() => s.clear())
          .catch(() => undefined);
      }
    };
  }, [active, disabled, onDecode]);

  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950">
        <div ref={hostRef} className="min-h-[220px]" />
        {!active ? (
          <div className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-4 py-10 text-center text-white">
            <Camera size={28} className="text-white/50" />
            <p className="text-sm text-white/70">Η κάμερα είναι κλειστή</p>
            <Button
              size="sm"
              disabled={disabled}
              onClick={() => setActive(true)}
            >
              Άνοιγμα κάμερας
            </Button>
          </div>
        ) : null}
      </div>
      {active ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setActive(false)}
        >
          Κλείσιμο κάμερας
        </Button>
      ) : null}
      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function KioskOverlay({
  sites,
  scanSiteId,
  setScanSiteId,
  lastScan,
  busy,
  onClose,
  onScan,
  live,
}: {
  sites: SiteOpt[];
  scanSiteId: string;
  setScanSiteId: (v: string) => void;
  lastScan: {
    message: string;
    presence: string;
    at: string;
    ok: boolean;
  } | null;
  busy: boolean;
  onClose: () => void;
  onScan: (qr: string) => void;
  live: LiveData | null;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/45">
            SoftifyOS · Kiosk παρουσίας
          </p>
          <p className="text-sm font-semibold">Σάρωσε την κάρτα εργασίας σου</p>
        </div>
        <div className="flex items-center gap-2">
          {sites.length ? (
            <select
              value={scanSiteId}
              onChange={(e) => setScanSiteId(e.target.value)}
              className="h-9 rounded-lg border border-white/20 bg-white/10 px-2 text-xs"
            >
              <option value="">Site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id} className="text-ink-900">
                  {s.code}
                </option>
              ))}
            </select>
          ) : null}
          <Button size="sm" variant="secondary" onClick={onClose}>
            Έξοδος
          </Button>
        </div>
      </div>
      <div className="grid flex-1 gap-4 p-5 lg:grid-cols-2">
        <div className="flex flex-col justify-center">
          <QrCameraScanner disabled={busy} onDecode={onScan} />
        </div>
        <div className="flex flex-col justify-center gap-4">
          <div
            className={cn(
              "rounded-3xl border border-white/10 px-6 py-10 text-center",
              lastScan?.ok && "bg-emerald-500/15",
              lastScan && !lastScan.ok && "bg-rose-500/15",
            )}
          >
            <p className="text-3xl font-semibold tracking-tight">
              {lastScan?.message ?? "Αναμονή σάρωσης…"}
            </p>
            {lastScan ? (
              <p className="mt-3 text-lg text-white/70">
                {lastScan.presence} · {dt(lastScan.at)}
              </p>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Kpi label="Εντός" value={live?.summary.in ?? 0} />
            <Kpi label="Διάλειμμα" value={live?.summary.break ?? 0} />
            <Kpi label="Εκτός" value={live?.summary.out ?? 0} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-white/45">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}
