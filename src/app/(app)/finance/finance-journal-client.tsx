"use client";

import { FormEvent, useState, useTransition } from "react";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import { formatEUR } from "@/modules/sales/invoice-utils";

type Journal = {
  id: string;
  number: string;
  status: string;
  description: string | null;
  sourceType: string | null;
  postedAt: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    memo: string | null;
    debit: number;
    credit: number;
    accountCode: string;
    accountName: string;
  }>;
};

export function FinanceJournalClient({
  initialJournals,
  canWrite,
}: {
  initialJournals: Journal[];
  canWrite: boolean;
}) {
  const [items, setItems] = useState(initialJournals);
  const [expanded, setExpanded] = useState<string | null>(
    initialJournals[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<
    Array<{ id: string; code: string; name: string }>
  >([]);
  const [showForm, setShowForm] = useState(false);

  const loadAccounts = async () => {
    if (accounts.length) return;
    const res = await fetch("/api/settings/gl-accounts");
    const data = await res.json();
    if (res.ok) {
      setAccounts(
        (data.items as Array<{ id: string; code: string; name: string; isPostable: boolean }>)
          .filter((a) => a.isPostable)
          .map((a) => ({ id: a.id, code: a.code, name: a.name })),
      );
    }
  };

  const openForm = async () => {
    await loadAccounts();
    setShowForm(true);
  };

  const postManual = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch("/api/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: String(form.get("description") || "") || null,
          lines: [
            {
              glAccountId: String(form.get("debitAccount") || ""),
              debit: Number(form.get("amount") || 0),
              credit: 0,
              memo: String(form.get("memo") || "") || null,
            },
            {
              glAccountId: String(form.get("creditAccount") || ""),
              debit: 0,
              credit: Number(form.get("amount") || 0),
              memo: String(form.get("memo") || "") || null,
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία καταχώρησης");
        return;
      }
      setShowForm(false);
      setMessage(`Καταχωρήθηκε ${data.item.number}`);
      const list = await fetch("/api/finance/journals");
      const listData = await list.json();
      if (list.ok) {
        setItems(
          listData.items.map(
            (j: Journal & { lines: Array<Journal["lines"][number] & { glAccount?: { code: string; name: string } }> }) => ({
              ...j,
              lines: j.lines.map((l) => ({
                id: l.id,
                memo: l.memo,
                debit: l.debit,
                credit: l.credit,
                accountCode:
                  (l as { accountCode?: string }).accountCode ??
                  (l as { glAccount?: { code: string } }).glAccount?.code ??
                  "",
                accountName:
                  (l as { accountName?: string }).accountName ??
                  (l as { glAccount?: { name: string } }).glAccount?.name ??
                  "",
              })),
            }),
          ),
        );
        setExpanded(data.item.id);
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-900">Ημερολόγιο άρθρων</h2>
        {canWrite ? (
          <Button size="sm" onClick={() => void openForm()} disabled={pending}>
            Νέο άρθρο
          </Button>
        ) : null}
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

      {showForm ? (
        <form onSubmit={postManual} className="soft-panel grid gap-3 p-4 sm:grid-cols-2">
          <p className="sm:col-span-2 text-sm font-medium text-ink-900">
            Απλό ισοσκελισμένο άρθρο (2 γραμμές)
          </p>
          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-medium">Περιγραφή</span>
            <input
              name="description"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              placeholder="π.χ. χειροκίνητη τακτοποίηση"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Χρέωση *</span>
            <select
              name="debitAccount"
              required
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Πίστωση *</span>
            <select
              name="creditAccount"
              required
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">—</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Ποσό *</span>
            <input
              name="amount"
              type="number"
              min="0.01"
              step="0.01"
              required
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Σημείωση</span>
            <input
              name="memo"
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" size="sm" disabled={pending}>
              Καταχώρηση &amp; Post
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setShowForm(false)}
            >
              Ακύρωση
            </Button>
          </div>
        </form>
      ) : null}

      <div className="soft-panel divide-y divide-slate-100 overflow-hidden">
        {items.map((j) => {
          const open = expanded === j.id;
          const debit = j.lines.reduce((s, l) => s + l.debit, 0);
          return (
            <div key={j.id}>
              <button
                type="button"
                onClick={() => setExpanded(open ? null : j.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50/80"
              >
                <div>
                  <p className="font-medium text-ink-950">
                    <span className="font-mono text-teal-800">{j.number}</span>
                    {j.description ? (
                      <span className="ml-2 text-slate-600">{j.description}</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {j.postedAt
                      ? new Date(j.postedAt).toLocaleString("el-GR")
                      : new Date(j.createdAt).toLocaleString("el-GR")}
                    {j.sourceType ? ` · ${j.sourceType}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={j.status === "POSTED" ? "teal" : "slate"}>
                    {j.status}
                  </Badge>
                  <span className="tabular-nums text-sm font-medium">
                    {formatEUR(debit)}
                  </span>
                </div>
              </button>
              {open ? (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs uppercase tracking-wide text-slate-400">
                        <th className="py-1 text-left font-semibold">Λογαριασμός</th>
                        <th className="py-1 text-right font-semibold">Χρέωση</th>
                        <th className="py-1 text-right font-semibold">Πίστωση</th>
                      </tr>
                    </thead>
                    <tbody>
                      {j.lines.map((l) => (
                        <tr key={l.id} className="border-t border-slate-100">
                          <td className="py-1.5">
                            <span className="font-mono text-teal-800">
                              {l.accountCode}
                            </span>{" "}
                            {l.accountName}
                            {l.memo ? (
                              <span className="block text-xs text-slate-400">
                                {l.memo}
                              </span>
                            ) : null}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {l.debit ? formatEUR(l.debit) : "—"}
                          </td>
                          <td className="py-1.5 text-right tabular-nums">
                            {l.credit ? formatEUR(l.credit) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          );
        })}
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            Δεν υπάρχουν άρθρα ακόμη. Εκδώστε τιμολόγιο ή καταχωρήστε χειροκίνητα.
          </p>
        ) : null}
      </div>
    </div>
  );
}
