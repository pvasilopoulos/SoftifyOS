"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/shared/ui/page-header";
import { Button } from "@/shared/ui/button";

export default function NewCustomerPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const payload = {
      code: String(form.get("code") || ""),
      name: String(form.get("name") || ""),
      vatNumber: String(form.get("vatNumber") || "") || null,
      email: String(form.get("email") || "") || null,
      phone: String(form.get("phone") || "") || null,
      notes: String(form.get("notes") || "") || null,
    };
    const res = await fetch("/api/customers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { item?: { id: string }; error?: string };
    setPending(false);
    if (!res.ok) {
      setError(data.error || "Αποτυχία δημιουργίας");
      return;
    }
    router.push(`/customers/${data.item!.id}`);
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
      >
        <ArrowLeft size={14} />
        Πίσω
      </Link>
      <PageHeader
        title="Νέος πελάτης"
        description="Στη συνέχεια θα προσθέσετε υποκαταστήματα και χώρους."
      />
      <form onSubmit={onSubmit} className="soft-panel space-y-4 p-5">
        <Field name="code" label="Κωδικός *" required placeholder="CUS-001" />
        <Field name="name" label="Επωνυμία *" required placeholder="Νηρέας Logistics ΑΕ" />
        <Field name="vatNumber" label="ΑΦΜ" placeholder="998877665" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="email" label="Email" type="email" />
          <Field name="phone" label="Τηλέφωνο" />
        </div>
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">Σημειώσεις</span>
          <textarea
            name="notes"
            rows={3}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none ring-teal-500/30 focus:ring-2"
          />
        </label>
        {error ? (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}
        <Button type="submit" disabled={pending} className="w-full sm:w-auto">
          {pending ? "Αποθήκευση..." : "Αποθήκευση"}
        </Button>
      </form>
    </div>
  );
}

function Field({
  name,
  label,
  required,
  placeholder,
  type = "text",
}: {
  name: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      <input
        name={name}
        required={required}
        type={type}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none ring-teal-500/30 focus:ring-2"
      />
    </label>
  );
}
