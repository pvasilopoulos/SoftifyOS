// Minimal client for SoftOne Soft1 Web Services (JSON over HTTP POST to <installation>/s1services).
// login → authenticate gives a clientID (session); every other call carries it and the appId.
// Sessions expire: one transparent re-login on an "invalid / expired session" answer.

export type Soft1Config = {
  url: string; username: string; password: string; app_id: string;
  company?: string; branch?: string; module?: string; refid?: string;
};
export type Soft1Company = { company: string; company_name: string; branch: string; branch_name: string; module: string; refid: string; refid_name: string };
type Json = Record<string, unknown>;

export class Soft1Error extends Error {
  constructor(message: string, readonly code?: number | string) { super(message); }
}

/** https://xyz.oncloud.gr, xyz.oncloud.gr/s1services … → https://xyz.oncloud.gr/s1services */
export function serviceUrl(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  if (!/\/s1services$/i.test(u)) u += '/s1services';
  return u;
}

/** Soft1 answers in UTF-8 or (older installations) Windows-1253 Greek. */
function decode(buf: ArrayBuffer) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  if (!utf8.includes('�')) return utf8;
  try { return new TextDecoder('windows-1253').decode(buf); } catch { return utf8; }
}

const SESSION_ERR = /session|clientid|not\s*logged|expired|authenticat/i;

export class Soft1 {
  private clientID: string | null = null;
  readonly endpoint: string;
  constructor(private cfg: Soft1Config, private timeoutMs = 30_000) { this.endpoint = serviceUrl(cfg.url); }

  private async raw(service: string, body: Json): Promise<Json> {
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
        body: JSON.stringify({ service, ...body }), signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      throw new Soft1Error(`Δεν απαντά ο server του Soft1 (${(e as Error).message})`, 'network');
    }
    const text = decode(await res.arrayBuffer());
    let json: Json;
    try { json = JSON.parse(text) as Json; } catch { throw new Soft1Error(`Μη αναμενόμενη απάντηση (HTTP ${res.status}): ${text.slice(0, 200)}`, res.status); }
    if (json.success === false || json.success === 'false') throw new Soft1Error(String(json.error ?? json.message ?? 'Σφάλμα Soft1'), json.errorcode as number | undefined);
    return json;
  }

  /** login + authenticate (with the configured company/branch/module/refid, or the first one offered). */
  async connect(): Promise<{ companies: Soft1Company[]; chosen: Soft1Company | null }> {
    const login = await this.raw('login', { username: this.cfg.username, password: this.cfg.password, appId: this.cfg.app_id });
    const objs = (Array.isArray(login.objs) ? login.objs : []) as Json[];
    const companies: Soft1Company[] = objs.map((o) => ({
      company: String(o.COMPANY ?? ''), company_name: String(o.COMPANYNAME ?? ''), branch: String(o.BRANCH ?? ''), branch_name: String(o.BRANCHNAME ?? ''),
      module: String(o.MODULE ?? ''), refid: String(o.REFID ?? ''), refid_name: String(o.REFIDNAME ?? ''),
    }));
    const want = (c: Soft1Company) => (!this.cfg.company || c.company === this.cfg.company) && (!this.cfg.branch || c.branch === this.cfg.branch)
      && (!this.cfg.module || c.module === this.cfg.module) && (!this.cfg.refid || c.refid === this.cfg.refid);
    const chosen = companies.find(want) ?? null;
    const auth = await this.raw('authenticate', {
      clientID: login.clientID,
      COMPANY: this.cfg.company || chosen?.company || '', BRANCH: this.cfg.branch || chosen?.branch || '',
      MODULE: this.cfg.module || chosen?.module || '0', REFID: this.cfg.refid || chosen?.refid || '',
    });
    this.clientID = String(auth.clientID ?? login.clientID);
    return { companies, chosen };
  }

  async call(service: string, body: Json): Promise<Json> {
    if (!this.clientID) await this.connect();
    try {
      return await this.raw(service, { clientID: this.clientID, appId: this.cfg.app_id, ...body });
    } catch (e) {
      if (!(e instanceof Soft1Error) || !SESSION_ERR.test(e.message)) throw e;
      this.clientID = null;
      await this.connect();
      return this.raw(service, { clientID: this.clientID, appId: this.cfg.app_id, ...body });
    }
  }

  /**
   * Browser (list) of an object, filtered. Returns the record keys and each row by field name.
   * The first column of every row is ZOOMINFO "OBJECT;key".
   */
  async browse(object: string, list: string, filters: string, max = 1000): Promise<{ key: string; row: Json }[]> {
    const info = await this.call('getBrowserInfo', { OBJECT: object, LIST: list, FILTERS: filters, VERSION: 2, LIMIT: Math.min(max, 1000) });
    const total = Number(info.totalcount ?? 0);
    const fields = ((info.fields ?? info.columns ?? []) as Json[]).map((f) => String(f.name ?? f.dataIndex ?? ''));
    const out: { key: string; row: Json }[] = [];
    for (let start = 0; start < Math.min(total, max); start += 200) {
      const data = await this.call('getBrowserData', { reqID: info.reqID, START: start, LIMIT: Math.min(200, max - start) });
      for (const r of (data.rows ?? []) as unknown[][]) {
        const row: Json = {};
        fields.forEach((f, i) => { row[f] = r[i]; row[f.split('.').pop()!] ??= r[i]; });
        const zoom = String(r[0] ?? '');
        const key = zoom.includes(';') ? zoom.split(';').pop()! : zoom;
        if (key) out.push({ key, row });
      }
      if (!(data.rows as unknown[] | undefined)?.length) break;
    }
    return out;
  }

  /** One record: the first line of the object's main table (field name → value). */
  async get(object: string, table: string, key: string): Promise<Json | null> {
    // No LOCATEINFO: some installations answer "TABLE:*" with an empty row; without it every field of the main table comes back
    const r = await this.call('getData', { OBJECT: object, FORM: '', KEY: key });
    const rows = ((r.data as Json | undefined)?.[table] ?? []) as Json[];
    return rows[0] ?? null;
  }

  /** Create (key null) or update a record; returns its key. */
  async set(object: string, table: string, key: string | null, fields: Json): Promise<string> {
    const r = await this.call('setData', { OBJECT: object, KEY: key ?? '', DATA: { [table]: [fields] } });
    return String(r.id ?? key ?? '');
  }

  async remove(object: string, key: string) {
    await this.call('delData', { OBJECT: object, KEY: key });
  }

  /** Field list of a table (to map fields): name, caption, type. */
  async tableFields(object: string, table: string): Promise<{ name: string; caption: string; type: string }[]> {
    const r = await this.call('getTableFields', { OBJECT: object, TABLE: table });
    return ((r.fields ?? []) as Json[]).map((f) => ({
      name: String(f.name ?? ''), caption: String(f.alias ?? f.caption ?? f.fullname ?? ''), type: String(f.datatype ?? f.type ?? ''),
    })).filter((f) => f.name);
  }
}
