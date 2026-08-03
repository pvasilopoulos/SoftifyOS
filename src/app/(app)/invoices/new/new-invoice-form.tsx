"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  CreditCard,
  Keyboard,
  Package,
  Plus,
  Search,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  calcInvoiceTotals,
  calcLineTotals,
  formatEUR,
} from "@/modules/sales/invoice-utils";
import { SeriesPicker } from "@/modules/documents/series-picker";
import { invoiceKindLabel } from "@/modules/documents/series";
import {
  maybeAutoPrintAfterIssue,
  preparePrintWindow,
} from "@/modules/print-forms/open-invoice-print";
import { validateTenders } from "@/modules/pos/payable";

export type InvoiceDocKind = "SALES_INVOICE" | "SALES_CREDIT" | "RETAIL_RECEIPT";

type CustomerOption = {
  id: string;
  code: string;
  name: string;
  paymentTermsDays?: number | null;
};
type BranchOption = {
  id: string;
  code: string;
  name: string;
  spaces: Array<{ id: string; code: string; name: string }>;
};
type ProductHit = {
  id: string;
  sku: string;
  name: string;
  price: number;
  vatRate: number;
};
type LineDraft = {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
};
type PayMethod = {
  id: string;
  code: string;
  name: string;
  kind: string;
  isDefault?: boolean;
};
type TenderLine = {
  key: string;
  paymentMethodId: string;
  amount: string;
};

function newLine(): LineDraft {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    productId: null,
    description: "",
    quantity: "1",
    unitPrice: "",
    vatRate: "24",
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function draftKey(kind: InvoiceDocKind) {
  return `softify:invoice-draft:${kind}`;
}

function addDaysIso(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function payIcon(kind: string) {
  const k = kind.toUpperCase();
  if (k === "CASH") return Banknote;
  if (k.includes("CARD")) return CreditCard;
  return Wallet;
}

export function NewInvoiceForm({ kind }: { kind: InvoiceDocKind }) {
  const router = useRouter();
  const kindTitle = invoiceKindLabel[kind];
  const formRef = useRef<HTMLFormElement>(null);

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftBanner, setDraftBanner] = useState(false);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerOpen, setCustomerOpen] = useState(false);
  const [branches, setBranches] = useState<BranchOption[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [customerLabel, setCustomerLabel] = useState("");
  const [branchId, setBranchId] = useState("");
  const [spaceId, setSpaceId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [statusOptionId, setStatusOptionId] = useState("");
  const [statusOptions, setStatusOptions] = useState<
    Array<{ id: string; code: string; name: string; workflow: string }>
  >([]);
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingHierarchy, setLoadingHierarchy] = useState(false);
  const [settleNow, setSettleNow] = useState(kind === "RETAIL_RECEIPT");
  const [payMethods, setPayMethods] = useState<PayMethod[]>([]);
  const [loadingPay, setLoadingPay] = useState(false);
  const [tenders, setTenders] = useState<TenderLine[]>([]);
  const [activeSection, setActiveSection] = useState<
    "details" | "lines" | "pay"
  >("details");

  const selectedStatus = useMemo(
    () => statusOptions.find((s) => s.id === statusOptionId) ?? null,
    [statusOptions, statusOptionId],
  );
  const issuesNow =
    selectedStatus?.workflow === "ISSUED" ||
    (settleNow && kind !== "SALES_CREDIT");
  const canSettle = kind !== "SALES_CREDIT";

  // Restore session draft once
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(draftKey(kind));
      if (!raw) return;
      const d = JSON.parse(raw) as {
        customerId?: string;
        customerLabel?: string;
        branchId?: string;
        spaceId?: string;
        seriesId?: string;
        statusOptionId?: string;
        dueAt?: string;
        notes?: string;
        lines?: LineDraft[];
        settleNow?: boolean;
      };
      if (d.customerId) {
        setCustomerId(d.customerId);
        setCustomerLabel(d.customerLabel || "");
      }
      if (d.branchId) setBranchId(d.branchId);
      if (d.spaceId) setSpaceId(d.spaceId);
      if (d.seriesId) setSeriesId(d.seriesId);
      if (d.statusOptionId) setStatusOptionId(d.statusOptionId);
      if (d.dueAt) setDueAt(d.dueAt);
      if (d.notes) setNotes(d.notes);
      if (d.lines?.length) setLines(d.lines);
      if (typeof d.settleNow === "boolean") setSettleNow(d.settleNow);
      setDraftBanner(true);
    } catch {
      /* ignore */
    }
  }, [kind]);

  useEffect(() => {
    setSettleNow(kind === "RETAIL_RECEIPT");
    setTenders([]);
  }, [kind]);

  // Persist draft
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        sessionStorage.setItem(
          draftKey(kind),
          JSON.stringify({
            customerId,
            customerLabel,
            branchId,
            spaceId,
            seriesId,
            statusOptionId,
            dueAt,
            notes,
            lines,
            settleNow,
          }),
        );
      } catch {
        /* ignore */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [
    kind,
    customerId,
    customerLabel,
    branchId,
    spaceId,
    seriesId,
    statusOptionId,
    dueAt,
    notes,
    lines,
    settleNow,
  ]);

  // Customer search
  useEffect(() => {
    let cancelled = false;
    const q = customerQuery.trim();
    const timer = window.setTimeout(async () => {
      setLoadingCustomers(true);
      try {
        const params = new URLSearchParams({
          limit: "20",
          status: "ACTIVE",
        });
        if (q) params.set("q", q);
        const res = await fetch(`/api/customers?${params}`);
        const data = (await res.json()) as { items?: CustomerOption[] };
        if (!cancelled) setCustomers(data.items ?? []);
      } catch {
        if (!cancelled) setCustomers([]);
      } finally {
        if (!cancelled) setLoadingCustomers(false);
      }
    }, q ? 220 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerQuery]);

  // Statuses once
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          "/api/settings/invoice-statuses?selectableOnCreate=1",
        );
        const data = (await res.json()) as {
          items?: Array<{
            id: string;
            code: string;
            name: string;
            workflow: string;
          }>;
        };
        if (cancelled) return;
        const opts = data.items ?? [];
        setStatusOptions(opts);
        setStatusOptionId((prev) => {
          if (prev && opts.some((o) => o.id === prev)) return prev;
          const draft =
            opts.find((o) => o.code === "DRAFT") ??
            opts.find((o) => o.workflow === "DRAFT") ??
            opts[0];
          return draft?.id ?? "";
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Customer hierarchy + payment terms
  useEffect(() => {
    if (!customerId) return;
    let cancelled = false;
    (async () => {
      setLoadingHierarchy(true);
      try {
        const res = await fetch(`/api/customers/${customerId}`);
        const data = (await res.json()) as {
          item?: {
            branches: BranchOption[];
            paymentTermsDays?: number | null;
            code?: string;
            name?: string;
          };
        };
        if (cancelled) return;
        setBranches(data.item?.branches ?? []);
        if (data.item?.code && data.item?.name) {
          setCustomerLabel(`${data.item.code} — ${data.item.name}`);
        }
        const days = data.item?.paymentTermsDays;
        if (typeof days === "number" && days > 0) {
          setDueAt((prev) => prev || addDaysIso(days));
        }
      } catch {
        if (!cancelled) setBranches([]);
      } finally {
        if (!cancelled) setLoadingHierarchy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    if (!seriesId || !canSettle) {
      setPayMethods([]);
      setTenders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingPay(true);
      try {
        const res = await fetch(
          `/api/settings/payment-methods?seriesId=${encodeURIComponent(seriesId)}&collect=1`,
        );
        const data = (await res.json()) as { items?: PayMethod[] };
        if (cancelled) return;
        const items = data.items ?? [];
        setPayMethods(items);
        const preferred =
          items.find((m) => m.isDefault)?.id ?? items[0]?.id ?? "";
        setTenders((prev) => {
          if (!preferred) return [];
          if (
            prev.length &&
            items.some((m) => m.id === prev[0]?.paymentMethodId)
          ) {
            return prev;
          }
          return [{ key: "t0", paymentMethodId: preferred, amount: "" }];
        });
      } catch {
        if (!cancelled) setPayMethods([]);
      } finally {
        if (!cancelled) setLoadingPay(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seriesId, canSettle]);

  const spaces = useMemo(() => {
    const branch = branches.find((b) => b.id === branchId);
    return branch?.spaces ?? [];
  }, [branches, branchId]);

  const totals = useMemo(() => {
    const parsed = lines.map((line) => ({
      quantity: Number(line.quantity) || 0,
      unitPrice: Number(line.unitPrice) || 0,
      vatRate: Number(line.vatRate) || 0,
    }));
    return calcInvoiceTotals(parsed);
  }, [lines]);

  const tenderPaid = useMemo(() => {
    return round2(
      tenders.reduce((s, t) => {
        const n = Number(t.amount);
        return s + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    );
  }, [tenders]);
  const tenderRemaining = round2(Math.max(0, totals.total - tenderPaid));
  const settleValidation = useMemo(() => {
    if (!settleNow || !canSettle) return null;
    const mapped = tenders
      .map((t) => {
        const pm = payMethods.find((m) => m.id === t.paymentMethodId);
        return {
          method: pm?.code || t.paymentMethodId,
          kind: pm?.kind || "OTHER",
          amount: Number(t.amount) || 0,
        };
      })
      .filter((t) => t.amount > 0);
    if (mapped.length === 0) return null;
    return validateTenders(totals.total, mapped);
  }, [settleNow, canSettle, tenders, payMethods, totals.total]);

  useEffect(() => {
    if (!settleNow || !canSettle || totals.total <= 0) return;
    setTenders((prev) => {
      if (prev.length !== 1) return prev;
      const only = prev[0]!;
      if (only.amount.trim() !== "") return prev;
      return [{ ...only, amount: String(totals.total) }];
    });
  }, [settleNow, canSettle, totals.total]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        formRef.current?.requestSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function removeLine(key: string) {
    setLines((prev) =>
      prev.length <= 1 ? prev : prev.filter((l) => l.key !== key),
    );
  }

  function applyProduct(lineKey: string, p: ProductHit) {
    updateLine(lineKey, {
      productId: p.id,
      description: p.name,
      unitPrice: String(p.price),
      vatRate: String(p.vatRate ?? 24),
    });
  }

  function clearDraftStorage() {
    try {
      sessionStorage.removeItem(draftKey(kind));
    } catch {
      /* ignore */
    }
    setDraftBanner(false);
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);

    if (!customerId) {
      setError("Επιλέξτε πελάτη");
      setPending(false);
      setActiveSection("details");
      return;
    }
    if (!seriesId) {
      setError("Επιλέξτε σειρά παραστατικού");
      setPending(false);
      setActiveSection("details");
      return;
    }
    if (lines.some((l) => !l.description.trim())) {
      setError("Όλες οι γραμμές χρειάζονται περιγραφή");
      setPending(false);
      setActiveSection("lines");
      return;
    }

    const settlePayload =
      settleNow && canSettle
        ? tenders
            .map((t) => {
              const pm = payMethods.find((m) => m.id === t.paymentMethodId);
              return {
                paymentMethodId: t.paymentMethodId,
                amount: Number(t.amount),
                kind: pm?.kind,
              };
            })
            .filter(
              (t) =>
                t.paymentMethodId &&
                Number.isFinite(t.amount) &&
                t.amount > 0,
            )
        : [];

    if (settleNow && canSettle) {
      if (settlePayload.length === 0) {
        setError("Επιλέξτε τρόπο πληρωμής και ποσό");
        setPending(false);
        setActiveSection("pay");
        return;
      }
      const v = validateTenders(
        totals.total,
        settlePayload.map((t) => ({
          method: t.paymentMethodId,
          kind: t.kind || "OTHER",
          amount: t.amount,
        })),
      );
      if (!v.ok) {
        setError(v.error);
        setPending(false);
        setActiveSection("pay");
        return;
      }
    }

    const willIssue = issuesNow || settlePayload.length > 0;
    const printWin = willIssue ? preparePrintWindow() : null;
    const change =
      settleValidation && settleValidation.ok ? settleValidation.change : 0;

    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId,
        branchId: branchId || null,
        spaceId: spaceId || null,
        seriesId,
        kind,
        statusOptionId: statusOptionId || null,
        dueAt: dueAt || null,
        notes: notes.trim() || null,
        lines: lines.map((line) => ({
          productId: line.productId,
          description: line.description.trim(),
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          vatRate: Number(line.vatRate),
        })),
        ...(settlePayload.length
          ? {
              settleMethods: settlePayload.map((t, idx) => ({
                paymentMethodId: t.paymentMethodId,
                amount: t.amount,
                ...(idx === 0 && change > 0 ? { changeAmount: change } : {}),
              })),
            }
          : {}),
      }),
    });
    const data = (await res.json()) as {
      item?: {
        id: string;
        status?: string;
        series?: {
          printPrinter?: string | null;
          printCopies?: number | null;
        } | null;
      };
      error?: string;
      warning?: string;
    };
    setPending(false);
    if (!res.ok) {
      printWin?.close();
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    if (data.warning) setError(data.warning);
    clearDraftStorage();
    const created = data.item!;
    if (created.status === "ISSUED" || willIssue || settlePayload.length) {
      maybeAutoPrintAfterIssue(created.id, created.series, printWin);
    } else {
      printWin?.close();
    }
    router.push(`/invoices/${created.id}`);
    router.refresh();
  }

  const steps = [
    { id: "details" as const, label: "Στοιχεία", done: Boolean(customerId && seriesId) },
    {
      id: "lines" as const,
      label: "Γραμμές",
      done: lines.some(
        (l) => l.description.trim() && Number(l.unitPrice) > 0,
      ),
    },
    ...(canSettle
      ? [
          {
            id: "pay" as const,
            label: "Εξόφληση",
            done: !settleNow || tenderRemaining <= 0.001,
          },
        ]
      : []),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-28">
      <Link
        href="/invoices"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω στα παραστατικά
      </Link>

      <PageHeader
        title={`Νέο ${kindTitle.toLowerCase()}`}
        description="Σειρά · πελάτης · γραμμές προϊόντων · προαιρετική εξόφληση"
        actions={
          <div className="hidden items-center gap-1.5 text-[11px] text-slate-400 sm:inline-flex">
            <Keyboard size={12} />
            Ctrl/⌘ + Enter αποθήκευση
          </div>
        }
      />

      {/* Kind switcher */}
      <div className="inline-flex flex-wrap gap-0.5 rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        {(
          [
            ["SALES_INVOICE", "Τιμολόγιο"],
            ["SALES_CREDIT", "Πιστωτικό"],
            ["RETAIL_RECEIPT", "ΑΠΥ"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={
              k === "SALES_INVOICE" ? "/invoices/new" : `/invoices/new?kind=${k}`
            }
            className={cn(
              "rounded-xl px-3.5 py-1.5 text-sm font-medium transition",
              kind === k
                ? "bg-ink-950 text-white shadow-sm"
                : "text-slate-600 hover:bg-slate-50",
            )}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Step rail */}
      <nav className="flex flex-wrap gap-2">
        {steps.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setActiveSection(s.id);
              document
                .getElementById(`section-${s.id}`)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition",
              activeSection === s.id
                ? "bg-teal-700 text-white"
                : s.done
                  ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200"
                  : "bg-white text-slate-600 ring-1 ring-slate-200",
            )}
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-black/10 text-[10px] font-semibold">
              {i + 1}
            </span>
            {s.label}
          </button>
        ))}
      </nav>

      {draftBanner ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span>Επαναφορά πρόχειρου από προηγούμενη συνεδρία.</span>
          <button
            type="button"
            className="text-xs font-medium text-sky-800 hover:underline"
            onClick={clearDraftStorage}
          >
            Απόρριψη
          </button>
        </div>
      ) : null}

      <form ref={formRef} onSubmit={onSubmit} className="space-y-5">
        {/* Details */}
        <section
          id="section-details"
          className="soft-panel space-y-4 p-5"
          onFocusCapture={() => setActiveSection("details")}
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-900">1. Στοιχεία</h2>
            {customerId && seriesId ? (
              <Badge tone="emerald">Έτοιμο</Badge>
            ) : (
              <Badge tone="slate">Απαιτείται</Badge>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <SeriesPicker
              key={kind}
              kind={kind}
              value={seriesId}
              onChange={setSeriesId}
            />

            <div className="relative sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">
                Πελάτης *
              </span>
              <div className="relative">
                <Search
                  size={15}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={customerOpen ? customerQuery : customerLabel}
                  onChange={(e) => {
                    setCustomerQuery(e.target.value);
                    setCustomerOpen(true);
                    if (customerId) {
                      setCustomerId("");
                      setCustomerLabel("");
                      setBranches([]);
                      setBranchId("");
                      setSpaceId("");
                    }
                  }}
                  onFocus={() => {
                    setCustomerOpen(true);
                    setCustomerQuery("");
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setCustomerOpen(false), 150);
                  }}
                  placeholder="Αναζήτηση ονόματος ή κωδικού…"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  autoComplete="off"
                />
              </div>
              {customerOpen ? (
                <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                  {loadingCustomers ? (
                    <li className="px-3 py-2 text-sm text-slate-500">
                      Φόρτωση…
                    </li>
                  ) : customers.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-slate-500">
                      Κανένα αποτέλεσμα
                    </li>
                  ) : (
                    customers.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col px-3 py-2 text-left hover:bg-teal-50"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setCustomerId(c.id);
                            setCustomerLabel(`${c.code} — ${c.name}`);
                            setCustomerQuery("");
                            setCustomerOpen(false);
                            setBranches([]);
                            setBranchId("");
                            setSpaceId("");
                          }}
                        >
                          <span className="text-sm font-medium text-ink-900">
                            {c.name}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {c.code}
                          </span>
                        </button>
                      </li>
                    ))
                  )}
                </ul>
              ) : null}
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Υποκατάστημα
              </span>
              <select
                value={branchId}
                disabled={!customerId || loadingHierarchy}
                onChange={(e) => {
                  setBranchId(e.target.value);
                  setSpaceId("");
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.code} — {b.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">Χώρος</span>
              <select
                value={spaceId}
                disabled={!branchId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2 disabled:bg-slate-50"
              >
                <option value="">— Προαιρετικό —</option>
                {spaces.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center justify-between gap-2 text-sm font-medium">
                <span>Κατάσταση</span>
                <Link
                  href="/settings/invoice-statuses"
                  className="text-xs font-normal text-teal-700 hover:underline"
                >
                  Διαχείριση
                </Link>
              </span>
              <select
                value={statusOptionId}
                onChange={(e) => setStatusOptionId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              >
                {statusOptions.length === 0 ? (
                  <option value="">— Φόρτωση —</option>
                ) : null}
                {statusOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium">
                Ημ. λήξης
              </span>
              <input
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                Συμπληρώνεται αυτόματα από όρους πελάτη αν υπάρχουν
              </span>
            </label>

            <label className="block sm:col-span-2">
              <span className="mb-1.5 block text-sm font-medium">
                Σημειώσεις
              </span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Εσωτερικές ή εμφανιζόμενες σημειώσεις…"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
              />
            </label>
          </div>
        </section>

        {/* Lines */}
        <section
          id="section-lines"
          className="soft-panel space-y-4 p-5"
          onFocusCapture={() => setActiveSection("lines")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-ink-900">2. Γραμμές</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Αναζήτηση προϊόντος ή ελεύθερη περιγραφή
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              <Plus size={14} />
              Γραμμή
            </Button>
          </div>

          <div className="space-y-3">
            {lines.map((line, idx) => {
              const { lineTotal } = calcLineTotals({
                quantity: Number(line.quantity) || 0,
                unitPrice: Number(line.unitPrice) || 0,
                vatRate: Number(line.vatRate) || 0,
              });
              return (
                <div
                  key={line.key}
                  className="space-y-3 rounded-2xl border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white p-3 sm:p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex size-6 items-center justify-center rounded-lg bg-slate-900 text-[11px] font-semibold text-white">
                      {idx + 1}
                    </span>
                    {line.productId ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700">
                        <Package size={12} />
                        Από κατάλογο
                      </span>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-8 w-8"
                      aria-label="Διαγραφή γραμμής"
                      disabled={lines.length <= 1}
                      onClick={() => removeLine(line.key)}
                    >
                      <Trash2 size={15} className="text-slate-500" />
                    </Button>
                  </div>

                  <ProductSearchField
                    onPick={(p) => applyProduct(line.key, p)}
                  />

                  <div className="grid gap-3 sm:grid-cols-12">
                    <label className="block sm:col-span-5">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Περιγραφή *
                      </span>
                      <input
                        required
                        value={line.description}
                        onChange={(e) =>
                          updateLine(line.key, {
                            description: e.target.value,
                            productId: null,
                          })
                        }
                        placeholder="Υπηρεσία / προϊόν"
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Ποσότητα
                      </span>
                      <input
                        required
                        type="number"
                        min="0.001"
                        step="any"
                        value={line.quantity}
                        onChange={(e) =>
                          updateLine(line.key, { quantity: e.target.value })
                        }
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            idx === lines.length - 1
                          ) {
                            e.preventDefault();
                            setLines((prev) => [...prev, newLine()]);
                          }
                        }}
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Τιμή
                      </span>
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitPrice}
                        onChange={(e) =>
                          updateLine(line.key, { unitPrice: e.target.value })
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <label className="block sm:col-span-1">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        ΦΠΑ %
                      </span>
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={line.vatRate}
                        onChange={(e) =>
                          updateLine(line.key, { vatRate: e.target.value })
                        }
                        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                      />
                    </label>
                    <div className="sm:col-span-2">
                      <span className="mb-1 block text-xs font-medium text-slate-500">
                        Σύνολο
                      </span>
                      <p className="h-10 content-center text-sm font-semibold tabular-nums text-ink-900">
                        {formatEUR(lineTotal)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Settle */}
        {canSettle ? (
          <section
            id="section-pay"
            className="soft-panel space-y-4 p-5"
            onFocusCapture={() => setActiveSection("pay")}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  <Wallet size={16} className="text-teal-700" />
                  3. Εξόφληση
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Προαιρετικά — έκδοση & είσπραξη σε ένα βήμα (όπως POS)
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
                <input
                  type="checkbox"
                  checked={settleNow}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setSettleNow(on);
                    if (on && tenders.length === 1 && !tenders[0]?.amount) {
                      setTenders((prev) =>
                        prev.map((t, i) =>
                          i === 0
                            ? { ...t, amount: String(totals.total || "") }
                            : t,
                        ),
                      );
                    }
                  }}
                  className="size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                />
                Εξόφληση τώρα
              </label>
            </div>

            {settleNow ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {loadingPay ? (
                    <p className="text-sm text-slate-500">Φόρτωση τρόπων…</p>
                  ) : payMethods.length === 0 ? (
                    <p className="col-span-full text-sm text-amber-800">
                      Δεν υπάρχουν τρόποι —{" "}
                      <Link
                        href="/settings/payment-methods"
                        className="font-medium text-teal-700 hover:underline"
                      >
                        Ρυθμίσεις
                      </Link>
                    </p>
                  ) : (
                    payMethods.map((pm) => {
                      const Icon = payIcon(pm.kind);
                      const active = tenders.some(
                        (t) => t.paymentMethodId === pm.id,
                      );
                      return (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => {
                            setTenders((prev) => {
                              if (prev.some((t) => t.paymentMethodId === pm.id)) {
                                return prev;
                              }
                              const rem =
                                tenderRemaining > 0
                                  ? tenderRemaining
                                  : totals.total;
                              if (prev.length === 1 && !prev[0]?.amount) {
                                return [
                                  {
                                    key: prev[0]!.key,
                                    paymentMethodId: pm.id,
                                    amount: String(rem || totals.total || ""),
                                  },
                                ];
                              }
                              return [
                                ...prev,
                                {
                                  key: `t${Date.now()}`,
                                  paymentMethodId: pm.id,
                                  amount: String(rem > 0 ? rem : ""),
                                },
                              ];
                            });
                          }}
                          className={cn(
                            "flex items-center gap-2.5 rounded-xl border px-3 py-3 text-left text-sm font-medium transition",
                            active
                              ? "border-teal-300 bg-teal-50 text-teal-900 ring-1 ring-teal-200"
                              : "border-slate-200 bg-white text-slate-700 hover:border-teal-200",
                          )}
                        >
                          <span
                            className={cn(
                              "flex size-9 items-center justify-center rounded-lg",
                              active
                                ? "bg-teal-600 text-white"
                                : "bg-slate-100 text-slate-600",
                            )}
                          >
                            <Icon size={16} />
                          </span>
                          <span>
                            {pm.name}
                            <span className="mt-0.5 block text-[11px] font-normal text-slate-500">
                              {pm.code}
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="space-y-2">
                  {tenders.map((line, idx) => (
                    <div
                      key={line.key}
                      className="grid grid-cols-[1fr_7rem_auto] gap-2"
                    >
                      <select
                        value={line.paymentMethodId}
                        onChange={(e) =>
                          setTenders((prev) =>
                            prev.map((t) =>
                              t.key === line.key
                                ? { ...t, paymentMethodId: e.target.value }
                                : t,
                            ),
                          )
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm"
                      >
                        {payMethods.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name} ({m.code})
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.amount}
                        onChange={(e) =>
                          setTenders((prev) =>
                            prev.map((t) =>
                              t.key === line.key
                                ? { ...t, amount: e.target.value }
                                : t,
                            ),
                          )
                        }
                        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm tabular-nums"
                        aria-label={`Ποσό τρόπου ${idx + 1}`}
                      />
                      <button
                        type="button"
                        disabled={tenders.length <= 1}
                        onClick={() =>
                          setTenders((prev) =>
                            prev.filter((t) => t.key !== line.key),
                          )
                        }
                        className="rounded-xl px-2 text-slate-400 hover:bg-slate-100 hover:text-ink-900 disabled:opacity-30"
                        aria-label="Αφαίρεση"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <button
                    type="button"
                    className="font-medium text-teal-700 hover:underline disabled:opacity-40"
                    disabled={payMethods.length === 0 || tenderRemaining <= 0}
                    onClick={() => {
                      const preferred =
                        payMethods.find((m) => m.isDefault)?.id ??
                        payMethods[0]?.id ??
                        "";
                      if (!preferred) return;
                      setTenders((prev) => [
                        ...prev,
                        {
                          key: `t${Date.now()}`,
                          paymentMethodId: preferred,
                          amount: String(tenderRemaining),
                        },
                      ]);
                    }}
                  >
                    + Προσθήκη τρόπου
                  </button>
                  <p className="tabular-nums">
                    Δηλωμένα {formatEUR(tenderPaid)}
                    {tenderRemaining > 0.001
                      ? ` · υπόλοιπο ${formatEUR(tenderRemaining)}`
                      : " · πλήρες"}
                    {settleValidation?.ok && settleValidation.change > 0
                      ? ` · ρέστα ${formatEUR(settleValidation.change)}`
                      : ""}
                  </p>
                </div>
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-xs text-slate-500">
                Χωρίς εξόφληση τώρα το παραστατικό μένει ανοιχτό — είσπραξη
                αργότερα από την κάρτα ή με αυτόματη πολιτική σειράς.
              </p>
            )}
          </section>
        ) : null}

        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {/* Desktop inline actions (sticky covers primary) */}
        <div className="flex flex-wrap gap-3 xl:hidden">
          <Button type="submit" disabled={pending || !seriesId}>
            {pending
              ? "Αποθήκευση..."
              : settleNow && canSettle
                ? "Έκδοση & εξόφληση"
                : issuesNow
                  ? `Έκδοση ${kindTitle.toLowerCase()}`
                  : "Αποθήκευση πρόχειρου"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push("/invoices")}
          >
            Ακύρωση
          </Button>
        </div>
      </form>

      {/* Sticky footer */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 px-3 py-3 shadow-[0_-8px_30px_rgba(15,23,42,0.06)] backdrop-blur supports-[backdrop-filter]:bg-white/80 sm:px-5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
            <span className="text-slate-500">
              Καθαρή{" "}
              <span className="font-medium tabular-nums text-ink-800">
                {formatEUR(totals.subtotal)}
              </span>
            </span>
            <span className="text-slate-500">
              ΦΠΑ{" "}
              <span className="font-medium tabular-nums text-ink-800">
                {formatEUR(totals.vatAmount)}
              </span>
            </span>
            <span className="text-base font-semibold text-ink-950">
              Σύνολο{" "}
              <span className="tabular-nums">{formatEUR(totals.total)}</span>
            </span>
            <span className="text-xs text-slate-400">
              {lines.length} γραμμ{lines.length === 1 ? "ή" : "ές"}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => router.push("/invoices")}
            >
              Ακύρωση
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pending || !seriesId}
              onClick={() => formRef.current?.requestSubmit()}
            >
              {pending
                ? "Αποθήκευση..."
                : settleNow && canSettle
                  ? "Έκδοση & εξόφληση"
                  : issuesNow
                    ? `Έκδοση ${kindTitle.toLowerCase()}`
                    : "Αποθήκευση πρόχειρου"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductSearchField({
  onPick,
}: {
  onPick: (p: ProductHit) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<ProductHit[]>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(async (query: string) => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        q: query.trim(),
        status: "ACTIVE",
        limit: "12",
      });
      const res = await fetch(`/api/products?${params}`);
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          sku: string;
          name: string;
          price: number;
          vatRate: number;
        }>;
      };
      setHits(
        (data.items ?? []).map((p) => ({
          id: p.id,
          sku: p.sku,
          name: p.name,
          price: Number(p.price),
          vatRate: Number(p.vatRate),
        })),
      );
    } catch {
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => void search(q), 200);
    return () => window.clearTimeout(t);
  }, [q, search]);

  return (
    <div className="relative">
      <div className="relative">
        <Package
          size={14}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          placeholder="Αναζήτηση προϊόντος (SKU / όνομα)…"
          className="h-9 w-full rounded-lg border border-dashed border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs outline-none ring-teal-500/30 focus:border-teal-300 focus:ring-2"
        />
      </div>
      {open && q.trim() ? (
        <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
          {loading ? (
            <li className="px-3 py-2 text-xs text-slate-500">Φόρτωση…</li>
          ) : hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-500">
              Κανένα προϊόν — γράψε ελεύθερη περιγραφή κάτω
            </li>
          ) : (
            hits.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-teal-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onPick(p);
                    setQ("");
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink-900">
                      {p.name}
                    </span>
                    <span className="text-[11px] text-slate-500">{p.sku}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums text-teal-800">
                    {formatEUR(p.price)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
