"use client";

import { FormEvent, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/cn";

type AppRole = { id: string; code: string; name: string };
type SystemRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
type UserRow = {
  membershipId: string;
  role: SystemRole;
  appRoleId: string | null;
  appRole: AppRole | null;
  user: { id: string; email: string; name: string; createdAt: string };
  groups: { id: string; code: string; name: string }[];
};

const SYSTEM_ROLES: SystemRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

const ROLE_META: Record<
  SystemRole,
  { label: string; tone: "teal" | "amber" | "slate" | "emerald" }
> = {
  OWNER: { label: "Ιδιοκτήτης", tone: "teal" },
  ADMIN: { label: "Διαχειριστής", tone: "amber" },
  MEMBER: { label: "Μέλος", tone: "emerald" },
  VIEWER: { label: "Αναγνώστης", tone: "slate" },
};

type Draft = {
  name: string;
  email: string;
  password: string;
  role: SystemRole;
  appRoleId: string;
};

function emptyDraft(): Draft {
  return {
    name: "",
    email: "",
    password: "",
    role: "MEMBER",
    appRoleId: "",
  };
}

function fromRow(row: UserRow): Draft {
  return {
    name: row.user.name,
    email: row.user.email,
    password: "",
    role: row.role,
    appRoleId: row.appRoleId ?? "",
  };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[1]![0] ?? ""}`.toUpperCase();
}

export function UsersSettingsClient({
  initialUsers,
  initialRoles,
  currentUserId,
  currentRole,
}: {
  initialUsers: UserRow[];
  initialRoles: AppRole[];
  currentUserId: string;
  currentRole: SystemRole;
}) {
  const [items, setItems] = useState(initialUsers);
  const [roles] = useState(initialRoles);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"closed" | "create" | "edit">("closed");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 3200);
    return () => window.clearTimeout(t);
  }, [message]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (row) =>
        row.user.name.toLowerCase().includes(q) ||
        row.user.email.toLowerCase().includes(q) ||
        row.role.toLowerCase().includes(q) ||
        (row.appRole?.name ?? "").toLowerCase().includes(q) ||
        row.groups.some((g) => g.name.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const editingRow = useMemo(
    () => items.find((r) => r.membershipId === editingId) ?? null,
    [items, editingId],
  );

  const refresh = async () => {
    const res = await fetch("/api/settings/users");
    const data = await res.json();
    if (res.ok) setItems(data.items);
  };

  const openCreate = () => {
    setMode("create");
    setEditingId(null);
    setDraft(emptyDraft());
    setConfirmDeleteId(null);
    setError(null);
  };

  const openEdit = (row: UserRow) => {
    setMode("edit");
    setEditingId(row.membershipId);
    setDraft(fromRow(row));
    setConfirmDeleteId(null);
    setError(null);
  };

  const closePanel = () => {
    setMode("closed");
    setEditingId(null);
    setDraft(emptyDraft());
    setConfirmDeleteId(null);
  };

  const canAssignOwner = currentRole === "OWNER";

  const saveCreate = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          email: draft.email.trim(),
          password: draft.password || undefined,
          role: draft.role,
          appRoleId: draft.appRoleId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία δημιουργίας");
        return;
      }
      setMessage(
        data.linkedExisting
          ? "Ο υπάρχων χρήστης προστέθηκε στο tenant."
          : "Ο χρήστης δημιουργήθηκε.",
      );
      closePanel();
      await refresh();
    });
  };

  const saveEdit = (e: FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          membershipId: editingId,
          name: draft.name.trim(),
          email: draft.email.trim(),
          ...(draft.password ? { password: draft.password } : {}),
          role: draft.role,
          appRoleId: draft.appRoleId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία αποθήκευσης");
        return;
      }
      setMessage("Ο χρήστης ενημερώθηκε.");
      closePanel();
      await refresh();
    });
  };

  const removeUser = (membershipId: string) => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/users", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία διαγραφής");
        setConfirmDeleteId(null);
        return;
      }
      setMessage("Ο χρήστης αφαιρέθηκε από το tenant.");
      if (editingId === membershipId) closePanel();
      setConfirmDeleteId(null);
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
            title="Χρήστες"
            description="Δημιουργία, επεξεργασία και αφαίρεση μελών · ρόλοι συστήματος και App Role."
          />
        </div>
        <Button size="sm" onClick={openCreate} disabled={pending}>
          <UserPlus size={16} /> Νέος χρήστης
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <label className="relative min-w-[220px] flex-1">
              <Search
                size={15}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Αναζήτηση ονόματος, email, ρόλου…"
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-teal-300"
              />
            </label>
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Users size={14} />
              {filtered.length} από {items.length}
            </span>
          </div>

          <div className="soft-panel overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-semibold">Χρήστης</th>
                    <th className="px-4 py-3 font-semibold">Ρόλος</th>
                    <th className="px-4 py-3 font-semibold">App Role</th>
                    <th className="px-4 py-3 font-semibold">Ομάδες</th>
                    <th className="px-4 py-3 font-semibold text-right">Ενέργειες</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const isSelf = row.user.id === currentUserId;
                    const meta = ROLE_META[row.role];
                    const selected = editingId === row.membershipId;
                    return (
                      <tr
                        key={row.membershipId}
                        className={cn(
                          "border-b border-slate-100 last:border-0 transition-colors",
                          selected ? "bg-teal-50/50" : "hover:bg-slate-50/80",
                        )}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-950 text-xs font-semibold text-white">
                              {initials(row.user.name)}
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium text-ink-950">
                                  {row.user.name}
                                </span>
                                {isSelf ? (
                                  <Badge tone="teal">Εσείς</Badge>
                                ) : null}
                              </div>
                              <div className="truncate text-xs text-slate-500">
                                {row.user.email}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge tone={meta.tone}>{meta.label}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {row.appRole ? (
                            <span className="text-sm text-ink-900">
                              {row.appRole.name}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {row.groups.length === 0 ? (
                              <span className="text-xs text-slate-400">—</span>
                            ) : (
                              row.groups.map((g) => (
                                <Badge key={g.id} tone="slate">
                                  {g.name}
                                </Badge>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => openEdit(row)}
                              title="Επεξεργασία"
                            >
                              <Pencil size={15} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={pending || isSelf}
                              onClick={() => setConfirmDeleteId(row.membershipId)}
                              title={
                                isSelf
                                  ? "Δεν μπορείτε να διαγράψετε τον εαυτό σας"
                                  : "Διαγραφή"
                              }
                              className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            >
                              <Trash2 size={15} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-4 py-12 text-center text-sm text-slate-500"
                      >
                        Δεν βρέθηκαν χρήστες.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside
          className={cn(
            "soft-panel p-4 transition",
            mode === "closed" && "hidden xl:block xl:opacity-70",
          )}
        >
          {mode === "closed" ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 px-4 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                <UserPlus size={22} />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink-900">
                  Διαχείριση μέλους
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Επιλέξτε επεξεργασία από τη λίστα ή δημιουργήστε νέο χρήστη.
                </p>
              </div>
              <Button size="sm" variant="secondary" onClick={openCreate}>
                <Plus size={15} /> Νέος χρήστης
              </Button>
            </div>
          ) : (
            <form
              onSubmit={mode === "create" ? saveCreate : saveEdit}
              className="space-y-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-ink-900">
                    {mode === "create" ? "Νέος χρήστης" : "Επεξεργασία χρήστη"}
                  </h2>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {mode === "create"
                      ? "Αν το email υπάρχει ήδη, προστίθεται στο tenant χωρίς νέο κωδικό."
                      : editingRow?.user.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePanel}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-ink-900"
                  aria-label="Κλείσιμο"
                >
                  <X size={16} />
                </button>
              </div>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Ονοματεπώνυμο</span>
                <input
                  required
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-300"
                  placeholder="π.χ. Γιάννης Παπαδόπουλος"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Email</span>
                <input
                  required
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-300"
                  placeholder="name@company.gr"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">
                  {mode === "create" ? "Κωδικός" : "Νέος κωδικός (προαιρετικό)"}
                </span>
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={draft.password ? 8 : undefined}
                  value={draft.password}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, password: e.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-300"
                  placeholder={
                    mode === "create"
                      ? "Υποχρεωτικός για νέο λογαριασμό (8+)"
                      : "Αφήστε κενό για να μείνει ίδιος"
                  }
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">
                  Ρόλος συστήματος
                </span>
                <select
                  value={draft.role}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      role: e.target.value as SystemRole,
                    }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-300"
                >
                  {SYSTEM_ROLES.map((r) => (
                    <option
                      key={r}
                      value={r}
                      disabled={r === "OWNER" && !canAssignOwner}
                    >
                      {ROLE_META[r].label} ({r})
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-slate-600">App Role</span>
                <select
                  value={draft.appRoleId}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, appRoleId: e.target.value }))
                  }
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-teal-300"
                >
                  <option value="">— Κανένας —</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code})
                    </option>
                  ))}
                </select>
              </label>

              {mode === "edit" && editingRow ? (
                <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                  Ομάδες:{" "}
                  {editingRow.groups.length
                    ? editingRow.groups.map((g) => g.name).join(", ")
                    : "καμία — ορίστε από Ρυθμίσεις → Ομάδες"}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="submit" size="sm" disabled={pending}>
                  {mode === "create" ? "Δημιουργία" : "Αποθήκευση"}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={closePanel}
                  disabled={pending}
                >
                  Ακύρωση
                </Button>
              </div>
            </form>
          )}
        </aside>
      </div>

      {confirmDeleteId ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/40 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold text-ink-950">
              Διαγραφή χρήστη;
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Ο χρήστης θα αφαιρεθεί από αυτό το tenant. Αν δεν ανήκει αλλού, θα
              διαγραφεί οριστικά ο λογαριασμός του.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending}
                onClick={() => setConfirmDeleteId(null)}
              >
                Ακύρωση
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={pending}
                onClick={() => removeUser(confirmDeleteId)}
              >
                <Trash2 size={15} /> Διαγραφή
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
