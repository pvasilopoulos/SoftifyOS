'use client';
// Settings: "Customers" display preferences, "Indexes" (default views + visible filters) and "Integrations".
import { useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Bookmark, Check, ChevronDown, Eye, EyeOff, CircleUser, Contact, DatabaseZap, Landmark, LayoutList, ListFilter, ListTree, Loader2, PenLine, Search, ShieldCheck, Store, Users, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useRoles } from './roles-settings';
import { Dialog } from './customer-dialogs';
import { FILTER_GROUPS, type IndexKey } from './index-filters';
import { EntityTile } from './ui';
import { ManageViews, useSavedViews } from './saved-views';
import { RegistrySettingsPanel, useRegistryConfig } from './registry';
import { matchRank } from '@/lib/search';
import { useToast } from './providers';

const primaryBtn = 'flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const ghostBtn = 'flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 font-medium';
const smallBtn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60';
const label = 'mb-2 text-xs font-semibold uppercase tracking-wide text-muted';

function Choice({ active, onClick, title, hint, disabled }: { active: boolean; onClick: () => void; title: string; hint?: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} aria-pressed={active}
      className={clsx('flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition disabled:opacity-60',
        active ? 'border-primary bg-primary-soft/60' : 'border-border hover:bg-surface-2')}>
      <span className={clsx('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2', active ? 'border-primary bg-primary text-white' : 'border-border')}>
        {active && <Check size={12} />}
      </span>
      <span><span className="block font-medium">{title}</span>{hint && <span className="block text-sm text-muted">{hint}</span>}</span>
    </button>
  );
}

/** A settings item that opens like a drop-down: icon, title, one-line summary; details on click. */
export function Expandable({ icon: Icon, title, summary, open, onToggle, children }: {
  icon: typeof Users; title: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode;
}) {
  return (
    <section className="card overflow-hidden">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left transition hover:bg-surface-2 sm:px-6">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><Icon size={19} /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{title}</span>
          {summary && <span className="block truncate text-sm text-muted">{summary}</span>}
        </span>
        <ChevronDown size={20} className={clsx('shrink-0 text-muted transition', open && 'rotate-180')} />
      </button>
      {open && <div className="border-t border-border p-4 sm:p-6">{children}</div>}
    </section>
  );
}

// ======================================== Searchable groups of settings items ========================================
export type SettingsItem = { key: string; icon: typeof Users; title: string; summary?: string; keywords?: string; content: ReactNode };
export type SettingsGroup = { key: string; icon: typeof Users; title: string; hint?: string; items: SettingsItem[] };

/** Search box + groups (module → items). Typing opens the first match; accents, case and greeklish are ignored. */
export function SettingsItems({ groups, placeholder }: { groups: SettingsGroup[]; placeholder: string }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const shown = groups.map((g) => ({
    ...g, items: g.items.filter((i) => !q.trim() || matchRank(`${g.title} ${i.title} ${i.summary ?? ''} ${i.keywords ?? ''}`, q) !== null),
  })).filter((g) => g.items.length);
  const first = q.trim() ? shown[0]?.items[0]?.key : null;
  return (
    <div className="space-y-4">
      <label className="relative block">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder}
          className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-9 text-sm outline-none focus:border-primary [&::-webkit-search-cancel-button]:hidden" />
        {q && <button type="button" onClick={() => setQ('')} aria-label="clear" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center text-muted"><X size={14} /></button>}
      </label>
      {!shown.length && <p className="card p-6 text-center text-sm text-muted">—</p>}
      {shown.map((g) => (
        <section key={g.key}>
          <div className="mb-2 flex items-center gap-2 px-1">
            <g.icon size={16} className="text-primary" />
            <h3 className="text-sm font-semibold">{g.title}</h3>
            {g.hint && <span className="truncate text-xs text-muted">· {g.hint}</span>}
          </div>
          <div className="space-y-2">
            {g.items.map((i) => (
              <Expandable key={i.key} icon={i.icon} title={i.title} summary={i.summary}
                open={open === i.key || (open === null && first === i.key)} onToggle={() => setOpen(open === i.key ? '' : i.key)}>
                {i.content}
              </Expandable>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ======================================== Customers display ========================================
type TabRow = { key: string; hidden: boolean };
type CustomersPrefs = {
  organization: { show_avatar: boolean }; mine: { show_avatar: boolean | null }; effective: { show_avatar: boolean }; can_edit_organization: boolean;
  tabs: { available: string[]; organization: TabRow[] | null; mine: TabRow[] | null; effective: TabRow[]; source: 'user' | 'organization' | 'default' };
};

export function CustomersSettingsSection() {
  const t = useTranslations('settings.customersPrefs');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useQuery({ queryKey: ['settings', 'customers'], queryFn: () => api<CustomersPrefs>('/settings/customers') });
  const regCfg = useRegistryConfig();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings', 'customers'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast({ title: ts('saved') }); };
  const org = useMutation({ mutationFn: (show: boolean) => api('/settings/customers/organization', { method: 'PUT', json: { show_avatar: show } }), onSuccess: refresh });
  const mine = useMutation({ mutationFn: (v: boolean | null) => api('/me/preferences', { method: 'PUT', json: { show_customer_avatar: v } }), onSuccess: refresh });
  if (!data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const orgLabel = data.organization.show_avatar ? t('shown') : t('hidden');

  void open; void setOpen;
  const reg = regCfg.data;
  const registrySummary = !reg ? '' : reg.lookup_mode === 'off' ? t('registryOff')
    : [reg.aade_ready ? 'ΑΑΔΕ' : null, reg.vies_enabled ? 'VIES' : null].filter(Boolean).join(' + ') + ` · ${t(`registryMode_${reg.lookup_mode}`)}`;
  return (
    <SettingsItems placeholder={ts('searchIn')} groups={[{ key: 'display', icon: Contact, title: t('groupDisplay'), items: [{
      key: 'avatar', icon: CircleUser, title: t('avatarTitle'), keywords: 'avatar εικονίδιο αρχικά logo initials',
      summary: `${data.effective.show_avatar ? t('shown') : t('hidden')} · ${data.mine.show_avatar === null ? t('followOrg') : t('mine')}`,
      content: (<>
        <p className="mb-4 text-sm text-muted">{t('avatarHint')}</p>
        <div className="mb-4 card flex items-center gap-3 p-3">
          {data.effective.show_avatar && <EntityTile name="ACME Group" size={40} />}
          <div className="min-w-0"><div className="font-semibold">ACME Group</div><div className="text-xs text-muted">{t('previewLine')}</div></div>
        </div>
        <div className={label}>{t('organization')}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice active={data.organization.show_avatar} disabled={!data.can_edit_organization || org.isPending} onClick={() => org.mutate(true)} title={t('show')} />
          <Choice active={!data.organization.show_avatar} disabled={!data.can_edit_organization || org.isPending} onClick={() => org.mutate(false)} title={t('hide')} />
        </div>
        {!data.can_edit_organization && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} /> {ts('adminOnly')}</p>}
        <div className={clsx(label, 'mt-5')}>{t('mine')}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Choice active={data.mine.show_avatar === null} disabled={mine.isPending} onClick={() => mine.mutate(null)} title={t('followOrg')} hint={orgLabel} />
          <Choice active={data.mine.show_avatar === true} disabled={mine.isPending} onClick={() => mine.mutate(true)} title={t('show')} />
          <Choice active={data.mine.show_avatar === false} disabled={mine.isPending} onClick={() => mine.mutate(false)} title={t('hide')} />
        </div>
      </>),
    }, {
      key: 'tabs', icon: LayoutList, title: t('tabsTitle'), keywords: 'καρτέλες tabs σειρά απόκρυψη εμφάνιση πελάτη ενέργειες ιστορικό',
      summary: `${data.tabs.effective.filter((x) => !x.hidden).length}/${data.tabs.effective.length} · ${t(`tabsSource_${data.tabs.source}`)}`,
      content: <CustomerTabsEditor data={data} onSaved={refresh} />,
    }] }, { key: 'registries', icon: Landmark, title: t('groupRegistries'), hint: t('groupRegistriesHint'), items: [{
      key: 'aade-vies', icon: DatabaseZap, title: t('registriesTitle'), keywords: 'ΑΑΔΕ AADE VIES ΑΦΜ μητρώο gsis taxisnet άντληση ενημέρωση',
      summary: registrySummary, content: <RegistrySettingsPanel />,
    }] }]} />
  );
}

// ======================================== Indexes (default views + filters) ========================================
const VIEWS = [
  { value: 'list', icon: Users, label: 'viewList' },
  { value: 'tree', icon: ListTree, label: 'viewTree' },
  { value: 'stores', icon: Store, label: 'viewStores' },
] as const;
type ViewKey = (typeof VIEWS)[number]['value'];
type FilterCfg = {
  available: string[]; defaults: string[]; organization: string[] | null; roles: Record<string, string[]>; mine: string[] | null;
  effective: { keys: string[]; source: 'user' | 'role' | 'organization' | 'default' };
};
type IndexPrefs = {
  customers_view: { organization: ViewKey; roles: Partial<Record<string, ViewKey>>; mine: ViewKey | null; my_role: string; effective: ViewKey; source: 'user' | 'role' | 'organization' };
  filters: Record<IndexKey, FilterCfg>;
  can_edit_organization: boolean;
};

function ViewPicker({ value, onChange, disabled }: { value: ViewKey | null; onChange: (v: ViewKey) => void; disabled?: boolean }) {
  const tc = useTranslations('customers');
  return (
    <div className="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1">
      {VIEWS.map(({ value: v, icon: Icon, label: l }) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)} aria-pressed={value === v}
          className={clsx('flex min-w-0 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-sm font-medium transition disabled:opacity-60',
            value === v ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-text')}>
          <Icon size={16} className="shrink-0" /> <span className="truncate">{tc(l)}</span>
        </button>
      ))}
    </div>
  );
}

export function IndexesSettingsSection() {
  const t = useTranslations('settings.indexes');
  const ts = useTranslations('settings');
  const tc = useTranslations('customers');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'indexes'], queryFn: () => api<IndexPrefs>('/settings/indexes') });
  const roles = useRoles().data?.roles ?? [];
  const savedCount = useSavedViews().data?.views.length ?? 0;
  const [open, setOpen] = useState<string | null>(null);
  const done = () => { qc.invalidateQueries({ queryKey: ['settings', 'indexes'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast({ title: ts('saved') }); };
  const fail = () => toast({ title: ts('error') });
  const saveOrg = useMutation({ mutationFn: (body: object) => api('/settings/indexes/organization', { method: 'PUT', json: body }), onSuccess: done, onError: fail });
  const saveMine = useMutation({
    mutationFn: (body: object) => api('/me/preferences', { method: 'PUT', json: body }),
    onSuccess: done, onError: fail,
  });
  if (!data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const cv = data.customers_view;
  const ro = !data.can_edit_organization || saveOrg.isPending;
  const viewLabel = (v: ViewKey) => tc(VIEWS.find((x) => x.value === v)!.label);
  const setRoleView = (role: string, v: ViewKey | '') => {
    const r = { ...cv.roles };
    if (v) r[role] = v; else delete r[role];
    saveOrg.mutate({ customers_view: { org: cv.organization, roles: r } });
  };
  void open; void setOpen;

  const viewContent = (
    <>
        <p className="mb-4 text-sm text-muted">{t('customersHint')}</p>
        <div className={label}>{t('organization')}</div>
        <ViewPicker value={cv.organization} disabled={ro} onChange={(v) => saveOrg.mutate({ customers_view: { org: v, roles: cv.roles } })} />
        <div className={clsx(label, 'mt-5')}>{t('perRole')}</div>
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {roles.map(({ key: r, name }) => (
            <li key={r} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="text-sm font-medium">{name}{r === cv.my_role && <span className="ml-1.5 text-xs font-normal text-muted">({t('yourRole')})</span>}</span>
              <select disabled={ro} value={cv.roles[r] ?? ''} onChange={(e) => setRoleView(r, e.target.value as ViewKey | '')} aria-label={name}
                className="rounded-xl border border-border bg-surface-2 px-3 py-1.5 text-sm outline-none focus:border-primary disabled:opacity-60">
                <option value="">{t('asOrganization', { view: viewLabel(cv.organization) })}</option>
                {VIEWS.map((v) => <option key={v.value} value={v.value}>{tc(v.label)}</option>)}
              </select>
            </li>
          ))}
        </ul>
        {!data.can_edit_organization && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} /> {ts('adminOnly')}</p>}
        <div className={clsx(label, 'mt-5')}>{t('mine')}</div>
        <div className="space-y-2">
          <Choice active={cv.mine === null} disabled={saveMine.isPending} onClick={() => saveMine.mutate({ customers_view: null })} title={t('followDefault')}
            hint={viewLabel(cv.roles[cv.my_role] ?? cv.organization)} />
          <ViewPicker value={cv.mine} disabled={saveMine.isPending} onChange={(v) => saveMine.mutate({ customers_view: v })} />
        </div>
    </>
  );
  const filterItem = (ix: IndexKey, icon: typeof Users): SettingsItem => ({
    key: `filters-${ix}`, icon, title: t(`${ix}FiltersTitle`), keywords: 'φίλτρα filters',
    summary: `${t('filtersEffective', { count: data.filters[ix].effective.keys.length })} · ${t(`source_${data.filters[ix].effective.source}`)}`,
    content: (
      <FilterVisibility index={ix} cfg={data.filters[ix]} myRole={cv.my_role} roles={roles} canEdit={data.can_edit_organization}
        busy={saveOrg.isPending || saveMine.isPending}
        onSaveOrg={(org, r) => saveOrg.mutate({ [`${ix}_filters`]: { org, roles: r } })}
        onSaveMine={(keys) => saveMine.mutate({ [`${ix}_filters`]: keys })} />
    ),
  });

  return (
    <SettingsItems placeholder={ts('searchIn')} groups={[
      { key: 'customers', icon: Contact, title: t('moduleCustomers'), hint: t('moduleCustomersHint'), items: [
        { key: 'first-view', icon: LayoutList, title: t('firstViewTitle'), keywords: 'προβολή ανοίγει πρώτη default view',
          summary: `${t('effective', { view: viewLabel(cv.effective) })} · ${t(`source_${cv.source}`)}`, content: viewContent },
        { key: 'saved-views', icon: Bookmark, title: t('savedViewsTitle'), keywords: 'αποθηκευμένες προβολές saved views αγαπημένες προεπιλογή',
          summary: t('savedViewsSummary', { count: savedCount }), content: <ManageViews /> },
        filterItem('customers', Users),
        filterItem('tree', ListTree),
        filterItem('stores', Store),
      ] },
    ]} />
  );
}

/** Who sees which filters: organisation default, per-role overrides, my own choice. */
function FilterVisibility({ index, cfg, myRole, roles, canEdit, busy, onSaveOrg, onSaveMine }: {
  index: IndexKey; cfg: FilterCfg; myRole: string; roles: { key: string; name: string }[]; canEdit: boolean; busy: boolean;
  onSaveOrg: (org: string[] | null, roles: Record<string, string[]>) => void; onSaveMine: (keys: string[] | null) => void;
}) {
  const t = useTranslations('settings.indexes');
  const ts = useTranslations('settings');
  const [picking, setPicking] = useState<{ title: string; value: string[]; onSave: (keys: string[]) => void; onReset?: () => void } | null>(null);
  const orgKeys = cfg.organization ?? cfg.defaults;
  const count = (k: string[]) => t('filtersCount', { count: k.length });
  const roleSet = (key: string, keys: string[] | null) => {
    const r = { ...cfg.roles };
    if (keys) r[key] = keys; else delete r[key];
    onSaveOrg(cfg.organization, r);
  };

  return (
    <div>
      <p className="mb-4 text-sm text-muted">{t('filtersHint')}</p>

      <div className={label}>{t('organization')}</div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border px-3 py-2.5">
        <div className="min-w-0 text-sm">
          <span className="font-medium">{count(orgKeys)}</span>
          <span className="text-muted"> · {cfg.organization ? t('custom') : t('builtIn')}</span>
        </div>
        {canEdit && (
          <button disabled={busy} onClick={() => setPicking({
            title: t('organization'), value: orgKeys, onSave: (k) => onSaveOrg(k, cfg.roles),
            onReset: cfg.organization ? () => onSaveOrg(null, cfg.roles) : undefined,
          })} className={smallBtn}><PenLine size={14} /> {t('edit')}</button>
        )}
      </div>

      <div className={clsx(label, 'mt-5')}>{t('perRole')}</div>
      <ul className="divide-y divide-border rounded-2xl border border-border">
        {roles.map(({ key, name }) => {
          const own = cfg.roles[key];
          return (
            <li key={key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="min-w-0 text-sm">
                <span className="font-medium">{name}</span>{key === myRole && <span className="ml-1.5 text-xs text-muted">({t('yourRole')})</span>}
                <span className="block text-xs text-muted">{own ? `${t('custom')} · ${count(own)}` : t('asOrganizationShort')}</span>
              </span>
              {canEdit && (
                <span className="flex gap-1.5">
                  {own && <button disabled={busy} onClick={() => roleSet(key, null)} className={smallBtn}>{t('asOrganizationShort')}</button>}
                  <button disabled={busy} onClick={() => setPicking({ title: name, value: own ?? orgKeys, onSave: (k) => roleSet(key, k) })} className={smallBtn}>
                    <PenLine size={14} /> {t('edit')}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {!canEdit && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} /> {ts('adminOnly')}</p>}

      <div className={clsx(label, 'mt-5')}>{t('mine')}</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Choice active={cfg.mine === null} disabled={busy} onClick={() => onSaveMine(null)} title={t('myFollow')}
          hint={count(cfg.roles[myRole] ?? orgKeys)} />
        <Choice active={cfg.mine !== null} disabled={busy} title={t('myCustom')} hint={cfg.mine ? count(cfg.mine) : undefined}
          onClick={() => setPicking({ title: t('mine'), value: cfg.mine ?? cfg.effective.keys, onSave: (k) => onSaveMine(k) })} />
      </div>

      {picking && (
        <FilterPicker index={index} available={cfg.available} title={picking.title} value={picking.value} onClose={() => setPicking(null)}
          onSave={(k) => { picking.onSave(k); setPicking(null); }} onReset={picking.onReset ? () => { picking.onReset!(); setPicking(null); } : undefined} />
      )}
    </div>
  );
}

function FilterPicker({ index, available, title, value, onClose, onSave, onReset }: {
  index: IndexKey; available: string[]; title: string; value: string[]; onClose: () => void; onSave: (keys: string[]) => void; onReset?: () => void;
}) {
  const t = useTranslations('settings.indexes');
  const tf = useTranslations('filters');
  const ts = useTranslations('settings');
  const [sel, setSel] = useState<Set<string>>(new Set(value));
  const flip = (k: string) => { const n = new Set(sel); if (n.has(k)) n.delete(k); else n.add(k); setSel(n); };
  return (
    <Dialog title={`${t(`${index}FiltersTitle`)} · ${title}`} onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <button type="button" onClick={() => setSel(new Set(available))} className={smallBtn}>{t('selectAll')}</button>
        <button type="button" onClick={() => setSel(new Set())} className={smallBtn}>{t('selectNone')}</button>
        <span className="ml-auto self-center text-sm text-muted">{t('filtersCount', { count: sel.size })}</span>
      </div>
      <div className="space-y-3">
        {FILTER_GROUPS.map((g) => {
          const keys = available.filter((k) => k.startsWith(`${g}_`));
          if (!keys.length) return null;
          return (
            <div key={g} className="rounded-2xl border border-border p-3">
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-semibold">{tf(`g_${g}`)}</span>
                {g !== 'c' && <span className="truncate text-[11px] text-muted">{tf(`hint_${index}_${g}`)}</span>}
              </div>
              <div className="grid gap-x-3 sm:grid-cols-2">
                {keys.map((k) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-surface-2">
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--primary)]" checked={sel.has(k)} onChange={() => flip(k)} />
                    {tf(k)}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        {onReset && <button type="button" onClick={onReset} className={clsx(ghostBtn, 'sm:mr-auto')}>{t('builtIn')}</button>}
        <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
        <button type="button" onClick={() => onSave(available.filter((k) => sel.has(k)))} className={primaryBtn}><Check size={16} /> {t('save')}</button>
      </div>
    </Dialog>
  );
}

// Integrations moved to ./integrations.tsx (overview, keys, webhooks, request log, docs)
export { IntegrationsSection } from './integrations';

/** Order and visibility of the customer page tabs: organisation default + my own (or follow the organisation). */
function CustomerTabsEditor({ data, onSaved }: { data: CustomersPrefs; onSaved: () => void }) {
  const t = useTranslations('settings.customersPrefs');
  const ts = useTranslations('settings');
  const tcu = useTranslations('customer');
  const [busy, setBusy] = useState<'org' | 'mine' | null>(null);
  const nameOf = (k: string) => (k === 'actions' ? tcu('actionsTab') : k === 'activity' ? tcu('history') : k === 'tasks' ? t('tabTasks') : k === 'documents' ? t('tabDocuments') : tcu(k as never));
  const defaults: TabRow[] = data.tabs.available.map((key) => ({ key, hidden: false }));
  const save = async (who: 'org' | 'mine', rows: TabRow[] | null) => {
    setBusy(who);
    try { await api(who === 'org' ? '/settings/customers/organization' : '/me/preferences', { method: 'PUT', json: who === 'org' ? { tabs: rows } : { customer_tabs: rows } }); onSaved(); }
    finally { setBusy(null); }
  };
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">{t('tabsHint')}</p>
      <div>
        <div className="flex items-center gap-2">
          <div className={clsx(label, 'flex-1')}>{t('organization')}</div>
          {data.can_edit_organization && data.tabs.organization && <button type="button" onClick={() => save('org', null)} className="mb-2 text-xs font-medium text-primary">{t('tabsReset')}</button>}
        </div>
        <TabList rows={data.tabs.organization ?? defaults} nameOf={nameOf} disabled={!data.can_edit_organization || busy !== null} onChange={(r) => save('org', r)} />
        {!data.can_edit_organization && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} /> {ts('adminOnly')}</p>}
      </div>
      <div>
        <div className={label}>{t('mine')}</div>
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <Choice active={!data.tabs.mine} disabled={busy !== null} onClick={() => save('mine', null)} title={t('followOrg')} />
          <Choice active={!!data.tabs.mine} disabled={busy !== null} onClick={() => { if (!data.tabs.mine) save('mine', data.tabs.organization ?? defaults); }} title={t('tabsOwn')} />
        </div>
        {data.tabs.mine && <TabList rows={data.tabs.mine} nameOf={nameOf} disabled={busy !== null} onChange={(r) => save('mine', r)} />}
      </div>
    </div>
  );
}

function TabList({ rows, nameOf, disabled, onChange }: { rows: TabRow[]; nameOf: (k: string) => string; disabled: boolean; onChange: (r: TabRow[]) => void }) {
  const t = useTranslations('settings.customersPrefs');
  const move = (i: number, d: -1 | 1) => { const r = [...rows]; [r[i], r[i + d]] = [r[i + d], r[i]]; onChange(r); };
  return (
    <ul className="divide-y divide-border rounded-xl border border-border">
      {rows.map((x, i) => (
        <li key={x.key} className={clsx('flex items-center gap-2 px-3 py-2', x.hidden && 'bg-surface-2/60')}>
          <span className="w-5 text-center text-xs text-muted tabular">{i + 1}</span>
          <span className={clsx('flex-1 text-sm font-medium', x.hidden && 'text-muted line-through')}>{nameOf(x.key)}</span>
          <button type="button" disabled={disabled || x.key === 'overview'} onClick={() => onChange(rows.map((y) => (y.key === x.key ? { ...y, hidden: !y.hidden } : y)))}
            title={x.key === 'overview' ? t('tabsAlways') : x.hidden ? t('show') : t('hide')} aria-label={x.hidden ? t('show') : t('hide')}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-40">
            {x.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
          <button type="button" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={t('up')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"><ArrowUp size={15} /></button>
          <button type="button" disabled={disabled || i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('down')} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-text disabled:opacity-30"><ArrowDown size={15} /></button>
        </li>
      ))}
    </ul>
  );
}
