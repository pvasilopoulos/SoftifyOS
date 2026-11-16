'use client';
import { useTabTitle } from '@/components/tabs';
import { use, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  ArrowLeft, Check, CheckCircle2, Clock, Copy, ExternalLink, FilePlus2, Link2, Loader2, MapPin, Printer, Send, ShieldCheck, X, XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import type { OfferDetail } from '@/lib/offers';
import { Link, useRouter } from '@/i18n/navigation';
import { Avatar, IconButton, Skeleton, StatusBadge, Tabs } from '@/components/ui';
import { useToast } from '@/components/providers';

// Stepper position: 0 created, 1 approval, 2 send, 3 customer response, 4 all done
const stepIndex: Record<string, number> = { draft: 0, in_progress: 0, pending_approval: 1, approved: 2, sent: 3, accepted: 4, rejected: 3 };

export default function OfferPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('offers');
  const tr = useTranslations('role');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const [tab, setTab] = useState<'summary' | 'items' | 'versions' | 'approvals'>('summary');
  const [viewVersion, setViewVersion] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [sending, setSending] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['offer', id, viewVersion],
    queryFn: () => api<OfferDetail>(`/offers/${id}${viewVersion ? `?version=${viewVersion}` : ''}`),
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['offer', id] }); qc.invalidateQueries({ queryKey: ['offers'] }); };
  const onError = (e: unknown) => toast({ title: e instanceof ApiError ? e.code : 'error' });
  const submit = useMutation({ mutationFn: () => api(`/offers/${id}/submit`, { method: 'POST' }), onSuccess: refresh, onError });
  const decide = useMutation({
    mutationFn: (b: { decision: 'approve' | 'reject'; comment?: string }) => api(`/offers/${id}/decision`, { method: 'POST', json: b }),
    onSuccess: () => { setRejecting(false); refresh(); }, onError,
  });

  useTabTitle(data ? `${data.offer.number}${data.offer.customer_name ? ` · ${data.offer.customer_name}` : ''}` : null);
  if (isLoading || !data) return <div className="space-y-4"><Skeleton className="h-10 w-48" /><Skeleton className="h-56" /><Skeleton className="h-40" /></div>;
  const o = data.offer;
  const current = stepIndex[o.status] ?? 0;
  const steps = [t('steps.created'), t('steps.approval'), t('steps.sent'), t('steps.accepted')];
  const isOld = data.version !== o.current_version;
  const shownVersion = data.versions.find((v) => v.version === data.version);
  const pendingStep = data.approvals.find((a) => a.status === 'pending');

  return (
    <div className="space-y-4 pb-28">
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.push('/offers')}><ArrowLeft size={22} /></IconButton>
        <span className="flex-1 truncate text-lg font-semibold">{o.number} <span className="text-muted">v.{String(o.current_version).padStart(2, '0')}</span></span>
        <Link href={`/print/offers/${id}${isOld ? `?version=${data.version}` : ''}`} aria-label={t('print')} className="grid h-10 w-10 place-items-center rounded-full hover:bg-surface-2"><Printer size={20} /></Link>
      </header>

      {/* Hero */}
      <section className="card p-5">
        <div className="flex items-center justify-between gap-2">
          <StatusBadge status={o.status} />
          {data.versions.length > 1 && (
            <select aria-label={t('version')} value={data.version} onChange={(e) => setViewVersion(Number(e.target.value) === o.current_version ? null : Number(e.target.value))}
              className="rounded-full bg-primary-soft px-3 py-1 text-sm font-semibold text-primary outline-none">
              {data.versions.map((v) => <option key={v.version} value={v.version}>v.{String(v.version).padStart(2, '0')}{v.version === o.current_version ? ` (${t('current')})` : ''}</option>)}
            </select>
          )}
        </div>
        <Link href={`/customers/${o.customer_id}`} className="mt-3 block text-xl font-bold hover:text-primary">{o.customer_name}</Link>
        {(o.branch_name || o.space_name) && <div className="text-sm text-muted">{[o.branch_name, o.space_name].filter(Boolean).join(' · ')}</div>}
        <div className="mt-3 flex items-end justify-between gap-4">
          <div className="tabular text-3xl font-bold">{money(shownVersion?.total_amount ?? o.total_amount, locale)}</div>
          {o.valid_until && <div className="text-right text-sm text-muted">{t('validUntil')}<br /><span className="text-text">{date(o.valid_until, locale)}</span></div>}
        </div>
        <ol className="mt-6 grid grid-cols-4">
          {steps.map((s, i) => {
            const failed = o.status === 'rejected' && i === 3;
            return (
              <li key={s} className="relative flex flex-col items-center gap-1.5 text-center text-xs">
                {i > 0 && <span className={clsx('absolute right-1/2 top-3 h-0.5 w-full', i <= current ? 'bg-primary' : 'bg-border')} />}
                <span className={clsx('relative z-10 grid h-6 w-6 place-items-center rounded-full border-2',
                  failed ? 'border-danger bg-danger text-white'
                    : i < current ? 'border-success bg-success text-white'
                    : i === current ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface')}>
                  {failed ? <X size={14} /> : i < current ? <Check size={14} /> : i === current ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                </span>
                <span className={clsx(i === current ? 'font-semibold text-text' : 'text-muted')}>{s}</span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Waiting for my approval */}
      {data.can.approve && pendingStep && (
        <section className="card border-warning/40 bg-warning-soft/40 p-4">
          <div className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} className="text-warning" /> {t('pendingYou')}</div>
          <div className="mt-0.5 text-sm text-muted">{pendingStep.title}</div>
          {rejecting ? (
            <RejectForm busy={decide.isPending} onCancel={() => setRejecting(false)} onSubmit={(c) => decide.mutate({ decision: 'reject', comment: c })} />
          ) : (
            <div className="mt-3 flex gap-2">
              <button onClick={() => setRejecting(true)} className="flex-1 rounded-xl border border-border bg-surface py-2.5 font-semibold text-danger">{t('reject')}</button>
              <button onClick={() => decide.mutate({ decision: 'approve' })} disabled={decide.isPending}
                className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-success py-2.5 font-semibold text-white disabled:opacity-60">
                {decide.isPending ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} {t('approveStep')}
              </button>
            </div>
          )}
        </section>
      )}

      <Tabs value={tab} onChange={setTab} options={[
        { value: 'summary', label: t('summary') }, { value: 'items', label: `${t('items')} (${data.items.length})` },
        { value: 'versions', label: `${t('versions')} (${data.versions.length})` }, { value: 'approvals', label: t('approvals') },
      ]} />

      {tab === 'summary' && (
        // min-w-0 on grid children: a long customer URL must truncate, not widen the column
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <section className="card p-4">
            <dl className="space-y-2.5 text-sm">
              <Row k={t('net')} v={money(shownVersion?.net_amount ?? o.net_amount, locale)} />
              <Row k={t('vat')} v={money(shownVersion?.vat_amount ?? o.vat_amount, locale)} />
              <div className="flex justify-between border-t border-border pt-2.5 text-base font-bold"><dt>{t('total')}</dt><dd className="tabular">{money(shownVersion?.total_amount ?? o.total_amount, locale)}</dd></div>
              {o.owner_name && <Row k={t('owner')} v={<span className="flex items-center gap-2"><Avatar name={o.owner_name} size={20} />{o.owner_name}</span>} />}
              {o.company_name && <Row k={t('company')} v={o.company_name} />}
              {o.sent_at && <Row k={t('sentTo')} v={`${relative(o.sent_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}${o.sent_to ? ` · ${o.sent_to}` : ''}`} />}
              {o.responder_name && <Row k={t('respondedBy')} v={`${o.responder_name}${o.response_note ? ` · ${o.response_note}` : ''}`} />}
            </dl>
          </section>
          <div className="space-y-4">
            {data.publicUrl && <PublicLink url={data.publicUrl} />}
            {o.notes && <section className="card p-4 text-sm"><div className="mb-1 font-semibold">{t('notes')}</div><p className="whitespace-pre-line text-muted">{o.notes}</p></section>}
          </div>
        </div>
      )}

      {tab === 'items' && (
        <section className="card divide-y divide-border">
          {isOld && <div className="bg-warning-soft px-4 py-2 text-sm text-warning">{t('version')} v.{String(data.version).padStart(2, '0')}</div>}
          {data.items.length === 0 ? <p className="p-6 text-center text-muted">{t('noItems')}</p> : data.items.map((i) => (
            <div key={i.id} className="flex items-start gap-3 p-4">
              <span className="w-5 pt-0.5 text-xs font-semibold text-muted">{i.position}</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{i.description}</div>
                {i.space_name && <div className="mt-0.5 inline-flex items-center gap-1 rounded-md bg-primary-soft px-1.5 py-0.5 text-xs font-medium text-primary"><MapPin size={12} /> {i.space_name}</div>}
                <div className="tabular text-sm text-muted">
                  {Number(i.quantity).toLocaleString(locale)} {i.unit} × {money(i.unit_price, locale)}{Number(i.discount) > 0 && ` · −${Number(i.discount)}%`} · {t('vat')} {Number(i.vat_rate)}%
                </div>
              </div>
              <span className="tabular font-semibold">{money(i.net_amount, locale)}</span>
            </div>
          ))}
        </section>
      )}

      {tab === 'versions' && (
        <ul className="space-y-2">
          {data.versions.map((v) => (
            <li key={v.version}>
              <button onClick={() => { setViewVersion(v.version === o.current_version ? null : v.version); setTab('items'); }}
                className={clsx('card flex w-full items-center gap-3 p-4 text-left', v.version === data.version && 'border-primary')}>
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-sm font-bold text-primary">v.{String(v.version).padStart(2, '0')}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{v.version === o.current_version ? t('current') : `${t('version')} ${v.version}`}</div>
                  <div className="truncate text-sm text-muted">{relative(v.created_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}{v.created_by_name && ` · ${v.created_by_name}`}{v.note && ` · ${v.note}`}</div>
                </div>
                <span className="tabular font-semibold">{money(v.total_amount, locale)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === 'approvals' && (
        <section className="card p-4">
          {data.approvals.length === 0 ? <p className="text-sm text-muted">—</p> : (
            <ul className="space-y-2">
              {data.approvals.map((a) => (
                <li key={a.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                  {a.status === 'approved' ? <CheckCircle2 className="shrink-0 text-success" size={22} />
                    : a.status === 'rejected' ? <XCircle className="shrink-0 text-danger" size={22} />
                    : <Clock className="shrink-0 text-warning" size={22} />}
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.step}. {a.title}</div>
                    <div className="text-xs text-muted">
                      {a.approver_name ? `${a.approver_name}${a.decided_at ? ` · ${relative(a.decided_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}` : ''}` : t('waitingRole', { role: tr(a.required_role as never) })}
                    </div>
                    {a.comment && <div className="mt-1 text-sm">“{a.comment}”</div>}
                  </div>
                  <StatusBadge status={a.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Action bar */}
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 px-4 lg:static lg:px-0">
        <div className="card mx-auto flex max-w-6xl gap-2 p-2">
          {data.can.edit && (
            <Link href={`/offers/${id}/edit`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold">
              <FilePlus2 size={18} /> {t('edit')}
            </Link>
          )}
          {data.can.submit && (
            <button onClick={() => submit.mutate()} disabled={submit.isPending}
              className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white disabled:opacity-60">
              {submit.isPending ? <Loader2 size={18} className="animate-spin" /> : <ShieldCheck size={18} />} {t('submit')}
            </button>
          )}
          {data.can.send && (
            <button onClick={() => setSending(true)} className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white">
              <Send size={18} /> {o.status === 'sent' ? t('resend') : t('send')}
            </button>
          )}
          {!data.can.edit && !data.can.submit && !data.can.send && (
            <Link href={`/print/offers/${id}`} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border py-3 text-sm font-semibold">
              <Printer size={18} /> {t('print')}
            </Link>
          )}
        </div>
      </div>

      {sending && <SendDialog offerId={id} onClose={() => setSending(false)} onSent={refresh} />}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="tabular text-right">{v}</dd></div>;
}

function RejectForm({ onSubmit, onCancel, busy }: { onSubmit: (c: string) => void; onCancel: () => void; busy: boolean }) {
  const t = useTranslations('offers');
  const [c, setC] = useState('');
  return (
    <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); onSubmit(c); }}>
      <input autoFocus value={c} onChange={(e) => setC(e.target.value)} placeholder={t('rejectReason')}
        className="w-full rounded-xl border border-border bg-surface px-3 py-2.5 outline-none focus:border-primary" />
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-border bg-surface py-2.5">✕</button>
        <button disabled={busy} className="flex-[2] rounded-xl bg-danger py-2.5 font-semibold text-white disabled:opacity-60">{t('reject')}</button>
      </div>
    </form>
  );
}

function PublicLink({ url }: { url: string }) {
  const t = useTranslations('offers');
  const [copied, setCopied] = useState(false);
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Link2 size={16} /> {t('publicLink')}</div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-2 text-xs">{url}</code>
        <button onClick={async () => { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
          className="flex items-center gap-1.5 rounded-lg bg-primary-soft px-3 py-2 text-sm font-semibold text-primary">
          <Copy size={15} /> {copied ? t('copied') : t('copy')}
        </button>
        <a href={url} target="_blank" rel="noopener" aria-label="open" className="grid h-9 w-9 place-items-center rounded-lg border border-border"><ExternalLink size={15} /></a>
      </div>
    </section>
  );
}

function SendDialog({ offerId, onClose, onSent }: { offerId: string; onClose: () => void; onSent: () => void }) {
  const t = useTranslations('offers');
  const locale = useLocale();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ url: string } | null>(null);
  const send = useMutation({
    mutationFn: () => api<{ url: string }>(`/offers/${offerId}/send`, { method: 'POST', json: { email: email || null, message: message || null, locale } }),
    onSuccess: (r) => { setResult(r); onSent(); },
  });
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-t-3xl bg-surface p-6 sheet-pb sm:rounded-3xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold">{t('sendTitle')}</h2>
          <IconButton label="close" onClick={onClose}><X size={20} /></IconButton>
        </div>
        {result ? <PublicLink url={result.url} /> : (
          <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="space-y-3">
            <p className="text-sm text-muted">{t('sendHint')}</p>
            <input type="email" placeholder={t('customerEmail')} value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary" />
            <textarea rows={3} placeholder={t('message')} value={message} onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-xl border border-border bg-surface-2 px-3.5 py-3 outline-none focus:border-primary" />
            <button disabled={send.isPending} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-60">
              {send.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {t('send')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
