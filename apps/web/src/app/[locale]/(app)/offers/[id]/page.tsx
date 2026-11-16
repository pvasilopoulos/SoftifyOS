'use client';
import { use, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { ArrowLeft, Check, CheckCircle2, Clock, FileText, MoreHorizontal, PenLine } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { date, money } from '@/lib/format';
import { useRouter } from '@/i18n/navigation';
import { Avatar, IconButton, Skeleton, StatusBadge, Tabs } from '@/components/ui';
import { useToast } from '@/components/providers';

type Detail = {
  offer: {
    id: string; number: string; status: string; current_version: number; net_amount: string; vat_amount: string; total_amount: string;
    valid_until: string | null; customer_name: string; branch_name: string | null; company_name: string | null; owner_name: string | null;
  };
  approvals: { id: string; step: number; title: string; status: string; approver_name: string | null }[];
};

const stepIndex: Record<string, number> = { draft: 0, in_progress: 0, pending_approval: 1, approved: 2, sent: 2, accepted: 3, rejected: 3 };

export default function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('offers');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'summary' | 'items' | 'versions' | 'approvals'>('summary');
  const { data, isLoading } = useQuery({ queryKey: ['offer', id], queryFn: () => api<Detail>(`/offers/${id}`) });
  const approve = useMutation({
    mutationFn: () => api(`/offers/${id}/approve`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['offer', id] }),
    onError: (e) => toast({ title: e instanceof ApiError ? e.code : 'error' }),
  });

  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-56" /></div>;
  const o = data.offer;
  const current = stepIndex[o.status] ?? 0;
  const steps = [t('steps.created'), t('steps.approval'), t('steps.sent'), t('steps.accepted')];
  const hasPending = data.approvals.some((a) => a.status === 'pending');

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.back()}><ArrowLeft size={22} /></IconButton>
        <span className="flex-1 text-lg font-semibold">{o.number} <span className="text-muted">v.{String(o.current_version).padStart(2, '0')}</span></span>
        <IconButton label="more"><MoreHorizontal size={20} /></IconButton>
      </header>

      <section className="card p-5">
        <StatusBadge status={o.status} />
        <h1 className="mt-3 text-xl font-bold">{o.customer_name}</h1>
        {o.branch_name && <div className="text-sm text-muted">{o.branch_name}</div>}
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="tabular text-3xl font-bold">{money(o.total_amount, locale)}</div>
          {o.valid_until && <div className="text-right text-sm text-muted">{t('validUntil')}<br /><span className="text-text">{date(o.valid_until, locale)}</span></div>}
        </div>
        <ol className="mt-6 grid grid-cols-4">
          {steps.map((s, i) => (
            <li key={s} className="relative flex flex-col items-center gap-1.5 text-center text-xs">
              {i > 0 && <span className={clsx('absolute right-1/2 top-3 h-0.5 w-full', i <= current ? 'bg-primary' : 'bg-border')} />}
              <span className={clsx('relative z-10 grid h-6 w-6 place-items-center rounded-full border-2',
                i < current ? 'border-success bg-success text-white' : i === current ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface')}>
                {i < current ? <Check size={14} /> : i === current ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
              </span>
              <span className={clsx(i === current ? 'font-semibold text-text' : 'text-muted')}>{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <Tabs value={tab} onChange={setTab} options={[
        { value: 'summary', label: t('summary') }, { value: 'items', label: t('items') },
        { value: 'versions', label: t('versions') }, { value: 'approvals', label: t('approvals') },
      ]} />

      <section className="card p-4">
        <dl className="space-y-2.5 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{t('net')}</dt><dd className="tabular">{money(o.net_amount, locale)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">{t('vat')}</dt><dd className="tabular">{money(o.vat_amount, locale)}</dd></div>
          <div className="flex justify-between border-t border-border pt-2.5 text-base font-bold"><dt>{t('total')}</dt><dd className="tabular">{money(o.total_amount, locale)}</dd></div>
          {o.owner_name && <div className="flex justify-between pt-2"><dt className="text-muted">{t('owner')}</dt><dd className="flex items-center gap-2"><Avatar name={o.owner_name} size={20} />{o.owner_name}</dd></div>}
          {o.company_name && <div className="flex justify-between"><dt className="text-muted">{t('company')}</dt><dd>{o.company_name}</dd></div>}
        </dl>
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">{t('approvals')}</h2>
        <ul className="space-y-2">
          {data.approvals.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
              <Avatar name={a.approver_name} size={32} />
              <div className="flex-1">
                <div className="font-medium">{a.title}</div>
                <div className="text-xs text-muted">{a.approver_name}</div>
              </div>
              {a.status === 'approved' ? <CheckCircle2 className="text-success" size={20} /> : <Clock className="text-warning" size={20} />}
            </li>
          ))}
        </ul>
      </section>

      <div className="sticky bottom-24 flex gap-2 lg:bottom-4">
        <button className="card flex flex-1 items-center justify-center gap-2 py-3 font-semibold"><FileText size={18} /> {t('pdf')}</button>
        {hasPending && (
          <button onClick={() => approve.mutate()} disabled={approve.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-[18px] bg-primary py-3 font-semibold text-white shadow-lg shadow-primary/30 disabled:opacity-60">
            <PenLine size={18} /> {t('approve')}
          </button>
        )}
      </div>
    </div>
  );
}
