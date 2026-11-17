// CRM activities on the client: types, meta (types / outcomes / templates / people), icons and colours.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Briefcase, Calendar, CheckSquare, Circle, Coffee, FileText, Flag, Mail, MapPin, MessageSquare, NotebookPen, Phone, Presentation,
  Repeat, ShoppingCart, SquareCheck, Star, Truck, Users, Video, Wrench, type LucideIcon,
} from 'lucide-react';
import { api } from './api';

export type ActivityStatus = 'planned' | 'in_progress' | 'done' | 'cancelled';
export type Activity = {
  id: string; external_id: string | null; type: string; type_name: string | null; type_icon: string | null; type_color: string | null;
  subject: string; body: string | null; status: ActivityStatus; priority: 1 | 2 | 3; due_at: string | null; duration_min: number; all_day: boolean;
  location: string | null; owner_id: string | null; owner_name: string | null; created_by: string | null; created_by_name: string | null;
  customer_id: string | null; customer_name: string | null; customer_code: string | null; branch_id: string | null; branch_name: string | null;
  contact_id: string | null; contact_name: string | null; contact_phone: string | null; contact_mobile: string | null; contact_email: string | null;
  offer_id: string | null; offer_number: string | null;
  outcome: string | null; outcome_name: string | null; outcome_color: string | null; outcome_note: string | null; completed_at: string | null;
  remind_before_min: number | null; series_id: string | null; recurrence: Recurrence | null; parent_id: string | null; rule_id: string | null;
  custom: Record<string, unknown>; overdue: boolean; created_at: string; updated_at: string;
};
export type ActivityDetail = Activity & { follow_ups: { id: string; subject: string; status: ActivityStatus; due_at: string | null }[];
  series: { id: string; due_at: string; status: ActivityStatus }[]; can_edit: boolean };
export type Recurrence = { freq: 'daily' | 'weekly' | 'monthly'; interval: number; count?: number; until?: string };
export type CrmType = { key: string; name: string; icon: string; color: string; default_duration: number; active: boolean };
export type CrmOutcome = { key: string; name: string; color: string; positive: boolean; active: boolean };
export type CrmTemplate = { id: string; name: string; type: string; subject: string; body: string | null; priority: number; duration_min: number; due_in_days: number | null; remind_before_min: number | null };
export type CrmMeta = {
  types: CrmType[]; outcomes: CrmOutcome[]; templates: CrmTemplate[]; users: { id: string; full_name: string }[];
  timezone: string; can: { all: boolean; edit: boolean; manage: boolean }; me: string;
};
export type Counts = { open: number; overdue: number; today: number; week: number; nodate: number; done_today: number; done_week: number };

export function useCrmMeta() {
  return useQuery({ queryKey: ['crm', 'meta'], queryFn: () => api<CrmMeta>('/crm/meta'), staleTime: 300_000 });
}
/** Refresh everything that shows activities (lists, counters, calendar, customer timelines). */
export function useCrmRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['crm'] });
    qc.invalidateQueries({ queryKey: ['events'] });
    qc.invalidateQueries({ queryKey: ['activities'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
}

export const ICONS: Record<string, LucideIcon> = {
  phone: Phone, mail: Mail, users: Users, 'map-pin': MapPin, presentation: Presentation, repeat: Repeat, 'square-check': SquareCheck,
  'notebook-pen': NotebookPen, circle: Circle, calendar: Calendar, briefcase: Briefcase, coffee: Coffee, video: Video, 'file-text': FileText,
  truck: Truck, wrench: Wrench, star: Star, flag: Flag, 'message-square': MessageSquare, 'shopping-cart': ShoppingCart, 'check-square': CheckSquare,
};
export const iconOf = (name?: string | null) => ICONS[name ?? ''] ?? Circle;
export const COLORS = ['primary', 'info', 'success', 'warning', 'danger', 'muted'] as const;
export const tone = (c?: string | null) => ({
  primary: 'bg-primary-soft text-primary', info: 'bg-info-soft text-info', success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', muted: 'bg-surface-2 text-muted',
}[c ?? 'primary'] ?? 'bg-primary-soft text-primary');
export const dot = (c?: string | null) => ({
  primary: 'bg-primary', info: 'bg-info', success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger', muted: 'bg-muted',
}[c ?? 'primary'] ?? 'bg-primary');

/** <input type="datetime-local"> value ⇄ ISO */
export const toLocalInput = (iso: string | Date | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);
/** A date n days from today at hh:mm (local). */
export const daysFromNow = (n: number, hh = 9, mm = 0) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hh, mm, 0, 0); return d; };

/** "Σήμερα 10:00", "Αύριο", "Τρ 18 Νοε 10:00" */
export function dueLabel(iso: string | null, locale: string, t: (k: 'today' | 'tomorrow' | 'yesterday') => string, allDay = false) {
  if (!iso) return '';
  const d = new Date(iso);
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const diff = Math.floor((d.getTime() - day0.getTime()) / 864e5);
  const hm = allDay ? '' : ` ${d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`;
  if (diff === 0) return `${t('today')}${hm}`;
  if (diff === 1) return `${t('tomorrow')}${hm}`;
  if (diff === -1) return `${t('yesterday')}${hm}`;
  return `${d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) })}${hm}`;
}
