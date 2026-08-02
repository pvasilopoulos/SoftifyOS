"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, Landmark, Loader2 } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import type { SessionPayload } from "@/platform/auth/session";

type CompanyRow = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  isDefault: boolean;
};

export function CompanySwitcher({
  session,
  compact = false,
}: {
  session: SessionPayload;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CompanyRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || loaded) return;
    void (async () => {
      try {
        const res = await fetch("/api/workspace/companies");
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "Αποτυχία φόρτωσης εταιρειών");
          return;
        }
        setItems(data.items ?? []);
        setLoaded(true);
      } catch {
        setError("Αποτυχία φόρτωσης εταιρειών");
      }
    })();
  }, [open, loaded]);

  // Reload list when tenant changes
  useEffect(() => {
    setLoaded(false);
    setItems([]);
  }, [session.tenantId]);

  const switchTo = (legalEntityId: string) => {
    if (legalEntityId === session.legalEntityId || pending) return;
    setSwitchingId(legalEntityId);
    setError(null);
    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/auth/select-workspace", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenantId: session.tenantId,
              legalEntityId,
            }),
          });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error || "Αποτυχία εναλλαγής");
            setSwitchingId(null);
            return;
          }
          window.location.href = "/";
        } catch {
          setError("Αποτυχία εναλλαγής");
          setSwitchingId(null);
        }
      })();
    });
  };

  const label = session.legalEntityName || session.legalEntityCode || "Εταιρεία";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Εταιρεία: ${label}`}
        className={cn(
          "flex items-center gap-2 rounded-2xl border border-slate-200 bg-white text-sm shadow-sm transition hover:bg-slate-50",
          compact ? "px-2 py-1.5" : "px-2.5 py-1.5",
        )}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink-950 text-white">
          <Landmark size={14} />
        </span>
        {!compact ? (
          <span className="max-w-[120px] truncate font-medium text-ink-900 lg:max-w-[160px]">
            {label}
          </span>
        ) : null}
        <ChevronDown
          size={14}
          className={cn("text-slate-400 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-[min(100vw-1.5rem,300px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/10"
        >
          <div className="border-b border-slate-100 px-3 py-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              B · Εταιρεία (Legal Entity)
            </p>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              Μέσα σε {session.tenantName}
            </p>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1">
            {!loaded && !error ? (
              <li className="flex items-center gap-2 px-3 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Φόρτωση…
              </li>
            ) : null}
            {error ? (
              <li className="px-3 py-3 text-sm text-rose-700">{error}</li>
            ) : null}
            {items.map((c) => {
              const active = c.id === session.legalEntityId;
              const busy = switchingId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    disabled={pending}
                    onClick={() => switchTo(c.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm transition",
                      active ? "bg-slate-50" : "hover:bg-slate-50",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        active
                          ? "bg-ink-950 text-white"
                          : "bg-slate-100 text-slate-600",
                      )}
                    >
                      {busy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Landmark size={14} />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {c.name}
                      </span>
                      <span className="block truncate text-[11px] text-slate-500">
                        {c.code}
                        {c.vatNumber ? ` · ${c.vatNumber}` : ""}
                        {c.isDefault ? " · default" : ""}
                      </span>
                    </span>
                    {active ? (
                      <Check className="h-4 w-4 text-teal-700" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-slate-100 p-2">
            <Link
              href="/settings/org-structure"
              onClick={() => setOpen(false)}
              className="block rounded-xl px-2.5 py-2 text-sm font-medium text-teal-800 hover:bg-teal-50"
            >
              Διαχείριση εταιρειών →
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}
