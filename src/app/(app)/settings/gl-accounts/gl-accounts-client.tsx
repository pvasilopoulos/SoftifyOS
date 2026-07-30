"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { GL_ACCOUNT_TYPE_LABEL } from "@/modules/ledger/defaults";

type GlType = keyof typeof GL_ACCOUNT_TYPE_LABEL;

type Item = {
  id: string;
  code: string;
  name: string;
  type: GlType;
  parentId: string | null;
  isPostable: boolean;
  isSystem: boolean;
  isActive: boolean;
};

export function GlAccountsClient({ initialItems }: { initialItems: Item[] }) {
  const [items, setItems] = useState(initialItems);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (a) =>
        a.code.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q),
    );
  }, [items, query]);

  const refresh = async () => {
    const res = await fetch("/api/settings/gl-accounts");
    const data = await res.json();
    if (res.ok) setItems(data.items);
  };

  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/settings/gl-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") || ""),
          name: String(form.get("name") || ""),
          type: String(form.get("type") || "ASSET"),
          isPostable: form.get("isPostable") === "on",
          isActive: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      setCreating(false);
      setMessage("Ο λογαριασμός δημιουργήθηκε.");
      await refresh();
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/settings"
            className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
          >
            <ArrowLeft size={14} /> Ρυθμίσεις
          </Link>
          <PageHeader
            title="Λογιστικό σχέδιο"
            description="Chart of Accounts — βάση γενικής λογιστικής SoftifyOS."
          />
        </div>
        <Button size="sm" onClick={() => setCreating(true)} disabled={pending}>
          <Plus size={16} /> Νέος λογαριασμός
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-900">
          {message}
        </p>
      ) : null}

      {creating ? (
        <form
          onSubmit={create}
          className="soft-panel grid gap-3 p-4 sm:grid-cols-5"
        >
          <input
            name="code"
            required
            placeholder="Κωδικός *"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
          />
          <input
            name="name"
            required
            placeholder="Ονομασία *"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm sm:col-span-2"
          />
          <select
            name="type"
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            defaultValue="ASSET"
          >
            {(Object.keys(GL_ACCOUNT_TYPE_LABEL) as GlType[]).map((t) => (
              <option key={t} value={t}>
                {GL_ACCOUNT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="isPostable" defaultChecked />{" "}
              Postable
            </label>
            <Button type="submit" size="sm" disabled={pending}>
              Αποθήκευση
            </Button>
          </div>
        </form>
      ) : null}

      <div className="flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Αναζήτηση κωδικού / ονόματος…"
          className="h-10 w-full max-w-md rounded-xl border border-slate-200 px-3 text-sm"
        />
        <span className="text-xs text-slate-500">
          {filtered.length} / {items.length}
        </span>
      </div>

      <div className="soft-panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Κωδικός</th>
              <th className="px-4 py-3 font-semibold">Ονομασία</th>
              <th className="px-4 py-3 font-semibold">Τύπος</th>
              <th className="px-4 py-3 font-semibold">Flags</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3 font-mono text-teal-800">{a.code}</td>
                <td className="px-4 py-3 font-medium text-ink-950">{a.name}</td>
                <td className="px-4 py-3">
                  <Badge tone="slate">{GL_ACCOUNT_TYPE_LABEL[a.type]}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {a.isPostable ? <Badge tone="teal">Postable</Badge> : null}
                    {a.isSystem ? <Badge tone="amber">System</Badge> : null}
                    {!a.isActive ? <Badge tone="rose">Off</Badge> : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
