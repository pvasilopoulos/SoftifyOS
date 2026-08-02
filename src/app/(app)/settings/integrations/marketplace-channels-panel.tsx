"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, useTransition } from "react";
import {
  Pause,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";
import {
  MARKETPLACE_PROVIDERS,
  MARKETPLACE_STATUSES,
  marketplaceProviderDefaults,
  marketplaceProviderLabel,
  marketplaceStatusLabel,
  marketplaceStatusTone,
  type MarketplaceChannelStatus,
  type MarketplaceProvider,
} from "@/modules/marketplace-channels/labels";

export type MarketplaceChannelItem = {
  id: string;
  code: string;
  name: string;
  provider: MarketplaceProvider;
  status: MarketplaceChannelStatus;
  merchantId: string | null;
  externalShopId: string | null;
  credentialsSecretKey: string | null;
  apiBaseHost: string | null;
  apiBaseUrl: string | null;
  syncCatalog: boolean;
  syncOrders: boolean;
  syncStock: boolean;
  syncPrices: boolean;
  autoImportOrders: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

type Draft = {
  code: string;
  name: string;
  provider: MarketplaceProvider;
  status: MarketplaceChannelStatus;
  merchantId: string;
  externalShopId: string;
  credentialsSecretKey: string;
  apiBaseHost: string;
  apiBaseUrl: string;
  syncCatalog: boolean;
  syncOrders: boolean;
  syncStock: boolean;
  syncPrices: boolean;
  autoImportOrders: boolean;
  isActive: boolean;
  sortOrder: number;
  notes: string;
};

function emptyDraft(provider: MarketplaceProvider = "SKROUTZ"): Draft {
  const d = marketplaceProviderDefaults[provider];
  return {
    code: d.code,
    name: d.name,
    provider,
    status: "DRAFT",
    merchantId: "",
    externalShopId: "",
    credentialsSecretKey: d.credentialsSecretKey,
    apiBaseHost: d.apiBaseHost,
    apiBaseUrl: "",
    syncCatalog: d.syncCatalog,
    syncOrders: d.syncOrders,
    syncStock: d.syncStock,
    syncPrices: d.syncPrices,
    autoImportOrders: false,
    isActive: true,
    sortOrder: 100,
    notes: "",
  };
}

function fromItem(m: MarketplaceChannelItem): Draft {
  return {
    code: m.code,
    name: m.name,
    provider: m.provider,
    status: m.status,
    merchantId: m.merchantId ?? "",
    externalShopId: m.externalShopId ?? "",
    credentialsSecretKey: m.credentialsSecretKey ?? "",
    apiBaseHost: m.apiBaseHost ?? "",
    apiBaseUrl: m.apiBaseUrl ?? "",
    syncCatalog: m.syncCatalog,
    syncOrders: m.syncOrders,
    syncStock: m.syncStock,
    syncPrices: m.syncPrices,
    autoImportOrders: m.autoImportOrders,
    isActive: m.isActive,
    sortOrder: m.sortOrder,
    notes: m.notes ?? "",
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1.5 block font-medium text-ink-900">{label}</span>
      {children}
      {hint ? (
        <span className="mt-1 block text-[11px] text-slate-400">{hint}</span>
      ) : null}
    </label>
  );
}

const inputCls =
  "h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-teal-500/30 disabled:bg-slate-50";

function syncChips(m: MarketplaceChannelItem) {
  const bits: string[] = [];
  if (m.syncCatalog) bits.push("Κατάλογος");
  if (m.syncOrders) bits.push("Παραγγελίες");
  if (m.syncStock) bits.push("Stock");
  if (m.syncPrices) bits.push("Τιμές");
  return bits;
}

export function MarketplaceChannelsPanel({
  canWrite,
  initialItems,
  onItemsChange,
}: {
  canWrite: boolean;
  initialItems: MarketplaceChannelItem[];
  onItemsChange?: (items: MarketplaceChannelItem[]) => void;
}) {
  const [items, setItems] = useState(initialItems);

  const replaceItems = (
    next:
      | MarketplaceChannelItem[]
      | ((prev: MarketplaceChannelItem[]) => MarketplaceChannelItem[]),
  ) => {
    setItems((prev) => {
      const value = typeof next === "function" ? next(prev) : next;
      onItemsChange?.(value);
      return value;
    });
  };
  const [query, setQuery] = useState("");
  const [filterProvider, setFilterProvider] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const editing = useMemo(
    () => items.find((i) => i.id === editingId) ?? null,
    [items, editingId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((m) => {
      if (filterProvider !== "all" && m.provider !== filterProvider) return false;
      if (filterStatus !== "all" && m.status !== filterStatus) return false;
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        m.code.toLowerCase().includes(q) ||
        (m.merchantId ?? "").toLowerCase().includes(q) ||
        marketplaceProviderLabel[m.provider].toLowerCase().includes(q)
      );
    });
  }, [items, query, filterProvider, filterStatus]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      active: items.filter((m) => m.status === "ACTIVE" && m.isActive).length,
      paused: items.filter((m) => m.status === "PAUSED").length,
      error: items.filter((m) => m.status === "ERROR").length,
    };
  }, [items]);

  const openCreate = () => {
    setCreating(true);
    setEditingId(null);
    setDraft(emptyDraft());
    setError(null);
    setMessage(null);
    setConfirmDeleteId(null);
  };

  const openEdit = (m: MarketplaceChannelItem) => {
    setCreating(false);
    setEditingId(m.id);
    setDraft(fromItem(m));
    setError(null);
    setMessage(null);
    setConfirmDeleteId(null);
  };

  const closeDrawer = () => {
    setCreating(false);
    setEditingId(null);
    setError(null);
  };

  const applyProviderDefaults = (provider: MarketplaceProvider) => {
    const d = marketplaceProviderDefaults[provider];
    setDraft((prev) => ({
      ...prev,
      provider,
      code: creating ? d.code : prev.code,
      name: creating || prev.name === marketplaceProviderDefaults[prev.provider].name
        ? d.name
        : prev.name,
      credentialsSecretKey: creating
        ? d.credentialsSecretKey
        : prev.credentialsSecretKey || d.credentialsSecretKey,
      apiBaseHost: creating ? d.apiBaseHost : prev.apiBaseHost || d.apiBaseHost,
      syncCatalog: d.syncCatalog,
      syncOrders: d.syncOrders,
      syncStock: d.syncStock,
      syncPrices: d.syncPrices,
    }));
  };

  const payloadFromDraft = () => ({
    code: draft.code,
    name: draft.name,
    provider: draft.provider,
    status: draft.status,
    merchantId: draft.merchantId || null,
    externalShopId: draft.externalShopId || null,
    credentialsSecretKey: draft.credentialsSecretKey || null,
    apiBaseHost: draft.apiBaseHost || null,
    apiBaseUrl: draft.apiBaseUrl || null,
    syncCatalog: draft.syncCatalog,
    syncOrders: draft.syncOrders,
    syncStock: draft.syncStock,
    syncPrices: draft.syncPrices,
    autoImportOrders: draft.autoImportOrders,
    isActive: draft.isActive,
    sortOrder: draft.sortOrder,
    notes: draft.notes || null,
  });

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const payload = payloadFromDraft();
      const res = creating
        ? await fetch("/api/settings/marketplace-channels", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/settings/marketplace-channels/${editingId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      const item = data.item as MarketplaceChannelItem;
      replaceItems((prev) => {
        if (creating) {
          return [...prev, item].sort((a, b) => a.sortOrder - b.sortOrder);
        }
        return prev.map((r) => (r.id === item.id ? item : r));
      });
      setMessage(creating ? "Το κανάλι δημιουργήθηκε" : "Αποθηκεύτηκε");
      closeDrawer();
    });
  };

  const patchStatus = (id: string, status: MarketplaceChannelStatus) => {
    if (!canWrite) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/settings/marketplace-channels/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          isActive: status === "ACTIVE" ? true : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία");
        return;
      }
      replaceItems((prev) =>
        prev.map((r) =>
          r.id === id ? (data.item as MarketplaceChannelItem) : r,
        ),
      );
      setMessage(`Κατάσταση: ${marketplaceStatusLabel[status]}`);
    });
  };

  const syncPing = (id: string) => {
    if (!canWrite) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(
        `/api/settings/marketplace-channels/${id}/sync-ping`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ok: true }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Sync ping απέτυχε");
        return;
      }
      replaceItems((prev) =>
        prev.map((r) =>
          r.id === id ? (data.item as MarketplaceChannelItem) : r,
        ),
      );
      setMessage("Sync heartbeat καταγράφηκε");
    });
  };

  const remove = (id: string) => {
    if (!canWrite) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/settings/marketplace-channels/${id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Αποτυχία διαγραφής");
        return;
      }
      replaceItems((prev) => prev.filter((r) => r.id !== id));
      setConfirmDeleteId(null);
      if (editingId === id) closeDrawer();
      setMessage("Το κανάλι διαγράφηκε");
    });
  };

  const drawerOpen = creating || Boolean(editingId);

  return (
    <section className="soft-panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Marketplaces & channels</h2>
          <p className="mt-1 text-xs text-slate-500">
            Πολλαπλά κανάλια (Skroutz, Shopify, Woo…) · sync μέσω Script Hooks /
            allow-listed HTTP
          </p>
        </div>
        {canWrite ? (
          <Button type="button" size="sm" onClick={openCreate} disabled={pending}>
            <Plus size={14} className="mr-1" />
            Νέο κανάλι
          </Button>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {[
          { label: "Σύνολο", value: stats.total },
          { label: "Ενεργά", value: stats.active },
          { label: "Παύση", value: stats.paused },
          { label: "Σφάλματα", value: stats.error },
        ].map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {s.label}
            </p>
            <p className="text-lg font-semibold tabular-nums text-ink-900">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Αναζήτηση κωδικού, ονόματος, merchant…"
            className={cn(inputCls, "pl-9")}
          />
        </div>
        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className={cn(inputCls, "w-auto min-w-[140px]")}
        >
          <option value="all">Όλοι οι πάροχοι</option>
          {MARKETPLACE_PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {marketplaceProviderLabel[p]}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className={cn(inputCls, "w-auto min-w-[130px]")}
        >
          <option value="all">Όλες οι καταστάσεις</option>
          {MARKETPLACE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {marketplaceStatusLabel[s]}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          {message}
        </p>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-100">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-slate-500">
            <Store size={28} className="text-slate-300" />
            <p>Δεν υπάρχουν κανάλια ακόμα.</p>
            {canWrite ? (
              <Button type="button" size="sm" variant="secondary" onClick={openCreate}>
                Δημιούργησε το πρώτο
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-start justify-between gap-3 px-3 py-3 hover:bg-slate-50/70"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink-900">{m.name}</span>
                    <Badge tone={marketplaceStatusTone[m.status]}>
                      {marketplaceStatusLabel[m.status]}
                    </Badge>
                    {!m.isActive ? <Badge tone="slate">ανενεργό</Badge> : null}
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {m.code}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {marketplaceProviderLabel[m.provider]}
                    {m.merchantId ? ` · Merchant ${m.merchantId}` : ""}
                    {m.credentialsSecretKey
                      ? ` · Secret «${m.credentialsSecretKey}»`
                      : ""}
                  </p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {syncChips(m).map((c) => (
                      <span
                        key={c}
                        className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-800"
                      >
                        {c}
                      </span>
                    ))}
                    {m.autoImportOrders ? (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                        Auto-import
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {m.lastSyncAt
                      ? `Τελευταίο sync ${new Date(m.lastSyncAt).toLocaleString("el-GR")}`
                      : "Χωρίς sync ακόμα"}
                    {m.lastError ? ` · ${m.lastError}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {canWrite && m.status !== "ACTIVE" ? (
                    <button
                      type="button"
                      title="Ενεργοποίηση"
                      disabled={pending}
                      onClick={() => patchStatus(m.id, "ACTIVE")}
                      className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-50"
                    >
                      <Play size={15} />
                    </button>
                  ) : null}
                  {canWrite && m.status === "ACTIVE" ? (
                    <button
                      type="button"
                      title="Παύση"
                      disabled={pending}
                      onClick={() => patchStatus(m.id, "PAUSED")}
                      className="rounded-lg p-2 text-amber-700 hover:bg-amber-50"
                    >
                      <Pause size={15} />
                    </button>
                  ) : null}
                  {canWrite ? (
                    <button
                      type="button"
                      title="Sync heartbeat"
                      disabled={pending}
                      onClick={() => syncPing(m.id)}
                      className="rounded-lg p-2 text-teal-700 hover:bg-teal-50"
                    >
                      <RefreshCw size={15} />
                    </button>
                  ) : null}
                  {canWrite ? (
                    <button
                      type="button"
                      title="Επεξεργασία"
                      disabled={pending}
                      onClick={() => openEdit(m)}
                      className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
                    >
                      <Pencil size={15} />
                    </button>
                  ) : null}
                  {canWrite ? (
                    confirmDeleteId === m.id ? (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => setConfirmDeleteId(null)}
                        >
                          Όχι
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          disabled={pending}
                          onClick={() => remove(m.id)}
                          className="!bg-rose-600 hover:!bg-rose-700"
                        >
                          Διαγραφή
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title="Διαγραφή"
                        disabled={pending}
                        onClick={() => setConfirmDeleteId(m.id)}
                        className="rounded-lg p-2 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 size={15} />
                      </button>
                    )
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-500">
        Secrets για tokens →{" "}
        <Link
          href="/settings/scripts"
          className="font-medium text-teal-700 hover:underline"
        >
          Script Secrets
        </Link>
        . HTTP hosts → Allow-list. Τα Script Hooks διαβάζουν το κανάλι (κωδικός /
        merchant / secret key) για πραγματικό sync.
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-ink-900/20 backdrop-blur-[1px]">
          <button
            type="button"
            aria-label="Κλείσιμο"
            className="absolute inset-0"
            onClick={closeDrawer}
          />
          <form
            onSubmit={save}
            className="relative z-10 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  {creating ? "Νέο marketplace channel" : `Επεξεργασία · ${editing?.code}`}
                </p>
                <p className="text-xs text-slate-500">
                  Provider, sync flags, credentials ref
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-50"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-4 px-4 py-4">
              {error ? (
                <p className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  {error}
                </p>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Πάροχος">
                  <select
                    required
                    disabled={!canWrite || pending}
                    value={draft.provider}
                    onChange={(e) =>
                      applyProviderDefaults(e.target.value as MarketplaceProvider)
                    }
                    className={inputCls}
                  >
                    {MARKETPLACE_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {marketplaceProviderLabel[p]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Κατάσταση">
                  <select
                    disabled={!canWrite || pending}
                    value={draft.status}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        status: e.target.value as MarketplaceChannelStatus,
                      }))
                    }
                    className={inputCls}
                  >
                    {MARKETPLACE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {marketplaceStatusLabel[s]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Κωδικός" hint="Μοναδικός ανά οργανισμό">
                  <input
                    required
                    disabled={!canWrite || pending || !creating}
                    value={draft.code}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        code: e.target.value.toUpperCase(),
                      }))
                    }
                    className={cn(inputCls, "font-mono")}
                    placeholder="SKROUTZ"
                  />
                </Field>
                <Field label="Όνομα">
                  <input
                    required
                    disabled={!canWrite || pending}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, name: e.target.value }))
                    }
                    className={inputCls}
                  />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Shop / Merchant ID">
                  <input
                    disabled={!canWrite || pending}
                    value={draft.merchantId}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, merchantId: e.target.value }))
                    }
                    className={inputCls}
                    placeholder="shop id"
                  />
                </Field>
                <Field label="External shop ID">
                  <input
                    disabled={!canWrite || pending}
                    value={draft.externalShopId}
                    onChange={(e) =>
                      setDraft((d) => ({
                        ...d,
                        externalShopId: e.target.value,
                      }))
                    }
                    className={inputCls}
                  />
                </Field>
              </div>

              <Field
                label="Script Secret key"
                hint="Το raw token μένει στα Script Secrets"
              >
                <input
                  disabled={!canWrite || pending}
                  value={draft.credentialsSecretKey}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      credentialsSecretKey: e.target.value,
                    }))
                  }
                  className={cn(inputCls, "font-mono")}
                  placeholder="SKROUTZ_TOKEN"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="API host (allow-list)">
                  <input
                    disabled={!canWrite || pending}
                    value={draft.apiBaseHost}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, apiBaseHost: e.target.value }))
                    }
                    className={inputCls}
                    placeholder="api.skroutz.gr"
                  />
                </Field>
                <Field label="API base URL">
                  <input
                    disabled={!canWrite || pending}
                    value={draft.apiBaseUrl}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, apiBaseUrl: e.target.value }))
                    }
                    className={inputCls}
                    placeholder="https://…"
                  />
                </Field>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-ink-900">Sync</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(
                    [
                      ["syncCatalog", "Κατάλογος προϊόντων"],
                      ["syncOrders", "Παραγγελίες"],
                      ["syncStock", "Αποθέματα"],
                      ["syncPrices", "Τιμές"],
                      ["autoImportOrders", "Auto-import παραγγελιών"],
                      ["isActive", "Ενεργό κανάλι"],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        disabled={!canWrite || pending}
                        checked={draft[key]}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, [key]: e.target.checked }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <Field label="Σειρά εμφάνισης">
                <input
                  type="number"
                  disabled={!canWrite || pending}
                  value={draft.sortOrder}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      sortOrder: Number(e.target.value) || 0,
                    }))
                  }
                  className={inputCls}
                />
              </Field>

              <Field label="Σημειώσεις">
                <textarea
                  disabled={!canWrite || pending}
                  rows={3}
                  value={draft.notes}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, notes: e.target.value }))
                  }
                  className={cn(inputCls, "h-auto py-2")}
                />
              </Field>
            </div>

            <div className="sticky bottom-0 mt-auto flex items-center justify-end gap-2 border-t border-slate-100 bg-white px-4 py-3">
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={closeDrawer}
              >
                Ακύρωση
              </Button>
              {canWrite ? (
                <Button type="submit" disabled={pending}>
                  {creating ? "Δημιουργία" : "Αποθήκευση"}
                </Button>
              ) : null}
            </div>
          </form>
        </div>
      ) : null}
    </section>
  );
}
