// Module Forms: field catalogue per form, layered configuration (organisation → role → user),
// conditional rules, and server-side enforcement (hidden / read-only / required / defaults / validation / options).
import { z } from 'zod';
import type { Tx } from './db.js';

export type L10n = { el?: string; en?: string };
export const FORMS = ['customer', 'branch', 'space', 'contact', 'activity', 'offer', 'offer_item'] as const;
export type FormKey = (typeof FORMS)[number];
export const CUSTOM_FORMS = ['customer', 'branch', 'space', 'contact', 'activity', 'offer'] as const;
export const CUSTOM_TYPES = ['text', 'textarea', 'number', 'date', 'bool', 'select', 'multiselect', 'email', 'url', 'phone'] as const;
export type FieldType = (typeof CUSTOM_TYPES)[number] | 'list' | 'lookup' | 'user' | 'tags' | 'country' | 'ref' | 'group';
export type Width = 'full' | 'half' | 'third';

type Choice = { value: string; label: L10n };
export type CatalogField = {
  key: string; type: FieldType; section: string; label: L10n; width?: Width;
  /** Always visible, editable and required: the record cannot exist without it. */
  core?: boolean;
  /** Value list behind list/lookup fields (options can be limited per level). */
  list?: string;
  choices?: Choice[];
  /** Layout fixed (e.g. offer lines are a grid): order/section/width are not configurable. */
  fixedLayout?: boolean;
};
type CatalogForm = { sections: { key: string; label: L10n }[]; fields: CatalogField[] };

// ------------------------------------------------------------------ catalogue
const L = (el: string, en: string): L10n => ({ el, en });
const f = (key: string, type: FieldType, section: string, label: L10n, extra: Partial<CatalogField> = {}): CatalogField => ({ key, type, section, label, ...extra });
const STATUS = [['prospect', 'Υποψήφιος', 'Prospect'], ['negotiation', 'Σε διαπραγμάτευση', 'Negotiating'], ['active', 'Ενεργός', 'Active'], ['inactive', 'Ανενεργός', 'Inactive']]
  .map(([value, el, en]) => ({ value, label: L(el, en) }));

export const CATALOG: Record<FormKey, CatalogForm> = {
  customer: {
    sections: [
      { key: 'identity', label: L('Στοιχεία επιχείρησης', 'Business details') }, { key: 'contact', label: L('Επικοινωνία', 'Contact') },
      { key: 'address', label: L('Διεύθυνση έδρας', 'Registered address') }, { key: 'terms', label: L('Εμπορικοί όροι', 'Commercial terms') },
      { key: 'class', label: L('Κατηγοριοποίηση & ανάθεση', 'Classification & ownership') }, { key: 'notes', label: L('Σημειώσεις', 'Notes') },
    ],
    fields: [
      f('kind', 'select', 'identity', L('Τύπος', 'Type'), { width: 'full', choices: [{ value: 'company', label: L('Εταιρεία', 'Company') }, { value: 'group', label: L('Όμιλος εταιρειών', 'Group of companies') }] }),
      f('code', 'text', 'identity', L('Κωδικός', 'Code')),
      f('name', 'text', 'identity', L('Επωνυμία', 'Legal name'), { core: true, width: 'full' }),
      f('trade_name', 'text', 'identity', L('Διακριτικός τίτλος', 'Trade name')),
      f('vat', 'text', 'identity', L('ΑΦΜ', 'VAT no.')),
      f('tax_office', 'text', 'identity', L('ΔΟΥ', 'Tax office')),
      f('gemi', 'text', 'identity', L('Αρ. ΓΕΜΗ', 'Company reg. no.')),
      f('activity', 'text', 'identity', L('Δραστηριότητα', 'Business activity'), { width: 'full' }),
      f('parent_id', 'ref', 'identity', L('Μητρικός όμιλος', 'Parent group'), { width: 'full' }),
      f('email', 'email', 'contact', L('Email', 'Email')),
      f('website', 'url', 'contact', L('Ιστοσελίδα', 'Website')),
      f('phone', 'phone', 'contact', L('Τηλέφωνο', 'Phone')),
      f('mobile', 'phone', 'contact', L('Κινητό', 'Mobile')),
      f('address_street', 'text', 'address', L('Οδός & αριθμός', 'Street & number'), { width: 'full' }),
      f('address_city', 'text', 'address', L('Πόλη', 'City')),
      f('address_postal', 'text', 'address', L('ΤΚ', 'Postal code')),
      f('address_region', 'list', 'address', L('Νομός', 'Prefecture'), { list: 'prefecture' }),
      f('geo_zone_id', 'lookup', 'address', L('Γεωγραφική ζώνη', 'Geographic zone'), { list: 'geo_zone' }),
      f('address_country', 'country', 'address', L('Χώρα', 'Country')),
      f('billing_address', 'group', 'address', L('Διεύθυνση τιμολόγησης', 'Billing address'), { width: 'full' }),
      f('payment_terms', 'list', 'terms', L('Τρόπος πληρωμής', 'Payment terms'), { list: 'payment_terms' }),
      f('discount', 'number', 'terms', L('Γενική έκπτωση %', 'Default discount %')),
      f('credit_limit', 'number', 'terms', L('Πιστωτικό όριο (€)', 'Credit limit (€)')),
      f('annual_value', 'number', 'terms', L('Εκτιμώμενη ετήσια αξία (€)', 'Estimated annual value (€)')),
      f('status', 'select', 'class', L('Κατάσταση', 'Status'), { choices: STATUS }),
      f('account_manager_id', 'user', 'class', L('Account manager', 'Account manager')),
      f('category', 'list', 'class', L('Κατηγορία', 'Category'), { list: 'customer_category' }),
      f('source', 'list', 'class', L('Πηγή', 'Lead source'), { list: 'customer_source' }),
      f('tags', 'tags', 'class', L('Ετικέτες', 'Tags'), { width: 'full' }),
      f('notes', 'textarea', 'notes', L('Εσωτερικές σημειώσεις', 'Internal notes'), { width: 'full' }),
    ],
  },
  branch: {
    sections: [
      { key: 'main', label: L('Κατάστημα', 'Store') }, { key: 'location', label: L('Τοποθεσία', 'Location') },
      { key: 'commercial', label: L('Εμπορικά στοιχεία', 'Commercial') }, { key: 'contact', label: L('Επικοινωνία', 'Contact') },
    ],
    fields: [
      f('name', 'text', 'main', L('Επωνυμία', 'Legal name'), { core: true, width: 'full' }),
      f('trade_name', 'text', 'main', L('Διακριτικός τίτλος', 'Trade name'), { width: 'full' }),
      f('status', 'select', 'main', L('Κατάσταση', 'Status'), { choices: [{ value: 'active', label: L('Ενεργό', 'Active') }, { value: 'inactive', label: L('Ανενεργό', 'Inactive') }] }),
      f('address', 'text', 'location', L('Διεύθυνση', 'Address'), { width: 'full' }),
      f('city', 'text', 'location', L('Πόλη', 'City')),
      f('postal_code', 'text', 'location', L('ΤΚ', 'Postal code')),
      f('region', 'list', 'location', L('Νομός', 'Prefecture'), { list: 'prefecture' }),
      f('geo_zone_id', 'lookup', 'location', L('Γεωγραφική ζώνη', 'Geographic zone'), { list: 'geo_zone' }),
      f('ongoing_status_id', 'lookup', 'commercial', L('Status on going', 'Status on going'), { list: 'ongoing_status', width: 'full' }),
      f('fee_schedule_id', 'lookup', 'commercial', L('Αμοιβολόγιο', 'Fee schedule'), { list: 'fee_schedule' }),
      f('tour_id', 'lookup', 'commercial', L('Εξόρμηση', 'Field tour'), { list: 'tour' }),
      f('seasonality', 'select', 'commercial', L('Εποχικότητα', 'Seasonality'), {
        width: 'full', choices: [['all_year', 'Όλο τον χρόνο', 'All year'], ['summer', 'Θερινή', 'Summer'], ['winter', 'Χειμερινή', 'Winter'], ['custom', 'Επιλεγμένοι μήνες', 'Selected months']]
          .map(([value, el, en]) => ({ value, label: L(el, en) })),
      }),
      f('phone', 'phone', 'contact', L('Τηλέφωνο', 'Phone')),
      f('manager_name', 'text', 'contact', L('Υπεύθυνος καταστήματος', 'Store manager')),
    ],
  },
  space: {
    sections: [{ key: 'main', label: L('Χώρος', 'Space') }],
    fields: [
      f('name', 'text', 'main', L('Όνομα χώρου', 'Space name'), { core: true, width: 'full' }),
      f('kind', 'list', 'main', L('Τύπος χώρου', 'Space type'), { list: 'space_kind' }),
      f('area_sqm', 'number', 'main', L('Εμβαδόν (m²)', 'Area (m²)')),
      f('notes', 'text', 'main', L('Σημειώσεις', 'Notes'), { width: 'full' }),
    ],
  },
  contact: {
    sections: [{ key: 'main', label: L('Επαφή', 'Contact') }],
    fields: [
      f('full_name', 'text', 'main', L('Ονοματεπώνυμο', 'Full name'), { core: true }),
      f('role_title', 'text', 'main', L('Θέση', 'Position')),
      f('email', 'email', 'main', L('Email', 'Email'), { width: 'full' }),
      f('phone', 'phone', 'main', L('Τηλέφωνο', 'Phone')),
      f('mobile', 'phone', 'main', L('Κινητό', 'Mobile')),
      f('notes', 'text', 'main', L('Σημειώσεις', 'Notes'), { width: 'full' }),
      f('is_primary', 'bool', 'main', L('Κύρια επαφή', 'Primary contact'), { width: 'full' }),
    ],
  },
  activity: {
    sections: [
      { key: 'main', label: L('Ενέργεια', 'Activity') }, { key: 'when', label: L('Πότε & ποιος', 'When & who') },
      { key: 'links', label: L('Σύνδεση', 'Linked to') }, { key: 'result', label: L('Αποτέλεσμα', 'Outcome') },
    ],
    fields: [
      f('type', 'select', 'main', L('Είδος', 'Type'), { width: 'full', list: 'crm_type' }),
      f('subject', 'text', 'main', L('Θέμα', 'Subject'), { core: true, width: 'full' }),
      f('body', 'textarea', 'main', L('Περιγραφή', 'Description'), { width: 'full' }),
      f('status', 'select', 'when', L('Κατάσταση', 'Status'), {
        choices: [['planned', 'Προγραμματισμένη', 'Planned'], ['in_progress', 'Σε εξέλιξη', 'In progress'], ['done', 'Ολοκληρώθηκε', 'Done'], ['cancelled', 'Ακυρώθηκε', 'Cancelled']]
          .map(([value, el, en]) => ({ value, label: L(el, en) })),
      }),
      f('priority', 'select', 'when', L('Προτεραιότητα', 'Priority'), {
        choices: [['1', 'Υψηλή', 'High'], ['2', 'Κανονική', 'Normal'], ['3', 'Χαμηλή', 'Low']].map(([value, el, en]) => ({ value, label: L(el, en) })),
      }),
      f('due_at', 'date', 'when', L('Ημερομηνία & ώρα', 'Date & time')),
      f('duration_min', 'number', 'when', L('Διάρκεια (λεπτά)', 'Duration (minutes)')),
      f('owner_id', 'user', 'when', L('Υπεύθυνος', 'Assigned to')),
      f('remind_before_min', 'number', 'when', L('Υπενθύμιση πριν (λεπτά)', 'Reminder before (minutes)')),
      f('location', 'text', 'when', L('Τοποθεσία', 'Location'), { width: 'full' }),
      f('customer_id', 'ref', 'links', L('Πελάτης', 'Customer'), { width: 'full' }),
      f('branch_id', 'ref', 'links', L('Κατάστημα', 'Store')),
      f('contact_id', 'ref', 'links', L('Επαφή', 'Contact')),
      f('offer_id', 'ref', 'links', L('Προσφορά', 'Offer'), { width: 'full' }),
      f('outcome', 'select', 'result', L('Αποτέλεσμα', 'Outcome'), { list: 'crm_outcome' }),
      f('outcome_note', 'textarea', 'result', L('Σημείωση αποτελέσματος', 'Outcome note'), { width: 'full' }),
    ],
  },
  offer: {
    sections: [{ key: 'main', label: L('Πελάτης & τοποθέτηση', 'Customer & placement') }, { key: 'notes', label: L('Σημειώσεις', 'Notes') }],
    fields: [
      f('branch_id', 'ref', 'main', L('Κατάστημα', 'Store')),
      f('company_id', 'ref', 'main', L('Εταιρεία έκδοσης', 'Issuing company')),
      f('valid_until', 'date', 'main', L('Ισχύει έως', 'Valid until')),
      f('notes', 'textarea', 'notes', L('Σημειώσεις / όροι', 'Notes / terms'), { width: 'full' }),
    ],
  },
  offer_item: {
    sections: [{ key: 'line', label: L('Γραμμή είδους', 'Item line') }],
    fields: [
      f('description', 'text', 'line', L('Περιγραφή', 'Description'), { core: true, fixedLayout: true }),
      f('quantity', 'number', 'line', L('Ποσότητα', 'Quantity'), { core: true, fixedLayout: true }),
      f('unit_price', 'number', 'line', L('Τιμή μον.', 'Unit price'), { core: true, fixedLayout: true }),
      f('space_id', 'ref', 'line', L('Χώρος', 'Space'), { fixedLayout: true }),
      f('unit', 'text', 'line', L('Μον.', 'Unit'), { fixedLayout: true }),
      f('discount', 'number', 'line', L('Έκπτ. %', 'Disc. %'), { fixedLayout: true }),
      f('vat_rate', 'number', 'line', L('ΦΠΑ %', 'VAT %'), { fixedLayout: true }),
    ],
  },
};
export const FORM_LABELS: Record<FormKey, L10n> = {
  customer: L('Πελάτες', 'Customers'), branch: L('Καταστήματα', 'Stores'), space: L('Χώροι', 'Spaces'), contact: L('Επαφές', 'Contacts'),
  activity: L('Ενέργειες CRM', 'CRM activities'), offer: L('Προσφορές', 'Offers'), offer_item: L('Γραμμές προσφοράς', 'Offer lines'),
};
export const FORM_MODULE: Record<FormKey, string> = {
  customer: 'customers', branch: 'customers', space: 'customers', contact: 'customers', activity: 'crm', offer: 'offers', offer_item: 'offers',
};

// ------------------------------------------------------------------ level configuration (what is stored)
export const PROPS = ['hidden', 'readonly', 'required', 'default', 'label', 'placeholder', 'help', 'section', 'order', 'width',
  'min', 'max', 'minLength', 'maxLength', 'pattern', 'patternMessage', 'options', 'rules'] as const;
export type Prop = (typeof PROPS)[number];
/** What a user may change on their own form (without forms.manage). */
export const PERSONAL_PROPS: Prop[] = ['default', 'section', 'order', 'width'];
const LAYOUT_PROPS: Prop[] = ['section', 'order', 'width'];

const l10n = z.object({ el: z.string().max(300).optional(), en: z.string().max(300).optional() });
const defaultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('static'), value: z.union([z.string().max(2000), z.number(), z.boolean(), z.array(z.string().max(200)).max(50), z.null()]) }),
  z.object({ kind: z.literal('today'), days: z.number().int().min(-3650).max(3650).default(0) }),
  z.object({ kind: z.literal('me') }),
  z.object({ kind: z.literal('parent'), field: z.string().max(60) }),
]);
export type DefaultValue = z.infer<typeof defaultSchema>;
const OPS = ['eq', 'neq', 'in', 'not_in', 'empty', 'not_empty', 'gt', 'lt'] as const;
const ruleSchema = z.object({
  field: z.string().max(60), op: z.enum(OPS), value: z.string().max(500).optional(),
  then: z.enum(['show', 'hide', 'require', 'readonly']),
});
export type Rule = z.infer<typeof ruleSchema>;
const validRegex = (p: string | null | undefined) => { if (!p) return true; try { new RegExp(p, 'u'); return true; } catch { return false; } };
const fieldCfg = z.object({
  hidden: z.boolean(), readonly: z.boolean(), required: z.boolean(), default: defaultSchema.nullable(),
  label: l10n, placeholder: l10n, help: l10n,
  section: z.string().regex(/^[a-z0-9_]{1,40}$/), order: z.number().int().min(0).max(100000), width: z.enum(['full', 'half', 'third']),
  min: z.number().nullable(), max: z.number().nullable(),
  minLength: z.number().int().min(0).max(100000).nullable(), maxLength: z.number().int().min(0).max(100000).nullable(),
  pattern: z.string().max(300).nullable().refine(validRegex, 'invalid_pattern'), patternMessage: l10n,
  options: z.array(z.string().max(200)).max(500).nullable(),
  rules: z.array(ruleSchema).max(20),
  locked: z.array(z.enum(PROPS)).max(PROPS.length),
}).partial();
export type FieldCfg = z.infer<typeof fieldCfg>;
const sectionCfg = z.object({
  label: l10n, order: z.number().int().min(0).max(100000), collapsed: z.boolean(), tab: z.string().max(40).nullable(), hidden: z.boolean(),
}).partial();
export const levelConfigSchema = z.object({
  fields: z.record(z.string().max(60), fieldCfg).default({}),
  sections: z.record(z.string().regex(/^[a-z0-9_]{1,40}$/), sectionCfg).default({}),
});
export type LevelConfig = z.infer<typeof levelConfigSchema>;
export type Scope = 'organization' | 'role' | 'user';
export type Level = { scope: Scope; config: LevelConfig };

// ------------------------------------------------------------------ effective configuration
export type EffField = {
  key: string; type: FieldType; core: boolean; custom: boolean; fixedLayout: boolean; list: string | null; choices: Choice[] | null;
  section: string; order: number; width: Width;
  hidden: boolean; readonly: boolean; required: boolean; default: DefaultValue | null;
  label: L10n; baseLabel: L10n; placeholder: L10n; help: L10n;
  min: number | null; max: number | null; minLength: number | null; maxLength: number | null; pattern: string | null; patternMessage: L10n;
  options: string[] | null; rules: Rule[];
  locked: Prop[]; source: Partial<Record<Prop, Scope>>;
};
export type EffSection = { key: string; label: L10n; baseLabel: L10n; order: number; collapsed: boolean; tab: string | null; hidden: boolean; custom: boolean };
export type Effective = { form: FormKey; fields: EffField[]; sections: EffSection[] };
export type CustomFieldRow = { key: string; type: string; label: L10n; options: string[]; sort: number };

const cleanL10n = (x: L10n | undefined) => Object.fromEntries(Object.entries(x ?? {}).filter(([, v]) => typeof v === 'string' && v.trim())) as L10n;

/** Catalogue + custom fields + levels (in order) → what the form looks like for that user. */
export function buildEffective(form: FormKey, customs: CustomFieldRow[], levels: Level[]): Effective {
  const cat = CATALOG[form];
  const sections = new Map<string, EffSection>();
  cat.sections.forEach((s, i) => sections.set(s.key, { key: s.key, label: s.label, baseLabel: s.label, order: (i + 1) * 10, collapsed: false, tab: null, hidden: false, custom: false }));
  const fields = new Map<string, EffField>();
  const base = (c: CatalogField, i: number, custom = false): EffField => ({
    key: c.key, type: c.type, core: !!c.core, custom, fixedLayout: !!c.fixedLayout, list: c.list ?? null, choices: c.choices ?? null,
    section: c.section, order: (i + 1) * 10, width: c.width ?? 'half',
    hidden: false, readonly: false, required: !!c.core, default: null,
    label: c.label, baseLabel: c.label, placeholder: {}, help: {},
    min: null, max: null, minLength: null, maxLength: null, pattern: null, patternMessage: {}, options: null, rules: [], locked: [], source: {},
  });
  cat.fields.forEach((c, i) => fields.set(c.key, base(c, i)));
  if (customs.length) {
    if (!sections.has('custom')) sections.set('custom', { key: 'custom', label: L('Επιπλέον πεδία', 'Additional fields'), baseLabel: L('Επιπλέον πεδία', 'Additional fields'), order: (cat.sections.length + 1) * 10, collapsed: false, tab: null, hidden: false, custom: false });
    customs.forEach((cf, i) => {
      const type = cf.type as FieldType;
      fields.set(`cf_${cf.key}`, base({
        key: `cf_${cf.key}`, type, section: 'custom', label: cf.label, width: type === 'textarea' ? 'full' : 'half',
        choices: ['select', 'multiselect'].includes(type) ? cf.options.map((o) => ({ value: o, label: { el: o, en: o } })) : undefined,
      }, 1000 + i, true));
    });
  }

  for (const lvl of levels) {
    for (const [key, sc] of Object.entries(lvl.config.sections ?? {})) {
      const s = sections.get(key) ?? { key, label: {}, baseLabel: {}, order: 10_000, collapsed: false, tab: null, hidden: false, custom: true };
      if (sc.label) s.label = { ...s.label, ...cleanL10n(sc.label) };
      if (sc.order !== undefined) s.order = sc.order;
      if (sc.collapsed !== undefined) s.collapsed = sc.collapsed;
      if (sc.tab !== undefined) s.tab = sc.tab?.trim() || null;
      if (sc.hidden !== undefined) s.hidden = sc.hidden;
      sections.set(key, s);
    }
    for (const [key, c] of Object.entries(lvl.config.fields ?? {})) {
      const fl = fields.get(key);
      if (!fl) continue;
      for (const prop of Object.keys(c) as (Prop | 'locked')[]) {
        if (prop === 'locked') continue;
        if (fl.locked.includes(prop)) continue;                                  // locked by a higher level
        if (fl.core && (prop === 'hidden' || prop === 'readonly' || prop === 'required')) continue;
        if (fl.fixedLayout && LAYOUT_PROPS.includes(prop)) continue;
        const val = c[prop];
        // Required set by a higher level cannot be relaxed further down
        if (prop === 'required' && val === false && fl.required && fl.source.required) continue;
        if (prop === 'label' || prop === 'placeholder' || prop === 'help' || prop === 'patternMessage') {
          (fl as Record<string, unknown>)[prop] = { ...(fl[prop] as L10n), ...cleanL10n(val as L10n) };
        } else {
          (fl as Record<string, unknown>)[prop] = val;
        }
        fl.source[prop] = lvl.scope;
      }
      if (lvl.scope !== 'user') for (const p of c.locked ?? []) if (!fl.locked.includes(p)) fl.locked.push(p);
    }
  }
  // Fields placed in a section that no longer exists go back to their own
  for (const fl of fields.values()) if (!sections.has(fl.section)) fl.section = fl.custom ? 'custom' : CATALOG[form].fields.find((x) => x.key === fl.key)?.section ?? cat.sections[0].key;
  const secList = [...sections.values()].sort((a, b) => a.order - b.order);
  const secOrder = new Map(secList.map((s, i) => [s.key, i]));
  const list = [...fields.values()].sort((a, b) => (secOrder.get(a.section)! - secOrder.get(b.section)!) || a.order - b.order);
  return { form, fields: list, sections: secList };
}

// ------------------------------------------------------------------ conditions
const str = (v: unknown) => (Array.isArray(v) ? v.join(',') : v === null || v === undefined ? '' : String(v)).trim();
const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function ruleMatches(r: Rule, values: Record<string, unknown>) {
  const v = values[r.field];
  const s = norm(str(v));
  const target = norm(r.value ?? '');
  const list = target.split(',').map((x) => x.trim()).filter(Boolean);
  switch (r.op) {
    case 'eq': return Array.isArray(v) ? v.some((x) => norm(String(x)) === target) : s === target;
    case 'neq': return Array.isArray(v) ? !v.some((x) => norm(String(x)) === target) : s !== target;
    case 'in': return Array.isArray(v) ? v.some((x) => list.includes(norm(String(x)))) : list.includes(s);
    case 'not_in': return Array.isArray(v) ? !v.some((x) => list.includes(norm(String(x)))) : !list.includes(s);
    case 'empty': return !s || s === 'false';
    case 'not_empty': return !!s && s !== 'false';
    case 'gt': return s !== '' && Number(s) > Number(target);
    case 'lt': return s !== '' && Number(s) < Number(target);
  }
}
export function fieldState(fl: EffField, values: Record<string, unknown>) {
  let { hidden, readonly, required } = fl;
  const shows = fl.rules.filter((r) => r.then === 'show');
  if (shows.length) hidden = !shows.some((r) => ruleMatches(r, values));
  for (const r of fl.rules) {
    if (r.then === 'show' || !ruleMatches(r, values)) continue;
    if (r.then === 'hide') hidden = true;
    if (r.then === 'require') required = true;
    if (r.then === 'readonly') readonly = true;
  }
  if (fl.core) { hidden = false; readonly = false; required = true; }
  return { hidden, readonly, required: required && !hidden && !readonly };
}

/** Record + custom values in one flat object (custom fields as cf_<key>). */
export function flatValues(row: Record<string, unknown> | null | undefined) {
  if (!row) return {};
  const custom = (row.custom ?? {}) as Record<string, unknown>;
  return { ...row, ...Object.fromEntries(Object.entries(custom).map(([k, v]) => [`cf_${k}`, v])) };
}

export function resolveDefault(d: DefaultValue | null, ctx: { userId: string; parent?: Record<string, unknown> | null }): unknown {
  if (!d) return undefined;
  switch (d.kind) {
    case 'static': return d.value;
    case 'today': return new Date(Date.now() + d.days * 864e5).toISOString().slice(0, 10);
    case 'me': return ctx.userId;
    case 'parent': return ctx.parent?.[d.field] ?? null;
  }
}

// ------------------------------------------------------------------ enforcement
const isEmpty = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
  || (typeof v === 'object' && !Array.isArray(v) && v !== null && !Object.values(v).some((x) => x !== null && x !== '' && x !== undefined));

function coerceCustom(fl: EffField, v: unknown): { ok: boolean; value: unknown } {
  if (v === null || v === undefined || v === '') return { ok: true, value: null };
  switch (fl.type) {
    case 'number': { const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.')); return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, value: null }; }
    case 'bool': return { ok: true, value: v === true || v === 'true' || v === 1 || v === '1' };
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? { ok: true, value: String(v) } : { ok: false, value: null };
    case 'multiselect': {
      const arr = (Array.isArray(v) ? v : String(v).split(',')).map((x) => String(x).trim()).filter(Boolean);
      return arr.every((x) => fl.choices?.some((c) => c.value === x)) ? { ok: true, value: arr.length ? arr : null } : { ok: false, value: null };
    }
    case 'select': return fl.choices?.some((c) => c.value === String(v)) ? { ok: true, value: String(v) } : { ok: false, value: null };
    case 'email': return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v).trim()) ? { ok: true, value: String(v).trim() } : { ok: false, value: null };
    default: return { ok: true, value: String(v).slice(0, 10_000) };
  }
}

/**
 * Applies the form configuration to a create (old = null) or update payload, in place.
 * Hidden / read-only fields keep their stored value (or get their default on create); required,
 * validation and allowed options are checked on the fields the user can edit.
 * Returns field → error code (empty when valid).
 */
export function enforceForm(eff: Effective, input: Record<string, unknown>, old: Record<string, unknown> | null,
  ctx: { userId: string; parent?: Record<string, unknown> | null }) {
  const errors: Record<string, string> = {};
  const hasCustom = eff.fields.some((x) => x.custom);
  // Custom values: typed, unknown keys dropped, values not sent are kept
  if (hasCustom || input.custom !== undefined) {
    const incoming = (input.custom && typeof input.custom === 'object' ? input.custom : {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...((old?.custom ?? {}) as Record<string, unknown>) };
    for (const fl of eff.fields.filter((x) => x.custom)) {
      const k = fl.key.slice(3);
      if (!(k in incoming)) continue;
      const c = coerceCustom(fl, incoming[k]);
      if (!c.ok) { errors[fl.key] = 'invalid'; continue; }
      if (c.value === null) delete out[k]; else out[k] = c.value;
    }
    input.custom = out;
  }
  const values = { ...flatValues(old), ...flatValues(input) };
  const get = (fl: EffField) => (fl.custom ? (input.custom as Record<string, unknown>)[fl.key.slice(3)] : input[fl.key]);
  const set = (fl: EffField, v: unknown) => {
    if (fl.custom) { const c = input.custom as Record<string, unknown>; if (v === null || v === undefined) delete c[fl.key.slice(3)]; else c[fl.key.slice(3)] = v; }
    else input[fl.key] = v;
  };
  for (const fl of eff.fields) {
    if (fl.core || errors[fl.key]) continue;
    if (!fl.custom && !(fl.key in input) && !(old && fl.key in old)) continue;   // not part of this payload
    const st = fieldState(fl, values);
    if (st.hidden || st.readonly) {
      if (old) { if (fl.custom || fl.key in old) set(fl, fl.custom ? ((old.custom ?? {}) as Record<string, unknown>)[fl.key.slice(3)] ?? null : old[fl.key]); }
      else if (fl.default && isEmpty(get(fl))) set(fl, resolveDefault(fl.default, ctx));
      continue;
    }
    const v = get(fl);
    if (isEmpty(v)) { if (st.required) errors[fl.key] = 'required'; continue; }
    if (fl.min !== null || fl.max !== null) {
      const n = Number(v);
      if (Number.isFinite(n) && ((fl.min !== null && n < fl.min) || (fl.max !== null && n > fl.max))) { errors[fl.key] = 'out_of_range'; continue; }
    }
    if (typeof v === 'string') {
      if ((fl.minLength !== null && v.trim().length < fl.minLength) || (fl.maxLength !== null && v.trim().length > fl.maxLength)) { errors[fl.key] = 'length'; continue; }
      if (fl.pattern && !new RegExp(fl.pattern, 'u').test(v.trim())) { errors[fl.key] = 'pattern'; continue; }
    }
    if (fl.options?.length) {
      const was = old ? (fl.custom ? ((old.custom ?? {}) as Record<string, unknown>)[fl.key.slice(3)] : old[fl.key]) : undefined;
      const vals = Array.isArray(v) ? v.map(String) : [String(v)];
      const wasVals = Array.isArray(was) ? was.map(String) : was === null || was === undefined ? [] : [String(was)];
      const allowed = fl.options.map(norm);
      // A value already stored stays valid; new values must be allowed
      if (vals.some((x) => !allowed.includes(norm(x)) && !wasVals.includes(x))) errors[fl.key] = 'option_not_allowed';
    }
  }
  return errors;
}

/**
 * Custom values sent by the integration API: typed per field definition, unknown keys rejected.
 * Returns what to set and which keys to clear (null), merged into the stored object by the caller.
 */
export async function customInput(tx: Tx, tenantId: string, form: FormKey, incoming: Record<string, unknown> | undefined) {
  if (!incoming) return null;
  const eff = await effectiveForm(tx, tenantId, form, null, null);
  const defs = new Map(eff.fields.filter((f) => f.custom).map((f) => [f.key.slice(3), f]));
  const set: Record<string, unknown> = {}, remove: string[] = [], errors: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    const fl = defs.get(k);
    if (!fl) { errors[k] = 'unknown_field'; continue; }
    const c = coerceCustom(fl, v);
    if (!c.ok) { errors[k] = 'invalid'; continue; }
    if (c.value === null) remove.push(k); else set[k] = c.value;
  }
  return { set, remove, errors };
}

// ------------------------------------------------------------------ loading (short cache per user)
const cache = new Map<string, { at: number; v: Effective }>();
const versions = new Map<string, number>();
export function invalidateForms(tenantId: string) { versions.set(tenantId, (versions.get(tenantId) ?? 0) + 1); }

export async function loadLevels(tx: Tx, tenantId: string, form: FormKey, role: string | null, userId: string | null) {
  const rows = await tx<{ scope: Scope; scope_key: string; config: LevelConfig }[]>`
    SELECT scope, scope_key, config FROM form_configs
    WHERE tenant_id = ${tenantId} AND form = ${form}
      AND (scope = 'organization' OR (scope = 'role' AND scope_key = ${role ?? ''}) OR (scope = 'user' AND scope_key = ${userId ?? ''}))`;
  const rank = { organization: 0, role: 1, user: 2 };
  return rows.sort((a, b) => rank[a.scope] - rank[b.scope]).map((r) => ({ scope: r.scope, config: r.config }));
}
export async function loadCustom(tx: Tx, tenantId: string, form: FormKey, all = false) {
  if (!(CUSTOM_FORMS as readonly string[]).includes(form)) return [];
  return tx<(CustomFieldRow & { id: string; active: boolean; filterable: boolean })[]>`
    SELECT id, key, type, label, options, sort, active, filterable FROM custom_fields
    WHERE tenant_id = ${tenantId} AND form = ${form} ${all ? tx`` : tx`AND active`} ORDER BY sort, created_at`;
}

export async function effectiveForm(tx: Tx, tenantId: string, form: FormKey, role: string | null, userId: string | null): Promise<Effective> {
  const k = `${tenantId}:${versions.get(tenantId) ?? 0}:${form}:${role}:${userId}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 30_000) return hit.v;
  const [levels, customs] = await Promise.all([loadLevels(tx, tenantId, form, role, userId), loadCustom(tx, tenantId, form)]);
  const v = buildEffective(form, customs, levels);
  if (cache.size > 20_000) cache.clear();
  cache.set(k, { at: Date.now(), v });
  return v;
}

/** Session-aware helper for routes: returns errors (empty object when the payload is valid). */
export async function applyForm(tx: Tx, s: { tenantId: string; role: string; userId: string }, form: FormKey,
  input: Record<string, unknown>, old: Record<string, unknown> | null, parent?: Record<string, unknown> | null) {
  const eff = await effectiveForm(tx, s.tenantId, form, s.role, s.userId);
  return enforceForm(eff, input, old, { userId: s.userId, parent });
}
