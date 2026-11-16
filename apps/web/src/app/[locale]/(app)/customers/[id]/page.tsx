'use client';
import { CustomerAvatar } from '@/components/customer-avatar';
import { use, useCallback, useState, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import clsx from 'clsx';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import {
  Archive, ArchiveRestore, ArrowLeft, CalendarDays, CheckCircle2, ChevronDown, ChevronRight, FileText, Globe, Mail,
  MapPin, NotebookPen, Pencil, Phone, Plus, Smartphone, Star, StickyNote, Store, Trash2,
} from 'lucide-react';
import { api, type Activity, type Offer, type Page } from '@/lib/api';
import { date, money, relative } from '@/lib/format';
import type { Branch, Contact, CustomerDetail, Space } from '@/lib/customers';
import { Link, useRouter } from '@/i18n/navigation';
import { Avatar, EntityTile, IconButton, Skeleton, StatusBadge, Tabs } from '@/components/ui';
import { ActivityDialog, BranchDialog, ContactDialog, SpaceDialog } from '@/components/customer-dialogs';
import { BranchDetails } from '@/components/branch-details';

type Tab = 'overview' | 'subsidiaries' | 'branches' | 'contacts' | 'offers' | 'activity';
type DialogState =
  | { kind: 'branch'; branch?: Branch }
  | { kind: 'space'; branchId: string; space?: Space }
  | { kind: 'contact'; contact?: Contact }
  | { kind: 'activity'; initial?: 'call' | 'email_sent' | 'meeting_done' | 'note' }
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
  const locale = useLocale();
  const router = useRouter();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const focusBranch = sp.get('branch');
  const [tab, setTab] = useState<Tab>(() => (['overview','subsidiaries','branches','contacts','offers','activity'].includes(sp.get('tab') ?? '') ? sp.get('tab') as Tab : 'overview'));
  const [dialog, setDialog] = useState<DialogState>(null);
  const { data, isLoading } = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/customers/${id}`) });
  const archive = useMutation({
    mutationFn: (archived: boolean) => api(`/customers/${id}/archive`, { method: 'POST', json: { archived } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['customer', id] }); qc.invalidateQueries({ queryKey: ['customers'] }); },
  });

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
  ];

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-1">
        <IconButton label="back" onClick={() => router.push('/customers')}><ArrowLeft size={22} /></IconButton>
        <span className="flex-1 text-lg font-semibold">{t('back')}</span>
        {data.can.archive && (
          <IconButton label={c.archived_at ? t('restore') : t('archive')}
            onClick={() => { if (c.archived_at || confirm(t('confirmArchive'))) archive.mutate(!c.archived_at); }}>
            {c.archived_at ? <ArchiveRestore size={20} /> : <Archive size={20} />}
          </IconButton>
        )}
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
        <QuickAction icon={Phone} label={t('call')} href={phone ? `tel:${phone.replace(/\s/g, '')}` : undefined} onClick={() => setDialog({ kind: 'activity', initial: 'call' })} />
        <QuickAction icon={Mail} label={t('email')} href={email ? `mailto:${email}` : undefined} onClick={() => setDialog({ kind: 'activity', initial: 'email_sent' })} />
        <QuickAction icon={CalendarDays} label={t('meeting')} onClick={() => setDialog({ kind: 'activity', initial: 'meeting_done' })} />
        <QuickAction icon={NotebookPen} label={t('kindNote')} onClick={() => setDialog({ kind: 'activity', initial: 'note' })} />
      </div>

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
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <InfoCard title={t('basics')}>
            <Row k={t('code')} v={c.code} />
            <Row k={t('vat')} v={c.vat} />
            <Row k={t('taxOffice')} v={c.tax_office} />
            <Row k={t('gemi')} v={c.gemi} />
            <Row k={t('activityField')} v={c.activity} />
            <Row k={t('manager')} v={c.account_manager_name && <span className="flex items-center gap-2"><Avatar name={c.account_manager_name} size={22} />{c.account_manager_name}</span>} />
            <Row k={t('source')} v={sourceLabel(c.source)} />
            <Row k={t('prefecture')} v={c.address_region} />
            <Row k={t('geoZone')} v={c.geo_zone_name} />
          </InfoCard>
          <InfoCard title={t('contactInfo')}>
            <Row k={t('email')} v={c.email && <a href={`mailto:${c.email}`} className="text-primary hover:underline">{c.email}</a>} icon={Mail} />
            <Row k={t('phone')} v={c.phone && <a href={`tel:${c.phone}`} className="text-primary">{c.phone}</a>} icon={Phone} />
            <Row k={t('mobile')} v={c.mobile && <a href={`tel:${c.mobile}`} className="text-primary">{c.mobile}</a>} icon={Smartphone} />
            <Row k="Web" v={c.website && <a href={c.website.startsWith('http') ? c.website : `https://${c.website}`} target="_blank" rel="noopener" className="text-primary hover:underline">{c.website}</a>} icon={Globe} />
            {primary && <Row k={t('primary')} v={`${primary.full_name}${primary.role_title ? ` · ${primary.role_title}` : ''}`} icon={Star} />}
          </InfoCard>
          <InfoCard title={t('address')}>
            <p className="text-sm leading-relaxed">
              {[c.address_street, [c.address_postal, c.address_city].filter(Boolean).join(' '), c.address_region, c.address_country].filter(Boolean).join(', ') || '—'}
            </p>
            <div className="mt-3 text-xs font-medium text-muted">{t('billing')}</div>
            <p className="text-sm">{c.billing_address
              ? [c.billing_address.street, [c.billing_address.postal, c.billing_address.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
              : t('sameAsAddress')}</p>
          </InfoCard>
          <InfoCard title={t('terms')}>
            <Row k={t('paymentTerms')} v={termsLabel(c.payment_terms)} />
            <Row k={t('creditLimit')} v={c.credit_limit ? money(c.credit_limit, locale, 0) : null} />
            <Row k={t('discount')} v={Number(c.discount) ? `${Number(c.discount)}%` : null} />
          </InfoCard>
          {c.notes && <InfoCard title={t('notes')} wide><p className="whitespace-pre-line text-sm">{c.notes}</p></InfoCard>}
        </div>
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

      {tab === 'activity' && (
        <div className="space-y-3">
          {data.can.edit && (
            <button onClick={() => setDialog({ kind: 'activity', initial: 'note' })} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary-soft py-3 text-sm font-semibold text-primary">
              <Plus size={18} /> {t('logActivity')}
            </button>
          )}
          <ActivityTimeline customerId={id} />
        </div>
      )}

      {dialog?.kind === 'branch' && <BranchDialog customerId={id} branch={dialog.branch} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'space' && <SpaceDialog customerId={id} branchId={dialog.branchId} space={dialog.space} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'contact' && <ContactDialog customerId={id} contact={dialog.contact} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'activity' && <ActivityDialog customerId={id} initialKind={dialog.initial} onClose={() => setDialog(null)} />}
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

function InfoCard({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <section className={clsx('card p-4', wide && 'lg:col-span-2')}>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <dl className="divide-y divide-border">{children}</dl>
    </section>
  );
}

function Row({ k, v, icon: Icon }: { k: string; v: ReactNode; icon?: typeof Mail }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 text-sm">
      <dt className="flex shrink-0 items-center gap-1.5 text-muted">{Icon && <Icon size={14} />}{k}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{v || <span className="text-muted">—</span>}</dd>
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
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{b.name}</div>
            {b.trade_name && <div className="truncate text-xs font-medium text-primary">{b.trade_name}</div>}
            {(b.city || b.address) && <div className="flex items-center gap-1 truncate text-sm text-muted"><MapPin size={14} className="shrink-0" />{[b.address, b.city].filter(Boolean).join(', ')}</div>}
            <div className="mt-1 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">{t('spaces', { count: b.spaces.length })}</span>
              {b.tour_name && <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-xs text-info">{b.tour_name}</span>}
              <StatusBadge status={b.status} />
            </div>
          </div>
          <ChevronDown size={20} className={clsx('shrink-0 text-muted transition-transform', open && 'rotate-180 text-primary')} />
        </button>
        {canEdit && (
          <>
            <IconButton label={t('editBranch')} onClick={onEdit} className="text-muted hover:text-primary"><Pencil size={17} /></IconButton>
            <IconButton label={t('deleteBranch')} className="text-muted hover:bg-danger-soft hover:text-danger"
              onClick={() => { if (confirm(t('confirmDeleteBranch', { name: b.name }))) del.mutate(); }}><Trash2 size={17} /></IconButton>
          </>
        )}
      </div>
      {open && (
        <div className="border-t border-border bg-surface-2/50 px-3.5 pb-3.5 pt-3">
          <div className="mb-3"><BranchDetails b={b} /></div>
          {b.spaces.length === 0 ? <p className="py-2 text-sm text-muted">{t('noSpaces')}</p> : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-surface">
              {b.spaces.map((sp) => (
                <li key={sp.id}>
                  <button onClick={() => canEdit && onEditSpace(sp)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary"><Store size={16} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{sp.name}</div>
                      <div className="text-xs text-muted">{t(`spaceKinds.${sp.kind}` as never)}{sp.area_sqm && ` · ${Number(sp.area_sqm)} m²`}</div>
                    </div>
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
              <button onClick={() => { if (confirm(t('confirmDeleteBranch', { name: b.name }))) del.mutate(); }}
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
          return (
            <li key={a.id} className="relative flex gap-3">
              <span className={`z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ${a.kind === 'approval' ? 'bg-success-soft text-success' : 'bg-primary-soft text-primary'}`}><Icon size={18} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold">{a.title}</span>
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

