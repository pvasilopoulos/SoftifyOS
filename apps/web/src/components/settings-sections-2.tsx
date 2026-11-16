'use client';
// Settings: "Customers" display preferences and "Integrations" (API keys + guide).
import { useEffect, useState, type ReactNode } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { Ban, Check, Copy, ExternalLink, KeyRound, Loader2, Plus, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { relative } from '@/lib/format';
import { Card } from './settings-sections';
import { Dialog } from './customer-dialogs';
import { EntityTile } from './ui';
import { useToast } from './providers';

const primaryBtn = 'flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const ghostBtn = 'flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 font-medium';
const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary';

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

// ======================================== Customers display ========================================
type CustomersPrefs = { organization: { show_avatar: boolean }; mine: { show_avatar: boolean | null }; effective: { show_avatar: boolean }; can_edit_organization: boolean };

export function CustomersSettingsSection() {
  const t = useTranslations('settings.customersPrefs');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['settings', 'customers'], queryFn: () => api<CustomersPrefs>('/settings/customers') });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['settings', 'customers'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast({ title: ts('saved') }); };
  const org = useMutation({ mutationFn: (show: boolean) => api('/settings/customers/organization', { method: 'PUT', json: { show_avatar: show } }), onSuccess: refresh });
  const mine = useMutation({ mutationFn: (v: boolean | null) => api('/me/preferences', { method: 'PUT', json: { show_customer_avatar: v } }), onSuccess: refresh });
  if (!data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const orgLabel = data.organization.show_avatar ? t('shown') : t('hidden');

  const Preview = ({ show }: { show: boolean }) => (
    <div className="card flex items-center gap-3 p-3">
      {show && <EntityTile name="ACME Group" size={40} />}
      <div className="min-w-0"><div className="font-semibold">ACME Group</div><div className="text-xs text-muted">{t('previewLine')}</div></div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card title={t('avatarTitle')} description={t('avatarHint')}>
        <div className="mb-4"><Preview show={data.effective.show_avatar} /></div>

        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t('organization')}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice active={data.organization.show_avatar} disabled={!data.can_edit_organization || org.isPending} onClick={() => org.mutate(true)} title={t('show')} />
          <Choice active={!data.organization.show_avatar} disabled={!data.can_edit_organization || org.isPending} onClick={() => org.mutate(false)} title={t('hide')} />
        </div>
        {!data.can_edit_organization && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><ShieldCheck size={13} /> {ts('adminOnly')}</p>}

        <div className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted">{t('mine')}</div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Choice active={data.mine.show_avatar === null} disabled={mine.isPending} onClick={() => mine.mutate(null)} title={t('followOrg')} hint={orgLabel} />
          <Choice active={data.mine.show_avatar === true} disabled={mine.isPending} onClick={() => mine.mutate(true)} title={t('show')} />
          <Choice active={data.mine.show_avatar === false} disabled={mine.isPending} onClick={() => mine.mutate(false)} title={t('hide')} />
        </div>
      </Card>
    </div>
  );
}

// ======================================== Integrations (API) ========================================
type ApiKey = { id: string; name: string; prefix: string; scope: 'read' | 'write'; created_at: string; last_used_at: string | null; requests: string; revoked_at: string | null; created_by_name: string | null };

function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-xl bg-[#17142b] p-3 pr-12 text-xs leading-relaxed text-[#e9e6f5]"><code>{children}</code></pre>
      <button onClick={async () => { await navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        aria-label="copy" className="absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-white/10 text-white hover:bg-white/20">
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export function IntegrationsSection() {
  const t = useTranslations('settings.integrations');
  const ts = useTranslations('settings');
  const ta = useTranslations('activity');
  const locale = useLocale();
  const toast = useToast();
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['settings', 'api-keys'], queryFn: () => api<ApiKey[]>('/settings/api-keys'), retry: false });
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/settings/api-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'api-keys'] }),
    onError: () => toast({ title: ts('error') }),
  });
  // Set after mount so server and client render the same HTML (no hydration mismatch)
  const [origin, setOrigin] = useState('https://app.softify.gr');
  useEffect(() => setOrigin(window.location.origin), []);

  if (keys.error instanceof ApiError && keys.error.status === 403) {
    return <div className="flex items-center gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info"><ShieldCheck size={16} /> {ts('adminOnly')}</div>;
  }

  const example = {
    ping: `curl ${origin}/api/v1/ping \\\n  -H "Authorization: Bearer $SOFTIFY_KEY"`,
    customers: `curl -X POST ${origin}/api/v1/customers/batch \\
  -H "Authorization: Bearer $SOFTIFY_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[
    {"external_id":"ERP-G-1","kind":"group","name":"ACME Group","geo_zone":"Αττική"},
    {"external_id":"ERP-1001","name":"ACME Retail Α.Ε.","vat":"094014201",
     "parent_external_id":"ERP-G-1","account_manager_email":"sales@example.com",
     "address":{"street":"Σταδίου 1","city":"Αθήνα","postal":"10562","region":"Αττικής"}}
  ]}'`,
    branches: `curl -X POST ${origin}/api/v1/branches/batch \\
  -H "Authorization: Bearer $SOFTIFY_KEY" -H "Content-Type: application/json" \\
  -d '{"items":[{"external_id":"ERP-ST-55","customer_external_id":"ERP-1001",
    "name":"Κατάστημα Σταδίου","city":"Αθήνα","region":"Αττικής","geo_zone":"Αττική",
    "fee_schedule":"Βασικό αμοιβολόγιο","tour":"Εξόρμηση Αττικής",
    "ongoing_status":"Σε εξέλιξη","seasonality":"all_year"}]}'`,
    spaces: `curl -X POST ${origin}/api/v1/spaces/batch \\
  -H "Authorization: Bearer $SOFTIFY_KEY" -H "Content-Type: application/json" \\
  -d '{"items":[{"external_id":"ERP-SP-9","branch_external_id":"ERP-ST-55",
    "name":"Εκθεσιακός χώρος","kind":"retail","area_sqm":220}]}'`,
    sync: `curl "${origin}/api/v1/customers?updated_since=2026-11-01T00:00:00Z&limit=500" \\
  -H "Authorization: Bearer $SOFTIFY_KEY"`,
  };

  return (
    <div className="space-y-4">
      <Card title={t('keysTitle')} description={t('keysHint')}
        action={<button onClick={() => setCreating(true)} className={primaryBtn}><Plus size={17} /> <span className="hidden sm:inline">{t('newKey')}</span></button>}>
        {!keys.data?.length ? <p className="text-sm text-muted">{t('noKeys')}</p> : (
          <ul className="divide-y divide-border">
            {keys.data.map((k) => (
              <li key={k.id} className={clsx('flex flex-wrap items-center gap-3 py-3', k.revoked_at && 'opacity-55')}>
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary"><KeyRound size={18} /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 font-semibold">
                    {k.name}
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', k.scope === 'write' ? 'bg-warning-soft text-warning' : 'bg-info-soft text-info')}>{t(`scope_${k.scope}`)}</span>
                    {k.revoked_at && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">{t('revoked')}</span>}
                  </div>
                  <div className="text-xs text-muted">
                    <code>sos_{k.prefix}_••••</code> · {t('lastUsed')}: {k.last_used_at ? relative(k.last_used_at, locale, { today: ta('today'), yesterday: ta('yesterday') }) : t('never')}
                    {' · '}{t('requests', { count: Number(k.requests) })}{k.created_by_name && ` · ${k.created_by_name}`}
                  </div>
                </div>
                {!k.revoked_at && (
                  <button onClick={() => { if (confirm(t('confirmRevoke', { name: k.name }))) revoke.mutate(k.id); }}
                    className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-danger hover:bg-danger-soft"><Ban size={15} /> {t('revoke')}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('guideTitle')} description={t('guideHint')}>
        <div className="space-y-4 text-sm">
          <Step n={1} title={t('step1')}><Code>{example.ping}</Code></Step>
          <Step n={2} title={t('step2')}><Code>{example.customers}</Code></Step>
          <Step n={3} title={t('step3')}><Code>{example.branches}</Code></Step>
          <Step n={4} title={t('step4')}><Code>{example.spaces}</Code></Step>
          <Step n={5} title={t('step5')}><Code>{example.sync}</Code></Step>
          <ul className="list-disc space-y-1 pl-5 text-muted">
            <li>{t('rule1')}</li><li>{t('rule2')}</li><li>{t('rule3')}</li><li>{t('rule4')}</li><li>{t('rule5')}</li>
          </ul>
          <a href="/api/v1/openapi.json" target="_blank" rel="noopener" className={clsx(ghostBtn, 'w-full sm:w-auto')}><ExternalLink size={16} /> {t('openapi')}</a>
        </div>
      </Card>

      {creating && <CreateKeyDialog onClose={() => setCreating(false)} onCreated={(k) => { setCreating(false); setCreated(k); qc.invalidateQueries({ queryKey: ['settings', 'api-keys'] }); }} />}
      {created && (
        <Dialog title={t('keyCreated')} onClose={() => setCreated(null)}>
          <p className="mb-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">{t('copyNow')}</p>
          <Code>{created}</Code>
          <div className="mt-4 flex justify-end"><button onClick={() => setCreated(null)} className={primaryBtn}>{t('done')}</button></div>
        </Dialog>
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 font-semibold"><span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-xs text-white">{n}</span>{title}</div>
      {children}
    </div>
  );
}

function CreateKeyDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (key: string) => void }) {
  const t = useTranslations('settings.integrations');
  const ts = useTranslations('settings');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const save = useMutation({ mutationFn: () => api<{ key: string }>('/settings/api-keys', { method: 'POST', json: { name, scope } }), onSuccess: (r) => onCreated(r.key) });
  return (
    <Dialog title={t('newKey')} onClose={onClose}>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="block"><span className="mb-1 block text-xs font-medium text-muted">{t('keyName')}</span>
          <input required minLength={2} autoFocus className={input} placeholder="ERP sync" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice active={scope === 'write'} onClick={() => setScope('write')} title={t('scope_write')} hint={t('scopeWriteHint')} />
          <Choice active={scope === 'read'} onClick={() => setScope('read')} title={t('scope_read')} hint={t('scopeReadHint')} />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending} className={primaryBtn}>{save.isPending ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} {t('create')}</button>
        </div>
      </form>
    </Dialog>
  );
}
