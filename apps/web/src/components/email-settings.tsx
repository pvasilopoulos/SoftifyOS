'use client';
// Settings → Email: sender name, where replies go, signature, open tracking, templates (el/en) and
// the organisation's own SMTP server (password stored encrypted on the server, never sent back).
import { useEffect, useState } from 'react';
import clsx from 'clsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Check, Loader2, Pencil, PlugZap, RotateCcw, Server, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { appConfirm } from './confirm';
import { Card } from './settings-sections';
import { useToast } from './providers';

type TplKey = 'offer_send' | 'offer_reminder';
type Tpl = { subject: string; body: string };
type Settings = {
  from_name?: string | null; reply_to_owner: boolean; reply_to?: string | null; bcc_sender: boolean; signature?: string | null;
  track_opens: boolean; notify_view: boolean; templates: Partial<Record<TplKey, { el?: Tpl; en?: Tpl }>>;
};
type Smtp = { host: string; port: number; secure: boolean; user: string | null; from: string; has_password: boolean; set_at: string };
type Data = {
  settings: Settings; defaults: Record<TplKey, { el: Tpl; en: Tpl }>; template_keys: TplKey[];
  smtp: Smtp | null; server_smtp: { host: string; from: string } | null;
  stats: { sent: number; opened: number; failed: number };
};

const input = 'w-full rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';
const btn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium disabled:opacity-50';

export function EmailSettingsSection() {
  const t = useTranslations('email');
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'email'], queryFn: () => api<Data>('/settings/email') });
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (q.data) setS(q.data.settings); }, [q.data]);
  if (q.isError) return <p className="text-sm text-muted">{t('noAccess')}</p>;
  if (!q.data || !s) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const d = q.data;
  const save = async () => {
    setBusy(true);
    try { await api('/settings/email', { method: 'PUT', json: s }); toast({ title: t('saved') }); qc.invalidateQueries({ queryKey: ['settings', 'email'] }); }
    catch { toast({ title: t('saveError') }); }
    setBusy(false);
  };
  const pct = (n: number) => (d.stats.sent ? Math.round((n / d.stats.sent) * 100) : 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {([['sent', d.stats.sent, null], ['opened', d.stats.opened, pct(d.stats.opened)], ['failed', d.stats.failed, null]] as const).map(([k, v, p]) => (
          <div key={k} className="card p-3">
            <div className="text-xs text-muted">{t(`stat_${k}`)}</div>
            <div className="tabular text-xl font-bold">{v}{p !== null && <span className="ml-1 text-sm font-medium text-muted">{p}%</span>}</div>
          </div>
        ))}
      </div>

      <SmtpCard data={d} />

      <Card title={t('senderTitle')} description={t('senderHint')}>
        <div className="space-y-3">
          <label className="block text-sm"><span className="mb-1 block font-medium">{t('fromName')}</span>
            <input value={s.from_name ?? ''} maxLength={100} onChange={(e) => setS({ ...s, from_name: e.target.value || null })} placeholder={t('fromNamePh')} className={input} />
          </label>
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-medium">{t('replies')}</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={s.reply_to_owner} onChange={() => setS({ ...s, reply_to_owner: true })} className="accent-[var(--primary)]" /> {t('replyOwner')}</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!s.reply_to_owner} onChange={() => setS({ ...s, reply_to_owner: false })} className="accent-[var(--primary)]" /> {t('replyFixed')}</label>
            {!s.reply_to_owner && <input type="email" value={s.reply_to ?? ''} onChange={(e) => setS({ ...s, reply_to: e.target.value || null })} placeholder="sales@…" className={input} />}
          </fieldset>
          <label className="block text-sm"><span className="mb-1 block font-medium">{t('signature')}</span>
            <textarea rows={3} maxLength={2000} value={s.signature ?? ''} onChange={(e) => setS({ ...s, signature: e.target.value || null })} placeholder={t('signaturePh')} className={input} />
          </label>
          {([['track_opens', 'track'], ['notify_view', 'notifyView'], ['bcc_sender', 'bccSender']] as const).map(([k, l]) => (
            <label key={k} className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} className="mt-0.5 h-4 w-4 accent-[var(--primary)]" />
              <span><span className="font-medium">{t(l)}</span><span className="block text-xs text-muted">{t(`${l}Hint`)}</span></span>
            </label>
          ))}
        </div>
      </Card>

      <Card title={t('templates')} description={t('templatesHint')}>
        <div className="space-y-4">
          {d.template_keys.map((k) => <TemplateEditor key={k} k={k} s={s} setS={setS} defaults={d.defaults[k]} />)}
        </div>
      </Card>

      <div className="sticky bottom-[calc(72px+env(safe-area-inset-bottom))] flex justify-end lg:bottom-4">
        <button type="button" onClick={save} disabled={busy} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-lg disabled:opacity-60">
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />} {t('save')}
        </button>
      </div>
    </div>
  );
}

function TemplateEditor({ k, s, setS, defaults }: { k: TplKey; s: Settings; setS: (x: Settings) => void; defaults: { el: Tpl; en: Tpl } }) {
  const t = useTranslations('email');
  const appLocale = useLocale();
  const [lang, setLang] = useState<'el' | 'en'>(appLocale === 'en' ? 'en' : 'el');
  const own = s.templates[k]?.[lang];
  const cur = own ?? defaults[lang];
  const set = (v: Tpl | undefined) => setS({ ...s, templates: { ...s.templates, [k]: { ...s.templates[k], [lang]: v } } });
  return (
    <div className="rounded-xl border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="flex-1 text-sm font-semibold">{t(`tpl_${k}`)}{!own && <span className="ml-2 text-xs font-normal text-muted">({t('default')})</span>}</span>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-surface-2 p-0.5 text-xs">
          {(['el', 'en'] as const).map((l) => (
            <button key={l} type="button" onClick={() => setLang(l)} className={clsx('rounded-md px-2 py-1 font-semibold uppercase', lang === l ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>{l}</button>
          ))}
        </div>
        {own && <button type="button" onClick={() => set(undefined)} className="flex items-center gap-1 text-xs font-medium text-muted hover:text-text"><RotateCcw size={12} /> {t('reset')}</button>}
      </div>
      <input value={cur.subject} maxLength={300} onChange={(e) => set({ ...cur, subject: e.target.value })} className={`${input} mb-2 font-medium`} aria-label={t('subject')} />
      <textarea rows={7} maxLength={5000} value={cur.body} onChange={(e) => set({ ...cur, body: e.target.value })} className={`${input} leading-relaxed`} aria-label={t('body')} />
      <p className="mt-1 text-xs text-muted">{t('placeholders')}: {'{customer} {number} {total} {valid_until} {link} {sender} {company}'}</p>
    </div>
  );
}

function SmtpCard({ data }: { data: Data }) {
  const t = useTranslations('email');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const cur = data.smtp;
  const [editing, setEditing] = useState(false);
  const empty = { host: '', port: 587, secure: false, user: '', pass: '', from: '' };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState<'save' | 'test' | 'delete' | null>(null);
  const [test, setTest] = useState<{ ok: boolean; to?: string; error?: string; detail?: string } | null>(null);
  const open = () => { setF(cur ? { host: cur.host, port: cur.port, secure: cur.secure, user: cur.user ?? '', pass: '', from: cur.from } : empty); setTest(null); setEditing(true); };
  const body = () => ({ ...f, user: f.user || null, pass: f.pass || null, keep_password: !!cur?.has_password && !f.pass });
  const refresh = () => qc.invalidateQueries({ queryKey: ['settings', 'email'] });
  const runTest = async (typed: boolean) => {
    setBusy('test'); setTest(null);
    try { setTest(await api('/settings/email/test', { method: 'POST', json: typed ? body() : {} })); } catch { setTest({ ok: false, error: 'api_error' }); }
    setBusy(null);
  };
  const save = async () => {
    setBusy('save');
    try { await api('/settings/email/smtp', { method: 'PUT', json: body() }); toast({ title: t('smtpSaved') }); setEditing(false); refresh(); }
    catch (e) { setTest({ ok: false, error: e instanceof ApiError ? e.code : 'api_error' }); }
    setBusy(null);
  };
  const remove = async () => {
    if (!(await appConfirm(t('smtpConfirmDelete'), { danger: true }))) return;
    setBusy('delete');
    try { await api('/settings/email/smtp', { method: 'DELETE' }); toast({ title: t('smtpDeleted') }); refresh(); } catch { toast({ title: t('saveError') }); }
    setBusy(null);
  };

  return (
    <Card title={t('smtpTitle')} description={cur ? t('smtpOwnHint') : data.server_smtp ? t('smtpServerHint', { host: data.server_smtp.host }) : t('smtpNoneHint')}>
      <div className="space-y-3">
        {!editing && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3">
            <Server size={18} className="shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-sm">
              {cur ? (
                <>
                  <div className="truncate font-semibold">{cur.from}</div>
                  <div className="truncate text-xs text-muted">{cur.host}:{cur.port}{cur.secure ? ' · SSL' : ''}{cur.user ? ` · ${cur.user}` : ''} · {new Date(cur.set_at).toLocaleDateString(locale)}</div>
                </>
              ) : <div className="text-muted">{data.server_smtp ? data.server_smtp.from : t('notConfigured')}</div>}
            </div>
            {(cur || data.server_smtp) && <button type="button" className={btn} disabled={!!busy} onClick={() => runTest(false)}>{busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {t('test')}</button>}
            <button type="button" className={btn} disabled={!!busy} onClick={open}><Pencil size={14} /> {cur ? t('change') : t('useOwn')}</button>
            {cur && <button type="button" className={`${btn} text-danger hover:bg-danger-soft`} disabled={!!busy} onClick={remove}>{busy === 'delete' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} {t('delete')}</button>}
          </div>
        )}
        {editing && (
          <form onSubmit={(e) => { e.preventDefault(); save(); }} className="grid gap-3 sm:grid-cols-[1fr_110px]">
            <label className="block text-sm"><span className="mb-1 block text-muted">{t('host')}</span>
              <input required value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="smtp.office365.com" className={input} autoComplete="off" />
            </label>
            <label className="block text-sm"><span className="mb-1 block text-muted">{t('port')}</span>
              <input type="number" required min={1} max={65535} value={f.port} onChange={(e) => setF({ ...f, port: Number(e.target.value), secure: Number(e.target.value) === 465 ? true : f.secure })} className={input} />
            </label>
            <label className="block text-sm"><span className="mb-1 block text-muted">{t('user')}</span>
              <input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} className={input} autoComplete="off" />
            </label>
            <label className="block text-sm sm:col-span-1"><span className="mb-1 block text-muted">{t('password')}</span>
              <input type="password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} placeholder={cur?.has_password ? '••••••••' : ''} className={input} autoComplete="new-password" />
            </label>
            <label className="block text-sm sm:col-span-2"><span className="mb-1 block text-muted">{t('from')}</span>
              <input required value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} placeholder="Εταιρεία <offers@company.gr>" className={input} />
            </label>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={f.secure} onChange={(e) => setF({ ...f, secure: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" /> {t('secure')}
            </label>
            <div className="flex flex-wrap gap-2 sm:col-span-2">
              <button type="button" className={btn} onClick={() => setEditing(false)}>{t('cancel')}</button>
              <span className="flex-1" />
              <button type="button" className={btn} disabled={!!busy || !f.host || !f.from} onClick={() => runTest(true)}>{busy === 'test' ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />} {t('test')}</button>
              <button className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-60" disabled={!!busy}>
                {busy === 'save' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} {t('save')}
              </button>
            </div>
          </form>
        )}
        {test && (
          <p className={clsx('rounded-xl p-3 text-sm', test.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger')}>
            {test.ok ? t('testOk', { to: test.to ?? '' }) : `${t('testFail')}${test.detail ? `: ${test.detail}` : test.error ? ` (${test.error})` : ''}`}
          </p>
        )}
      </div>
    </Card>
  );
}
