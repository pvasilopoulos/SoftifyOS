"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";

type UserOpt = {
  membershipId: string;
  user: { id: string; email: string; name: string };
};
type RoleOpt = { id: string; code: string; name: string };
type Group = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  members: UserOpt[];
  roles: RoleOpt[];
};

export function GroupsSettingsClient() {
  const [items, setItems] = useState<Group[]>([]);
  const [users, setUsers] = useState<UserOpt[]>([]);
  const [roles, setRoles] = useState<RoleOpt[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const [gRes, uRes, rRes] = await Promise.all([
      fetch("/api/settings/groups"),
      fetch("/api/settings/users"),
      fetch("/api/settings/roles"),
    ]);
    const gData = await gRes.json();
    const uData = await uRes.json();
    const rData = await rRes.json();
    if (!gRes.ok) {
      setError(gData.error || "Αποτυχία φόρτωσης ομάδων");
      return;
    }
    setItems(gData.items);
    setUsers(
      (uData.items ?? []).map(
        (u: {
          membershipId: string;
          user: { id: string; email: string; name: string };
        }) => ({
          membershipId: u.membershipId,
          user: u.user,
        }),
      ),
    );
    setRoles(
      (rData.items ?? []).map((r: RoleOpt) => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
    );
    setSelectedId((prev) => prev ?? gData.items[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => items.find((g) => g.id === selectedId) ?? null,
    [items, selectedId],
  );

  const createGroup = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      const res = await fetch("/api/settings/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: String(form.get("code") || ""),
          name: String(form.get("name") || ""),
          description: String(form.get("description") || "") || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία δημιουργίας");
        return;
      }
      setCreating(false);
      setMessage("Η ομάδα δημιουργήθηκε.");
      await load();
      setSelectedId(data.item.id);
    });
  };

  const saveGroup = () => {
    if (!selected) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/settings/groups/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: selected.name,
          description: selected.description,
          memberIds: selected.members.map((m) => m.membershipId),
          roleIds: selected.roles.map((r) => r.id),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage("Η ομάδα αποθηκεύτηκε.");
      await load();
    });
  };

  const deleteGroup = () => {
    if (!selected) return;
    if (!confirm(`Διαγραφή ομάδας «${selected.name}»;`)) return;
    startTransition(async () => {
      const res = await fetch(`/api/settings/groups/${selected.id}`, {
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

  const toggleMember = (membershipId: string) => {
    if (!selected) return;
    setItems((prev) =>
      prev.map((g) => {
        if (g.id !== selected.id) return g;
        const has = g.members.some((m) => m.membershipId === membershipId);
        if (has) {
          return {
            ...g,
            members: g.members.filter((m) => m.membershipId !== membershipId),
          };
        }
        const user = users.find((u) => u.membershipId === membershipId);
        if (!user) return g;
        return { ...g, members: [...g.members, user] };
      }),
    );
  };

  const toggleRole = (roleId: string) => {
    if (!selected) return;
    setItems((prev) =>
      prev.map((g) => {
        if (g.id !== selected.id) return g;
        const has = g.roles.some((r) => r.id === roleId);
        if (has) {
          return { ...g, roles: g.roles.filter((r) => r.id !== roleId) };
        }
        const role = roles.find((r) => r.id === roleId);
        if (!role) return g;
        return { ...g, roles: [...g.roles, role] };
      }),
    );
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
            title="Ομάδες χρηστών"
            description="Ομαδοποίηση μελών και ανάθεση ρόλων σε ομάδες."
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={16} /> Νέα ομάδα
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
        <form onSubmit={createGroup} className="soft-panel grid gap-3 p-4 sm:grid-cols-3">
          <input
            name="code"
            required
            placeholder="code (π.χ. warehouse)"
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
            <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
              Ακύρωση
            </Button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div className="soft-panel space-y-1 p-2">
          {items.length === 0 ? (
            <p className="px-3 py-2 text-sm text-slate-500">Δεν υπάρχουν ομάδες</p>
          ) : (
            items.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => setSelectedId(g.id)}
                className={`flex w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  selectedId === g.id
                    ? "bg-teal-50 font-medium text-teal-900"
                    : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {g.name}
              </button>
            ))
          )}
        </div>

        {selected ? (
          <div className="soft-panel space-y-5 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-2">
                <input
                  value={selected.name}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((g) =>
                        g.id === selected.id ? { ...g, name: e.target.value } : g,
                      ),
                    )
                  }
                  className="block w-full max-w-md rounded-xl border border-slate-200 px-3 py-2 text-base font-semibold"
                />
                <p className="text-xs text-slate-500">
                  code: <code>{selected.code}</code>
                </p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="danger" onClick={deleteGroup} disabled={pending}>
                  <Trash2 size={16} />
                </Button>
                <Button size="sm" onClick={saveGroup} disabled={pending}>
                  Αποθήκευση
                </Button>
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Μέλη
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {users.map((u) => {
                  const checked = selected.members.some(
                    (m) => m.membershipId === u.membershipId,
                  );
                  return (
                    <label
                      key={u.membershipId}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleMember(u.membershipId)}
                      />
                      <span>
                        <span className="font-medium">{u.user.name}</span>
                        <span className="block text-xs text-slate-400">
                          {u.user.email}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                Ρόλοι ομάδας
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map((r) => {
                  const checked = selected.roles.some((x) => x.id === r.id);
                  return (
                    <label
                      key={r.id}
                      className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRole(r.id)}
                      />
                      <span>
                        <span className="font-medium">{r.name}</span>
                        <span className="block text-xs text-slate-400">{r.code}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Επιλέξτε ή δημιουργήστε ομάδα</p>
        )}
      </div>
    </div>
  );
}
