"use client";

import {
  ArrowLeftRight,
  Banknote,
  CreditCard,
  Gift,
  MoreHorizontal,
  Star,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/shared/lib/cn";
import {
  paymentMethodKindLabel,
  type PaymentMethodKind,
} from "@/modules/payments/labels";

type Tender = {
  methodCode: string;
  amount: number;
  changeAmount?: number;
};

const KIND_STYLE: Record<
  PaymentMethodKind,
  {
    icon: LucideIcon;
    chip: string;
    bar: string;
    ink: string;
  }
> = {
  CASH: {
    icon: Banknote,
    chip: "bg-emerald-50 ring-emerald-200/80",
    bar: "bg-emerald-500",
    ink: "text-emerald-800",
  },
  CARD: {
    icon: CreditCard,
    chip: "bg-sky-50 ring-sky-200/80",
    bar: "bg-sky-500",
    ink: "text-sky-800",
  },
  TRANSFER: {
    icon: ArrowLeftRight,
    chip: "bg-violet-50 ring-violet-200/80",
    bar: "bg-violet-500",
    ink: "text-violet-800",
  },
  GIFT_CARD: {
    icon: Gift,
    chip: "bg-amber-50 ring-amber-200/80",
    bar: "bg-amber-500",
    ink: "text-amber-900",
  },
  LOYALTY: {
    icon: Star,
    chip: "bg-rose-50 ring-rose-200/80",
    bar: "bg-rose-500",
    ink: "text-rose-800",
  },
  OTHER: {
    icon: MoreHorizontal,
    chip: "bg-slate-50 ring-slate-200/80",
    bar: "bg-slate-400",
    ink: "text-slate-700",
  },
};

export function inferPaymentKind(code: string): PaymentMethodKind {
  const c = code.toUpperCase();
  if (c === "CASH" || c.startsWith("CASH")) return "CASH";
  if (
    c.includes("CARD") ||
    c.includes("VIVA") ||
    c.includes("POS") ||
    c.includes("WORLDLINE")
  ) {
    return "CARD";
  }
  if (
    c.includes("TRANSFER") ||
    c.includes("WIRE") ||
    c.includes("BANK") ||
    c.includes("IRIS")
  ) {
    return "TRANSFER";
  }
  if (c.includes("GIFT")) return "GIFT_CARD";
  if (c.includes("LOYAL")) return "LOYALTY";
  return "OTHER";
}

function tenderLabel(code: string): string {
  const kind = inferPaymentKind(code);
  const kindName = paymentMethodKindLabel[kind];
  // Prefer short Greek kind; keep distinct codes when not a standard kind
  if (code.toUpperCase() === kind || code.toUpperCase().startsWith(kind)) {
    return kindName;
  }
  if (kind === "OTHER") return code;
  return kindName;
}

function money(n: number) {
  return n.toLocaleString("el-GR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  });
}

/** Compact, colorful breakdown of settlement tenders for table cells / cards. */
export function SettlementTenders({
  methods,
  totalAmount,
  compact = false,
}: {
  methods: Tender[];
  totalAmount?: number;
  compact?: boolean;
}) {
  if (!methods.length) {
    return <span className="text-xs text-slate-400">—</span>;
  }

  const total =
    totalAmount && totalAmount > 0
      ? totalAmount
      : methods.reduce((s, m) => s + Number(m.amount || 0), 0);
  const rows = methods.map((m) => {
    const amount = Number(m.amount || 0);
    const kind = inferPaymentKind(m.methodCode);
    return {
      ...m,
      amount,
      kind,
      pct: total > 0 ? Math.max(0, (amount / total) * 100) : 0,
      style: KIND_STYLE[kind],
      label: tenderLabel(m.methodCode),
    };
  });

  return (
    <div className={cn("min-w-[12rem] max-w-sm", compact ? "space-y-1.5" : "space-y-2")}>
      {/* Mix bar */}
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-slate-100"
        title={rows.map((r) => `${r.label} ${money(r.amount)}`).join(" · ")}
      >
        {rows.map((r) => (
          <div
            key={`${r.methodCode}-${r.amount}`}
            className={cn("h-full transition-[width]", r.style.bar)}
            style={{ width: `${r.pct}%` }}
          />
        ))}
      </div>

      {/* Tender chips */}
      <ul className="flex flex-wrap gap-1.5">
        {rows.map((r, idx) => {
          const Icon = r.style.icon;
          return (
            <li
              key={`${r.methodCode}-${idx}`}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2 py-1 ring-1 ring-inset",
                r.style.chip,
              )}
            >
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md bg-white/80",
                  r.style.ink,
                )}
              >
                <Icon size={12} strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block text-[10px] font-semibold uppercase tracking-wide leading-none",
                    r.style.ink,
                  )}
                >
                  {r.label}
                </span>
                <span className="mt-0.5 block text-xs font-semibold tabular-nums leading-none text-ink-950">
                  {money(r.amount)}
                </span>
              </span>
              {rows.length > 1 ? (
                <span className="pl-0.5 text-[10px] font-medium tabular-nums text-slate-400">
                  {Math.round(r.pct)}%
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
