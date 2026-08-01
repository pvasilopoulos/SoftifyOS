"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
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

type AccountOpt = { id: string; code: string; name: string };

type DraftLine = {
  key: string;
  glAccountId: string;
  debit: string;
  credit: string;
  memo: string;
};

type CardMovement = {
  journalId: string;
  number: string;
  entryDate: string;
  description: string | null;
  memo: string | null;
  debit: number;
  credit: number;
  balance: number;
};

function newLine(partial?: Partial<DraftLine>): DraftLine {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    glAccountId: "",
    debit: "",
    credit: "",
    memo: "",
    ...partial,
  };
}

export function FinanceJournalClient({
  initialJournals,
  canWrite,
  showActions = false,
}: {
  initialJournals: Journal[];
  canWrite: boolean;
  showActions?: boolean;
}) {
  const [items, setItems] = useState(initialJournals);
  const [expanded, setExpanded] = useState<string | null>(
    initialJournals[0]?.id ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [accounts, setAccounts] = useState<AccountOpt[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    newLine(),
    newLine(),
  ]);
  const [cardAccountId, setCardAccountId] = useState("");
  const [card, setCard] = useState<{
    account: { code: string; name: string };
    movements: CardMovement[];
    totals: { debit: number; credit: number; balance: number };
  } | null>(null);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return {
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      diff: Math.round((debit - credit) * 100) / 100,
    };
  }, [lines]);

  const loadAccounts = async () => {
    if (accounts.length) return accounts;
    const res = await fetch("/api/settings/gl-accounts");
    const data = await res.json();
    if (res.ok) {
      const list = (
        data.items as Array<{
          id: string;
          code: string;
          name: string;
          isPostable: boolean;
        }>
      )
        .filter((a) => a.isPostable)
        .map((a) => ({ id: a.id, code: a.code, name: a.name }));
      setAccounts(list);
      return list;
    }
    return [];
  };

  const openForm = async () => {
    await loadAccounts();
    setLines([newLine(), newLine()]);
    setDescription("");
    setShowForm(true);
  };

  const refreshJournals = async (focusId?: string) => {
    const list = await fetch("/api/finance/journals");
    const listData = await list.json();
    if (!list.ok) return;
    setItems(
      listData.items.map(
        (
          j: Journal & {
            lines: Array<
              Journal["lines"][number] & {
                glAccount?: { code: string; name: string };
              }
            >;
          },
        ) => ({
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
    if (focusId) setExpanded(focusId);
  };

  const postManual = (e: FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const payloadLines = lines
        .map((l) => ({
          glAccountId: l.glAccountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          memo: l.memo || null,
        }))
        .filter((l) => l.glAccountId && (l.debit > 0 || l.credit > 0));

      if (payloadLines.length < 2) {
        setError("Απαιτούνται τουλάχιστον 2 γραμμές με ποσά");
        return;
      }
      if (Math.abs(totals.diff) > 0.001) {
        setError(
          `Μη ισοσκελισμένο (Χ ${totals.debit.toFixed(2)} ≠ Π ${totals.credit.toFixed(2)})`,
        );
        return;
      }

      const res = await fetch("/api/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: description || null,
          lines: payloadLines,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία καταχώρησης");
        return;
      }
      setShowForm(false);
      setMessage(`Καταχωρήθηκε ${data.item.number}`);
      await refreshJournals(data.item.id);
    });
  };

  const loadCard = (accountId?: string) => {
    const id = accountId || cardAccountId;
    if (!id) return;
    startTransition(async () => {
      setError(null);
      await loadAccounts();
      const res = await fetch(
        `/api/finance/reports?kind=account-card&accountId=${encodeURIComponent(id)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία καρτέλας");
        setCard(null);
        return;
      }
      setCard({
        account: data.account,
        movements: (data.movements ?? []).map(
          (m: CardMovement & { entryDate: string | Date }) => ({
            ...m,
            entryDate:
              typeof m.entryDate === "string"
                ? m.entryDate
                : new Date(m.entryDate).toISOString(),
          }),
        ),
        totals: data.totals,
      });
    });
  };

  const journalAction = (
    id: string,
    action: "post" | "void" | "reverse",
  ) => {
    startTransition(async () => {
      setError(null);
      setMessage(null);
      const res = await fetch(`/api/finance/journals/${id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Αποτυχία ενέργειας");
        return;
      }
      setMessage(
        action === "post"
          ? "Άρθρο οριστικοποιήθηκε"
          : action === "void"
            ? "Άρθρο ακυρώθηκε"
            : `Αντιστροφή ${data.item?.number ?? ""}`,
      );
      await refreshJournals(action === "reverse" ? data.item?.id : id);
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

      <div className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-1 block font-medium">Καρτέλα λογαριασμού</span>
            <select
              value={cardAccountId}
              onChange={(e) => setCardAccountId(e.target.value)}
              onFocus={() => void loadAccounts()}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
            >
              <option value="">— Επίλεξε λογαριασμό —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            disabled={!cardAccountId || pending}
            onClick={() => loadCard()}
          >
            Εμφάνιση
          </Button>
        </div>
        {card ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <p className="font-medium">
                <span className="font-mono text-teal-800">{card.account.code}</span>{" "}
                {card.account.name}
              </p>
              <p className="tabular-nums text-slate-600">
                Υπόλοιπο {formatEUR(card.totals.balance)}
              </p>
            </div>
            <div className="max-h-64 overflow-auto rounded-xl border border-slate-100">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Ημ/νία</th>
                    <th className="px-3 py-2 text-left">Άρθρο</th>
                    <th className="px-3 py-2 text-right">Χρέωση</th>
                    <th className="px-3 py-2 text-right">Πίστωση</th>
                    <th className="px-3 py-2 text-right">Υπόλοιπο</th>
                  </tr>
                </thead>
                <tbody>
                  {card.movements.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="px-3 py-6 text-center text-slate-400"
                      >
                        Καμία κίνηση
                      </td>
                    </tr>
                  ) : (
                    card.movements.map((m, i) => (
                      <tr key={`${m.journalId}-${i}`} className="border-t border-slate-50">
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {new Date(m.entryDate).toLocaleDateString("el-GR")}
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="font-mono text-xs text-teal-800">
                            {m.number}
                          </span>
                          {m.description || m.memo ? (
                            <span className="ml-1 text-slate-500">
                              {m.description || m.memo}
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {m.debit ? formatEUR(m.debit) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {m.credit ? formatEUR(m.credit) : "—"}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {formatEUR(m.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>

      {showForm ? (
        <form
          onSubmit={postManual}
          className="space-y-3 rounded-2xl border border-teal-100 bg-teal-50/30 p-4"
        >
          <p className="text-sm font-medium text-ink-900">
            Πολυγραμμικό άρθρο (ισοσκελισμένο)
          </p>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Περιγραφή</span>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="h-10 w-full rounded-xl border border-slate-200 px-3"
              placeholder="π.χ. τακτοποίηση / κατανομή"
            />
          </label>

          <div className="overflow-x-auto rounded-xl border border-slate-100">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2 text-left">Λογαριασμός</th>
                  <th className="px-2 py-2 text-right w-28">Χρέωση</th>
                  <th className="px-2 py-2 text-right w-28">Πίστωση</th>
                  <th className="px-2 py-2 text-left">Σημείωση</th>
                  <th className="px-2 py-2 w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.key} className="border-t border-slate-50">
                    <td className="px-2 py-1.5">
                      <select
                        required
                        value={line.glAccountId}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? { ...l, glAccountId: e.target.value }
                                : l,
                            ),
                          )
                        }
                        className="h-9 w-full min-w-[180px] rounded-lg border border-slate-200 px-2"
                      >
                        <option value="">—</option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.code} · {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.debit}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    debit: e.target.value,
                                    credit: e.target.value ? "" : l.credit,
                                  }
                                : l,
                            ),
                          )
                        }
                        className="h-9 w-full rounded-lg border border-slate-200 px-2 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.credit}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? {
                                    ...l,
                                    credit: e.target.value,
                                    debit: e.target.value ? "" : l.debit,
                                  }
                                : l,
                            ),
                          )
                        }
                        className="h-9 w-full rounded-lg border border-slate-200 px-2 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={line.memo}
                        onChange={(e) =>
                          setLines((prev) =>
                            prev.map((l, i) =>
                              i === idx ? { ...l, memo: e.target.value } : l,
                            ),
                          )
                        }
                        className="h-9 w-full rounded-lg border border-slate-200 px-2"
                      />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {lines.length > 2 ? (
                        <button
                          type="button"
                          className="text-xs text-rose-600"
                          onClick={() =>
                            setLines((prev) => prev.filter((_, i) => i !== idx))
                          }
                        >
                          ✕
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-slate-200 bg-slate-50/80 font-medium">
                  <td className="px-2 py-2">Σύνολα</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatEUR(totals.debit)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatEUR(totals.credit)}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-500" colSpan={2}>
                    {Math.abs(totals.diff) < 0.001
                      ? "Ισοσκελισμένο"
                      : `Διαφορά ${formatEUR(Math.abs(totals.diff))}`}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setLines((prev) => [...prev, newLine()])}
            >
              + Γραμμή
            </Button>
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

      <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100">
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
                    {` · ${j.lines.length} γραμμές`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    tone={
                      j.status === "POSTED"
                        ? "teal"
                        : j.status === "VOID"
                          ? "rose"
                          : "slate"
                    }
                  >
                    {j.status}
                  </Badge>
                  <span className="tabular-nums text-sm font-medium">
                    {formatEUR(debit)}
                  </span>
                </div>
              </button>
              {open ? (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-3">
                  {showActions && canWrite ? (
                    <div className="mb-3 flex flex-wrap gap-2">
                      {j.status === "DRAFT" ? (
                        <>
                          <Button
                            size="sm"
                            disabled={pending}
                            onClick={() => journalAction(j.id, "post")}
                          >
                            Post
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => journalAction(j.id, "void")}
                          >
                            Void
                          </Button>
                        </>
                      ) : null}
                      {j.status === "POSTED" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={pending}
                          onClick={() => journalAction(j.id, "reverse")}
                        >
                          Αντιστροφή
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
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
                            <button
                              type="button"
                              className="text-left"
                              onClick={() => {
                                void loadAccounts().then((list) => {
                                  const acc = list.find(
                                    (a) => a.code === l.accountCode,
                                  );
                                  if (acc) {
                                    setCardAccountId(acc.id);
                                    loadCard(acc.id);
                                  }
                                });
                              }}
                            >
                              <span className="font-mono text-teal-800 hover:underline">
                                {l.accountCode}
                              </span>{" "}
                              {l.accountName}
                            </button>
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
