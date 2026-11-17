// Calendar sync with Google Calendar and Microsoft 365 / Outlook (OAuth 2, per user).
//  - push: CRM activities the user owns → events in their calendar (create / update / delete), queued by a DB trigger
//  - pull: the user's other events → "busy" blocks in the SoftifyOS calendar (worker, every few minutes)
// Tokens are stored encrypted; the worker refreshes them. Works across tenants, so it uses the owner connection.
import { sql } from './db.js';
import { env } from './env.js';
import { decryptSecret, encryptSecret } from './registries.js';

export type Provider = 'google' | 'microsoft';
export const PROVIDERS: Provider[] = ['google', 'microsoft'];

export const providerConfigured = (p: Provider) =>
  p === 'google' ? !!(env.google.clientId && env.google.clientSecret) : !!(env.microsoft.clientId && env.microsoft.clientSecret);

export const redirectUri = (p: Provider) => `${env.appUrl.replace(/\/$/, '')}/api/calendar/oauth/${p}/callback`;

const MS_BASE = () => `https://login.microsoftonline.com/${env.microsoft.tenant}/oauth2/v2.0`;
const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events';
const MS_SCOPES = 'offline_access openid email User.Read Calendars.ReadWrite';

export function authUrl(p: Provider, state: string) {
  if (p === 'google') {
    const q = new URLSearchParams({
      client_id: env.google.clientId, redirect_uri: redirectUri(p), response_type: 'code', scope: GOOGLE_SCOPES,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
  }
  const q = new URLSearchParams({
    client_id: env.microsoft.clientId, redirect_uri: redirectUri(p), response_type: 'code', response_mode: 'query', scope: MS_SCOPES, state, prompt: 'select_account',
  });
  return `${MS_BASE()}/authorize?${q}`;
}

type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; error?: string; error_description?: string };

async function tokenRequest(p: Provider, params: Record<string, string>): Promise<TokenResponse> {
  const url = p === 'google' ? 'https://oauth2.googleapis.com/token' : `${MS_BASE()}/token`;
  const body = new URLSearchParams({
    ...params,
    client_id: p === 'google' ? env.google.clientId : env.microsoft.clientId,
    client_secret: p === 'google' ? env.google.clientSecret : env.microsoft.clientSecret,
    ...(p === 'microsoft' ? { scope: MS_SCOPES } : {}),
  });
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(20000) });
  const j = (await r.json().catch(() => ({}))) as TokenResponse;
  if (!r.ok || j.error) throw new CalendarError(j.error === 'invalid_grant' ? 'revoked' : 'token_error', j.error_description ?? j.error ?? `HTTP ${r.status}`);
  return j;
}

export class CalendarError extends Error {
  constructor(public code: 'revoked' | 'token_error' | 'api_error' | 'not_found', detail?: string) { super(detail ?? code); }
}

/** Exchanges the OAuth code, finds the account email, returns what to store. */
export async function exchangeCode(p: Provider, code: string) {
  const t = await tokenRequest(p, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(p) });
  if (!t.refresh_token) throw new CalendarError('token_error', 'no_refresh_token');
  let email: string | null = null;
  if (t.id_token) {
    try { email = JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()).email ?? null; } catch { /* ignore */ }
  }
  if (!email && p === 'microsoft') {
    const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}));
    email = me.mail ?? me.userPrincipalName ?? null;
  }
  return {
    account_email: email,
    access_enc: encryptSecret(t.access_token),
    refresh_enc: encryptSecret(t.refresh_token),
    expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000),
  };
}

type Conn = {
  id: string; tenant_id: string; user_id: string; provider: Provider; calendar_id: string;
  access_enc: string | null; refresh_enc: string; expires_at: Date | null; push_enabled: boolean; import_busy: boolean; status: string;
};

/** Valid access token (refreshed and saved when expired). Marks the connection revoked when the user withdrew access. */
async function accessToken(c: Conn): Promise<string> {
  if (c.access_enc && c.expires_at && new Date(c.expires_at).getTime() > Date.now() + 30_000) {
    const a = decryptSecret(c.access_enc);
    if (a) return a;
  }
  const refresh = decryptSecret(c.refresh_enc);
  if (!refresh) throw new CalendarError('revoked', 'cannot decrypt refresh token');
  try {
    const t = await tokenRequest(c.provider, { grant_type: 'refresh_token', refresh_token: refresh });
    const expires = new Date(Date.now() + (t.expires_in - 60) * 1000);
    await sql`UPDATE calendar_connections SET access_enc = ${encryptSecret(t.access_token)}, expires_at = ${expires},
              refresh_enc = ${t.refresh_token ? encryptSecret(t.refresh_token) : c.refresh_enc} WHERE id = ${c.id}`;
    c.access_enc = encryptSecret(t.access_token); c.expires_at = expires;
    return t.access_token;
  } catch (e) {
    if (e instanceof CalendarError && e.code === 'revoked') {
      await sql`UPDATE calendar_connections SET status = 'revoked', last_error = ${e.message.slice(0, 300)} WHERE id = ${c.id}`;
    }
    throw e;
  }
}

async function call(c: Conn, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const token = await accessToken(c);
  const r = await fetch(url, {
    method, signal: AbortSignal.timeout(20000),
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 404 || r.status === 410) throw new CalendarError('not_found');
  if (r.status === 401) throw new CalendarError('revoked', 'unauthorized');
  if (!r.ok) throw new CalendarError('api_error', `${r.status} ${(await r.text()).slice(0, 300)}`);
  return r.status === 204 ? null : r.json();
}

// ------------------------------------------------------------------ push (activity → external event)
type Act = {
  id: string; subject: string; body: string | null; location: string | null; due_at: Date; duration_min: number; all_day: boolean;
  status: string; customer_name: string | null; type_name: string | null; tz: string;
};

const ymd = (d: Date, tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const nextDay = (s: string) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };

function eventBody(p: Provider, a: Act) {
  const title = `${a.status === 'done' ? '✓ ' : ''}${a.type_name ? `${a.type_name}: ` : ''}${a.subject}${a.customer_name ? ` · ${a.customer_name}` : ''}`.slice(0, 250);
  const link = `${env.appUrl.replace(/\/$/, '')}/el/crm?activity=${a.id}`;
  const text = `${a.body ? `${a.body}\n\n` : ''}SoftifyOS: ${link}`;
  const start = new Date(a.due_at);
  const end = new Date(start.getTime() + Math.max(15, a.duration_min || 30) * 60_000);
  if (p === 'google') {
    return {
      summary: title, description: text, location: a.location ?? undefined,
      start: a.all_day ? { date: ymd(start, a.tz) } : { dateTime: start.toISOString() },
      end: a.all_day ? { date: nextDay(ymd(start, a.tz)) } : { dateTime: end.toISOString() },
      extendedProperties: { private: { softify_activity: a.id } },
      source: { title: 'SoftifyOS', url: link },
    };
  }
  return {
    subject: title, body: { contentType: 'text', content: text },
    location: a.location ? { displayName: a.location } : undefined,
    isAllDay: a.all_day,
    start: a.all_day ? { dateTime: `${ymd(start, a.tz)}T00:00:00`, timeZone: a.tz } : { dateTime: start.toISOString().replace('Z', ''), timeZone: 'UTC' },
    end: a.all_day ? { dateTime: `${nextDay(ymd(start, a.tz))}T00:00:00`, timeZone: a.tz } : { dateTime: end.toISOString().replace('Z', ''), timeZone: 'UTC' },
    showAs: a.status === 'done' ? 'free' : 'busy',
  };
}

const eventsUrl = (c: Conn, id?: string) => c.provider === 'google'
  ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.calendar_id)}/events${id ? `/${encodeURIComponent(id)}` : ''}`
  : `https://graph.microsoft.com/v1.0/me/events${id ? `/${encodeURIComponent(id)}` : ''}`;

async function deleteExternal(c: Conn, externalId: string) {
  try { await call(c, 'DELETE', eventsUrl(c, externalId)); } catch (e) { if (!(e instanceof CalendarError && e.code === 'not_found')) throw e; }
  await sql`DELETE FROM calendar_event_links WHERE connection_id = ${c.id} AND external_id = ${externalId}`;
}

/** Brings the external calendars in line with one activity (created, changed, re-assigned, cancelled or deleted). */
export async function pushActivity(tenantId: string, activityId: string) {
  const [a] = await sql<Act[]>`
    SELECT a.id, a.subject, a.body, a.location, a.due_at, a.duration_min, a.all_day, a.status, a.owner_id,
           c.name AS customer_name, ty.name AS type_name, coalesce(t.timezone, 'Europe/Athens') AS tz
    FROM crm_activities a JOIN tenants t ON t.id = a.tenant_id
    LEFT JOIN customers c ON c.id = a.customer_id LEFT JOIN crm_activity_types ty ON ty.tenant_id = a.tenant_id AND ty.key = a.type
    WHERE a.id = ${activityId} AND a.tenant_id = ${tenantId}`;
  const wanted = a && a.due_at && a.status !== 'cancelled'
    ? await sql<Conn[]>`SELECT * FROM calendar_connections WHERE tenant_id = ${tenantId} AND user_id = ${(a as unknown as { owner_id: string }).owner_id}
                         AND status = 'active' AND push_enabled`
    : [];
  const links = await sql<{ connection_id: string; external_id: string }[]>`
    SELECT connection_id, external_id FROM calendar_event_links WHERE activity_id = ${activityId} AND tenant_id = ${tenantId}`;
  const errors: string[] = [];
  // Remove from calendars that should no longer have it (deleted, cancelled, new owner)
  for (const l of links.filter((l) => !wanted.some((c) => c.id === l.connection_id))) {
    const [c] = await sql<Conn[]>`SELECT * FROM calendar_connections WHERE id = ${l.connection_id}`;
    if (!c || c.status !== 'active') { await sql`DELETE FROM calendar_event_links WHERE connection_id = ${l.connection_id} AND activity_id = ${activityId}`; continue; }
    try { await deleteExternal(c, l.external_id); } catch (e) { errors.push((e as Error).message); }
  }
  for (const c of wanted) {
    const link = links.find((l) => l.connection_id === c.id);
    const body = eventBody(c.provider, a!);
    try {
      let ext: string | null = null;
      if (link) {
        try { await call(c, 'PATCH', eventsUrl(c, link.external_id), body); ext = link.external_id; }
        catch (e) { if (!(e instanceof CalendarError && e.code === 'not_found')) throw e; }   // deleted there → create again
      }
      if (!ext) ext = ((await call(c, 'POST', eventsUrl(c), body)) as { id: string }).id;
      await sql`INSERT INTO calendar_event_links (connection_id, tenant_id, activity_id, external_id) VALUES (${c.id}, ${tenantId}, ${activityId}, ${ext})
                ON CONFLICT (connection_id, activity_id) DO UPDATE SET external_id = EXCLUDED.external_id, synced_at = now()`;
      await sql`UPDATE calendar_connections SET last_sync_at = now(), last_error = NULL, status = 'active' WHERE id = ${c.id} AND status = 'active'`;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      errors.push(msg);
      await sql`UPDATE calendar_connections SET last_error = ${msg}, status = ${e instanceof CalendarError && e.code === 'revoked' ? 'revoked' : 'active'} WHERE id = ${c.id}`;
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
}

/** All upcoming activities of the user → their calendar (after connecting, or "sync now"). */
export async function queueFullPush(tenantId: string, userId: string) {
  await sql`
    INSERT INTO jobs (kind, payload, run_at)
    SELECT 'calendar_push', jsonb_build_object('tenantId', a.tenant_id, 'activityId', a.id), now() + (row_number() OVER (ORDER BY a.due_at) / 5) * interval '1 second'
    FROM crm_activities a
    WHERE a.tenant_id = ${tenantId} AND a.owner_id = ${userId} AND a.due_at > now() - interval '7 days' AND a.due_at < now() + interval '180 days'
      AND a.status <> 'cancelled'
    LIMIT 2000`;
}

// ------------------------------------------------------------------ pull (external events → busy blocks)
type BusyRow = { external_id: string; title: string | null; starts_at: Date; ends_at: Date; all_day: boolean };

async function fetchEvents(c: Conn, from: Date, to: Date): Promise<BusyRow[]> {
  const out: BusyRow[] = [];
  if (c.provider === 'google') {
    let page: string | undefined;
    do {
      const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', ...(page ? { pageToken: page } : {}) });
      const j = (await call(c, 'GET', `${eventsUrl(c)}?${q}`)) as {
        items: { id: string; status?: string; summary?: string; transparency?: string; start: { dateTime?: string; date?: string }; end: { dateTime?: string; date?: string }; extendedProperties?: { private?: Record<string, string> } }[];
        nextPageToken?: string;
      };
      for (const e of j.items ?? []) {
        if (e.status === 'cancelled' || e.transparency === 'transparent' || e.extendedProperties?.private?.softify_activity) continue;
        const allDay = !!e.start.date;
        out.push({ external_id: e.id, title: e.summary ?? null, all_day: allDay,
          starts_at: new Date(e.start.dateTime ?? `${e.start.date}T00:00:00Z`), ends_at: new Date(e.end.dateTime ?? `${e.end.date}T00:00:00Z`) });
      }
      page = j.nextPageToken;
    } while (page && out.length < 5000);
  } else {
    let url: string | undefined = `https://graph.microsoft.com/v1.0/me/calendarView?${new URLSearchParams({
      startDateTime: from.toISOString(), endDateTime: to.toISOString(), $top: '500', $select: 'id,subject,start,end,isAllDay,showAs,isCancelled',
    })}`;
    while (url && out.length < 5000) {
      const j = (await call(c, 'GET', url, undefined, { Prefer: 'outlook.timezone="UTC"' })) as {
        value: { id: string; subject?: string; isAllDay: boolean; showAs?: string; isCancelled?: boolean; start: { dateTime: string }; end: { dateTime: string } }[];
        '@odata.nextLink'?: string;
      };
      for (const e of j.value ?? []) {
        if (e.isCancelled || e.showAs === 'free') continue;
        out.push({ external_id: e.id, title: e.subject ?? null, all_day: e.isAllDay, starts_at: new Date(`${e.start.dateTime}Z`), ends_at: new Date(`${e.end.dateTime}Z`) });
      }
      url = j['@odata.nextLink'];
    }
  }
  return out;
}

/** Refreshes the busy blocks of one connection for the window −7 … +60 days (events we created ourselves are skipped). */
export async function pullBusy(connectionId: string) {
  const [c] = await sql<Conn[]>`SELECT * FROM calendar_connections WHERE id = ${connectionId} AND status = 'active'`;
  if (!c) return;
  if (!c.import_busy) { await sql`DELETE FROM calendar_busy WHERE connection_id = ${c.id}`; return; }
  const from = new Date(Date.now() - 7 * 864e5), to = new Date(Date.now() + 60 * 864e5);
  try {
    const mine = new Set((await sql`SELECT external_id FROM calendar_event_links WHERE connection_id = ${c.id}`).map((r) => r.external_id as string));
    const rows = (await fetchEvents(c, from, to)).filter((r) => !mine.has(r.external_id));
    await sql.begin(async (tx) => {
      await tx`DELETE FROM calendar_busy WHERE connection_id = ${c.id}`;
      if (rows.length) {
        await tx`INSERT INTO calendar_busy ${tx(rows.map((r) => ({ ...r, connection_id: c.id, tenant_id: c.tenant_id, user_id: c.user_id, title: r.title?.slice(0, 200) ?? null })))}
                 ON CONFLICT DO NOTHING`;
      }
      await tx`UPDATE calendar_connections SET last_sync_at = now(), last_error = NULL WHERE id = ${c.id}`;
    });
  } catch (e) {
    await sql`UPDATE calendar_connections SET last_error = ${(e as Error).message.slice(0, 300)} WHERE id = ${c.id}`;
  }
}

/** Worker tick: refresh connections not synced in the last 10 minutes. */
export async function pullDue() {
  const due = await sql<{ id: string }[]>`
    SELECT id FROM calendar_connections WHERE status = 'active' AND import_busy
      AND (last_sync_at IS NULL OR last_sync_at < now() - interval '10 minutes') ORDER BY last_sync_at NULLS FIRST LIMIT 20`;
  for (const c of due) await pullBusy(c.id);
}

/** Disconnect: revokes Google access and forgets the connection. Events already in the calendar stay there (they are the user's appointments). */
export async function disconnect(connectionId: string) {
  const [c] = await sql<Conn[]>`SELECT * FROM calendar_connections WHERE id = ${connectionId}`;
  if (!c) return;
  if (c.provider === 'google') {
    const refresh = decryptSecret(c.refresh_enc);
    if (refresh) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refresh)}`, { method: 'POST', signal: AbortSignal.timeout(10000) }).catch(() => {});
  }
  await sql`DELETE FROM calendar_connections WHERE id = ${connectionId}`;
}
