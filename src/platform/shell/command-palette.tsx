"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FileText,
  Package,
  Search,
  ShoppingCart,
  Truck,
  Users,
  X,
  Zap,
} from "lucide-react";
import { quickActions } from "@/platform/navigation";
import { cn } from "@/shared/lib/cn";
import { useDensity } from "@/shared/ui/density";

type SearchHit = {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  href: string;
};

const typeIcon: Record<string, typeof Users> = {
  customer: Users,
  invoice: FileText,
  order: ShoppingCart,
  product: Package,
  supplier: Truck,
};

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { density, setDensity } = useDensity();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [active, setActive] = useState(0);
  const activeQuery = open ? query : "";

  const actions = useMemo(() => {
    const q = activeQuery.trim().toLowerCase();
    const base = !q
      ? quickActions
      : quickActions.filter((a) => a.label.toLowerCase().includes(q));
    return [
      ...base,
      {
        id: "density-toggle",
        label:
          density === "compact"
            ? "Πυκνότητα: άνετη"
            : "Πυκνότητα: συμπαγής",
        href: "__density__",
        shortcut: "D",
      },
    ];
  }, [activeQuery, density]);

  useEffect(() => {
    if (!open) return;
    const q = activeQuery.trim();
    if (q.length < 1) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          cache: "no-store",
        });
        const data = await res.json();
        if (!cancelled && res.ok) setHits(data.items || []);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [activeQuery, open]);

  const rows = useMemo(() => {
    const entityRows = hits.map((h) => ({
      kind: "entity" as const,
      id: h.id,
      label: h.title,
      meta: h.subtitle,
      href: h.href,
      type: h.type,
    }));
    const actionRows = actions.map((a) => ({
      kind: "action" as const,
      id: a.id,
      label: a.label,
      meta: a.shortcut,
      href: a.href,
      type: "action",
    }));
    return [...entityRows, ...actionRows];
  }, [hits, actions]);

  useEffect(() => {
    setActive(0);
  }, [rows.length, activeQuery]);

  useEffect(() => {
    function handleClose() {
      setQuery("");
      setHits([]);
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) handleClose();
        else document.dispatchEvent(new CustomEvent("softify:open-command"));
      }
      if (!open) return;
      if (e.key === "Escape") handleClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(i + 1, Math.max(0, rows.length - 1)));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && rows[active]) {
        e.preventDefault();
        go(rows[active]!.href);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, rows, active]);

  function close() {
    setQuery("");
    setHits([]);
    onClose();
  }

  function go(href: string) {
    if (href === "__density__") {
      setDensity(density === "compact" ? "comfortable" : "compact");
      return;
    }
    close();
    router.push(href);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink-950/40 p-4 pt-[10vh] backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-ink-950/20"
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4">
          <Search size={18} className="text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση πελατών, παραστατικών, προϊόντων, εντολών…"
            className="h-14 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {searching ? (
            <span className="text-[11px] text-slate-400">…</span>
          ) : null}
          <button
            type="button"
            onClick={close}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"
            aria-label="Κλείσιμο"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="max-h-[28rem] overflow-y-auto p-2">
          {hits.length > 0 ? (
            <li className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Οντότητες
            </li>
          ) : null}
          {rows.map((row, idx) => {
            const Icon =
              row.kind === "entity"
                ? typeIcon[row.type] || FileText
                : Zap;
            return (
              <li key={row.id}>
                {row.kind === "action" &&
                idx === hits.length &&
                hits.length > 0 ? (
                  <p className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Εντολές
                  </p>
                ) : null}
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-teal-50",
                    idx === active && "bg-teal-50",
                  )}
                  onMouseEnter={() => setActive(idx)}
                  onClick={() => go(row.href)}
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink-900">
                      {row.label}
                    </span>
                    {row.meta ? (
                      <span className="block truncate text-xs text-slate-500">
                        {row.meta}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
          {rows.length === 0 ? (
            <li className="px-3 py-8 text-center text-sm text-slate-500">
              Δεν βρέθηκαν αποτελέσματα
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
