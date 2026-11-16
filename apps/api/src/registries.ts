// Public registries for company data by VAT number:
//  - AADE "Αναζήτηση βασικών στοιχείων μητρώου επιχειρήσεων" (RgWsPublic2, SOAP + WS-Security).
//    Needs the organisation's special lookup credentials (registered at gsis.gr → "Ειδικοί κωδικοί πρόσβασης").
//  - EU VIES (REST, no credentials): validity + name/address for EU VAT numbers (incl. Greece as "EL").
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from './env.js';

export type RegistryFields = {
  name?: string; trade_name?: string; tax_office?: string; activity?: string;
  address_street?: string; address_postal?: string; address_city?: string;
};
export type RegistryResult = {
  source: 'aade' | 'vies'; valid: boolean; active: boolean | null; fields: RegistryFields;
  legal_status?: string | null; registered_at?: string | null; stopped_at?: string | null;
  activities?: { code: string; description: string; main: boolean }[]; message?: string | null;
};
export type RegistrySettings = {
  aade_enabled: boolean; aade_username: string | null; aade_password_enc: string | null; aade_caller_afm: string | null;
  vies_enabled: boolean; lookup_mode: 'off' | 'button' | 'auto'; update_policy: 'empty' | 'overwrite';
  fields: (keyof RegistryFields)[];
};
export const REGISTRY_FIELDS: (keyof RegistryFields)[] = ['name', 'trade_name', 'tax_office', 'activity', 'address_street', 'address_postal', 'address_city'];
export const DEFAULT_REGISTRY: RegistrySettings = {
  aade_enabled: false, aade_username: null, aade_password_enc: null, aade_caller_afm: null,
  vies_enabled: true, lookup_mode: 'button', update_policy: 'empty', fields: REGISTRY_FIELDS,
};

// ---------------------------------------------------------------- secret at rest (AES-256-GCM, key from the server secret)
const key = createHash('sha256').update(`${env.jwtSecret}:registry-credentials`).digest();
export function encryptSecret(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}
export function decryptSecret(enc: string | null) {
  if (!enc) return null;
  try {
    const [, iv, tag, data] = enc.split(':');
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

// ---------------------------------------------------------------- helpers
const clean = (s: string | null | undefined) => {
  const v = (s ?? '').replace(/\s+/g, ' ').trim();
  return v && v !== '---' && v !== '-' ? v : undefined;
};
const xmlDecode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text of the first <…:tag> element (namespace prefixes ignored). */
function tag(xml: string, name: string) {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`).exec(xml);
  return m ? xmlDecode(m[1]).trim() : undefined;
}
function tags(xml: string, name: string) {
  return [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'g'))].map((m) => m[1]);
}

// ---------------------------------------------------------------- AADE RgWsPublic2
const AADE_URL = 'https://www1.gsis.gr/wsaade/RgWsPublic2/RgWsPublic2';

export async function lookupAade(afm: string, s: RegistrySettings): Promise<RegistryResult> {
  const password = decryptSecret(s.aade_password_enc);
  if (!s.aade_username || !password) throw new Error('aade_not_configured');
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<env:Envelope xmlns:env="http://www.w3.org/2003/05/soap-envelope" xmlns:ns1="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:ns2="http://rgwspublic2/RgWsPublic2Service" xmlns:ns3="http://rgwspublic2/RgWsPublic2">
  <env:Header><ns1:Security><ns1:UsernameToken><ns1:Username>${xmlEscape(s.aade_username)}</ns1:Username><ns1:Password>${xmlEscape(password)}</ns1:Password></ns1:UsernameToken></ns1:Security></env:Header>
  <env:Body><ns2:rgWsPublic2AfmMethod><ns2:INPUT_REC>
    ${s.aade_caller_afm ? `<ns3:afm_called_by>${xmlEscape(s.aade_caller_afm)}</ns3:afm_called_by>` : '<ns3:afm_called_by/>'}
    <ns3:afm_called_for>${xmlEscape(afm)}</ns3:afm_called_for>
  </ns2:INPUT_REC></ns2:rgWsPublic2AfmMethod></env:Body>
</env:Envelope>`;
  const res = await fetch(AADE_URL, {
    method: 'POST', body: envelope, signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/soap+xml; charset=utf-8' },
  });
  const xml = await res.text();
  const errCode = tag(xml, 'error_code');
  if (errCode) {
    const descr = tag(xml, 'error_descr') ?? errCode;
    // Not found / invalid AFM are answers, not failures
    if (/RG_WS_PUBLIC_AFM_CALLED_BY_NOT_FOUND|RG_WS_PUBLIC_WRONG_AFM|RG_WS_PUBLIC_NOT_FOUND|RG_WS_PUBLIC_EPIT_NF/.test(errCode)) {
      return { source: 'aade', valid: false, active: null, fields: {}, message: descr };
    }
    throw new Error(`aade:${errCode}:${descr}`);
  }
  if (!res.ok) throw new Error(`aade_http_${res.status}`);
  const basic = tag(xml, 'basic_rec') ?? '';
  const street = [clean(tag(basic, 'postal_address')), clean(tag(basic, 'postal_address_no'))].filter(Boolean).join(' ');
  const activities = tags(xml, 'item').map((it) => ({
    code: clean(tag(it, 'firm_act_code')) ?? '', description: clean(tag(it, 'firm_act_descr')) ?? '', main: tag(it, 'firm_act_kind') === '1',
  })).filter((a) => a.code || a.description);
  const main = activities.find((a) => a.main) ?? activities[0];
  return {
    source: 'aade', valid: true,
    active: tag(basic, 'deactivation_flag') ? tag(basic, 'deactivation_flag') === '1' : null,
    fields: {
      name: clean(tag(basic, 'onomasia')), trade_name: clean(tag(basic, 'commer_title')),
      tax_office: clean(tag(basic, 'doy_descr')), activity: main ? main.description : undefined,
      address_street: street || undefined, address_postal: clean(tag(basic, 'postal_zip_code')), address_city: clean(tag(basic, 'postal_area_description')),
    },
    legal_status: clean(tag(basic, 'legal_status_descr')) ?? null,
    registered_at: clean(tag(basic, 'regist_date')) ?? null, stopped_at: clean(tag(basic, 'stop_date')) ?? null,
    activities,
  };
}

// ---------------------------------------------------------------- EU VIES
export async function lookupVies(country: string, vat: string, retry = true): Promise<RegistryResult> {
  const cc = country === 'GR' ? 'EL' : country;
  const num = encodeURIComponent(vat.replace(/^(EL|GR)/i, ''));
  const res = await fetch(`https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${encodeURIComponent(cc)}/vat/${num}`, {
    signal: AbortSignal.timeout(15_000), headers: { accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`vies_http_${res.status}`);
  const raw = await res.json() as { isValid?: boolean; name?: string; address?: string; userError?: string };
  // userError VALID / INVALID are answers; anything else (MS_UNAVAILABLE, TIMEOUT, MS_MAX_CONCURRENT_REQ…) means
  // the member state's service did not answer — NOT that the number is invalid.
  if (raw.userError && raw.userError !== 'VALID' && raw.userError !== 'INVALID') {
    // Busy / momentary outage: one quick retry before giving up
    if (retry) { await new Promise((r) => setTimeout(r, 1200)); return lookupVies(country, vat, false); }
    throw new Error(`vies_unavailable:${raw.userError}`);
  }
  const j = { valid: !!raw.isValid, name: raw.name, address: raw.address };
  // Free-text address, e.g. Greece "ΣΤΑΔΙΟΥ 10 10564 - ΑΘΗΝΑ", Ireland "3RD FLOOR, GORDON HOUSE, BARROW STREET, DUBLIN 4"
  const addr = (j.address ?? '').replace(/\s*\n\s*/g, ', ').replace(/\s+/g, ' ').trim();
  const usable = addr && addr !== '---';
  const withPostal = /^(.*?)[,\s]+(\d{3}\s?\d{2}|\d{4,6})\s*[-–]?\s*([^,\d][^,]*)$/.exec(addr);
  const parts = addr.split(',').map((x) => x.trim()).filter(Boolean);
  const address = !usable ? {} : withPostal
    ? { address_street: clean(withPostal[1].replace(/,\s*$/, '')), address_postal: withPostal[2].replace(/\s/g, ''), address_city: clean(withPostal[3]) }
    : parts.length > 1 ? { address_street: clean(parts.slice(0, -1).join(', ')), address_city: clean(parts.at(-1)) } : { address_street: clean(addr) };
  return {
    source: 'vies', valid: !!j.valid, active: j.valid ? true : null,
    fields: j.valid ? { name: clean(j.name), ...address } : {},
    message: j.valid ? null : 'VAT number not valid in VIES',
  };
}

// ---------------------------------------------------------------- one entry point (+ short cache)
const cache = new Map<string, { at: number; r: RegistryResult }>();
export async function lookupRegistry(s: RegistrySettings, country: string, vat: string): Promise<RegistryResult> {
  const v = vat.trim().replace(/\s/g, '').toUpperCase();
  const c = (country || 'GR').toUpperCase();
  const useAade = c === 'GR' && s.aade_enabled && !!s.aade_username && !!s.aade_password_enc;
  if (!useAade && !s.vies_enabled) throw new Error('registry_disabled');
  const k = `${useAade ? 'aade' : 'vies'}:${c}:${v}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.r;
  let r: RegistryResult;
  try {
    r = useAade ? await lookupAade(v.replace(/^(EL|GR)/, ''), s) : await lookupVies(c, v);
  } catch (e) {
    // AADE unreachable / credentials problem: fall back to VIES when allowed
    if (useAade && s.vies_enabled && !/aade_not_configured/.test((e as Error).message)) r = { ...(await lookupVies(c, v)), message: `AADE: ${(e as Error).message}` };
    else throw e;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(k, { at: Date.now(), r });
  return r;
}

/** Which record fields change, following the organisation's policy (only empty fields, or overwrite). */
export function plannedChanges(current: Record<string, unknown>, r: RegistryResult, s: RegistrySettings) {
  const out: Partial<Record<keyof RegistryFields, { from: string | null; to: string }>> = {};
  for (const f of s.fields) {
    const to = r.fields[f];
    if (!to) continue;
    const from = (current[f] as string | null | undefined) ?? null;
    if (from === to) continue;
    if (s.update_policy === 'empty' && from && String(from).trim()) continue;
    out[f] = { from, to };
  }
  return out;
}
