// Documents: folders, upload (raw body, streamed to disk), versions, metadata & links, download / preview,
// share links, bulk actions, categories, storage quota.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { likeAny, searchPatterns, sql, withTenant, type Tx } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { audit } from './settings.js';
import { isInline, openFile, removeFile, saveUpload, UploadError, MAX_FILE_BYTES, ALLOWED_EXT } from '../storage.js';

const forbid = (reply: FastifyReply) => reply.code(403).send({ error: 'forbidden' });
const idParam = z.object({ id: z.string().uuid() });
const uuidN = z.string().uuid().nullish().transform((v) => v ?? null);
const LINKS = ['customer_id', 'branch_id', 'space_id', 'offer_id', 'activity_id', 'task_id'] as const;

export const docOut = (tx: Tx, T: string) => tx`
  SELECT d.id, d.folder_id, f.name AS folder_name, d.name, d.description, d.category, cat.name AS category_name, cat.color AS category_color,
         d.tags, d.mime, d.ext, d.size, d.version, d.customer_id, c.name AS customer_name, d.branch_id, b.name AS branch_name,
         d.space_id, sp.name AS space_name, d.offer_id, o.number AS offer_number, d.activity_id, a.subject AS activity_subject, d.task_id,
         d.expires_at, (d.share_token IS NOT NULL AND (d.share_expires_at IS NULL OR d.share_expires_at > now())) AS shared, d.share_expires_at,
         d.created_by, cu.full_name AS created_by_name, d.created_at, d.updated_at
  FROM documents d
  LEFT JOIN doc_folders f ON f.id = d.folder_id
  LEFT JOIN doc_categories cat ON cat.tenant_id = d.tenant_id AND cat.key = d.category
  LEFT JOIN customers c ON c.id = d.customer_id LEFT JOIN branches b ON b.id = d.branch_id LEFT JOIN spaces sp ON sp.id = d.space_id
  LEFT JOIN offers o ON o.id = d.offer_id LEFT JOIN crm_activities a ON a.id = d.activity_id
  LEFT JOIN users cu ON cu.id = d.created_by
  WHERE d.tenant_id = ${T}`;

async function usage(tx: Tx, T: string) {
  const [u] = await tx`SELECT coalesce(sum(size), 0)::bigint AS used, (SELECT storage_quota_bytes FROM tenants WHERE id = ${T}) AS quota FROM document_versions WHERE tenant_id = ${T}`;
  return { used: Number(u.used), quota: Number(u.quota) };
}

/** Links must exist and agree with each other (store / space / offer of the given customer). */
async function checkLinks(tx: Tx, l: Partial<Record<(typeof LINKS)[number], string | null>>) {
  if (l.space_id) {
    const [s] = await tx`SELECT s.branch_id, b.customer_id FROM spaces s JOIN branches b ON b.id = s.branch_id WHERE s.id = ${l.space_id}`;
    if (!s) return 'space_not_found';
    l.branch_id ??= s.branch_id; l.customer_id ??= s.customer_id;
  }
  if (l.branch_id) {
    const [b] = await tx`SELECT customer_id FROM branches WHERE id = ${l.branch_id}`;
    if (!b) return 'branch_not_found';
    if (l.customer_id && l.customer_id !== b.customer_id) return 'branch_other_customer';
    l.customer_id = b.customer_id;
  }
  if (l.offer_id) {
    const [o] = await tx`SELECT customer_id FROM offers WHERE id = ${l.offer_id}`;
    if (!o) return 'offer_not_found';
    l.customer_id ??= o.customer_id;
  }
  if (l.activity_id && !(await tx`SELECT 1 FROM crm_activities WHERE id = ${l.activity_id}`)[0]) return 'activity_not_found';
  if (l.task_id && !(await tx`SELECT 1 FROM tasks WHERE id = ${l.task_id}`.catch(() => []))[0]) return 'task_not_found';
  if (l.customer_id && !(await tx`SELECT 1 FROM customers WHERE id = ${l.customer_id}`)[0]) return 'customer_not_found';
  return null;
}

/** Sends a stored file: images/PDF inline when asked, everything else as a download; never sniffed as HTML. */
async function sendFile(reply: FastifyReply, key: string, name: string, mime: string, ext: string, inline: boolean) {
  const f = await openFile(key).catch(() => null);
  if (!f) return reply.code(410).send({ error: 'file_missing' });
  const disp = inline && isInline(ext) ? 'inline' : 'attachment';
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  reply.header('Content-Type', mime);
  reply.header('Content-Length', f.size);
  reply.header('Content-Disposition', `${disp}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`);
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
  reply.header('Cache-Control', 'private, max-age=300');
  return reply.send(f.stream);
}

const uploadQuery = z.object({
  name: z.string().trim().min(1).max(255),
  folder_id: uuidN, category: z.string().trim().max(40).nullish().transform((v) => v || null),
  customer_id: uuidN, branch_id: uuidN, space_id: uuidN, offer_id: uuidN, activity_id: uuidN, task_id: uuidN,
});

export default async function documentRoutes(app: FastifyInstance) {
  // Raw uploads: the body arrives as a stream (no buffering in memory)
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  // ---------------- public share link
  app.get('/public/files/:token', async (req, reply) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,60}$/) }).parse(req.params);
    const [d] = await sql`SELECT storage_key, name, mime, ext FROM documents WHERE share_token = ${token} AND (share_expires_at IS NULL OR share_expires_at > now())`;
    if (!d) return reply.code(404).send({ error: 'not_found' });
    return sendFile(reply, d.storage_key, d.name, d.mime, d.ext, (req.query as { inline?: string }).inline === '1');
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);
    const canEdit = (s: Session) => can(s, 'customers.edit');

    r.get('/documents/meta', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => ({
        categories: await tx`SELECT key, name, color, active FROM doc_categories WHERE tenant_id = ${s.tenantId} ORDER BY sort, name`,
        folders: await tx`
          SELECT f.id, f.parent_id, f.name, (SELECT count(*)::int FROM documents d WHERE d.folder_id = f.id) AS docs
          FROM doc_folders f WHERE f.tenant_id = ${s.tenantId} ORDER BY f.name`,
        usage: await usage(tx, s.tenantId),
        max_file: MAX_FILE_BYTES, allowed: ALLOWED_EXT,
        can: { edit: canEdit(s), delete: can(s, 'customers.delete'), manage: can(s, 'settings.manage') },
      }));
    });

    r.get('/documents', async (req) => {
      const q = z.object({
        folder: z.string().max(40).optional(),         // uuid, 'root' (no folder) or empty = everywhere
        q: z.string().trim().max(100).optional(), category: z.string().max(40).optional(),
        customer_id: z.string().uuid().optional(), branch_id: z.string().uuid().optional(), space_id: z.string().uuid().optional(),
        offer_id: z.string().uuid().optional(), activity_id: z.string().uuid().optional(), task_id: z.string().uuid().optional(),
        expiring: z.enum(['0', '1']).optional(), mine: z.enum(['0', '1']).optional(),
        sort: z.enum(['recent', 'name', 'size', 'expiry']).default('recent'),
        offset: z.coerce.number().int().min(0).max(100000).default(0), limit: z.coerce.number().int().min(1).max(200).default(60),
      }).parse(req.query);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const k = q.q && q.q.length >= 2 ? searchPatterns(q.q) : null;
        const order = { recent: tx`d.created_at DESC, d.id DESC`, name: tx`lower(d.name), d.id`, size: tx`d.size DESC, d.id`, expiry: tx`d.expires_at NULLS LAST, d.id` }[q.sort];
        const rows = await tx`
          ${docOut(tx, s.tenantId)}
          ${q.folder === 'root' ? tx`AND d.folder_id IS NULL` : q.folder && /^[0-9a-f-]{36}$/.test(q.folder) ? tx`AND d.folder_id = ${q.folder}` : tx``}
          ${q.category ? tx`AND d.category = ${q.category}` : tx``}
          ${LINKS.map((l) => (q[l] ? tx`AND ${tx('d.' + l)} = ${q[l]!}` : tx``)).reduce((a, b) => tx`${a} ${b}`, tx``)}
          ${q.expiring === '1' ? tx`AND d.expires_at IS NOT NULL AND d.expires_at <= current_date + 30` : tx``}
          ${q.mine === '1' ? tx`AND d.created_by = ${s.userId}` : tx``}
          ${k ? tx`AND (${likeAny(tx, 'd.search', k)} OR d.customer_id IN (SELECT id FROM customers WHERE tenant_id = ${s.tenantId} AND (${likeAny(tx, 'search', k)})))` : tx``}
          ORDER BY ${order} OFFSET ${q.offset} LIMIT ${q.limit + 1}`;
        const more = rows.length > q.limit;
        return { items: more ? rows.slice(0, q.limit) : rows, next_offset: more ? q.offset + q.limit : null };
      });
    });

    r.get('/documents/:id', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const s = req.session;
      return withTenant(s.tenantId, async (tx) => {
        const [d] = await tx`${docOut(tx, s.tenantId)} AND d.id = ${id}`;
        if (!d) return reply.code(404).send({ error: 'not_found' });
        const versions = await tx`
          SELECT v.version, v.name, v.size, v.mime, v.note, v.created_at, u.full_name AS created_by_name
          FROM document_versions v LEFT JOIN users u ON u.id = v.created_by WHERE v.document_id = ${id} ORDER BY v.version DESC`;
        const [tok] = await tx`SELECT share_token FROM documents WHERE id = ${id}`;
        return { ...d, versions, share_url: d.shared && tok?.share_token ? `/api/public/files/${tok.share_token}` : null };
      });
    });

    // ---- upload: POST raw bytes (Content-Type: application/octet-stream), metadata in the query
    r.post('/documents/upload', { bodyLimit: MAX_FILE_BYTES + 1024 }, async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) { (req.body as Readable)?.resume?.(); return forbid(reply); }
      const q = uploadQuery.parse(req.query);
      const links = Object.fromEntries(LINKS.map((l) => [l, q[l]])) as Record<(typeof LINKS)[number], string | null>;
      const pre = await withTenant(s.tenantId, async (tx) => {
        const err = await checkLinks(tx, links);
        if (err) return { error: err };
        if (q.folder_id && !(await tx`SELECT 1 FROM doc_folders WHERE id = ${q.folder_id}`)[0]) return { error: 'folder_not_found' };
        const u = await usage(tx, s.tenantId);
        if (u.used >= u.quota) return { error: 'quota_exceeded' };
        return { left: u.quota - u.used };
      });
      if ('error' in pre) { (req.body as Readable)?.resume?.(); return reply.code(pre.error === 'quota_exceeded' ? 413 : 400).send({ error: pre.error }); }
      let file;
      try { file = await saveUpload(s.tenantId, q.name, req.body as Readable, Math.min(MAX_FILE_BYTES, pre.left as number)); }
      catch (e) { if (e instanceof UploadError) return reply.code(e.code === 'too_large' ? 413 : 415).send({ error: e.code }); throw e; }
      const row = await withTenant(s.tenantId, async (tx) => {
        const [d] = await tx`
          INSERT INTO documents (tenant_id, folder_id, name, category, mime, ext, size, storage_key, created_by, updated_by,
                                 customer_id, branch_id, space_id, offer_id, activity_id, task_id)
          VALUES (${s.tenantId}, ${q.folder_id}, ${q.name}, ${q.category}, ${file.mime}, ${file.ext}, ${file.size}, ${file.key}, ${s.userId}, ${s.userId},
                  ${links.customer_id}, ${links.branch_id}, ${links.space_id}, ${links.offer_id}, ${links.activity_id}, ${links.task_id})
          RETURNING id`;
        await tx`INSERT INTO document_versions (tenant_id, document_id, version, storage_key, name, mime, size, sha256, created_by)
                 VALUES (${s.tenantId}, ${d.id}, 1, ${file.key}, ${q.name}, ${file.mime}, ${file.size}, ${file.sha256}, ${s.userId})`;
        await audit(tx, s, 'documents.upload', q.name, { id: d.id, size: file.size });
        const [out] = await tx`${docOut(tx, s.tenantId)} AND d.id = ${d.id}`;
        return out;
      }).catch(async (e) => { await removeFile(file.key).catch(() => {}); throw e; });
      return reply.code(201).send(row);
    });

    // ---- new version of an existing document
    r.post('/documents/:id/versions', { bodyLimit: MAX_FILE_BYTES + 1024 }, async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const q = z.object({ name: z.string().trim().min(1).max(255), note: z.string().trim().max(300).nullish() }).parse(req.query);
      if (!canEdit(s)) { (req.body as Readable)?.resume?.(); return forbid(reply); }
      const pre = await withTenant(s.tenantId, async (tx) => {
        const [d] = await tx`SELECT id FROM documents WHERE id = ${id}`;
        if (!d) return { error: 'not_found' };
        const u = await usage(tx, s.tenantId);
        return u.used >= u.quota ? { error: 'quota_exceeded' } : { left: u.quota - u.used };
      });
      if ('error' in pre) { (req.body as Readable)?.resume?.(); return reply.code(pre.error === 'not_found' ? 404 : 413).send({ error: pre.error }); }
      let file;
      try { file = await saveUpload(s.tenantId, q.name, req.body as Readable, Math.min(MAX_FILE_BYTES, pre.left as number)); }
      catch (e) { if (e instanceof UploadError) return reply.code(e.code === 'too_large' ? 413 : 415).send({ error: e.code }); throw e; }
      await withTenant(s.tenantId, async (tx) => {
        const [d] = await tx`UPDATE documents SET version = version + 1, storage_key = ${file.key}, mime = ${file.mime}, ext = ${file.ext}, size = ${file.size},
                 name = ${q.name}, updated_by = ${s.userId}, updated_at = now() WHERE id = ${id} RETURNING version`;
        await tx`INSERT INTO document_versions (tenant_id, document_id, version, storage_key, name, mime, size, sha256, note, created_by)
                 VALUES (${s.tenantId}, ${id}, ${d.version}, ${file.key}, ${q.name}, ${file.mime}, ${file.size}, ${file.sha256}, ${q.note ?? null}, ${s.userId})`;
        await audit(tx, s, 'documents.version', q.name, { id, version: d.version });
      });
      return { ok: true };
    });

    // ---- file (current or a given version)
    r.get('/documents/:id/file', async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const q = z.object({ v: z.coerce.number().int().min(1).optional(), inline: z.enum(['0', '1']).default('0') }).parse(req.query);
      const s = req.session;
      const [f] = await withTenant(s.tenantId, (tx) => q.v
        ? tx`SELECT storage_key, name, mime, (SELECT ext FROM documents WHERE id = ${id}) AS ext FROM document_versions WHERE document_id = ${id} AND version = ${q.v}`
        : tx`SELECT storage_key, name, mime, ext FROM documents WHERE id = ${id}`);
      if (!f) return reply.code(404).send({ error: 'not_found' });
      return sendFile(reply, f.storage_key, f.name, f.mime, f.ext, q.inline === '1');
    });

    r.patch('/documents/:id', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({
        name: z.string().trim().min(1).max(255).optional(), description: z.string().trim().max(2000).nullish(),
        category: z.string().trim().max(40).nullish(), tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        folder_id: uuidN.optional(), expires_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
        customer_id: uuidN.optional(), branch_id: uuidN.optional(), space_id: uuidN.optional(), offer_id: uuidN.optional(),
        activity_id: uuidN.optional(), task_id: uuidN.optional(),
      }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [d] = await tx`SELECT * FROM documents WHERE id = ${id} FOR UPDATE`;
        if (!d) return 404;
        const links = Object.fromEntries(LINKS.map((l) => [l, b[l] !== undefined ? b[l] : d[l]])) as Record<(typeof LINKS)[number], string | null>;
        const err = await checkLinks(tx, links);
        if (err) return err;
        if (b.folder_id && !(await tx`SELECT 1 FROM doc_folders WHERE id = ${b.folder_id}`)[0]) return 'folder_not_found';
        if (b.name && b.name.split('.').pop()?.toLowerCase() !== d.ext) b.name = `${b.name}.${d.ext}`;   // keep the real extension
        const cols: Record<string, unknown> = { ...links, updated_by: s.userId };
        for (const k of ['name', 'description', 'category', 'tags', 'folder_id'] as const) if (b[k] !== undefined) cols[k] = b[k];
        if (b.expires_at !== undefined) { cols.expires_at = b.expires_at; cols.expiry_notified = false; }
        await tx`UPDATE documents SET ${tx(cols as never)}, updated_at = now() WHERE id = ${id}`;
        return 200;
      });
      if (res === 404) return reply.code(404).send({ error: 'not_found' });
      if (res !== 200) return reply.code(400).send({ error: res });
      return { ok: true };
    });

    /** Rows → files to remove after commit. */
    const deleteDocs = async (tx: Tx, s: Session, ids: string[]) => {
      const mine = can(s, 'customers.delete') ? tx`` : tx`AND d.created_by = ${s.userId}`;
      const gone = await tx`DELETE FROM documents d WHERE d.id = ANY(${ids}::uuid[]) ${mine} RETURNING d.id, d.name`;
      if (!gone.length) return { n: 0, keys: [] as string[] };
      const keys = (await tx`SELECT storage_key FROM document_versions WHERE document_id = ANY(${gone.map((g) => g.id)}::uuid[])`).map((k) => k.storage_key as string);
      await audit(tx, s, 'documents.delete', null, { names: gone.map((g) => g.name).slice(0, 20), count: gone.length });
      return { n: gone.length, keys };
    };
    const purge = async (keys: string[]) => {
      for (const k of keys) {
        try { await removeFile(k); } catch { await sql`INSERT INTO storage_trash (storage_key) VALUES (${k}) ON CONFLICT DO NOTHING`; }
      }
    };

    r.delete('/documents/:id', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const res = await withTenant(s.tenantId, (tx) => deleteDocs(tx, s, [id]));
      if (!res.n) return reply.code(404).send({ error: 'not_found_or_forbidden' });
      await purge(res.keys);
      return { ok: true };
    });

    r.post('/documents/bulk', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), action: z.enum(['move', 'delete', 'category']),
        folder_id: uuidN.optional(), category: z.string().max(40).nullish() }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        if (b.action === 'delete') return deleteDocs(tx, s, b.ids);
        if (b.action === 'move') {
          if (b.folder_id && !(await tx`SELECT 1 FROM doc_folders WHERE id = ${b.folder_id}`)[0]) return { n: -1, keys: [] };
          const u = await tx`UPDATE documents SET folder_id = ${b.folder_id ?? null}, updated_at = now() WHERE id = ANY(${b.ids}::uuid[])`;
          return { n: u.count, keys: [] };
        }
        const u = await tx`UPDATE documents SET category = ${b.category ?? null}, updated_at = now() WHERE id = ANY(${b.ids}::uuid[])`;
        return { n: u.count, keys: [] };
      });
      if (res.n < 0) return reply.code(400).send({ error: 'folder_not_found' });
      await purge(res.keys);
      return { ok: true, count: res.n };
    });

    // ---- share link (public, optional expiry)
    r.post('/documents/:id/share', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const { days } = z.object({ days: z.coerce.number().int().min(1).max(365).nullish() }).parse(req.body ?? {});
      const token = randomBytes(24).toString('base64url');
      const ok = await withTenant(s.tenantId, async (tx) => {
        const [d] = await tx`UPDATE documents SET share_token = ${token}, share_expires_at = ${days ? new Date(Date.now() + days * 864e5) : null} WHERE id = ${id} RETURNING name`;
        if (d) await audit(tx, s, 'documents.share', d.name, { id, days: days ?? null });
        return !!d;
      });
      return ok ? { url: `/api/public/files/${token}` } : reply.code(404).send({ error: 'not_found' });
    });
    r.delete('/documents/:id/share', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const { id } = idParam.parse(req.params);
      await withTenant(s.tenantId, (tx) => tx`UPDATE documents SET share_token = NULL, share_expires_at = NULL WHERE id = ${id}`);
      return { ok: true };
    });

    // ---- folders
    r.post('/doc-folders', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const b = z.object({ name: z.string().trim().min(1).max(120), parent_id: uuidN }).parse(req.body);
      const row = await withTenant(s.tenantId, async (tx) => {
        if (b.parent_id && !(await tx`SELECT 1 FROM doc_folders WHERE id = ${b.parent_id}`)[0]) return null;
        const [f] = await tx`INSERT INTO doc_folders (tenant_id, parent_id, name, created_by) VALUES (${s.tenantId}, ${b.parent_id}, ${b.name}, ${s.userId}) RETURNING id`;
        return f;
      });
      return row ? reply.code(201).send(row) : reply.code(400).send({ error: 'folder_not_found' });
    });
    r.patch('/doc-folders/:id', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const b = z.object({ name: z.string().trim().min(1).max(120).optional(), parent_id: uuidN.optional() }).parse(req.body);
      const res = await withTenant(s.tenantId, async (tx) => {
        if (b.parent_id) {
          // no cycles: the new parent may not be this folder or one of its sub-folders
          const [cyc] = await tx`WITH RECURSIVE up AS (SELECT id, parent_id FROM doc_folders WHERE id = ${b.parent_id}
            UNION ALL SELECT f.id, f.parent_id FROM doc_folders f JOIN up ON f.id = up.parent_id) SELECT 1 FROM up WHERE id = ${id} LIMIT 1`;
          if (cyc) return 'cycle';
        }
        const cols: Record<string, unknown> = {};
        if (b.name) cols.name = b.name;
        if (b.parent_id !== undefined) cols.parent_id = b.parent_id;
        if (!Object.keys(cols).length) return 'ok';
        const [f] = await tx`UPDATE doc_folders SET ${tx(cols as never)} WHERE id = ${id} RETURNING id`;
        return f ? 'ok' : 'not_found';
      });
      return res === 'ok' ? { ok: true } : reply.code(res === 'not_found' ? 404 : 400).send({ error: res });
    });
    r.delete('/doc-folders/:id', async (req, reply) => {
      const s = req.session;
      if (!canEdit(s)) return forbid(reply);
      const { id } = idParam.parse(req.params);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [x] = await tx`SELECT (SELECT count(*) FROM doc_folders WHERE parent_id = ${id})::int AS subs, (SELECT count(*) FROM documents WHERE folder_id = ${id})::int AS docs`;
        if (x.subs || x.docs) return 'not_empty';
        const [f] = await tx`DELETE FROM doc_folders WHERE id = ${id} RETURNING id`;
        return f ? 'ok' : 'not_found';
      });
      return res === 'ok' ? { ok: true } : reply.code(res === 'not_found' ? 404 : 409).send({ error: res });
    });

    // ---- categories (Settings)
    r.put('/doc-categories', async (req: FastifyRequest, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return forbid(reply);
      const { items } = z.object({ items: z.array(z.object({
        key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/), name: z.string().trim().min(1).max(60),
        color: z.enum(['primary', 'info', 'success', 'warning', 'danger', 'muted']).default('primary'), active: z.boolean().default(true),
      })).max(50) }).parse(req.body);
      await withTenant(s.tenantId, async (tx) => {
        for (const [i, c] of items.entries()) {
          await tx`INSERT INTO doc_categories (tenant_id, key, name, color, sort, active) VALUES (${s.tenantId}, ${c.key}, ${c.name}, ${c.color}, ${i + 1}, ${c.active})
                   ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color, sort = EXCLUDED.sort, active = EXCLUDED.active`;
        }
        const keep = items.map((c) => c.key);
        await tx`UPDATE doc_categories SET active = false WHERE tenant_id = ${s.tenantId} AND NOT (key = ANY(${keep}))
                 AND EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id = ${s.tenantId} AND d.category = doc_categories.key)`;
        await tx`DELETE FROM doc_categories WHERE tenant_id = ${s.tenantId} AND NOT (key = ANY(${keep}))
                 AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.tenant_id = ${s.tenantId} AND d.category = doc_categories.key)`;
        await audit(tx, s, 'documents.categories', null, { count: items.length });
      });
      return { ok: true };
    });
  });
}
