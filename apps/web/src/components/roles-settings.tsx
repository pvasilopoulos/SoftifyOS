'use client';
// Roles & permissions (Settings → Users & roles): system roles + organisation-defined roles.
import { useState } from 'react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Check, Loader2, Lock, PenLine, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { api, ApiError, type Me } from '@/lib/api';
import { Card } from './settings-sections';
import { Dialog } from './customer-dialogs';
import { useToast } from './providers';

export type Role = {
  key: string; name: string; description: string | null; permissions: string[]; approval_level: number;
  is_system: boolean; sort: number; members: number;
};
type RolesResponse = { roles: Role[]; permissions: string[]; can_manage: boolean; my_role: string };

const input = 'w-full min-w-0 rounded-xl border border-border bg-surface-2 px-3 py-2.5 outline-none transition focus:border-primary';
const primaryBtn = 'flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 py-2.5 font-semibold text-white shadow-sm disabled:opacity-60';
const ghostBtn = 'flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 font-medium';
const smallBtn = 'flex items-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2 disabled:opacity-60';

export function useRoles() {
  return useQuery({ queryKey: ['settings', 'roles'], queryFn: () => api<RolesResponse>('/settings/roles'), staleTime: 60_000 });
}

/** Permission check for the signed-in user (owners can do everything). */
export function canDo(me: Me | undefined, perm: string) {
  const t = me?.tenant as (Me['tenant'] & { permissions?: string[] }) | undefined;
  return t?.role === 'owner' || !!t?.permissions?.includes(perm);
}

const GROUPS: { key: string; perms: string[] }[] = [
  { key: 'customers', perms: ['customers.edit', 'customers.delete'] },
  { key: 'offers', perms: ['offers.edit'] },
  { key: 'views', perms: ['views.share'] },
  { key: 'forms', perms: ['forms.manage'] },
  { key: 'admin', perms: ['settings.manage', 'users.manage', 'integrations.manage', 'audit.view'] },
];
const permKey = (p: string) => p.replace('.', '_');

export function RolesCard() {
  const t = useTranslations('settings.roles');
  const ts = useTranslations('settings');
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useRoles();
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);
  if (!data) return <Loader2 className="mx-auto animate-spin text-muted" />;
  const manage = data.can_manage;

  return (
    <Card title={t('title')} description={t('hint')}
      action={manage ? <button onClick={() => setEditing('new')} className={primaryBtn}><Plus size={17} /> <span className="hidden sm:inline">{t('new')}</span></button> : undefined}>
      <ul className="divide-y divide-border">
        {data.roles.map((r) => (
          <li key={r.key} className="py-3.5 first:pt-0 last:pb-0">
            <div className="flex items-start gap-3">
              <span className={clsx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', r.is_system ? 'bg-primary-soft text-primary' : 'bg-success-soft text-success')}>
                {r.key === 'owner' ? <Lock size={17} /> : <ShieldCheck size={18} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold">
                  {r.name}
                  <span className={clsx('rounded-full px-2 py-0.5 text-xs font-medium', r.is_system ? 'bg-surface-2 text-muted' : 'bg-success-soft text-success')}>{r.is_system ? t('system') : t('custom')}</span>
                  {r.key === data.my_role && <span className="text-xs font-normal text-muted">({t('yours')})</span>}
                </div>
                {r.description && <div className="text-sm text-muted">{r.description}</div>}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.key === 'owner' ? <span className="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary">{t('everything')}</span>
                    : r.permissions.length === 0 ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">{t('readOnly')}</span>
                    : r.permissions.map((p) => <span key={p} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{t(`p_${permKey(p)}`)}</span>)}
                  {r.approval_level > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">{t('approves', { level: t(`level_${r.approval_level}`) })}</span>}
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted"><Users size={12} /> {t('members', { count: r.members })}</div>
              </div>
            </div>
            {manage && r.key !== 'owner' && (
              <div className="mt-2.5 flex flex-wrap gap-2 pl-[52px]">
                <button onClick={() => setEditing(r)} className={smallBtn}><PenLine size={14} /> {t('edit')}</button>
                {!r.is_system && <button onClick={() => setDeleting(r)} className={clsx(smallBtn, 'text-danger hover:bg-danger-soft')}><Trash2 size={14} /> {t('delete')}</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <RoleDialog role={editing === 'new' ? null : editing} roles={data.roles} myRole={data.my_role} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['settings', 'roles'] }); qc.invalidateQueries({ queryKey: ['me'] }); toast({ title: ts('saved') }); }} />
      )}
      {deleting && (
        <DeleteRoleDialog role={deleting} roles={data.roles} onClose={() => setDeleting(null)}
          onDone={() => { setDeleting(null); qc.invalidateQueries({ queryKey: ['settings'] }); toast({ title: ts('saved') }); }} />
      )}
    </Card>
  );
}

function RoleDialog({ role, roles, myRole, onClose, onSaved }: { role: Role | null; roles: Role[]; myRole: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('settings.roles');
  const ts = useTranslations('settings');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? ['customers.edit']));
  const [level, setLevel] = useState(role?.approval_level ?? 0);
  const [error, setError] = useState<string | null>(null);
  const toggle = (p: string) => { const n = new Set(perms); if (n.has(p)) n.delete(p); else n.add(p); setPerms(n); };
  const copyFrom = (key: string) => { const r = roles.find((x) => x.key === key); if (r) { setPerms(new Set(r.permissions)); setLevel(Math.min(r.approval_level, 3)); } };
  const lockOut = role?.key === myRole && !perms.has('users.manage');
  const save = useMutation({
    mutationFn: () => {
      const json = { name, description, permissions: [...perms], approval_level: level };
      return role ? api(`/settings/roles/${role.key}`, { method: 'PUT', json }) : api('/settings/roles', { method: 'POST', json });
    },
    onSuccess: onSaved,
    onError: (e) => setError(e instanceof ApiError && t.has(`err_${e.code}`) ? t(`err_${e.code}` as never) : ts('error')),
  });
  return (
    <Dialog title={role ? t('editTitle', { name: role.name }) : t('new')} onClose={onClose}>
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-medium">{t('name')}</span>
            <input required minLength={2} maxLength={60} autoFocus={!role} className={input} placeholder={t('namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {!role && (
            <label className="block min-w-0">
              <span className="mb-1.5 block text-sm font-medium">{t('copyFrom')}</span>
              <select className={input} defaultValue="" onChange={(e) => copyFrom(e.target.value)}>
                <option value="">—</option>
                {roles.filter((r) => r.key !== 'owner').map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </label>
          )}
          <label className="block min-w-0 sm:col-span-2">
            <span className="mb-1.5 block text-sm font-medium">{t('description')}</span>
            <input maxLength={200} className={input} value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </div>

        <fieldset>
          <legend className="mb-2 text-sm font-medium">{t('permissions')}</legend>
          <div className="space-y-2">
            {GROUPS.map((g) => (
              <div key={g.key} className="rounded-2xl border border-border p-3">
                <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{t(`g_${g.key}`)}</div>
                <div className="space-y-1">
                  {g.perms.map((p) => (
                    <label key={p} className="flex cursor-pointer items-start gap-3 rounded-xl px-1 py-1.5 hover:bg-surface-2">
                      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]" checked={perms.has(p)} onChange={() => toggle(p)} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{t(`p_${permKey(p)}`)}</span>
                        <span className="block text-xs text-muted">{t(`h_${permKey(p)}`)}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">{t('viewAll')}</p>
        </fieldset>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">{t('approval')}</span>
          <select className={input} value={level} onChange={(e) => setLevel(Number(e.target.value))}>
            {[0, 1, 2, 3].map((l) => <option key={l} value={l}>{l === 0 ? t('approvalNone') : t('approvalUpTo', { level: t(`level_${l}`) })}</option>)}
          </select>
          <span className="mt-1.5 block text-xs text-muted">{t('approvalHint')}</span>
        </label>

        {lockOut && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">{t('err_would_lock_out')}</p>}
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
          <button disabled={save.isPending || name.trim().length < 2 || lockOut} className={primaryBtn}>
            {save.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} {role ? ts('save') : t('create')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteRoleDialog({ role, roles, onClose, onDone }: { role: Role; roles: Role[]; onClose: () => void; onDone: () => void }) {
  const t = useTranslations('settings.roles');
  const ts = useTranslations('settings');
  const others = roles.filter((r) => r.key !== role.key && r.key !== 'owner');
  const [target, setTarget] = useState(others.find((r) => r.key === 'sales')?.key ?? others[0]?.key ?? '');
  const del = useMutation({
    mutationFn: () => api(`/settings/roles/${role.key}${role.members ? `?reassign_to=${target}` : ''}`, { method: 'DELETE' }),
    onSuccess: onDone,
  });
  return (
    <Dialog title={t('deleteTitle', { name: role.name })} onClose={onClose}>
      {role.members > 0 ? (
        <label className="block">
          <span className="mb-1.5 block text-sm">{t('reassign', { count: role.members })}</span>
          <select className={input} value={target} onChange={(e) => setTarget(e.target.value)}>
            {others.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
          </select>
        </label>
      ) : <p className="text-sm text-muted">{t('deleteEmpty')}</p>}
      {del.error && <p className="mt-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{ts('error')}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <button type="button" onClick={onClose} className={ghostBtn}>{ts('cancel')}</button>
        <button onClick={() => del.mutate()} disabled={del.isPending || (role.members > 0 && !target)} className={clsx(primaryBtn, 'bg-danger')}>
          {del.isPending ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} {t('delete')}
        </button>
      </div>
    </Dialog>
  );
}
