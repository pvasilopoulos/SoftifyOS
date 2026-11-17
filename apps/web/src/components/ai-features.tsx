'use client';
// AI features placed on screens: voice visit report, customer summary, report from a sentence, offer from text,
// smart import of a customer (photo of a card, PDF or pasted text).
import { useRef, useState } from 'react';
import clsx from 'clsx';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, Camera, FileUp, Loader2, Mic, RefreshCw, ScanText, Sparkles, Wand2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAi, useAiStatus, type AiAction } from '@/lib/ai';
import { Link } from '@/i18n/navigation';
import { Dialog } from './customer-dialogs';
import { ActionCard, AiErrorNote, Markdown, MicButton, useDictation } from './ai-ui';
import { useCopilot } from './copilot';

const errCode = (e: unknown) => (e instanceof ApiError ? e.code : 'error');

// ============================================================ voice visit
export function VoiceVisitButton({ customerId, branchId, compact }: { customerId?: string; branchId?: string; compact?: boolean }) {
  const t = useTranslations('ai');
  const on = useAi('voice');
  const [open, setOpen] = useState(false);
  if (!on) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={t('voiceTitle')} aria-label={t('voiceTitle')}
        className={clsx('flex shrink-0 items-center gap-1.5 rounded-xl border border-border bg-surface text-sm font-medium transition hover:border-primary/50 hover:text-primary', compact ? 'h-10 w-10 justify-center' : 'h-10 px-3')}>
        <Mic size={16} className="text-primary" />{!compact && <span className="hidden sm:inline">{t('voiceShort')}</span>}
      </button>
      {open && <VoiceVisitDialog customerId={customerId} branchId={branchId} onClose={() => setOpen(false)} />}
    </>
  );
}

type VisitResult = { customer: { id: string; name: string } | null; candidates: { id: string; name: string; address_city?: string | null }[]; customer_name: string | null; actions: AiAction[] };

function VoiceVisitDialog({ customerId, branchId, onClose }: { customerId?: string; branchId?: string; onClose: () => void }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const [text, setText] = useState('');
  const dict = useDictation((x) => setText((v) => (v ? `${v} ${x}` : x)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<VisitResult | null>(null);
  const analyse = async () => {
    dict.stop();
    setBusy(true); setErr(null);
    try { setRes(await api<VisitResult>('/ai/visit', { method: 'POST', json: { text, customer_id: customerId ?? null, branch_id: branchId ?? null, locale } })); }
    catch (e) { setErr(errCode(e)); }
    setBusy(false);
  };
  const pick = async (id: string, name: string) => {
    if (!res) return;
    await api('/ai/actions/link', { method: 'POST', json: { ids: res.actions.map((a) => a.id), customer_id: id } });
    setRes({ ...res, customer: { id, name }, candidates: [], actions: res.actions.map((a) => ({ ...a, payload: { ...a.payload, customer_id: id } })) });
  };
  return (
    <Dialog title={t('voiceTitle')} onClose={onClose} wide>
      {!res ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">{dict.supported ? t('voiceHint') : t('voiceHintNoMic')}</p>
          {dict.supported && (
            <div className="flex flex-col items-center gap-2 py-2">
              <MicButton d={dict} className="h-20 w-20 rounded-full border border-border" size={32} />
              <span className="text-xs text-muted">{dict.listening ? t('listening') : t('tapToSpeak')}</span>
              {dict.error && <span className="text-xs text-danger">{t('micError')}</span>}
            </div>
          )}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder={t('voicePlaceholder')}
            className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-primary" />
          {dict.interim && <p className="text-xs italic text-muted">{dict.interim}</p>}
          {err && <AiErrorNote code={err} />}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">{t('cancel')}</button>
            <button type="button" disabled={busy || text.trim().length < 3} onClick={analyse} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {t('analyse')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {res.customer ? (
            <p className="text-sm">{t('forCustomer')} <Link href={`/customers/${res.customer.id}`} className="font-semibold text-primary">{res.customer.name}</Link></p>
          ) : res.candidates.length > 0 ? (
            <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
              <p className="font-medium">{t('whichCustomer', { name: res.customer_name ?? '' })}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {res.candidates.map((c) => <button key={c.id} type="button" onClick={() => pick(c.id, c.name)} className="rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-medium hover:border-primary">{c.name}{c.address_city ? ` · ${c.address_city}` : ''}</button>)}
              </div>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-sm text-warning"><AlertTriangle size={14} /> {res.customer_name ? t('customerNotFound', { name: res.customer_name }) : t('noCustomer')}</p>
          )}
          <p className="text-xs text-muted">{t('reviewHint')}</p>
          <div className="space-y-2">{res.actions.map((a) => <ActionCard key={a.id} action={a} />)}</div>
          <div className="flex justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setRes(null)} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">{t('back')}</button>
            <button type="button" onClick={onClose} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white">{t('done')}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}

// ============================================================ customer summary
export function CustomerSummaryCard({ customerId }: { customerId: string }) {
  const t = useTranslations('ai');
  const locale = useLocale();
  const on = useAi('summary');
  const [state, setState] = useState<{ text?: string; at?: string; err?: string; busy?: boolean }>({});
  if (!on) return null;
  const run = async () => {
    setState({ busy: true });
    try { const r = await api<{ text: string; generated_at: string }>(`/ai/customers/${customerId}/summary`, { method: 'POST', json: { locale } }); setState({ text: r.text, at: r.generated_at }); }
    catch (e) { setState({ err: errCode(e) }); }
  };
  return (
    <section className="card border-primary/30 bg-gradient-to-br from-primary-soft/50 to-transparent p-4">
      <div className="flex items-center gap-2">
        <Sparkles size={16} className="text-primary" />
        <h3 className="flex-1 text-sm font-semibold">{t('summaryTitle')}</h3>
        {state.text && <span className="text-[11px] text-muted">{new Date(state.at!).toLocaleTimeString(locale, { timeStyle: 'short' })}</span>}
        <button type="button" onClick={run} disabled={state.busy} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft disabled:opacity-50">
          {state.busy ? <Loader2 size={13} className="animate-spin" /> : state.text ? <RefreshCw size={13} /> : <Wand2 size={13} />} {state.text ? t('refresh') : t('summarise')}
        </button>
      </div>
      {state.text && <Markdown text={state.text} className="mt-2" />}
      {!state.text && !state.busy && !state.err && <p className="mt-1 text-xs text-muted">{t('summaryHint')}</p>}
      {state.err && <div className="mt-2"><AiErrorNote code={state.err} /></div>}
    </section>
  );
}

// ============================================================ report from a sentence
export function ReportPromptBar<D>({ onDefinition }: { onDefinition: (name: string, def: D) => void }) {
  const t = useTranslations('ai');
  const on = useAi('reports');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dict = useDictation((x) => setQ((v) => (v ? `${v} ${x}` : x)));
  if (!on) return null;
  const go = async () => {
    setBusy(true); setErr(null);
    try { const r = await api<{ name: string; definition: D }>('/ai/report', { method: 'POST', json: { prompt: q } }); onDefinition(r.name, r.definition); setQ(''); }
    catch (e) { setErr(errCode(e)); }
    setBusy(false);
  };
  return (
    <div className="print:hidden">
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim().length >= 3) go(); }} className="flex items-center gap-1.5 rounded-2xl border border-primary/30 bg-surface p-1.5 pl-3 focus-within:border-primary">
        <Sparkles size={16} className="shrink-0 text-primary" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('reportPlaceholder')} aria-label={t('reportPlaceholder')} className="min-w-0 flex-1 bg-transparent py-1.5 text-sm outline-none" />
        <MicButton d={dict} className="h-9 w-9" size={16} />
        <button type="submit" disabled={busy || q.trim().length < 3} className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-3 text-sm font-semibold text-white disabled:opacity-40">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}<span className="hidden sm:inline">{t('build')}</span>
        </button>
      </form>
      {err && <div className="mt-2"><AiErrorNote code={err === 'invalid_definition' ? 'err_report' : err} /></div>}
    </div>
  );
}

// ============================================================ offer from text (opens the Copilot with the context)
export function OfferFromTextButton({ customerId, customerName, branchId }: { customerId?: string | null; customerName?: string | null; branchId?: string | null }) {
  const t = useTranslations('ai');
  const on = useAi('offer_draft');
  const c = useCopilot();
  if (!on || !c) return null;
  const prompt = t('offerPrompt', { customer: customerName ? `${customerName}${customerId ? ` (id ${customerId})` : ''}` : '—', branch: branchId ?? '—' });
  return (
    <button type="button" onClick={() => c.open({ prompt })} className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary-soft/40 px-3 text-sm font-medium text-primary hover:bg-primary-soft">
      <Sparkles size={15} /> {t('offerFromText')}
    </button>
  );
}

// ============================================================ smart import of a customer
export type ImportedCustomer = {
  name: string | null; trade_name: string | null; vat: string | null; tax_office: string | null; activity: string | null;
  email: string | null; phone: string | null; mobile: string | null; website: string | null;
  address_street: string | null; address_postal: string | null; address_city: string | null; address_region: string | null; address_country: string | null;
  contact: { full_name: string; role: string | null; email: string | null; phone: string | null } | null; notes: string | null;
};
type Dup = { id: string; name: string; vat?: string | null; address_city?: string | null };

const toBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = rej; r.readAsDataURL(f); });
/** Phone photos are large: scale to ≤1600px JPEG before sending. */
async function shrink(f: File): Promise<{ media_type: string; data: string }> {
  if (f.type === 'application/pdf' || !f.type.startsWith('image/')) return { media_type: f.type || 'application/pdf', data: await toBase64(f) };
  const bmp = await createImageBitmap(f);
  const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  return { media_type: 'image/jpeg', data: cv.toDataURL('image/jpeg', 0.85).split(',')[1] };
}

export function SmartImportButton({ onImport }: { onImport: (c: ImportedCustomer) => void }) {
  const t = useTranslations('ai');
  const on = useAi('import');
  const { data } = useAiStatus();
  const [open, setOpen] = useState(false);
  if (!on || !data) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-10 items-center gap-1.5 rounded-xl border border-primary/30 bg-primary-soft/40 px-3 text-sm font-medium text-primary hover:bg-primary-soft">
        <ScanText size={16} /> {t('smartImport')}
      </button>
      {open && <SmartImportDialog onClose={() => setOpen(false)} onImport={(c) => { onImport(c); setOpen(false); }} />}
    </>
  );
}

function SmartImportDialog({ onClose, onImport }: { onClose: () => void; onImport: (c: ImportedCustomer) => void }) {
  const t = useTranslations('ai');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ fields: ImportedCustomer; duplicates: Dup[] } | null>(null);
  const cam = useRef<HTMLInputElement>(null), pick = useRef<HTMLInputElement>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const f = file ? await shrink(file) : null;
      if (f && f.data.length > 14_000_000) { setErr('too_large'); setBusy(false); return; }
      setRes(await api<{ fields: ImportedCustomer; duplicates: Dup[] }>('/ai/extract-customer', { method: 'POST', json: { text: text || null, file: f } }));
    } catch (e) { setErr(errCode(e)); }
    setBusy(false);
  };
  const rows = res ? (Object.entries(res.fields) as [keyof ImportedCustomer, unknown][]).filter(([k, v]) => v && k !== 'contact') : [];
  return (
    <Dialog title={t('smartImport')} onClose={onClose} wide>
      {!res ? (
        <div className="space-y-3">
          <p className="text-sm text-muted">{t('importHint')}</p>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => cam.current?.click()} className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-4 text-sm font-medium hover:border-primary hover:text-primary"><Camera size={22} /> {t('takePhoto')}</button>
            <button type="button" onClick={() => pick.current?.click()} className="flex flex-col items-center gap-1.5 rounded-2xl border border-dashed border-border p-4 text-sm font-medium hover:border-primary hover:text-primary"><FileUp size={22} /> {t('chooseFile')}</button>
            <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <input ref={pick} type="file" accept="image/*,application/pdf" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {file && <p className="truncate text-sm">📎 {file.name} <button type="button" className="ml-2 text-xs text-muted underline" onClick={() => setFile(null)}>{t('remove')}</button></p>}
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={t('importPlaceholder')} className="w-full rounded-xl border border-border bg-surface-2 px-3 py-2.5 text-sm outline-none focus:border-primary" />
          {err && <AiErrorNote code={err === 'too_large' ? 'err_too_large' : err} />}
          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">{t('cancel')}</button>
            <button type="button" disabled={busy || (!file && text.trim().length < 5)} onClick={run} className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} {t('extract')}
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {res.duplicates.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm">
              <p className="flex items-center gap-1.5 font-medium text-warning"><AlertTriangle size={14} /> {t('possibleDuplicates')}</p>
              <ul className="mt-1 space-y-0.5">{res.duplicates.map((d) => <li key={d.id}><Link href={`/customers/${d.id}`} className="text-primary hover:underline">{d.name}</Link>{d.vat ? ` · ${d.vat}` : ''}{d.address_city ? ` · ${d.address_city}` : ''}</li>)}</ul>
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-border p-3 text-sm">
            {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{t(`fld_${k}` as never)}</dt><dd className="break-words font-medium">{String(v)}</dd></div>)}
            {res.fields.contact && <div className="contents"><dt className="text-muted">{t('fld_contact')}</dt><dd className="font-medium">{[res.fields.contact.full_name, res.fields.contact.role, res.fields.contact.email, res.fields.contact.phone].filter(Boolean).join(' · ')}</dd></div>}
          </dl>
          {!rows.length && <p className="text-sm text-muted">{t('nothingFound')}</p>}
          <div className="flex justify-between gap-2 border-t border-border pt-4">
            <button type="button" onClick={() => setRes(null)} className="rounded-xl border border-border px-4 py-2 text-sm font-medium">{t('back')}</button>
            <button type="button" disabled={!rows.length} onClick={() => onImport(res.fields)} className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{t('fillForm')}</button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
