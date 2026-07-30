"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { permissionsByGroup, type PermissionCode } from "@/platform/auth/permissions";

type Role = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  permissions: string[];
  isSystem: boolean;
  _count?: { memberships: number; groups: number };
};

const groups = permissionsByGroup();

export function RolesSettingsClient() {
  const [items, setItems] = useState<Role[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/settings/roles");
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Αποτυχία φόρτωσης");
      return;
    }
    setItems(data.items);
    setSelectedId((prev) => prev ?? data.items[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find((r) => r.id === selectedId) ?? null,
    [items, selectedId],
  );

  const togglePerm = (code: PermissionCode) => {
    if (!selected) return;
    const set = new Set(selected.permissions);
    if (set.has(code)) set.delete(code);
    else set.add(code);
    setItems((prev) =>
      prev.map((r) =>
        r.id === selected.id ? { ...r, permissions: [...set] } : r,
      ),
    );
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
      await load();
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
      await load();
      setSelectedId(data.item.id);
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
      await load();
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
            title="Ρόλοι"
            description="System και custom ρόλοι με granular permissions."
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Νέος ρόλος
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
        <form onSubmit={createRole} className="soft-panel grid gap-3 p-4 sm:grid-cols-3">
          <input
            name="code"
            required
            placeholder="code (π.χ. sales_rep)"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            name="name"
            required
            placeholder="Όνομα"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            name="description"
            placeholder="Περιγραφή"
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          />
          <div className="flex gap-2 sm:col-span-3">
            <Button type="submit" size="sm" disabled={pending}>
              Δημιουργία
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCreating(false)}
            >
              Ακύρωση
            </Button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="soft-panel space-y-1 p-2">
          {items.map((role) => (
            <button
              key={role.id}
              type="button"
              onClick={() => setSelectedId(role.id)}
              className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition ${
                selectedId === role.id
                  ? "bg-teal-50 font-medium text-teal-900"
                  : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span>{role.name}</span>
              {role.isSystem ? <Badge tone="slate">sys</Badge> : null}
            </button>
          ))}
        </div>

        {selected ? (
          <div className="soft-panel space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <input
                  value={selected.name}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((r) =>
                        r.id === selected.id ? { ...r, name: e.target.value } : r,
                      ),
                    )
                  }
                  className="block w-full max-w-md rounded-xl border border-slate-200 px-3 py-2 text-base font-semibold"
                />
                <p className="text-xs text-slate-500">
                  code: <code>{selected.code}</code>
                  {selected._count
                    ? ` · ${selected._count.memberships} χρήστες · ${selected._count.groups} ομάδες`
                    : null}
                </p>
                <textarea
                  value={selected.description ?? ""}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((r) =>
                        r.id === selected.id
                          ? { ...r, description: e.target.value }
                          : r,
                      ),
                    )
                  }
                  rows={2}
                  className="w-full max-w-lg rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Περιγραφή"
                />
              </div>
              <div className="flex gap-2">
                {!selected.isSystem ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={deleteRole}
                    disabled={pending}
                  >
                    <Trash2 size={16} />
                  </Button>
                ) : null}
                <Button size="sm" onClick={saveSelected} disabled={pending}>
                  Αποθήκευση
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              {groups.map(({ group, items: perms }) => (
                <div key={group}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {group}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {perms.map((p) => {
                      const checked = selected.permissions.includes(p.code);
                      return (
                        <label
                          key={p.code}
                          className="flex cursor-pointer items-start gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm hover:bg-slate-50"
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={checked}
                            onChange={() => togglePerm(p.code)}
                          />
                          <span>
                            <span className="block font-medium text-ink-900">
                              {p.label}
                            </span>
                            <span className="text-xs text-slate-400">{p.code}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Επιλέξτε ρόλο</p>
        )}
      </div>
    </div>
  );
}
