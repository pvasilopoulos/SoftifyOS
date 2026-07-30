"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

export type CustomerListItem = {
  id: string;
  code: string;
  name: string;
  vatNumber: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  branchCount: number;
  createdAt: string;
};

type ListResponse = {
  items: CustomerListItem[];
  nextCursor: string | null;
  meta: { ms: number };
  error?: string;
};

export function CustomersClient({
  initialItems,
  initialNextCursor,
  initialMs,
}: {
  initialItems: CustomerListItem[];
  initialNextCursor: string | null;
  initialMs: number;
}) {
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [ms, setMs] = useState(initialMs);
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function search() {
    setError(null);
    const params = new URLSearchParams({ limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/customers?${params}`, { cache: "no-store" });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setItems(data.items);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
    });
  }

  async function loadMore() {
    if (!nextCursor) return;
    const params = new URLSearchParams({ limit: "50", cursor: nextCursor });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/customers?${params}`, { cache: "no-store" });
    const data = (await res.json()) as ListResponse;
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    startTransition(() => {
      setItems((prev) => [...prev, ...data.items]);
      setNextCursor(data.nextCursor);
      setMs(data.meta.ms);
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="soft-surface flex flex-1 items-center gap-2 px-3 py-2.5">
          <Search size={16} className="text-slate-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void search();
            }}
            placeholder="Αναζήτηση ονόματος, κωδικού ή ΑΦΜ..."
            className="w-full bg-transparent text-sm outline-none"
          />
        </label>
        <Button
          variant="secondary"
          onClick={() => void search()}
          disabled={isPending}
        >
          Αναζήτηση
        </Button>
        <Badge tone={ms < 200 ? "emerald" : "amber"}>{ms} ms</Badge>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      <section className="soft-panel overflow-hidden">
        <div className="hidden border-b border-slate-100 px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-slate-400 md:grid md:grid-cols-[0.7fr_1.4fr_0.8fr_0.6fr_0.6fr] md:gap-3">
          <span>Κωδικός</span>
          <span>Επωνυμία</span>
          <span>ΑΦΜ</span>
          <span>Υποκ/τα</span>
          <span>Κατάσταση</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {items.map((c) => (
            <li key={c.id} className="soft-row">
              <Link
                href={`/customers/${c.id}`}
                className="block px-4 py-3 hover:bg-slate-50 md:grid md:grid-cols-[0.7fr_1.4fr_0.8fr_0.6fr_0.6fr] md:items-center md:gap-3"
              >
                <p className="font-mono text-sm font-medium text-ink-950">
                  {c.code}
                </p>
                <div>
                  <p className="text-sm font-medium text-ink-900">{c.name}</p>
                  <p className="text-xs text-slate-500 md:hidden">
                    {c.branchCount} υποκαταστήματα
                  </p>
                </div>
                <p className="mt-1 text-sm text-slate-600 md:mt-0">
                  {c.vatNumber || "—"}
                </p>
                <p className="hidden text-sm md:block">{c.branchCount}</p>
                <div className="mt-2 md:mt-0">
                  <Badge tone={c.status === "ACTIVE" ? "emerald" : "slate"}>
                    {c.status === "ACTIVE" ? "Ενεργός" : "Ανενεργός"}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
          {items.length === 0 ? (
            <li className="px-4 py-12 text-center text-sm text-slate-500">
              Δεν βρέθηκαν πελάτες.
            </li>
          ) : null}
        </ul>
        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">{items.length} εμφανίζονται</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={!nextCursor || isPending}
            className={cn(!nextCursor && "opacity-50")}
            onClick={() => void loadMore()}
          >
            Επόμενα
          </Button>
        </div>
      </section>
    </div>
  );
}
