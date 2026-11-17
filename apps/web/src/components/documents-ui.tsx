'use client';
// Document UI pieces: upload queue (drag & drop / camera), document row & card, detail dialog (preview, metadata,
// versions, share link), and a panel for a customer / offer / task / activity.
import { useRef, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  CheckCircle2, Copy, Download, ExternalLink, History, Link2, Loader2, Share2, Trash2, Upload, X, XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { tone } from '@/lib/crm';
import {
  docsApi, fileIcon, fileUrl, formatBytes, isImage, isAudio, isPdf, uploadFile, useDocsMeta, type Doc, type DocDetail, type DocLinks,
} from '@/lib/documents';
import { Dialog } from './customer-dialogs';
import { CaptureButtons } from './voice-recorder';
import { appConfirm } from './confirm';
import { useToast } from './providers';
import { CustomerPicker } from './crm-editor';

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary';

export function useDocsRefresh() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['docs'] });
}

type Item = { id: string; file: File; progress: number; state: 'up' | 'ok' | 'err'; error?: string };
/** Upload queue: several files at once, progress per file, clear errors. */
export function useUploader(links: DocLinks) {
  const t = useTranslations('docs');
  const meta = useDocsMeta();
  const refresh = useDocsRefresh();
  const [items, setItems] = useState<Item[]>([]);
  const add = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const max = meta.data?.max_file ?? 25 * 1024 * 1024;
    const allowed = meta.data?.allowed ?? [];
    const queue: Item[] = list.map((f) => ({ id: Math.random().toString(36).slice(2), file: f, progress: 0, state: 'up' }));
    setItems((xs) => [...queue, ...xs].slice(0, 30));
    for (const it of queue) {
      const ext = it.file.name.split('.').pop()?.toLowerCase() ?? '';
      const fail = (error: string) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'err', error } : x)));
      if (allowed.length && !allowed.includes(ext)) { fail(t('err_type_not_allowed')); continue; }
      if (it.file.size > max) { fail(t('err_too_large', { max: formatBytes(max) })); continue; }
      try {
        await uploadFile(it.file, links, (p) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, progress: p } : x))));
        setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, state: 'ok', progress: 1 } : x)));
      } catch (e) {
        const code = e instanceof ApiError ? e.code : 'error';
        fail(t.has(`err_${code}`) ? (t as unknown as (k: string, v: object) => string)(`err_${code}`, { max: formatBytes(max) }) : code);
      }
    }
    refresh();
    setTimeout(() => setItems((xs) => xs.filter((x) => x.state !== 'ok')), 4000);
  };
  return { items, add, clear: () => setItems([]) };
}

export function UploadQueue({ items, onClear }: { items: Item[]; onClear: () => void }) {
  if (!items.length) return null;
  return (
    <div className="card space-y-1.5 p-3">
      {items.map((x) => (
        <div key={x.id} className="flex items-center gap-2 text-sm">
          {x.state === 'up' ? <Loader2 size={15} className="animate-spin text-primary" /> : x.state === 'ok' ? <CheckCircle2 size={15} className="text-success" /> : <XCircle size={15} className="text-danger" />}
          <span className="min-w-0 flex-1 truncate">{x.file.name}</span>
          {x.state === 'up' && <span className="w-24 overflow-hidden rounded-full bg-surface-2"><span className="block h-1.5 rounded-full bg-primary" style={{ width: `${Math.round(x.progress * 100)}%` }} /></span>}
          {x.error && <span className="truncate text-xs text-danger">{x.error}</span>}
        </div>
      ))}
      {items.some((x) => x.state === 'err') && <button onClick={onClear} className="text-xs font-medium text-primary">OK</button>}
    </div>
  );
}

/** Drop zone + "Choose", "Photo" (camera on phones) and "Record" (voice note) buttons. */
export function DropZone({ onFiles, children, disabled, className }: { onFiles: (f: FileList | File[]) => void; children?: ReactNode; disabled?: boolean; className?: string }) {
  const t = useTranslations('docs');
  const meta = useDocsMeta();
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div onDragOver={(e) => { if (disabled) return; e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled && e.dataTransfer.files.length) onFiles(e.dataTransfer.files); }}
      className={clsx('relative rounded-2xl transition', over && 'ring-2 ring-primary ring-offset-2', className)}>
      {children ?? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-border p-5 text-center text-sm text-muted">
          <Upload size={22} />
          <span>{t('dropHint')}</span>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" disabled={disabled} onClick={() => ref.current?.click()} className="h-10 rounded-xl bg-primary px-3 font-semibold text-white disabled:opacity-60">{t('choose')}</button>
            <CaptureButtons onFiles={onFiles} disabled={disabled} maxBytes={meta.data?.max_file ?? 25 * 1024 * 1024} />
          </div>
        </div>
      )}
      <input ref={ref} type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); e.target.value = ''; }} />
      {over && <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-2xl bg-primary-soft/80 font-semibold text-primary">{t('dropNow')}</div>}
    </div>
  );
}

export function FileTile({ doc, size = 40 }: { doc: Pick<Doc, 'id' | 'ext' | 'version'>; size?: number }) {
  const Icon = fileIcon(doc.ext);
  if (isImage(doc.ext)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`${fileUrl(doc.id, { inline: true })}&r=${doc.version}`} alt="" loading="lazy" style={{ width: size, height: size }} className="shrink-0 rounded-xl border border-border bg-surface-2 object-cover" />;
  }
  return (
    <span className="relative grid shrink-0 place-items-center rounded-xl bg-primary-soft text-primary" style={{ width: size, height: size }}>
      <Icon size={size * 0.5} />
      <span className="absolute -bottom-1 rounded bg-surface px-1 text-[9px] font-bold uppercase text-muted shadow">{doc.ext}</span>
    </span>
  );
}

export function DocRow({ d, onOpen, select }: { d: Doc; onOpen: () => void; select?: { on: boolean; toggle: () => void } }) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const expiring = d.expires_at && new Date(d.expires_at).getTime() - Date.now() < 30 * 864e5;
  return (
    <li className="flex items-center gap-3 px-3 py-2.5 hover:bg-surface-2/60 sm:px-4">
      {select && <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--primary)]" checked={select.on} onChange={select.toggle} aria-label={d.name} />}
      <button onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <FileTile doc={d} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5"><span className="truncate font-medium">{d.name}</span>
            {d.version > 1 && <span className="shrink-0 rounded bg-surface-2 px-1 text-[10px] font-semibold text-muted">v{d.version}</span>}
            {d.shared && <Link2 size={12} className="shrink-0 text-info" />}</span>
          <span className="block truncate text-xs text-muted">
            {[d.customer_name, d.offer_number, d.folder_name].filter(Boolean).join(' · ') || d.created_by_name}
          </span>
        </span>
        <span className="hidden shrink-0 sm:block">{d.category_name && <span className={clsx('rounded-md px-1.5 py-0.5 text-[11px] font-semibold', tone(d.category_color))}>{d.category_name}</span>}</span>
        <span className="shrink-0 text-right text-xs text-muted">
          <span className="block tabular">{formatBytes(d.size, locale)}</span>
          {expiring ? <span className="block font-semibold text-danger">{t('expires', { d: new Date(d.expires_at!).toLocaleDateString(locale) })}</span>
            : <span className="block">{new Date(d.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}</span>}
        </span>
      </button>
    </li>
  );
}

/** Documents of one record (customer, offer, task…) with upload. */
export function DocumentsPanel({ links, title }: { links: DocLinks; title?: string }) {
  const t = useTranslations('docs');
  const meta = useDocsMeta();
  const [open, setOpen] = useState<string | null>(null);
  const up = useUploader(links);
  const params = new URLSearchParams(Object.entries(links).filter(([, v]) => v) as [string, string][]);
  const q = useInfiniteQuery({
    queryKey: ['docs', 'panel', params.toString()], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ items: Doc[]; next_offset: number | null }>(`/documents?${params}&offset=${pageParam}&limit=50`),
    getNextPageParam: (l) => l.next_offset,
  });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <section className="space-y-3">
      {title && <h3 className="font-semibold">{title}</h3>}
      {meta.data?.can.edit && <DropZone onFiles={up.add} />}
      <UploadQueue items={up.items} onClear={up.clear} />
      {q.isLoading ? <Loader2 className="mx-auto animate-spin text-muted" /> : !items.length ? <p className="py-4 text-center text-sm text-muted">{t('none')}</p> : (
        <ul className="card divide-y divide-border overflow-hidden">{items.map((d) => <DocRow key={d.id} d={d} onOpen={() => setOpen(d.id)} />)}</ul>
      )}
      {q.hasNextPage && <button onClick={() => q.fetchNextPage()} className="mx-auto block text-sm font-medium text-primary">{t('more')}</button>}
      {open && <DocumentDialog id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Preview, details, versions, share link. */
export function DocumentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useTranslations('docs');
  const locale = useLocale();
  const toast = useToast();
  const refresh = useDocsRefresh();
  const meta = useDocsMeta();
  const d = useQuery({ queryKey: ['docs', 'detail', id], queryFn: () => api<DocDetail>(`/documents/${id}`) });
  const [tab, setTab] = useState<'preview' | 'details' | 'versions'>('preview');
  const [edit, setEdit] = useState<Record<string, unknown> | null>(null);
  const verRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  if (!d.data) return <Dialog title="…" onClose={onClose} wide><Loader2 className="mx-auto animate-spin text-muted" /></Dialog>;
  const doc = d.data;
  const canEdit = !!meta.data?.can.edit;
  const v = edit ?? { name: doc.name, description: doc.description ?? '', category: doc.category ?? '', expires_at: doc.expires_at?.slice(0, 10) ?? '', folder_id: doc.folder_id ?? '', customer: doc.customer_id ? { id: doc.customer_id, name: doc.customer_name ?? '' } : null, tags: doc.tags.join(', ') };
  const set = (k: string, val: unknown) => setEdit({ ...v, [k]: val });
  const save = async () => {
    setBusy(true);
    try {
      await docsApi.patch(id, {
        name: String(v.name).trim(), description: String(v.description).trim() || null, category: v.category || null,
        expires_at: v.expires_at || null, folder_id: v.folder_id || null, customer_id: (v.customer as { id: string } | null)?.id ?? null,
        ...(!(v.customer as { id: string } | null) || (v.customer as { id: string }).id !== doc.customer_id ? { branch_id: null, space_id: null, offer_id: null } : {}),
        tags: String(v.tags).split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20),
      });
      toast({ title: t('saved') }); setEdit(null); d.refetch(); refresh();
    } catch (e) { toast({ title: t('saveError'), body: e instanceof ApiError ? e.code : undefined }); }
    setBusy(false);
  };
  const remove = async () => {
    if (!(await appConfirm(t('deleteConfirm', { name: doc.name }), { danger: true }))) return;
    try { await docsApi.remove(id); refresh(); onClose(); } catch { toast({ title: t('deleteForbidden') }); }
  };
  const share = async () => {
    const r = await api<{ url: string }>(`/documents/${id}/share`, { method: 'POST', json: { days: 30 } });
    await navigator.clipboard?.writeText(location.origin + r.url).catch(() => {});
    toast({ title: t('shareCopied') }); d.refetch(); refresh();
  };
  const unshare = async () => { await api(`/documents/${id}/share`, { method: 'DELETE' }); d.refetch(); refresh(); };
  const newVersion = async (f: File) => {
    setBusy(true);
    try { await uploadFile(f, {}, undefined, `/documents/${id}/versions`); toast({ title: t('versionUploaded') }); d.refetch(); refresh(); }
    catch (e) { toast({ title: t('saveError'), body: e instanceof ApiError ? (t.has(`err_${e.code}`) ? (t as unknown as (k: string, v: object) => string)(`err_${e.code}`, { max: '25 MB' }) : e.code) : undefined }); }
    setBusy(false);
  };
  return (
    <Dialog title={doc.name} onClose={onClose} wide>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" className="flex w-full gap-1 rounded-xl bg-surface-2 p-1 sm:w-auto">
          {(['preview', 'details', 'versions'] as const).map((x) => (
            <button key={x} role="tab" aria-selected={tab === x} onClick={() => setTab(x)}
              className={clsx('min-w-0 flex-auto truncate whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-medium sm:px-3 sm:text-sm', tab === x ? 'bg-surface text-primary shadow-sm' : 'text-muted')}>
              {t(`tab_${x}`)}{x === 'versions' && doc.versions.length > 1 ? ` (${doc.versions.length})` : ''}
            </button>
          ))}
        </div>
        <span className="hidden flex-1 sm:block" />
        <a href={fileUrl(id)} className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium sm:flex-none"><Download size={15} /> {t('download')}</a>
        {(isImage(doc.ext) || isPdf(doc.ext)) && <a href={fileUrl(id, { inline: true })} target="_blank" rel="noopener" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border" aria-label={t('openNew')}><ExternalLink size={15} /></a>}
      </div>

      {tab === 'preview' && (
        <div className="overflow-hidden rounded-2xl border border-border bg-surface-2">
          {isImage(doc.ext)
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={`${fileUrl(id, { inline: true })}&r=${doc.version}`} alt={doc.name} className="mx-auto max-h-[60dvh] object-contain" />
            : isAudio(doc.ext) ? <div className="p-6"><audio controls preload="metadata" src={`${fileUrl(id, { inline: true })}&r=${doc.version}`} className="w-full" /></div>
            : isPdf(doc.ext) ? <iframe title={doc.name} src={`${fileUrl(id, { inline: true })}&r=${doc.version}`} className="h-[60dvh] w-full bg-white" />
              : <div className="grid place-items-center gap-2 p-10 text-center text-sm text-muted"><FileTile doc={doc} size={64} />{t('noPreview')}</div>}
          <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border bg-surface px-3 py-2 text-xs text-muted">
            <span>{formatBytes(doc.size, locale)}</span><span>v{doc.version}</span>
            <span>{t('uploadedBy', { name: doc.created_by_name ?? '—', d: new Date(doc.created_at).toLocaleDateString(locale) })}</span>
            {doc.customer_name && <span>{doc.customer_name}</span>}{doc.offer_number && <span>{doc.offer_number}</span>}
          </div>
        </div>
      )}

      {tab === 'details' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="sm:col-span-2"><span className="mb-1 block text-xs text-muted">{t('name')}</span><input className={input} disabled={!canEdit} value={String(v.name)} onChange={(e) => set('name', e.target.value)} /></label>
          <label><span className="mb-1 block text-xs text-muted">{t('category')}</span>
            <select className={input} disabled={!canEdit} value={String(v.category)} onChange={(e) => set('category', e.target.value)}>
              <option value="">—</option>{meta.data?.categories.filter((c) => c.active || c.key === v.category).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
            </select></label>
          <label><span className="mb-1 block text-xs text-muted">{t('folder')}</span>
            <select className={input} disabled={!canEdit} value={String(v.folder_id)} onChange={(e) => set('folder_id', e.target.value)}>
              <option value="">{t('root')}</option>{meta.data?.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select></label>
          <div className="sm:col-span-2"><span className="mb-1 block text-xs text-muted">{t('customer')}</span>
            <CustomerPicker value={v.customer as { id: string; name: string } | null} disabled={!canEdit} onChange={(c) => set('customer', c)} /></div>
          <label><span className="mb-1 block text-xs text-muted">{t('expiresAt')}</span><input type="date" className={input} disabled={!canEdit} value={String(v.expires_at)} onChange={(e) => set('expires_at', e.target.value)} /></label>
          <label><span className="mb-1 block text-xs text-muted">{t('tags')}</span><input className={input} disabled={!canEdit} placeholder="a, b" value={String(v.tags)} onChange={(e) => set('tags', e.target.value)} /></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-xs text-muted">{t('description')}</span><textarea rows={3} className={input} disabled={!canEdit} value={String(v.description)} onChange={(e) => set('description', e.target.value)} /></label>
          <div className="rounded-xl bg-surface-2 p-3 text-sm sm:col-span-2">
            <div className="mb-2 flex items-center gap-2 font-medium"><Share2 size={15} /> {t('shareTitle')}</div>
            {doc.share_url ? (
              <div className="flex flex-wrap items-center gap-2">
                <input readOnly className={clsx(input, 'flex-1 bg-surface font-mono text-xs')} value={location.origin + doc.share_url} onFocus={(e) => e.target.select()} />
                <button onClick={() => navigator.clipboard?.writeText(location.origin + doc.share_url).then(() => toast({ title: t('copied') }))} className="grid h-9 w-9 place-items-center rounded-xl border border-border bg-surface" aria-label={t('copy')}><Copy size={15} /></button>
                {canEdit && <button onClick={unshare} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-medium text-danger">{t('unshare')}</button>}
                {doc.share_expires_at && <span className="w-full text-xs text-muted">{t('shareUntil', { d: new Date(doc.share_expires_at).toLocaleDateString(locale) })}</span>}
              </div>
            ) : canEdit ? <button onClick={share} className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white">{t('share30')}</button> : <span className="text-muted">—</span>}
          </div>
        </div>
      )}

      {tab === 'versions' && (
        <div className="space-y-3">
          {canEdit && (
            <>
              <button disabled={busy} onClick={() => verRef.current?.click()} className="flex items-center gap-2 rounded-xl bg-primary-soft px-3 py-2 text-sm font-semibold text-primary"><Upload size={15} /> {t('newVersion')}</button>
              <input ref={verRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) newVersion(f); e.target.value = ''; }} />
            </>
          )}
          <ul className="divide-y divide-border rounded-2xl border border-border">
            {doc.versions.map((x) => (
              <li key={x.version} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-surface-2 text-xs font-bold">v{x.version}</span>
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{x.name}</span>
                  <span className="block truncate text-xs text-muted">{new Date(x.created_at).toLocaleString(locale)} · {x.created_by_name ?? '—'} · {formatBytes(x.size, locale)}{x.note ? ` · ${x.note}` : ''}</span></span>
                <a href={fileUrl(id, { v: x.version })} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-surface-2" aria-label={t('download')}><Download size={15} /></a>
              </li>
            ))}
          </ul>
          <p className="flex items-center gap-1.5 text-xs text-muted"><History size={13} /> {t('versionsHint')}</p>
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-5 mt-4 flex items-center gap-2 border-t border-border bg-surface px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:-mx-6 sm:px-6 sm:pb-3">
        {canEdit && <button onClick={remove} className="grid h-10 w-10 place-items-center rounded-xl text-danger hover:bg-danger-soft" aria-label={t('delete')}><Trash2 size={18} /></button>}
        <span className="flex-1" />
        <button onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 font-medium">{t('close')}</button>
        {tab === 'details' && canEdit && edit && (
          <button disabled={busy} onClick={save} className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {t('save')}
          </button>
        )}
      </div>
    </Dialog>
  );
}

export { X };
