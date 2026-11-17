'use client';
// Offer ↔ customer by email: the send dialog (organisation template, editable), the engagement card
// (link opened, emails sent and opened) and the signature pad used on the public offer page.
import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, BellRing, CheckCheck, Eraser, Eye, Loader2, Mail, MailCheck, MailX, Send, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { relative } from '@/lib/format';
import { IconButton } from './ui';
import { Link } from '@/i18n/navigation';

type Draft = { to: string | null; subject: string; body: string; track: boolean; own_smtp: boolean; can_send: boolean };
export type EmailRow = {
  id: string; kind: string; to_addr: string; subject: string; status: 'queued' | 'sent' | 'failed' | 'logged'; error: string | null;
  open_count: number; opened_at: string | null; last_open_at: string | null; created_at: string; sent_at: string | null; user_name: string | null;
};

const field = 'w-full rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 outline-none focus:border-primary';

export function SendDialog({ offerId, reminder, onClose, onSent, onLink }: {
  offerId: string; reminder?: boolean; onClose: () => void; onSent: () => void; onLink: (url: string) => void;
}) {
  const t = useTranslations('offers');
  const te = useTranslations('email');
  const appLocale = useLocale();
  const [locale, setLocale] = useState<'el' | 'en'>(appLocale === 'en' ? 'en' : 'el');
  const [tpl, setTpl] = useState<'offer_send' | 'offer_reminder'>(reminder ? 'offer_reminder' : 'offer_send');
  const [form, setForm] = useState<{ to: string; cc: string; subject: string; body: string } | null>(null);
  const [showCc, setShowCc] = useState(false);
  const qc = useQueryClient();
  const draft = useQuery({
    queryKey: ['email-draft', offerId, locale, tpl],
    queryFn: () => api<Draft>(`/offers/${offerId}/email-draft?locale=${locale}&template=${tpl}`),
  });
  // Template/language change refills subject and text, keeps the recipients
  useEffect(() => {
    if (draft.data) setForm((f) => ({ to: f?.to || draft.data.to || '', cc: f?.cc ?? '', subject: draft.data.subject, body: draft.data.body }));
  }, [draft.data]);
  const send = useMutation({
    mutationFn: (withEmail: boolean) => api<{ url: string; emailed: boolean }>(`/offers/${offerId}/send`, {
      method: 'POST',
      json: withEmail && form
        ? { email: form.to.trim(), cc: form.cc.trim() || null, subject: form.subject, message: form.body, template: tpl, locale }
        : { locale },
    }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ['emails', offerId] }); onSent(); onLink(r.url); onClose(); },
  });
  const err = send.error instanceof ApiError ? send.error.code : send.error ? 'error' : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-3xl bg-surface sheet-pb sm:rounded-3xl">
        <div className="flex items-center justify-between gap-2 px-5 pb-2 pt-5 sm:px-6">
          <h2 className="text-lg font-bold">{tpl === 'offer_reminder' ? te('reminderTitle') : t('sendTitle')}</h2>
          <IconButton label="close" onClick={onClose}><X size={20} /></IconButton>
        </div>
        {!form ? <Loader2 className="mx-auto my-10 animate-spin text-muted" /> : (
          <form onSubmit={(e) => { e.preventDefault(); send.mutate(true); }} className="min-h-0 space-y-3 overflow-y-auto px-5 pb-5 sm:px-6">
            <div className="flex flex-wrap gap-2">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
                {(['offer_send', 'offer_reminder'] as const).map((k) => (
                  <button key={k} type="button" onClick={() => setTpl(k)} aria-pressed={tpl === k}
                    className={clsx('rounded-lg px-2.5 py-1 font-medium', tpl === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{te(`tpl_${k}`)}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1 text-sm">
                {(['el', 'en'] as const).map((l) => (
                  <button key={l} type="button" onClick={() => setLocale(l)} aria-pressed={locale === l}
                    className={clsx('rounded-lg px-2.5 py-1 font-medium uppercase', locale === l ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{l}</button>
                ))}
              </div>
            </div>
            <label className="block text-sm">
              <span className="mb-1 flex items-center justify-between text-muted">{te('to')}
                {!showCc && <button type="button" onClick={() => setShowCc(true)} className="text-xs font-medium text-primary">+ Cc</button>}
              </span>
              <input type="email" required value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder={t('customerEmail')} className={field} />
            </label>
            {showCc && (
              <label className="block text-sm"><span className="mb-1 block text-muted">Cc</span>
                <input type="email" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} className={field} />
              </label>
            )}
            <label className="block text-sm"><span className="mb-1 block text-muted">{te('subject')}</span>
              <input required maxLength={300} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className={field} />
            </label>
            <label className="block text-sm"><span className="mb-1 block text-muted">{te('body')}</span>
              <textarea rows={8} required maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className={`${field} leading-relaxed`} />
              <span className="mt-1 block text-xs text-muted">{te('bodyHint')}</span>
            </label>
            {!draft.data?.can_send && (
              <p className="flex items-start gap-2 rounded-xl bg-warning-soft p-3 text-xs text-warning">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>{te('noSmtp')} <Link href="/settings?s=email" className="font-semibold underline">{te('setup')}</Link></span>
              </p>
            )}
            {err && <p className="text-sm text-danger">{te.has(`err_${err}` as never) ? te(`err_${err}` as never) : err}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              {tpl === 'offer_send' && (
                <button type="button" disabled={send.isPending} onClick={() => send.mutate(false)} className="rounded-xl border border-border px-3 py-3 text-sm font-medium disabled:opacity-60">
                  {te('linkOnly')}
                </button>
              )}
              <button disabled={send.isPending} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-white disabled:opacity-60">
                {send.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />} {te('sendEmail')}
              </button>
            </div>
            {draft.data?.track && <p className="text-center text-xs text-muted">{te('trackNote')}</p>}
          </form>
        )}
      </div>
    </div>
  );
}

/** Did the customer open the email / the offer? */
export function EngagementCard({ offerId, viewedAt, lastViewedAt, viewCount, canRemind, onRemind }: {
  offerId: string; viewedAt: string | null; lastViewedAt: string | null; viewCount: number; canRemind: boolean; onRemind: () => void;
}) {
  const te = useTranslations('email');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const rel = (d: string) => relative(d, locale, { today: ta('today'), yesterday: ta('yesterday') });
  const q = useQuery({ queryKey: ['emails', offerId], queryFn: () => api<EmailRow[]>(`/emails?offer_id=${offerId}`), refetchInterval: (x) => (x.state.data?.some((m) => m.status === 'queued') ? 4000 : false) });
  const rows = q.data ?? [];
  if (!rows.length && !viewedAt) return null;
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Mail size={16} /> {te('engagement')}</div>
      <div className={clsx('mb-3 flex items-center gap-3 rounded-xl p-3 text-sm', viewedAt ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted')}>
        <Eye size={18} className="shrink-0" />
        <span className="min-w-0 flex-1">
          {viewedAt
            ? <>{te('viewed', { count: viewCount })} <span className="block text-xs opacity-80">{te('firstLast', { first: rel(viewedAt), last: rel(lastViewedAt ?? viewedAt) })}</span></>
            : te('notViewed')}
        </span>
        {canRemind && (
          <button type="button" onClick={onRemind} className="flex shrink-0 items-center gap-1.5 rounded-lg bg-surface px-2.5 py-1.5 text-xs font-semibold text-primary shadow-sm">
            <BellRing size={14} /> {te('remind')}
          </button>
        )}
      </div>
      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map((m) => {
            const Icon = m.status === 'failed' ? MailX : m.opened_at ? CheckCheck : m.status === 'queued' ? Loader2 : MailCheck;
            return (
              <li key={m.id} className="flex items-start gap-3 py-2.5 text-sm">
                <Icon size={17} className={clsx('mt-0.5 shrink-0', m.status === 'failed' ? 'text-danger' : m.opened_at ? 'text-success' : 'text-muted', m.status === 'queued' && 'animate-spin')} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{m.subject}</div>
                  <div className="truncate text-xs text-muted">{m.to_addr} · {rel(m.created_at)}{m.user_name && ` · ${m.user_name}`}</div>
                  <div className={clsx('text-xs', m.status === 'failed' ? 'text-danger' : m.opened_at ? 'text-success' : 'text-muted')}>
                    {m.status === 'failed' ? `${te('st_failed')}${m.error ? `: ${m.error}` : ''}`
                      : m.opened_at ? te('opened', { count: m.open_count, when: rel(m.last_open_at ?? m.opened_at) })
                      : te(`st_${m.status}`)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Finger / mouse signature → PNG data URL (white background, so it prints). */
export function SignaturePad({ onChange, clearLabel, hint }: { onChange: (dataUrl: string | null) => void; clearLabel: string; hint: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    const c = ref.current!;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    c.width = c.offsetWidth * ratio; c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#17142b';
  }, []);
  const pos = (e: React.PointerEvent) => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] as const; };
  const down = (e: React.PointerEvent) => {
    e.preventDefault(); ref.current!.setPointerCapture(e.pointerId); drawing.current = true;
    const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 0.1, y + 0.1); ctx.stroke();
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); dirty.current = true;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) { setEmpty(false); onChange(ref.current!.toDataURL('image/png')); }
  };
  const clear = () => {
    const c = ref.current!; const ctx = c.getContext('2d')!;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height); ctx.restore();
    dirty.current = false; setEmpty(true); onChange(null);
  };
  return (
    <div>
      <div className="relative">
        <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          className="block h-36 w-full touch-none rounded-xl border border-dashed border-[#c9c4e6] bg-white" aria-label={hint} />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-[#8a879c]">{hint}</span>}
      </div>
      <button type="button" onClick={clear} className="mt-1 flex items-center gap-1 text-xs font-medium text-[#6b6880]"><Eraser size={13} /> {clearLabel}</button>
    </div>
  );
}
