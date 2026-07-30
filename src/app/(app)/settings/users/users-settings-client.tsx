"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

type AppRole = { id: string; code: string; name: string };
type UserRow = {
  membershipId: string;
  role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";
  appRoleId: string | null;
  appRole: AppRole | null;
  user: { id: string; email: string; name: string; createdAt: string };
  groups: { id: string; code: string; name: string }[];
};

const SYSTEM_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export function UsersSettingsClient() {
  const [items, setItems] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setError(null);
    const [usersRes, rolesRes] = await Promise.all([
      fetch("/api/settings/users"),
      fetch("/api/settings/roles"),
    ]);
    const usersData = await usersRes.json();
    const rolesData = await rolesRes.json();
    if (!usersRes.ok) {
      setError(usersData.error || "Αποτυχία φόρτωσης χρηστών");
      return;
    }
    if (!rolesRes.ok) {
      setError(rolesData.error || "Αποτυχία φόρτωσης ρόλων");
      return;
    }
    setItems(usersData.items);
    setRoles(
      rolesData.items.map((r: AppRole & { code: string }) => ({
        id: r.id,
        code: r.code,
        name: r.name,
      })),
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = (membershipId: string, patch: { role?: string; appRoleId?: string | null }) => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/settings/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membershipId, ...patch }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία ενημέρωσης");
        return;
      }
      setMessage("Ενημερώθηκε.");
      await load();
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/settings"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Ρυθμίσεις
        </Link>
        <PageHeader
          title="Χρήστες"
          description="Διαχείριση μελών, ρόλου συστήματος και custom App Role."
        />
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

      <div className="soft-panel overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200/80 text-xs uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3 font-semibold">Χρήστης</th>
              <th className="px-4 py-3 font-semibold">Ρόλος συστήματος</th>
              <th className="px-4 py-3 font-semibold">App Role</th>
              <th className="px-4 py-3 font-semibold">Ομάδες</th>
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.membershipId} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-950">{row.user.name}</div>
                  <div className="text-xs text-slate-500">{row.user.email}</div>
                </td>
                <td className="px-4 py-3">
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    value={row.role}
                    disabled={pending}
                    onChange={(e) => patch(row.membershipId, { role: e.target.value })}
                  >
                    {SYSTEM_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm"
                    value={row.appRoleId ?? ""}
                    disabled={pending}
                    onChange={(e) =>
                      patch(row.membershipId, {
                        appRoleId: e.target.value || null,
                      })
                    }
                  >
                    <option value="">— Κανένας —</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.code})
                      </option>
                    ))}
                  </select>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
