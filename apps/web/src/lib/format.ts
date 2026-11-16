const cache = new Map<string, Intl.NumberFormat>();
const tag = (locale: string) => (locale === 'el' ? 'el-GR' : 'en-IE');

export function money(v: string | number, locale: string, decimals = 2) {
  const k = `${locale}:${decimals}`;
  if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals }));
  return cache.get(k)!.format(Number(v));
}

export function compactMoney(v: string | number, locale: string) {
  return new Intl.NumberFormat(tag(locale), { style: 'currency', currency: 'EUR', notation: Number(v) >= 10_000_000 ? 'compact' : 'standard', maximumFractionDigits: 0 }).format(Number(v));
}

export function time(d: string | Date, locale: string) {
  return new Intl.DateTimeFormat(tag(locale), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Athens' }).format(new Date(d));
}

export function date(d: string | Date, locale: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Intl.DateTimeFormat(tag(locale), { timeZone: 'Europe/Athens', ...opts }).format(new Date(d));
}

/** "Today, 14:32" / "Yesterday, 16:48" / "15 Jan, 10:20" */
export function relative(d: string, locale: string, labels: { today: string; yesterday: string }) {
  const x = new Date(d);
  const day = (t: Date) => new Date(t.toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' })).getTime();
  const diff = Math.round((day(new Date()) - day(x)) / 86_400_000);
  const prefix = diff === 0 ? labels.today : diff === 1 ? labels.yesterday : date(x, locale, { day: 'numeric', month: 'short' });
  return `${prefix}, ${time(x, locale)}`;
}

export function initials(name?: string | null) {
  return (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}
