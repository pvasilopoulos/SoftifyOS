"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Minus,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";
import {
  PERMISSION_CATALOG,
  permissionsByGroup,
  type PermissionCode,
} from "@/platform/auth/permissions";

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  membershipCount: number;
  groupCount: number;
};

const groups = permissionsByGroup();
const totalPermissions = PERMISSION_CATALOG.length;

function normalizeRole(
  r: Role & { _count?: { memberships: number; groups: number } },
): Role {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    description: r.description,
    permissions: r.permissions,
    isSystem: r.isSystem,
    membershipCount: r._count?.memberships ?? r.membershipCount ?? 0,
    groupCount: r._count?.groups ?? r.groupCount ?? 0,
  };
}

export function RolesSettingsClient({ initialRoles }: { initialRoles: Role[] }) {
  const [items, setItems] = useState(initialRoles);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRoles[0]?.id ?? null,
  );
  const [baseline, setBaseline] = useState<Role | null>(
    initialRoles[0] ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [roleQuery, setRoleQuery] = useState("");
  const [permQuery, setPermQuery] = useState("");

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) ?? null,
    [items, selectedId],
  );

  const dirty = useMemo(() => {
    if (!selected || !baseline || selected.id !== baseline.id) return false;
    return (
      selected.name !== baseline.name ||
      (selected.description ?? "") !== (baseline.description ?? "") ||
      selected.permissions.length !== baseline.permissions.length ||
      selected.permissions.some((p) => !baseline.permissions.includes(p))
    );
  }, [selected, baseline]);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(t);
  }, [message]);

  const filteredRoles = useMemo(() => {
    const q = roleQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.code.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [items, roleQuery]);

  const visibleGroups = useMemo(() => {
    const q = permQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(({ group, items: perms }) => ({
        group,
        items: perms.filter(
          (p) =>
            p.label.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            group.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.items.length > 0);
  }, [permQuery]);

  const refresh = async () => {
    const res = await fetch("/api/settings/roles");
    const data = await res.json();
    if (!res.ok) return;
    const next = (data.items as Role[]).map(normalizeRole);
    setItems(next);
    const current = next.find((r) => r.id === selectedId) ?? next[0] ?? null;
    if (current) {
      setSelectedId(current.id);
      setBaseline(current);
    } else {
      setSelectedId(null);
      setBaseline(null);
    }
  };

  const selectRole = (role: Role) => {
    if (dirty && !confirm("Υπάρχουν μη αποθηκευμένες αλλαγές. Συνέχεια;")) {
      return;
    }
    setSelectedId(role.id);
    setBaseline(role);
    setError(null);
    setMessage(null);
    setPermQuery("");
  };

  const patchSelected = (patch: Partial<Role>) => {
    if (!selected) return;
    setItems((prev) =>
      prev.map((r) => (r.id === selected.id ? { ...r, ...patch } : r)),
    );
  };

  const togglePerm = (code: PermissionCode) => {
    if (!selected) return;
    const set = new Set(selected.permissions);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    patchSelected({ permissions: [...set] });
  };

  const setGroupPermissions = (codes: PermissionCode[], enabled: boolean) => {
    if (!selected) return;
    const set = new Set(selected.permissions);
    for (const code of codes) {
      if (enabled) set.add(code);
      else set.delete(code);
    }
    patchSelected({ permissions: [...set] });
  };

  const saveSelected = () => {
    if (!selected) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/settings/roles/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          description: selected.description,
          permissions: selected.permissions,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage("Ο ρόλος αποθηκεύτηκε.");
      await refresh();
    });
  };

  const createRole = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") || ""),
          name: String(form.get("name") || ""),
          description: String(form.get("description") || "") || null,
          permissions: [],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία δημιουργίας");
        return;
      }
      setCreating(false);
      setMessage("Δημιουργήθηκε νέος ρόλος.");
      await refresh();
      setSelectedId(data.item.id);
      setBaseline(normalizeRole(data.item));
    });
  };

  const deleteRole = () => {
    if (!selected || selected.isSystem) return;
    if (!confirm(`Διαγραφή ρόλου «${selected.name}»;`)) return;
    startTransition(async () => {
      setError(null);
      const res = await fetch(`/api/settings/roles/${selected.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία διαγραφής");
        return;
      }
      setSelectedId(null);
      setBaseline(null);
      await refresh();
    });
  };

  const discardChanges = () => {
    if (!baseline) return;
    setItems((prev) =>
      prev.map((r) => (r.id === baseline.id ? { ...baseline } : r)),
    );
    setError(null);
  };

  return (
    <div className="space-y-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Ρυθμίσεις
      </Link>

      <PageHeader
        title="Ρόλοι"
        description="Ορίστε δικαιώματα ανά ρόλο — system και custom — για κάθε λειτουργία του ERP."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={15} />
            Νέος ρόλος
          </Button>
        }
      />

      {error ? (
        <p className="rounded-xl border border-rose-200/80 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        <aside className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:sticky lg:top-20">
          <div className="border-b border-slate-100 px-3 py-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-400">
                Ρόλοι
              </p>
              <span className="tabular-nums text-xs text-slate-400">
                {items.length}
              </span>
            </div>
            <label className="relative block">
              <Search
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={roleQuery}
                onChange={(e) => setRoleQuery(e.target.value)}
                placeholder="Αναζήτηση ρόλου…"
                className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50/60 pl-8 pr-3 text-sm outline-none ring-teal-500/30 placeholder:text-slate-400 focus:bg-white focus:ring-2"
              />
            </label>
          </div>

          <ul className="max-h-[min(70vh,36rem)] space-y-0.5 overflow-y-auto p-1.5">
            {filteredRoles.map((role) => {
              const active = selectedId === role.id;
              const pct = Math.round(
                (role.permissions.length / totalPermissions) * 100,
              );
              return (
                <li key={role.id}>
                  <button
                    type="button"
                    onClick={() => selectRole(role)}
                    className={cn(
                      "relative flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition",
                      active
                        ? "bg-teal-50/80 text-ink-950"
                        : "text-slate-700 hover:bg-slate-50",
                    )}
                  >
                    {active ? (
                      <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-teal-600" />
                    ) : null}
                    <span
                      className={cn(
                        "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg",
                        active
                          ? "bg-teal-600 text-white"
                          : "bg-slate-100 text-slate-500",
                      )}
                    >
                      <Shield size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">
                          {role.name}
                        </span>
                        {role.isSystem ? (
                          <Badge tone="slate" className="shrink-0 !px-1.5 !py-0 text-[10px]">
                            sys
                          </Badge>
                        ) : (
                          <Badge tone="teal" className="shrink-0 !px-1.5 !py-0 text-[10px]">
                            custom
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-400">
                        {role.code}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <Users size={11} />
                          {role.membershipCount}
                        </span>
                        <span className="tabular-nums">{pct}% δικαιώματα</span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
            {filteredRoles.length === 0 ? (
              <li className="px-3 py-8 text-center text-sm text-slate-500">
                Κανένας ρόλος
              </li>
            ) : null}
          </ul>
        </aside>

        {selected ? (
          <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/95 px-4 py-3.5 backdrop-blur sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-ink-950">
                      {selected.name || "Χωρίς όνομα"}
                    </h2>
                    {dirty ? (
                      <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-inset ring-amber-200">
                        Μη αποθηκευμένα
                      </span>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-500">
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-800">
                      {selected.code}
                    </code>
                    <span className="mx-1.5 text-slate-300">·</span>
                    {selected.membershipCount} χρήστες
                    <span className="mx-1.5 text-slate-300">·</span>
                    {selected.groupCount} ομάδες
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="tabular-nums">
                      {selected.permissions.length}/{totalPermissions} δικαιώματα
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {dirty ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={discardChanges}
                      disabled={pending}
                    >
                      Ακύρωση
                    </Button>
                  ) : null}
                  {!selected.isSystem ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={deleteRole}
                      disabled={pending}
                    >
                      <Trash2 size={15} />
                      Διαγραφή
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    onClick={saveSelected}
                    disabled={pending || !dirty}
                  >
                    {pending ? "Αποθήκευση…" : "Αποθήκευση"}
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-6 px-4 py-4 sm:px-5 sm:py-5">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1.5 block font-medium text-ink-900">
                    Όνομα *
                  </span>
                  <input
                    value={selected.name}
                    onChange={(e) => patchSelected({ name: e.target.value })}
                    className="h-10 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                  />
                </label>
                <label className="block text-sm sm:col-span-1">
                  <span className="mb-1.5 block font-medium text-ink-900">
                    Κωδικός
                  </span>
                  <input
                    value={selected.code}
                    disabled
                    className="h-10 w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-sm text-slate-500"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="mb-1.5 block font-medium text-ink-900">
                    Περιγραφή
                  </span>
                  <textarea
                    value={selected.description ?? ""}
                    onChange={(e) =>
                      patchSelected({ description: e.target.value })
                    }
                    rows={2}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
                    placeholder="Σύντομη περιγραφή του ρόλου"
                  />
                </label>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-ink-950">
                      Δικαιώματα
                    </h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Ενεργοποιήστε ανά ομάδα ή μεμονωμένα.
                    </p>
                  </div>
                  <label className="relative block w-full sm:max-w-xs">
                    <Search
                      size={14}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                    />
                    <input
                      value={permQuery}
                      onChange={(e) => setPermQuery(e.target.value)}
                      placeholder="Φίλτρο δικαιωμάτων…"
                      className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-sm outline-none ring-teal-500/30 placeholder:text-slate-400 focus:ring-2"
                    />
                  </label>
                </div>

                <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-teal-600 transition-[width] duration-300"
                    style={{
                      width: `${Math.round(
                        (selected.permissions.length / totalPermissions) * 100,
                      )}%`,
                    }}
                  />
                </div>

                {visibleGroups.map(({ group, items: perms }) => {
                  const codes = perms.map((p) => p.code);
                  const enabledCount = codes.filter((c) =>
                    selected.permissions.includes(c),
                  ).length;
                  const allOn = enabledCount === codes.length;
                  const someOn = enabledCount > 0 && !allOn;

                  return (
                    <div
                      key={group}
                      className="rounded-xl border border-slate-100 bg-slate-50/40"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.06em] text-slate-500">
                            {group}
                          </p>
                          <p className="text-[11px] tabular-nums text-slate-400">
                            {enabledCount}/{codes.length} ενεργά
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setGroupPermissions(codes, !allOn)
                          }
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition",
                            allOn
                              ? "border-teal-200 bg-teal-50 text-teal-800"
                              : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-ink-900",
                          )}
                        >
                          {allOn ? (
                            <>
                              <Minus size={12} />
                              Αφαίρεση όλων
                            </>
                          ) : (
                            <>
                              <Check size={12} />
                              {someOn ? "Συμπλήρωση όλων" : "Επιλογή όλων"}
                            </>
                          )}
                        </button>
                      </div>

                      <div className="grid gap-1.5 p-2 sm:grid-cols-2">
                        {perms.map((p) => {
                          const checked = selected.permissions.includes(p.code);
                          return (
                            <label
                              key={p.code}
                              className={cn(
                                "flex cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-sm transition",
                                checked
                                  ? "bg-white ring-1 ring-teal-200/80"
                                  : "hover:bg-white/80",
                              )}
                            >
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500"
                                checked={checked}
                                onChange={() => togglePerm(p.code)}
                              />
                              <span className="min-w-0">
                                <span className="block font-medium text-ink-900">
                                  {p.label}
                                </span>
                                <span className="block truncate font-mono text-[11px] text-slate-400">
                                  {p.code}
                                </span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {visibleGroups.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                    Δεν βρέθηκαν δικαιώματα για «{permQuery}».
                  </p>
                ) : null}
              </div>
            </div>
          </section>
        ) : (
          <div className="flex min-h-[20rem] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 px-6 text-center">
            <div>
              <Shield className="mx-auto mb-3 text-slate-300" size={28} />
              <p className="text-sm font-medium text-ink-900">Επιλέξτε ρόλο</p>
              <p className="mt-1 text-sm text-slate-500">
                ή δημιουργήστε νέο για να ορίσετε δικαιώματα.
              </p>
            </div>
          </div>
        )}
      </div>

      {creating ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/40">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Κλείσιμο"
            onClick={() => setCreating(false)}
          />
          <form
            onSubmit={createRole}
            className="relative flex h-full w-full max-w-md flex-col bg-white shadow-2xl animate-fade-in"
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-ink-950">Νέος ρόλος</h2>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
                aria-label="Κλείσιμο"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {error ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </p>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Κωδικός *</span>
                <input
                  name="code"
                  required
                  placeholder="π.χ. sales_rep"
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm outline-none ring-teal-500/30 focus:ring-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Όνομα *</span>
                <input
                  name="name"
                  required
                  placeholder="π.χ. Πωλητής"
                  className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1.5 block font-medium">Περιγραφή</span>
                <textarea
                  name="description"
                  rows={3}
                  placeholder="Προαιρετικά"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
                />
              </label>
              <p className="text-xs text-slate-500">
                Μετά τη δημιουργία ορίστε τα δικαιώματα από τον πίνακα.
              </p>
            </div>
            <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
              <Button type="submit" disabled={pending} className="flex-1">
                {pending ? "Δημιουργία…" : "Δημιουργία"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCreating(false)}
              >
                Ακύρωση
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
