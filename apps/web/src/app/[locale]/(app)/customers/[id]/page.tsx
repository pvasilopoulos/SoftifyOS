'use client';
import { RegistryRefreshButton } from '@/components/registry';
import { useTabTitle } from '@/components/tabs';
import { appConfirm } from '@/components/confirm';
import { CustomerAvatar } from '@/components/customer-avatar';
import { use, useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Archive, ArchiveRestore, ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, FileText, Mail,
  NotebookPen, Pencil, Phone, Plus, Star, StickyNote, Store, Trash2,
} from 'lucide-react';
import { api, ApiError, type Activity, type Offer, type Page } from '@/lib/api';
import { useToast } from '@/components/providers';
import { date, money, relative } from '@/lib/format';
import type { Branch, Contact, CustomerDetail, Space } from '@/lib/customers';
import { Link, useRouter } from '@/i18n/navigation';
import { Avatar, EntityTile, IconButton, Skeleton, StatusBadge, Tabs } from '@/components/ui';
import { BranchDialog, ContactDialog, SpaceDialog } from '@/components/customer-dialogs';
import { ActivityEditor, CompleteDialog, TypeIcon, type EditorPreset } from '@/components/crm-editor';
import { dueLabel, tone, type Activity as CrmActivity } from '@/lib/crm';
import { BranchDetailsDisplay, SpaceLine, StoreRowParts, useCustomerCardValues } from '@/components/display-views';
import { DisplayCustomizeButton, DisplayRows } from '@/components/display';
import { DocumentsPanel } from '@/components/documents-ui';
import { TasksPanel } from '@/components/task-ui';

type Tab = 'overview' | 'subsidiaries' | 'branches' | 'contacts' | 'offers' | 'activity' | 'tasks' | 'documents';
type DialogState =
  | { kind: 'branch'; branch?: Branch }
  | { kind: 'space'; branchId: string; space?: Space }
  | { kind: 'contact'; contact?: Contact }
  | { kind: 'activity'; preset: EditorPreset }
  | null;

const activityIcon: Record<string, typeof FileText> = {
  offer_updated: FileText, meeting_done: CalendarDays, email_sent: Mail, approval: CheckCircle2, call: Phone, note: StickyNote,
};

export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('customer');
  const tc = useTranslations('customers');
  const tf = useTranslations('cform');
  const ta = useTranslations('activity');
  const td = useTranslations('docs');
  const tt = useTranslations('tasks');
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const sp = useSearchParams();
  const focusBranch = sp.get('branch');
  const [tab, setTab] = useState<Tab>(() => (['overview','subsidiaries','branches','contacts','offers','activity'].includes(sp.get('tab') ?? '') ? sp.get('tab') as Tab : 'overview'));
  const [dialog, setDialog] = useState<DialogState>(null);
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api(`/customers/${id}/archive`, { method: 'POST', json: { archived } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', id] }); qc.invalidateQueries({ queryKey: ['customers'] }); },
  });

  useTabTitle(data?.customer.name);
  if (isLoading || !data) {
    return <div className="space-y-4"><Skeleton className="h-10 w-40" /><Skeleton className="h-32" /><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  }
  const c = data.customer;
  const s = data.stats;
  const primary = data.contacts.find((x) => x.is_primary) ?? data.contacts[0];
  const phone = c.phone || c.mobile || primary?.phone || primary?.mobile;
  const email = c.email || primary?.email;
  const rel = (d: string) => relative(d, locale, { today: ta('today'), yesterday: ta('yesterday') });
  const termsLabel = (x: string | null) => (x ? (tf.has(`terms.${x}`) ? tf(`terms.${x}` as never) : x) : null);
  const sourceLabel = (x: string | null) => (x ? (tf.has(`sources.${x}`) ? tf(`sources.${x}` as never) : x) : null);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: t('overview') },
    ...(c.kind === 'group' ? [{ value: 'subsidiaries' as const, label: `${t('subsidiaries')} (${data.subsidiaries.length})` }] : []),
    { value: 'branches', label: `${t('branches')} (${data.branches.length})` },
    { value: 'contacts', label: `${t('contacts')} (${data.contacts.length})` },
    { value: 'offers', label: t('offers') },
    { value: 'activity', label: t('activity') },
    { value: 'tasks', label: tt('title') },
    { value: 'documents', label: td('title') },
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.push('/customers')}><ArrowLeft size={22} /></IconButton>
        <span className="flex-1 text-lg font-semibold">{t('back')}</span>
        {data.can.archive && (
          <IconButton label={c.archived_at ? t('restore') : t('archive')}
            onClick={async () => { if (c.archived_at || await appConfirm(t('confirmArchive'))) archive.mutate(!c.archived_at); }}>
            {c.archived_at ? <ArchiveRestore size={20} /> : <Archive size={20} />}
          </IconButton>
        )}
        {data.can.archive && (
          <IconButton label={t('deleteCustomer')} className="text-danger hover:bg-danger-soft" onClick={async () => {
            if (!(await appConfirm(t('confirmDeleteCustomer', { name: c.name }), { danger: true, confirmLabel: t('delete') }))) return;
            try {
              await api(`/customers/${id}`, { method: 'DELETE' });
              qc.invalidateQueries({ queryKey: ['customers'] });
              toast({ title: t('customerDeleted') });
              router.push('/customers');
            } catch (e) {
              const b = e instanceof ApiError ? (e.body as { offers?: number; subsidiaries?: number }) : {};
              toast({ title: t('cannotDelete'), body: e instanceof ApiError && e.code === 'has_offers' ? t('deleteHasOffers', { n: b.offers ?? 0 })
                : e instanceof ApiError && e.code === 'has_subsidiaries' ? t('deleteHasSubsidiaries', { n: b.subsidiaries ?? 0 }) : undefined });
            }
          }}>
            <Trash2 size={19} />
          </IconButton>
        )}
        {data.can.edit && <RegistryRefreshButton customerId={id} hasVat={!!c.vat} />}
        {data.can.edit && (
          <Link href={`/customers/${id}/edit`} className="flex items-center gap-1.5 rounded-full bg-primary-soft px-4 py-2 text-sm font-semibold text-primary">
            <Pencil size={16} /> {t('edit')}
          </Link>
        )}
      </header>

      {c.archived_at && (
        <div className="flex items-center gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
          <Archive size={16} /> {t('archived')} · {date(c.archived_at, locale)}
        </div>
      )}

      {/* Identity */}
      <section className="card flex items-start gap-4 p-4 sm:p-5">
        <CustomerAvatar name={c.name} size={72} />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold leading-tight sm:text-2xl">{c.name}</h1>
          <div className="mt-0.5 text-sm text-muted">
            {c.trade_name && <span className="font-medium text-text">{c.trade_name} · </span>}
            {c.kind === 'group' ? tc('group') : tc('company')}
            {c.parent_id && <> · <Link href={`/customers/${c.parent_id}`} className="text-primary hover:underline">{c.parent_name}</Link></>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={c.status} />
            <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted">{c.code}</span>
            {c.category && <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-medium text-warning">{c.category}</span>}
            {c.tags.map((tag) => <span key={tag} className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">#{tag}</span>)}
          </div>
        </div>
      </section>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-2">
        <QuickAction icon={Phone} label={t('call')} href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined} onClick={() => setDialog({ kind: 'activity', preset: { type: 'call', status: 'done', customer_id: c.id, customer_name: c.name } })} />
        <QuickAction icon={Mail} label={t('email')} href={email ? `mailto:${email}` : undefined} onClick={() => setDialog({ kind: 'activity', preset: { type: 'email', status: 'done', customer_id: c.id, customer_name: c.name } })} />
        <QuickAction icon={CalendarDays} label={t('meeting')} onClick={() => setDialog({ kind: 'activity', preset: { type: 'meeting', status: 'planned', customer_id: c.id, customer_name: c.name } })} />
        <QuickAction icon={NotebookPen} label={t('kindNote')} onClick={() => setDialog({ kind: 'activity', preset: { type: 'note', status: 'done', customer_id: c.id, customer_name: c.name } })} />
      </div>

      <UpcomingActivities customerId={c.id} customerName={c.name} />

      <Link href={`/offers/new?customer=${c.id}&name=${encodeURIComponent(c.name)}`}
        className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3 font-semibold text-white shadow-lg shadow-primary/25">
        <FileText size={18} /> {tc('newOffer')}
      </Link>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label={t('annualValue')} value={money(c.annual_value, locale, 0)} />
        <Kpi label={t('openAmount')} value={money(s.open_amount, locale, 0)} sub={t('offersCount', { count: s.open_offers })} />
        <Kpi label={t('wonAmount')} value={money(s.won_amount, locale, 0)} sub={t('offersCount', { count: s.won_offers })} tone="text-success" />
        <Kpi label={t('winRate')} value={s.win_rate === null ? '—' : `${s.win_rate}%`}
          sub={s.last_activity_at ? `${t('lastActivity')}: ${rel(s.last_activity_at)}` : undefined} />
      </div>

      <Tabs value={tab} onChange={setTab} options={tabs} />

      {tab === 'overview' && (
        <CustomerCard c={c as unknown as Record<string, unknown>}
          primary={primary ? `${primary.full_name}${primary.role_title ? ` · ${primary.role_title}` : ''}` : null}
          termsLabel={termsLabel} sourceLabel={sourceLabel} />
      )}

      {tab === 'subsidiaries' && (
        <div className="space-y-2">
          {data.can.edit && (
            <Link href={`/customers/new?parent=${c.id}&parentName=${encodeURIComponent(c.name)}`} className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-semibold text-primary">
              <Plus size={18} /> {t('addSubsidiary')}
            </Link>
          )}
          {data.subsidiaries.length === 0 ? <p className="py-8 text-center text-muted">{t('noSubsidiaries')}</p> : data.subsidiaries.map((x) => (
            <Link key={x.id} href={`/customers/${x.id}`} className="card flex items-center gap-3 p-3.5 hover:border-primary/40">
              <CustomerAvatar name={x.name} size={44} />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{x.name}</div>
                <div className="text-xs text-muted">{x.code} · {t('branchesCount', { count: x.branches_count })}</div>
              </div>
              <StatusBadge status={x.status} />
              <ChevronRight size={18} className="text-muted" />
            </Link>
          ))}
        </div>
      )}

      {tab === 'branches' && (
        <div className="space-y-3">
          {data.can.edit && (
            <button onClick={() => setDialog({ kind: 'branch' })} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-semibold text-primary">
              <Plus size={18} /> {t('addBranch')}
            </button>
          )}
          {data.branches.length === 0 && <p className="py-8 text-center text-muted">{t('noBranches')}</p>}
          {data.branches.map((b) => (
            <BranchCard key={b.id} branch={b} canEdit={data.can.edit} focus={b.id === focusBranch}
              onEdit={() => setDialog({ kind: 'branch', branch: b })}
              onAddSpace={() => setDialog({ kind: 'space', branchId: b.id })}
              onEditSpace={(sp) => setDialog({ kind: 'space', branchId: b.id, space: sp })} />
          ))}
        </div>
      )}

      {tab === 'contacts' && (
        <div className="space-y-2">
          {data.can.edit && (
            <button onClick={() => setDialog({ kind: 'contact' })} className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-semibold text-primary">
              <Plus size={18} /> {t('addContact')}
            </button>
          )}
          {data.contacts.length === 0 ? <p className="py-8 text-center text-muted">{t('noContacts')}</p> : data.contacts.map((p) => (
            <div key={p.id} className="card flex items-center gap-3 p-3.5">
              <Avatar name={p.full_name} size={42} />
              <button onClick={() => data.can.edit && setDialog({ kind: 'contact', contact: p })} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-1.5 font-semibold">{p.full_name}{p.is_primary && <Star size={14} className="fill-warning text-warning" />}</div>
                <div className="truncate text-sm text-muted">{[p.role_title, p.email].filter(Boolean).join(' · ')}</div>
              </button>
              {p.email && <a href={`mailto:${p.email}`} aria-label="email" className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-primary"><Mail size={16} /></a>}
              {(p.mobile || p.phone) && <a href={`tel:${(p.mobile || p.phone)!.replace(/\s/g, '')}`} aria-label="call" className="grid h-9 w-9 place-items-center rounded-full bg-success-soft text-success"><Phone size={16} /></a>}
            </div>
          ))}
        </div>
      )}

      {tab === 'offers' && <CustomerOffers customerId={id} />}
      {tab === 'documents' && <DocumentsPanel links={{ customer_id: id }} />}
      {tab === 'tasks' && <TasksPanel customerId={id} customerName={c.name} />}

      {tab === 'activity' && (
        <div className="space-y-3">
          {data.can.edit && (
            <button onClick={() => setDialog({ kind: 'activity', preset: { type: 'call', status: 'done', customer_id: c.id, customer_name: c.name } })} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-soft py-3 text-sm font-semibold text-primary">
              <Plus size={18} /> {t('logActivity')}
            </button>
          )}
          <ActivityTimeline customerId={id} />
        </div>
      )}

      {dialog?.kind === 'branch' && <BranchDialog customerId={id} branch={dialog.branch} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'space' && <SpaceDialog customerId={id} branchId={dialog.branchId} space={dialog.space} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'contact' && <ContactDialog customerId={id} contact={dialog.contact} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'activity' && <ActivityEditor preset={dialog.preset} onClose={() => setDialog(null)} />}
    </div>
  );
}

function QuickAction({ icon: Icon, label, href, onClick }: { icon: typeof Phone; label: string; href?: string; onClick: () => void }) {
  const cls = 'card flex flex-col items-center gap-1.5 py-3 text-xs font-medium transition hover:border-primary/40';
  // With a phone/email: open the dialer/mail app AND offer to log it; otherwise just log the activity
  return href
    ? <a href={href} onClick={() => setTimeout(onClick, 400)} className={cls}><Icon size={20} className="text-primary" /> {label}</a>
    : <button onClick={onClick} className={cls}><Icon size={20} className="text-primary" /> {label}</button>;
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="card min-w-0 p-4">
      <div className="truncate text-xs text-muted">{label}</div>
      <div className={clsx('tabular mt-1 truncate text-xl font-bold', tone)}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-xs text-muted">{sub}</div>}
    </div>
  );
}

/** Overview: sections and fields from Settings → Module Forms → Display (customer card). */
function CustomerCard({ c, primary, termsLabel, sourceLabel }: {
  c: Record<string, unknown>; primary: string | null; termsLabel: (x: string | null) => string | null; sourceLabel: (x: string | null) => string | null;
}) {
  const values = useCustomerCardValues(c, { primary, termsLabel, sourceLabel });
  const LONG = new Set(['address', 'billing', 'notes']);
  return (
    <div className="space-y-2">
      <div className="flex justify-end"><DisplayCustomizeButton surface="disp_customer_card" /></div>
      <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <DisplayRows surface="disp_customer_card" values={values} render={(s, rows) => (
          <InfoCard title={s.title} wide={s.key === 'notes'}>
            {rows.map((r) => <Row key={r.key} k={r.label} v={r.value} icon={r.icon} wrap={LONG.has(r.key) || !r.label} />)}
          </InfoCard>
        )} />
      </div>
    </div>
  );
}

function InfoCard({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={clsx('card p-4', wide && 'lg:col-span-2')}>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Row({ k, v, icon: Icon, wrap }: { k: string; v: ReactNode; icon?: typeof Mail; wrap?: boolean }) {
  return (
    <div className={clsx('flex justify-between gap-4 py-2.5 text-sm', wrap ? 'items-start' : 'items-center')}>
      {(k || Icon) && <dt className="flex shrink-0 items-center gap-1.5 text-muted">{Icon && <Icon size={14} />}{k}</dt>}
      <dd className={clsx('min-w-0 font-medium', wrap ? (k ? 'text-right' : 'flex-1') : 'truncate text-right')}>{v || <span className="text-muted">—</span>}</dd>
    </div>
  );
}

/** Store card: tap to expand its spaces (add / edit inline). */
function BranchCard({ branch: b, canEdit, onEdit, onAddSpace, onEditSpace, focus }: {
  branch: Branch; canEdit: boolean; onEdit: () => void; onAddSpace: () => void; onEditSpace: (s: Space) => void; focus?: boolean;
}) {
  const t = useTranslations('customer');
  const qc = useQueryClient();
  const [open, setOpen] = useState(!!focus);
  // Deep link from the "Stores" view: open this store and bring it into view
  const ref = useCallback((el: HTMLDivElement | null) => { if (el && focus) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [focus]);
  const del = useMutation({
    mutationFn: () => api(`/branches/${b.id}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer'] }); qc.invalidateQueries({ queryKey: ['customers'] }); },
  });
  return (
    <div ref={ref} className={clsx('card overflow-hidden transition', open && 'border-primary/40', focus && 'ring-2 ring-primary/40')}>
      <div className="flex items-center gap-1 pr-2">
        <button onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 p-3.5 text-left">
          <EntityTile name={b.name} size={52} />
          <StoreRowParts b={{ ...b, spaces_count: b.spaces.length } as unknown as Record<string, unknown>}>{(p) => (
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-baseline gap-x-1 font-semibold"><span className="truncate">{b.name}</span>{p.title}</div>
            <div className="text-sm text-muted">{p.line}</div>
            <div className="mt-1 empty:hidden">{p.badges}</div>
          </div>
          )}</StoreRowParts>
          <ChevronDown size={20} className={clsx('shrink-0 text-muted transition-transform', open && 'rotate-180 text-primary')} />
        </button>
        {canEdit && (
          <>
            <IconButton label={t('editBranch')} onClick={onEdit} className="text-muted hover:text-primary"><Pencil size={17} /></IconButton>
            <IconButton label={t('deleteBranch')} className="text-muted hover:bg-danger-soft hover:text-danger"
              onClick={async () => { if (await appConfirm(t('confirmDeleteBranch', { name: b.name }))) del.mutate(); }}><Trash2 size={17} /></IconButton>
          </>
        )}
      </div>
      {open && (
        <div className="border-t border-border bg-surface-2/50 px-3.5 pb-3.5 pt-3">
          <div className="mb-3 flex items-start gap-2"><div className="min-w-0 flex-1"><BranchDetailsDisplay b={b as unknown as Record<string, unknown>} /></div><DisplayCustomizeButton surface="disp_store_details" /></div>
          {b.spaces.length === 0 ? <p className="py-2 text-sm text-muted">{t('noSpaces')}</p> : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {b.spaces.map((sp) => (
                <li key={sp.id}>
                  <button onClick={() => canEdit && onEditSpace(sp)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary"><Store size={16} /></span>
                    <div className="min-w-0 flex-1 text-sm"><SpaceLine s={sp as unknown as Record<string, unknown>} /></div>
                    {canEdit && <Pencil size={14} className="text-muted" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="mt-3 flex gap-2">
              <button onClick={onAddSpace} className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary-soft py-2.5 text-sm font-semibold text-primary"><Plus size={16} /> {t('addSpace')}</button>
              <button onClick={onEdit} className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium"><Pencil size={15} /> {t('edit')}</button>
              <button onClick={async () => { if (await appConfirm(t('confirmDeleteBranch', { name: b.name }))) del.mutate(); }}
                className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm font-medium text-danger"><Trash2 size={15} /> <span className="hidden sm:inline">{t('delete')}</span></button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CustomerOffers({ customerId }: { customerId: string }) {
  const t = useTranslations('customer');
  const locale = useLocale();
  const { data, isLoading } = useQuery({ queryKey: ['offers', 'customer', customerId], queryFn: () => api<Page<Offer>>(`/offers?customer=${customerId}&limit=50`) });
  if (isLoading) return <Skeleton className="h-40" />;
  if (!data?.items.length) return <p className="py-8 text-center text-muted">{t('noOffers')}</p>;
  return (
    <ul className="space-y-2">
      {data.items.map((o) => (
        <li key={o.id}>
          <Link href={`/offers/${o.id}`} className="card flex items-center gap-3 p-3.5 hover:border-primary/40">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-soft text-primary"><FileText size={18} /></span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{o.number} <span className="font-normal text-muted">v.{String(o.current_version).padStart(2, '0')}</span></div>
              <div className="text-xs text-muted">{date(o.created_at, locale)}{o.branch_name && ` · ${o.branch_name}`}</div>
            </div>
            <div className="text-right">
              <div className="tabular font-semibold">{money(o.total_amount, locale)}</div>
              <StatusBadge status={o.status} />
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Planned activities of this customer (next steps), with quick complete. */
function UpcomingActivities({ customerId, customerName }: { customerId: string; customerName: string }) {
  const t = useTranslations('crm');
  const locale = useLocale();
  const [open, setOpen] = useState<string | null>(null);
  const [completing, setCompleting] = useState<CrmActivity | null>(null);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ['crm', 'customer', customerId],
    queryFn: () => api<{ items: CrmActivity[] }>(`/crm/activities?customer_id=${customerId}&scope=all&status=open&sort=due&limit=5`),
  });
  const items = q.data?.items ?? [];
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="flex-1 text-sm font-semibold">{t('nextSteps')}</span>
        <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm font-medium text-primary"><Plus size={15} /> {t('schedule')}</button>
      </header>
      {!items.length ? <p className="px-4 py-3 text-sm text-muted">{q.isLoading ? '…' : t('noNextSteps')}</p> : (
        <ul className="divide-y divide-border">
          {items.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
              <button onClick={() => setCompleting(a)} aria-label={t('complete')} className="grid h-7 w-7 place-items-center rounded-full text-muted hover:bg-success-soft hover:text-success"><CheckCircle2 size={19} /></button>
              <button onClick={() => setOpen(a.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
                <TypeIcon icon={a.type_icon} color={a.type_color} size={30} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{a.subject}</span>
                  <span className="block truncate text-xs text-muted">{[a.branch_name, a.owner_name].filter(Boolean).join(' · ')}</span></span>
                <span className={`shrink-0 text-xs font-medium ${a.overdue ? 'text-danger' : 'text-muted'}`}>{dueLabel(a.due_at, locale, (k) => t(`d_${k}`), a.all_day) || t('noDate')}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <ActivityEditor id={open} onClose={() => setOpen(null)} />}
      {adding && <ActivityEditor preset={{ customer_id: customerId, customer_name: customerName, type: 'call' }} onClose={() => setAdding(false)} />}
      {completing && <CompleteDialog activity={completing} onClose={() => setCompleting(null)} onDone={() => setCompleting(null)} />}
    </section>
  );
}

function ActivityTimeline({ customerId }: { customerId: string }) {
  const ta = useTranslations('activity');
  const tcm = useTranslations('common');
  const locale = useLocale();
  const q = useInfiniteQuery({
    queryKey: ['activities', customerId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api<Page<Activity>>(`/customers/${customerId}/activities?limit=20${pageParam ? `&cursor=${pageParam}` : ''}`),
    getNextPageParam: (l) => l.nextCursor,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="card p-4">
      <ol className="relative space-y-5 before:absolute before:bottom-2 before:left-[19px] before:top-2 before:w-px before:bg-border">
        {rows.map((a) => {
          const Icon = activityIcon[a.kind] ?? StickyNote;
          const crm = (a as { source?: string }).source === 'crm' ? (a as unknown as { type_icon: string | null; type_color: string | null; type_name: string | null; outcome_name: string | null; outcome_color: string | null }) : null;
          return (
            <li key={a.id} className="relative flex gap-3">
              {crm ? <span className="z-10 rounded-full ring-4 ring-surface"><TypeIcon icon={crm.type_icon} color={crm.type_color} size={40} /></span>
                : <span className={`z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ${a.kind === 'approval' ? 'bg-success-soft text-success' : 'bg-surface-2 text-muted'}`}><Icon size={18} /></span>}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{a.title}{crm?.outcome_name && <span className={`ml-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${tone(crm.outcome_color)}`}>{crm.outcome_name}</span>}</span>
                  <span className="shrink-0 text-xs text-muted">{relative(a.occurred_at, locale, { today: ta('today'), yesterday: ta('yesterday') })}</span>
                </div>
                {a.body && <div className="whitespace-pre-line text-sm text-muted">{a.body}</div>}
                {a.actor_name && <div className="mt-1 flex items-center gap-1.5 text-xs text-muted"><Avatar name={a.actor_name} size={18} />{a.actor_name}</div>}
              </div>
            </li>
          );
        })}
      </ol>
      {q.hasNextPage && (
        <button onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage} className="mt-4 w-full rounded-xl bg-primary-soft py-2.5 text-sm font-semibold text-primary">
          {q.isFetchingNextPage ? tcm('loading') : tcm('loadMore')}
        </button>
      )}
    </div>
  );
}

