'use client';
// Documents: folders, search (greeklish), categories, list / grid, drag & drop upload, bulk move / category / delete, storage use.
import { Suspense, useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { AlertTriangle, ChevronRight, Folder, FolderOpen, FolderPlus, Grid2x2, LayoutList, Loader2, Pencil, Search, Trash2, Upload, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatBytes, useDocsMeta, type Doc, type Folder as F } from '@/lib/documents';
import { tone } from '@/lib/crm';
import { tabStore } from '@/lib/tab-store';
import { useTabTitle } from '@/components/tabs';
import { DocRow, DocumentDialog, DropZone, FileTile, UploadQueue, useDocsRefresh, useUploader } from '@/components/documents-ui';
import { appConfirm, appPrompt } from '@/components/confirm';
import { useToast } from '@/components/providers';
import { CaptureButtons } from '@/components/voice-recorder';

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => { const id = setTimeout(() => setD(v), ms); return () => clearTimeout(id); }, [v, ms]);
  return d;
}

function DocsInner() {
  const t = useTranslations('docs');
  const locale = useLocale();
  const sp = useSearchParams();
  const toast = useToast();
  const refresh = useDocsRefresh();
  const meta = useDocsMeta();
  useTabTitle(t('title'));
  const saved = useMemo(() => { try { return JSON.parse(tabStore.getItem('docs.state') ?? '{}'); } catch { return {}; } }, []);
  const [folder, setFolder] = useState<string>(saved.folder ?? '');        // '' = all, 'root', or id
  const [category, setCategory] = useState<string>(saved.category ?? '');
  const [sort, setSort] = useState<string>(saved.sort ?? 'recent');
  const [view, setView] = useState<'list' | 'grid'>(saved.view ?? 'list');
  const [expiring, setExpiring] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  useEffect(() => { try { tabStore.setItem('docs.state', JSON.stringify({ folder, category, sort, view })); } catch {} }, [folder, category, sort, view]);
  const [open, setOpen] = useState<string | null>(sp.get('open'));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const up = useUploader({ folder_id: folder && folder !== 'root' ? folder : null, category: category || null });

  const params = new URLSearchParams({ sort });
  if (folder && !dq) params.set('folder', folder);
  if (category) params.set('category', category);
  if (dq.length >= 2) params.set('q', dq);
  if (expiring) { params.set('expiring', '1'); params.set('sort', 'expiry'); }
  const list = useInfiniteQuery({
    queryKey: ['docs', 'list', params.toString()], initialPageParam: 0,
    queryFn: ({ pageParam }) => api<{ items: Doc[]; next_offset: number | null }>(`/documents?${params}&offset=${pageParam}&limit=60`),
    getNextPageParam: (l) => l.next_offset,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const folders = meta.data?.folders ?? [];
  const path = useMemo(() => {
    const out: F[] = [];
    let cur = folders.find((f) => f.id === folder);
    while (cur) { out.unshift(cur); cur = folders.find((f) => f.id === cur!.parent_id); }
    return out;
  }, [folders, folder]);
  const children = folders.filter((f) => (folder && folder !== 'root' ? f.parent_id === folder : !f.parent_id));
  const canEdit = !!meta.data?.can.edit;

  const newFolder = async () => {
    const name = (await appPrompt(t('newFolderName')))?.trim();
    if (!name) return;
    await api('/doc-folders', { method: 'POST', json: { name, parent_id: folder && folder !== 'root' ? folder : null } });
    refresh();
  };
  const renameFolder = async (f: F) => {
    const name = (await appPrompt(t('renameFolder'), f.name))?.trim();
    if (!name || name === f.name) return;
    await api(`/doc-folders/${f.id}`, { method: 'PATCH', json: { name } }); refresh();
  };
  const deleteFolder = async (f: F) => {
    if (!(await appConfirm(t('deleteFolderConfirm', { name: f.name }), { danger: true }))) return;
    try { await api(`/doc-folders/${f.id}`, { method: 'DELETE' }); if (folder === f.id) setFolder(f.parent_id ?? ''); refresh(); }
    catch (e) { toast({ title: e instanceof ApiError && e.code === 'not_empty' ? t('folderNotEmpty') : t('saveError') }); }
  };
  const bulk = async (action: 'move' | 'delete' | 'category', extra: Record<string, unknown> = {}) => {
    if (action === 'delete' && !(await appConfirm(t('bulkDeleteConfirm', { n: sel.size }), { danger: true }))) return;
    const r = await api<{ count: number }>('/documents/bulk', { method: 'POST', json: { ids: [...sel], action, ...extra } });
    toast({ title: t('bulkDone', { n: r.count }) }); setSel(new Set()); refresh();
  };
  const usage = meta.data?.usage;
  const pct = usage ? Math.min(100, Math.round((usage.used / usage.quota) * 100)) : 0;

  return (
    <div className="space-y-4 pb-24">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold tracking-tight">{t('title')}</h1>
        {canEdit && <button onClick={newFolder} className="flex h-10 items-center gap-1.5 rounded-xl border border-border bg-surface px-3 text-sm font-medium"><FolderPlus size={16} /> <span className="hidden sm:inline">{t('newFolder')}</span></button>}
        {canEdit && <CaptureButtons onFiles={up.add} maxBytes={meta.data?.max_file ?? 25 * 1024 * 1024} compact />}
        {canEdit && (
          <label className="flex h-10 cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm">
            <Upload size={16} /> {t('upload')}
            <input type="file" multiple hidden onChange={(e) => { if (e.target.files?.length) up.add(e.target.files); e.target.value = ''; }} />
          </label>
        )}
      </header>

      <div className="grid items-start gap-4 lg:grid-cols-[240px_1fr]">
        {/* Folders + usage */}
        <aside className="space-y-3">
          <nav className="card p-2 text-sm">
            {[['', t('all'), FolderOpen], ['root', t('root'), Folder]].map(([k, label, Icon]) => (
              <button key={k as string} onClick={() => { setFolder(k as string); setExpiring(false); }}
                className={clsx('flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left', folder === k && !expiring ? 'bg-primary-soft font-semibold text-primary' : 'hover:bg-surface-2')}>
                <Icon size={16} /> {label as string}
              </button>
            ))}
            <FolderTree folders={folders} parent={null} active={folder} onPick={(id) => { setFolder(id); setExpiring(false); }} onRename={renameFolder} onDelete={deleteFolder} canEdit={canEdit} />
            <button onClick={() => { setExpiring(true); setFolder(''); }} className={clsx('mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left', expiring ? 'bg-danger-soft font-semibold text-danger' : 'text-danger hover:bg-surface-2')}>
              <AlertTriangle size={16} /> {t('expiringSoon')}
            </button>
          </nav>
          {usage && (
            <div className="card p-3 text-xs">
              <div className="mb-1.5 flex justify-between"><span className="font-medium">{t('storage')}</span><span className="tabular text-muted">{formatBytes(usage.used, locale)} / {formatBytes(usage.quota, locale)}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className={clsx('h-full rounded-full', pct > 90 ? 'bg-danger' : 'bg-primary')} style={{ width: `${Math.max(pct, 1)}%` }} /></div>
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-3">
          {/* Breadcrumb + sub-folders */}
          {folder && folder !== 'root' && !dq && (
            <div className="flex flex-wrap items-center gap-1 text-sm">
              <button onClick={() => setFolder('')} className="text-muted hover:text-text">{t('all')}</button>
              {path.map((f) => <span key={f.id} className="flex items-center gap-1"><ChevronRight size={14} className="text-muted" /><button onClick={() => setFolder(f.id)} className={clsx(f.id === folder ? 'font-semibold' : 'text-muted hover:text-text')}>{f.name}</button></span>)}
            </div>
          )}
          {!dq && !expiring && children.length > 0 && folder !== '' && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {children.map((f) => (
                <button key={f.id} onClick={() => setFolder(f.id)} className="card flex items-center gap-2 p-3 text-left text-sm hover:shadow-md">
                  <Folder size={18} className="text-primary" /><span className="min-w-0 flex-1 truncate font-medium">{f.name}</span><span className="text-xs text-muted">{f.docs}</span>
                </button>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-11 min-w-0 basis-full items-center gap-2 rounded-xl border border-border bg-surface px-3.5 sm:basis-auto sm:flex-1">
              <Search size={18} className="shrink-0 text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} className="w-full min-w-0 bg-transparent outline-none" />
              {q && <button onClick={() => setQ('')} aria-label="clear"><X size={16} className="text-muted" /></button>}
            </div>
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="h-11 rounded-xl border border-border bg-surface px-3 text-sm" aria-label={t('sort')}>
              {['recent', 'name', 'size', 'expiry'].map((s) => <option key={s} value={s}>{t(`sort_${s}`)}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-surface-2 p-1">
              {([['list', LayoutList], ['grid', Grid2x2]] as const).map(([k, Icon]) => (
                <button key={k} onClick={() => setView(k)} aria-label={t(`view_${k}`)} className={clsx('grid h-8 w-9 place-items-center rounded-lg', view === k ? 'bg-surface text-primary shadow-sm' : 'text-muted')}><Icon size={16} /></button>
              ))}
            </div>
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {[{ key: '', name: t('allCategories'), color: 'muted' }, ...(meta.data?.categories.filter((c) => c.active) ?? [])].map((c) => (
              <button key={c.key || 'all'} onClick={() => setCategory(c.key)}
                className={clsx('shrink-0 rounded-full border px-3 py-1.5 text-sm', category === c.key ? `${tone(c.color)} border-transparent font-semibold` : 'border-border bg-surface')}>{c.name}</button>
            ))}
          </div>

          <UploadQueue items={up.items} onClear={up.clear} />
          <DropZone onFiles={up.add} disabled={!canEdit}>
            {list.isLoading ? <Loader2 className="mx-auto my-10 animate-spin text-muted" /> : !items.length ? (
              <div className="card grid place-items-center gap-2 p-10 text-center text-sm text-muted"><Upload size={28} />{canEdit ? t('emptyDrop') : t('empty')}</div>
            ) : view === 'list' ? (
              <div className="card overflow-hidden">
                <div className="flex items-center gap-3 border-b border-border px-3 py-2 text-xs text-muted sm:px-4">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={items.every((d) => sel.has(d.id))} aria-label={t('selectAll')}
                    onChange={() => setSel(items.every((d) => sel.has(d.id)) ? new Set() : new Set(items.map((d) => d.id)))} />
                  {t('shown', { n: items.length })}
                </div>
                <ul className="divide-y divide-border">
                  {items.map((d) => <DocRow key={d.id} d={d} onOpen={() => setOpen(d.id)}
                    select={{ on: sel.has(d.id), toggle: () => { const s = new Set(sel); if (s.has(d.id)) s.delete(d.id); else s.add(d.id); setSel(s); } }} />)}
                </ul>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                {items.map((d) => (
                  <button key={d.id} onClick={() => setOpen(d.id)} className="card flex flex-col items-center gap-2 p-3 text-center hover:shadow-md">
                    <FileTile doc={d} size={88} />
                    <span className="w-full truncate text-sm font-medium">{d.name}</span>
                    <span className="text-xs text-muted">{formatBytes(d.size, locale)}{d.customer_name ? ` · ${d.customer_name}` : ''}</span>
                  </button>
                ))}
              </div>
            )}
          </DropZone>
          {list.hasNextPage && <button onClick={() => list.fetchNextPage()} className="mx-auto block text-sm font-medium text-primary">{t('more')}</button>}
        </div>
      </div>

      {sel.size > 0 && (
        <div className="card sticky bottom-24 z-20 flex flex-wrap items-center gap-2 p-3 lg:bottom-4">
          <span className="text-sm font-semibold">{t('selected', { n: sel.size })}</span>
          <span className="flex-1" />
          <select className="rounded-xl border border-border bg-surface px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && bulk('move', { folder_id: e.target.value === 'root' ? null : e.target.value })}>
            <option value="">{t('moveTo')}</option><option value="root">{t('root')}</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select className="rounded-xl border border-border bg-surface px-3 py-2 text-sm" value="" onChange={(e) => e.target.value && bulk('category', { category: e.target.value === '-' ? null : e.target.value })}>
            <option value="">{t('setCategory')}</option><option value="-">—</option>
            {meta.data?.categories.filter((c) => c.active).map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
          <button onClick={() => bulk('delete')} className="rounded-xl border border-border px-3 py-2 text-sm font-medium text-danger">{t('delete')}</button>
          <button onClick={() => setSel(new Set())} className="grid h-9 w-9 place-items-center rounded-xl border border-border" aria-label="clear"><X size={15} /></button>
        </div>
      )}
      {open && <DocumentDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FolderTree({ folders, parent, active, onPick, onRename, onDelete, canEdit, depth = 0 }: {
  folders: F[]; parent: string | null; active: string; onPick: (id: string) => void; onRename: (f: F) => void; onDelete: (f: F) => void; canEdit: boolean; depth?: number;
}) {
  const kids = folders.filter((f) => f.parent_id === parent);
  if (!kids.length || depth > 6) return null;
  return (
    <ul>
      {kids.map((f) => (
        <li key={f.id}>
          <div className={clsx('group flex items-center rounded-xl', active === f.id ? 'bg-primary-soft text-primary' : 'hover:bg-surface-2')} style={{ paddingLeft: depth * 12 }}>
            <button onClick={() => onPick(f.id)} className={clsx('flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left', active === f.id && 'font-semibold')}>
              <Folder size={15} className="shrink-0" /><span className="truncate">{f.name}</span><span className="ml-auto text-xs text-muted">{f.docs || ''}</span>
            </button>
            {canEdit && (
              <span className="hidden shrink-0 gap-0.5 pr-1 group-hover:flex">
                <button onClick={() => onRename(f)} className="grid h-6 w-6 place-items-center rounded text-muted hover:text-text" aria-label="rename"><Pencil size={12} /></button>
                <button onClick={() => onDelete(f)} className="grid h-6 w-6 place-items-center rounded text-muted hover:text-danger" aria-label="delete"><Trash2 size={12} /></button>
              </span>
            )}
          </div>
          <FolderTree folders={folders} parent={f.id} active={active} onPick={onPick} onRename={onRename} onDelete={onDelete} canEdit={canEdit} depth={depth + 1} />
        </li>
      ))}
    </ul>
  );
}

export default function DocumentsPage() {
  return <Suspense><DocsInner /></Suspense>;
}
