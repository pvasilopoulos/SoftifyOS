"use client";

import { useState } from "react";
import { Plus, Star, Trash2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";

export type CustomerContactItem = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  isPrimary: boolean;
  notes: string | null;
};

export function CustomerContactsPanel({
  customerId,
  initial,
  canEdit,
}: {
  customerId: string;
  initial: CustomerContactItem[];
  canEdit: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    title: "",
    email: "",
    phone: "",
    mobile: "",
    isPrimary: false,
  });

  async function addContact() {
    if (!form.name.trim()) return;
    setPending(true);
    setError(null);
    const res = await fetch(`/api/customers/${customerId}/contacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name.trim(),
        title: form.title || null,
        email: form.email || null,
        phone: form.phone || null,
        mobile: form.mobile || null,
        isPrimary: form.isPrimary,
      }),
    });
    const data = await res.json();
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία");
      return;
    }
    setItems((prev) => {
      const next = form.isPrimary
        ? prev.map((c) => ({ ...c, isPrimary: false }))
        : prev;
      return [data.item as CustomerContactItem, ...next];
    });
    setForm({
      name: "",
      title: "",
      email: "",
      phone: "",
      mobile: "",
      isPrimary: false,
    });
  }

  async function removeContact(contactId: string) {
    setPending(true);
    setError(null);
    const res = await fetch(
      `/api/customers/${customerId}/contacts/${contactId}`,
      { method: "DELETE" },
    );
    setPending(false);
    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Αποτυχία διαγραφής");
      return;
    }
    setItems((prev) => prev.filter((c) => c.id !== contactId));
  }

  return (
    <section className="soft-panel space-y-4 p-5">
      <div>
        <h2 className="text-base font-semibold text-ink-950">Επαφές</h2>
        <p className="text-xs text-slate-500">
          Contact persons του πελάτη (αποδέκτες, αγοραστές, λογιστήριο)
        </p>
      </div>

      {error ? (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}

      {canEdit ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            placeholder="Ονοματεπώνυμο *"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <input
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            placeholder="Θέση / ρόλος"
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          />
          <input
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
          <input
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            placeholder="Τηλέφωνο"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
          <input
            className="h-10 rounded-xl border border-slate-200 px-3 text-sm"
            placeholder="Κινητό"
            value={form.mobile}
            onChange={(e) => setForm((f) => ({ ...f, mobile: e.target.value }))}
          />
          <label className="flex h-10 items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.isPrimary}
              onChange={(e) =>
                setForm((f) => ({ ...f, isPrimary: e.target.checked }))
              }
            />
            Κύρια επαφή
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <Button
              size="sm"
              disabled={pending || !form.name.trim()}
              onClick={() => void addContact()}
            >
              <Plus size={14} /> Προσθήκη επαφής
            </Button>
          </div>
        </div>
      ) : null}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
        {items.length === 0 ? (
          <li className="px-4 py-8 text-center text-sm text-slate-500">
            Δεν υπάρχουν επαφές
          </li>
        ) : (
          items.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-start justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-ink-950">{c.name}</p>
                  {c.isPrimary ? (
                    <Badge tone="teal">
                      <Star size={10} className="mr-0.5" /> Κύρια
                    </Badge>
                  ) : null}
                </div>
                <p className="text-xs text-slate-500">
                  {[c.title, c.email, c.phone || c.mobile]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              {canEdit ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs text-rose-700 hover:bg-rose-50"
                  disabled={pending}
                  onClick={() => void removeContact(c.id)}
                >
                  <Trash2 size={12} /> Διαγραφή
                </button>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </section>
  );
}
