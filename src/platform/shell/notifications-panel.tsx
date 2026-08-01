"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, Loader2 } from "lucide-react";
import { Drawer } from "@/shared/ui/drawer";
import { cn } from "@/shared/lib/cn";

type Notif = {
  id: string;
  tone: "rose" | "amber" | "slate" | "teal";
  title: string;
  body: string;
  href: string;
};

const toneDot: Record<Notif["tone"], string> = {
  rose: "bg-rose-500",
  amber: "bg-amber-500",
  slate: "bg-slate-400",
  teal: "bg-teal-500",
};

export function NotificationsButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [count, setCount] = useState(0);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/notifications", { cache: "no-store" });
      const data = await res.json();
      if (res.ok) {
        setItems(data.items || []);
        setCount(data.summary?.count ?? (data.items || []).length);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void load();
        }}
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        aria-label="Ειδοποιήσεις"
      >
        <Bell size={18} />
        {count > 0 ? (
          <span className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {count > 9 ? "9+" : count}
          </span>
        ) : null}
      </button>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Ειδοποιήσεις"
        subtitle={
          count > 0
            ? `${count} ενεργ${count === 1 ? "ή" : "ές"} · ανανέωση κάθε λεπτό`
            : "Καμία εκκρεμότητα αυτή τη στιγμή"
        }
        widthClass="max-w-md"
        headerExtra={
          count > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">
              {count > 99 ? "99+" : count}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              Ήρεμα
            </span>
          )
        }
      >
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
            <Loader2 size={16} className="animate-spin" /> Φόρτωση…
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <Bell size={18} />
            </span>
            <p className="text-sm font-medium text-ink-900">Όλα εντάξει</p>
            <p className="max-w-[220px] text-xs text-slate-500">
              Δεν υπάρχουν ειδοποιήσεις προς ενέργεια.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push(n.href);
                  }}
                  className="flex w-full gap-3 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-teal-300 hover:bg-teal-50/50"
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full",
                      toneDot[n.tone],
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                      {n.body}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Drawer>
    </>
  );
}
