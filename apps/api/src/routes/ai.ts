// AI routes: Copilot chat (streamed), confirmations of proposed actions, voice visit capture, customer summary,
// natural-language report builder, smart import of a customer from a card / PDF / text, and Settings → AI.
import type { FastifyInstance, FastifyReply } from 'fastify';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z4 from 'zod/v4';
import { z } from 'zod';
import { sql, withTenant } from '../db.js';
import { can, requireAuth, type Session } from '../auth.js';
import { audit } from './settings.js';
import { planBlocks } from '../billing.js';
import { encryptSecret } from '../registries.js';
import {
  aiFor, BETAS, callerFor, clientWithKey, hasEnvKey, contextLine, DEFAULT_SETTINGS, executeAction, FEATURES, gate, loadSettings, meter, monthSpend, MODEL, recordError,
  systemPrompt, TOOL_BY_NAME, TOOLS, ToolError, type ActionKind, type AiSettings, type Feature,
} from '../ai.js';
import { definitionSchema } from '../reports.js';

const idParam = z.object({ id: z.string().uuid() });
const MAX_STEPS = 10;
type Msg = Anthropic.Beta.BetaMessageParam;

const refuse = (reply: FastifyReply, error: string) =>
  reply.code(error === 'forbidden' ? 403 : error === 'budget_exceeded' ? 402 : error === 'ai_not_configured' ? 503 : 409).send({ error });

/** Text of an assistant message, without thinking / tool blocks. */
const textOf = (content: Anthropic.Beta.BetaContentBlock[]) => content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');

function apiError(e: unknown) {
  if (e instanceof Anthropic.RateLimitError) return 'ai_rate_limited';
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'ai_auth';
  if (e instanceof Anthropic.APIError) return 'ai_error';
  return 'ai_error';
}

/** One structured-output call (no tools). Returns the parsed object or throws. */
async function extract<T extends z4.ZodType>(s: Session, feature: Feature, schema: T, system: string, content: Anthropic.Beta.BetaContentBlockParam[], effort: 'low' | 'medium' | 'high' = 'medium') {
  const t0 = Date.now();
  let r;
  try {
    r = await (await aiFor(s.tenantId))!.beta.messages.parse({
      model: MODEL, max_tokens: 16000, betas: BETAS, fallbacks: 'default',
      output_config: { effort, format: zodOutputFormat(schema) },
      system, messages: [{ role: 'user', content }],
    });
  } catch (e) { await recordError(s, feature, e, { requested_model: MODEL, duration_ms: Date.now() - t0 }); throw e; }
  await meter(s, feature, r.model, r.usage, { request_id: (r as { _request_id?: string | null })._request_id, duration_ms: Date.now() - t0 }, r.stop_reason === 'refusal');
  if (r.stop_reason === 'refusal') throw new ToolError('refused');
  if (!r.parsed_output) throw new ToolError('unparsed');
  return r.parsed_output as z4.infer<T>;
}

export default async function aiRoutes(app: FastifyInstance) {
  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    // ------------------------------------------------------------ status (what the UI shows)
    r.get('/ai/status', async (req) => {
      const s = req.session;
      const st = await loadSettings(s.tenantId);
      const spent = await withTenant(s.tenantId, (tx) => monthSpend(tx, s.tenantId));
      const configured = !!(await aiFor(s.tenantId));
      const plan = await planBlocks(s.tenantId, 'ai');   // not in the plan / subscription lapsed
      const allowed = !plan && (s.role === 'owner' || !!s.perms?.includes('ai.use'));
      return {
        configured, enabled: st.enabled && !!st.consent_at, allowed, plan_block: plan,
        features: Object.fromEntries(FEATURES.map((f) => [f, configured && allowed && st.enabled && !!st.consent_at && st.features[f]])),
        budget_left: Math.max(0, st.monthly_budget_usd - spent) > 0,
      };
    });

    // ------------------------------------------------------------ Settings → AI
    r.get('/settings/ai', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const st = await loadSettings(s.tenantId);
      return withTenant(s.tenantId, async (tx) => ({
        settings: st, configured: !!(await aiFor(s.tenantId)), model: MODEL, env_key: hasEnvKey(),
        key: await (async () => {
          const [k] = await tx<{ meta: { last4: string; set_by: string; set_at: string } | null }[]>`SELECT ai_key_meta AS meta FROM tenants WHERE id = ${s.tenantId}`;
          if (!k?.meta) return null;
          const [u] = await tx`SELECT full_name FROM users WHERE id = ${k.meta.set_by}`;
          return { last4: k.meta.last4, set_at: k.meta.set_at, set_by_name: u?.full_name ?? null };
        })(),
        consent_by_name: st.consent_by ? (await tx`SELECT full_name FROM users WHERE id = ${st.consent_by}`)[0]?.full_name ?? null : null,
        month: {
          spent: await monthSpend(tx, s.tenantId),
          by_feature: await tx`SELECT feature, count(*)::int AS calls, sum(cost_usd)::float AS usd FROM ai_usage
                               WHERE tenant_id = ${s.tenantId} AND created_at >= date_trunc('month', now()) GROUP BY feature ORDER BY usd DESC`,
          by_user: await tx`SELECT coalesce(u.full_name, '—') AS name, count(*)::int AS calls, sum(a.cost_usd)::float AS usd FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
                            WHERE a.tenant_id = ${s.tenantId} AND a.created_at >= date_trunc('month', now()) GROUP BY u.full_name ORDER BY usd DESC LIMIT 20`,
        },
        history: await tx`SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, sum(cost_usd)::float AS usd FROM ai_usage
                          WHERE tenant_id = ${s.tenantId} AND created_at >= date_trunc('month', now()) - interval '5 months' GROUP BY 1 ORDER BY 1`,
        roles: await tx`SELECT key, name, ('ai.use' = ANY(permissions) OR key = 'owner') AS ai FROM roles WHERE tenant_id = ${s.tenantId} ORDER BY sort`,
      }));
    });

    r.put('/settings/ai', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const b = z.object({
        enabled: z.boolean(), consent: z.boolean(), monthly_budget_usd: z.coerce.number().min(0).max(100000),
        features: z.object(Object.fromEntries(FEATURES.map((f) => [f, z.boolean()])) as Record<Feature, z.ZodBoolean>),
      }).parse(req.body);
      const cur = await loadSettings(s.tenantId);
      // Consent is recorded once (who / when); withdrawing it also switches AI off
      const next: AiSettings = {
        ...DEFAULT_SETTINGS, ...cur, enabled: b.enabled && b.consent, monthly_budget_usd: b.monthly_budget_usd, features: b.features,
        consent_at: b.consent ? cur.consent_at ?? new Date().toISOString() : null, consent_by: b.consent ? cur.consent_by ?? s.userId : null,
      };
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ai_settings = ${tx.json(next as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'ai.settings', null, { enabled: next.enabled, consent: !!next.consent_at, budget: next.monthly_budget_usd, features: next.features });
      });
      return { ok: true, settings: next };
    });

    // ------------------------------------------------------------ Settings → AI → API key (encrypted; never sent back)
    const keySchema = z.string().trim().min(20).max(300).regex(/^[A-Za-z0-9_\-]+$/, 'invalid_key_format');
    /** A tiny call that tells apart: invalid key, no permission/credit, rate limit, other API errors. */
    async function testClient(client: Anthropic) {
      try {
        await client.messages.create({ model: MODEL, max_tokens: 16, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'ping' }] });
        return { ok: true as const };
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) return { ok: false as const, error: 'invalid_key' };
        if (e instanceof Anthropic.PermissionDeniedError) return { ok: false as const, error: 'permission' };
        if (e instanceof Anthropic.RateLimitError) return { ok: false as const, error: 'rate_limited' };
        if (e instanceof Anthropic.BadRequestError) return { ok: false as const, error: 'bad_request', detail: e.message.slice(0, 300) };
        if (e instanceof Anthropic.APIConnectionError) return { ok: false as const, error: 'connection' };
        if (e instanceof Anthropic.APIError) return { ok: false as const, error: 'api_error', detail: e.message.slice(0, 300) };
        return { ok: false as const, error: 'api_error' };
      }
    }

    r.put('/settings/ai/key', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const parsed = keySchema.safeParse((req.body as { key?: unknown })?.key);
      if (!parsed.success) return reply.code(400).send({ error: 'invalid_key_format' });
      const key = parsed.data;
      const meta = { last4: key.slice(-4), set_by: s.userId, set_at: new Date().toISOString() };
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ai_key_enc = ${encryptSecret(key)}, ai_key_meta = ${tx.json(meta as never)}, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'ai.key_set', null, { last4: meta.last4 });   // never the key itself
      });
      return { ok: true, key: { last4: meta.last4, set_at: meta.set_at } };
    });

    r.delete('/settings/ai/key', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      await withTenant(s.tenantId, async (tx) => {
        await tx`UPDATE tenants SET ai_key_enc = NULL, ai_key_meta = NULL, updated_at = now() WHERE id = ${s.tenantId}`;
        await audit(tx, s, 'ai.key_removed', null);
      });
      return { ok: true };
    });

    /** Test the key typed in the form (body.key) or, without one, the key in use. */
    r.post('/settings/ai/key/test', async (req, reply) => {
      const s = req.session;
      if (!can(s, 'settings.manage')) return reply.code(403).send({ error: 'forbidden' });
      const typed = (req.body as { key?: unknown } | null)?.key;
      let client: Anthropic | null;
      if (typed !== undefined && typed !== null && typed !== '') {
        const parsed = keySchema.safeParse(typed);
        if (!parsed.success) return { ok: false, error: 'invalid_key_format' };
        client = clientWithKey(parsed.data);
      } else client = await aiFor(s.tenantId);
      if (!client) return { ok: false, error: 'no_key' };
      return testClient(client);
    });

    // ------------------------------------------------------------ conversations
    r.get('/ai/conversations', async (req) => {
      const s = req.session;
      return withTenant(s.tenantId, (tx) => tx`
        SELECT id, title, context, updated_at FROM ai_conversations WHERE user_id = ${s.userId} ORDER BY updated_at DESC LIMIT 40`);
    });

    r.get('/ai/conversations/:id', async (req, reply) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      const res = await withTenant(s.tenantId, async (tx) => {
        const [c] = await tx`SELECT id, title, context FROM ai_conversations WHERE id = ${id} AND user_id = ${s.userId}`;
        if (!c) return null;
        const msgs = await tx<{ id: string; role: string; content: unknown[] }[]>`SELECT id, role, content FROM ai_messages WHERE conversation_id = ${id} ORDER BY id`;
        const actions = await tx`SELECT id, kind, payload, summary, status, result, created_at FROM ai_actions WHERE conversation_id = ${id} ORDER BY created_at`;
        return { c, msgs, actions };
      });
      if (!res) return reply.code(404).send({ error: 'not_found' });
      // What the chat shows: the user's words and the assistant's text (tool traffic stays internal)
      const items: { id: string; role: 'user' | 'assistant'; text: string; tools?: string[] }[] = [];
      for (const m of res.msgs) {
        const blocks = m.content as { type: string; text?: string; name?: string }[];
        if (m.role === 'user') {
          const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').replace(/^\[now:[^\]]*\]\s*/, '');
          if (text) items.push({ id: m.id, role: 'user', text });
        } else {
          const last = items.at(-1);
          const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
          const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => b.name ?? '');
          if (last?.role === 'assistant') { last.text += text; last.tools = [...(last.tools ?? []), ...tools]; }
          else items.push({ id: m.id, role: 'assistant', text, tools });
        }
      }
      return { ...res.c, items, actions: res.actions };
    });

    r.delete('/ai/conversations/:id', async (req) => {
      const s = req.session;
      const { id } = idParam.parse(req.params);
      await withTenant(s.tenantId, (tx) => tx`DELETE FROM ai_conversations WHERE id = ${id} AND user_id = ${s.userId}`);
      return { ok: true };
    });

    // ------------------------------------------------------------ chat (Server-Sent Events)
    r.post('/ai/chat', async (req, reply) => {
      const s = req.session;
      const b = z.object({
        conversation_id: z.string().uuid().nullish(), message: z.string().trim().min(1).max(8000),
        page: z.object({ kind: z.string().max(40).optional(), id: z.string().max(60).optional(), title: z.string().max(200).optional() }).nullish(),
        locale: z.enum(['el', 'en']).default('el'),
      }).parse(req.body);
      const blocked = await gate(s, 'copilot');
      if (blocked) return refuse(reply, blocked);

      // Conversation + history (append-only: blocks go back exactly as the model returned them)
      const conv = await withTenant(s.tenantId, async (tx) => {
        if (b.conversation_id) {
          const [c] = await tx`SELECT id FROM ai_conversations WHERE id = ${b.conversation_id} AND user_id = ${s.userId}`;
          if (c) return c.id as string;
        }
        const [c] = await tx`INSERT INTO ai_conversations (tenant_id, user_id, title, context)
                             VALUES (${s.tenantId}, ${s.userId}, ${b.message.slice(0, 80)}, ${b.page ? tx.json(b.page as never) : null}) RETURNING id`;
        return c.id as string;
      });
      const history = await withTenant(s.tenantId, (tx) => tx<{ role: 'user' | 'assistant'; content: Msg['content'] }[]>`
        SELECT role, content FROM ai_messages WHERE conversation_id = ${conv} ORDER BY id`);
      const messages: Msg[] = history.map((m) => ({ role: m.role, content: m.content as Msg['content'] }) as Msg);
      const save = (role: 'user' | 'assistant', content: unknown) => withTenant(s.tenantId, (tx) => tx`
        INSERT INTO ai_messages (tenant_id, conversation_id, role, content) VALUES (${s.tenantId}, ${conv}, ${role}, ${tx.json(content as never)})`);
      const userMsg: Msg = { role: 'user', content: [{ type: 'text', text: `${contextLine(b.page)}\n${b.message}` }] };
      messages.push(userMsg);
      await save('user', userMsg.content);

      reply.hijack();
      reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = (o: unknown) => { if (!reply.raw.destroyed) reply.raw.write(`data: ${JSON.stringify(o)}\n\n`); };
      const abort = new AbortController();
      reply.raw.on('close', () => abort.abort());
      send({ type: 'start', conversation_id: conv });

      const system = await systemPrompt(s, b.locale);
      const call = callerFor(app, req);
      let hiddenCache: { customer: Set<string>; branch: Set<string> } | null = null;
      const ctx = {
        call, s, conversationId: conv,
        hidden: async () => {
          if (!hiddenCache) {
            const get = async (f: string) => new Set((((await call('GET', `/forms/${f}/effective`)).data as { fields?: { key: string; hidden: boolean }[] })?.fields ?? []).filter((x) => x.hidden).map((x) => x.key));
            hiddenCache = { customer: await get('customer'), branch: await get('branch') };
          }
          return hiddenCache;
        },
      };
      try {
        for (let step = 0; step < MAX_STEPS; step++) {
          const t0 = Date.now();
          const stream = (await aiFor(s.tenantId))!.beta.messages.stream({
            model: MODEL, max_tokens: 32000, betas: BETAS, fallbacks: 'default',
            output_config: { effort: 'medium' },
            cache_control: { type: 'ephemeral' },
            system, tools: TOOLS.map((t) => t.tool), messages,
          }, { signal: abort.signal });
          stream.on('text', (delta) => send({ type: 'text', delta }));
          let msg;
          try { msg = await stream.finalMessage(); }
          catch (e) { if (!abort.signal.aborted) await recordError(s, 'copilot', e, { requested_model: MODEL, duration_ms: Date.now() - t0, entity: 'conversation', entity_id: conv }); throw e; }
          await meter(s, 'copilot', msg.model, msg.usage, {
            request_id: (stream as unknown as { request_id?: string | null }).request_id ?? null, duration_ms: Date.now() - t0, entity: 'conversation', entity_id: conv,
          }, msg.stop_reason === 'refusal');
          messages.push({ role: 'assistant', content: msg.content });
          await save('assistant', msg.content);

          if (msg.stop_reason === 'refusal') { send({ type: 'error', error: 'refused' }); break; }
          if (msg.stop_reason === 'pause_turn') continue;
          const uses = msg.content.filter((x): x is Anthropic.Beta.BetaToolUseBlock => x.type === 'tool_use');
          if (!uses.length) break;
          if (msg.stop_reason === 'max_tokens') { send({ type: 'error', error: 'too_long' }); break; }

          const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(uses.map(async (u) => {
            const def = TOOL_BY_NAME.get(u.name);
            send({ type: 'tool', name: u.name, label: def?.label[b.locale] ?? u.name });
            if (!def) return { type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: 'unknown tool' };
            const parsed = def.schema.safeParse(u.input);
            if (!parsed.success) return { type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: `invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}` };
            try {
              const out = await def.run(parsed.data as never, ctx);
              if (out && typeof out === 'object' && 'proposed_action_id' in out) {
                const [a] = await withTenant(s.tenantId, (tx) => tx`SELECT id, kind, payload, summary, status FROM ai_actions WHERE id = ${(out as { proposed_action_id: string }).proposed_action_id}`);
                send({ type: 'action', action: a });
              }
              const text = JSON.stringify(out ?? null);
              return { type: 'tool_result' as const, tool_use_id: u.id, content: text.length > 60000 ? `${text.slice(0, 60000)}… (truncated: narrow the search)` : text };
            } catch (e) {
              return { type: 'tool_result' as const, tool_use_id: u.id, is_error: true, content: e instanceof ToolError ? e.message : 'tool failed' };
            }
          }));
          const toolMsg: Msg = { role: 'user', content: results };
          messages.push(toolMsg);
          await save('user', results);
        }
        await withTenant(s.tenantId, (tx) => tx`UPDATE ai_conversations SET updated_at = now() WHERE id = ${conv}`);
        send({ type: 'done', conversation_id: conv });
      } catch (e) {
        if (!abort.signal.aborted) { req.log.error(e); send({ type: 'error', error: apiError(e) }); }
      }
      reply.raw.end();
    });

    // ------------------------------------------------------------ confirm / cancel a proposed action
    r.post('/ai/actions/:id/:decision', async (req, reply) => {
      const s = req.session;
      const p = z.object({ id: z.string().uuid(), decision: z.enum(['confirm', 'cancel']) }).parse(req.params);
      const edits = z.object({ payload: z.record(z.string(), z.unknown()).optional() }).parse(req.body ?? {});
      const [a] = await withTenant(s.tenantId, (tx) => tx`
        UPDATE ai_actions SET status = 'cancelled', decided_at = now()
        WHERE id = ${p.id} AND user_id = ${s.userId} AND status = 'pending' AND ${p.decision === 'cancel'}
        RETURNING id`);
      if (p.decision === 'cancel') return a ? { ok: true, status: 'cancelled' } : reply.code(409).send({ error: 'not_pending' });
      // Claim it first so a double click cannot run it twice
      const [row] = await withTenant(s.tenantId, (tx) => tx<{ id: string; kind: ActionKind; payload: Record<string, unknown> }[]>`
        UPDATE ai_actions SET status = 'done', decided_at = now() WHERE id = ${p.id} AND user_id = ${s.userId} AND status = 'pending'
        RETURNING id, kind, payload`);
      if (!row) return reply.code(409).send({ error: 'not_pending' });
      const payload = { ...row.payload, ...(edits.payload ?? {}) };
      try {
        const result = await executeAction(callerFor(app, req), row.kind, payload);
        await withTenant(s.tenantId, async (tx) => {
          await tx`UPDATE ai_actions SET result = ${tx.json(result as never)}, payload = ${tx.json(payload as never)} WHERE id = ${row.id}`;
          await audit(tx, s, `ai.action.${row.kind}`, null, { action: row.id, result });
        });
        return { ok: true, status: 'done', result };
      } catch (e) {
        const error = e instanceof ToolError ? e.message : 'failed';
        await withTenant(s.tenantId, (tx) => tx`UPDATE ai_actions SET status = 'failed', result = ${tx.json({ error } as never)} WHERE id = ${row.id}`);
        return reply.code(400).send({ error });
      }
    });

    // ------------------------------------------------------------ voice / dictated visit → activity + tasks
    r.post('/ai/visit', async (req, reply) => {
      const s = req.session;
      const blocked = await gate(s, 'voice');
      if (blocked) return refuse(reply, blocked);
      const b = z.object({ text: z.string().trim().min(3).max(10000), customer_id: z.string().uuid().nullish(), branch_id: z.string().uuid().nullish(), locale: z.enum(['el', 'en']).default('el') }).parse(req.body);
      const call = callerFor(app, req);
      const meta = (await call('GET', '/crm/meta')).data as { types: { key: string; name: string; active: boolean }[]; outcomes: { key: string; name: string; active: boolean }[]; users: { id: string; full_name: string }[] };
      const types = meta.types.filter((t) => t.active), outcomes = meta.outcomes.filter((o) => o.active);
      const Schema = z4.object({
        customer_name: z4.string().nullable().describe('Customer / company mentioned, as said; null if none'),
        store_name: z4.string().nullable().describe('Store / branch mentioned; null if none'),
        activity: z4.object({
          type: z4.string().describe(`One of: ${types.map((t) => t.key).join(', ')}`),
          subject: z4.string().describe('Short title, e.g. "Επίσκεψη – ανανέωση συμβολαίου"'),
          body: z4.string().describe('Clean, well-written notes of what was discussed, in the speaker language, bullet points allowed'),
          outcome: z4.string().nullable().describe(`One of: ${outcomes.map((o) => o.key).join(', ') || 'none'}; null if unclear`),
          outcome_note: z4.string().nullable(),
          duration_min: z4.number().int().nullable(),
        }),
        tasks: z4.array(z4.object({
          title: z4.string(), description: z4.string().nullable(),
          due_at: z4.string().nullable().describe('ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:MM) resolved from relative words like "την Πέμπτη"; null if none'),
          priority: z4.number().int().min(1).max(3), assignee_name: z4.string().nullable().describe('Colleague named as responsible; null = the speaker'),
        })).describe('Follow-ups the speaker committed to or asked for'),
        follow_up: z4.object({ subject: z4.string(), due_at: z4.string() }).nullable().describe('A next visit/call to plan, if one was mentioned with a date'),
      });
      try {
        const out = await extract(s, 'voice', Schema,
          `You turn a salesperson's dictated or typed visit report into structured CRM data. The text may come from speech recognition: fix obvious recognition errors, keep names as said. Today is ${contextLine(null)}. Never invent facts that were not said.`,
          [{ type: 'text', text: b.text }], 'medium');
        // Match the customer (unless the screen already says which one) through the user's own search
        let customer: { id: string; name: string } | null = null;
        let candidates: { id: string; name: string; address_city?: string | null }[] = [];
        if (b.customer_id) {
          const c = await call('GET', `/customers/${b.customer_id}`);
          if (c.status < 400) customer = { id: b.customer_id, name: (c.data as { name: string }).name };
        } else if (out.customer_name) {
          const r2 = await call('GET', `/customers?q=${encodeURIComponent(out.customer_name)}&limit=5`);
          candidates = ((r2.data as { items?: { id: string; name: string; address_city?: string | null }[] })?.items ?? []).map(({ id, name, address_city }) => ({ id, name, address_city }));
          if (candidates.length === 1) customer = candidates[0];
        }
        let branchId = b.branch_id ?? null;
        if (!branchId && customer && out.store_name) {
          const br = await call('GET', `/customers/${customer.id}/branches`);
          const list = (Array.isArray(br.data) ? br.data : (br.data as { items?: unknown[] })?.items ?? []) as { id: string; name: string; trade_name?: string | null }[];
          const k = out.store_name.toLowerCase();
          branchId = list.find((x) => x.name.toLowerCase().includes(k) || (x.trade_name ?? '').toLowerCase().includes(k))?.id ?? null;
        }
        const userId = (name: string | null) => (name ? meta.users.find((u) => u.full_name.toLowerCase().includes(name.toLowerCase()))?.id ?? null : null);
        const proposals: { kind: ActionKind; payload: Record<string, unknown>; summary: Record<string, unknown> }[] = [];
        const link = { customer_id: customer?.id ?? null, branch_id: branchId };
        proposals.push({ kind: 'activity', payload: {
          type: types.some((t) => t.key === out.activity.type) ? out.activity.type : (types.find((t) => t.key === 'visit')?.key ?? types[0]?.key ?? 'visit'),
          subject: out.activity.subject, body: out.activity.body, status: 'done', due_at: new Date().toISOString(),
          duration_min: out.activity.duration_min ?? undefined, outcome: outcomes.some((o) => o.key === out.activity.outcome) ? out.activity.outcome : null,
          outcome_note: out.activity.outcome_note, ...link }, summary: { subject: out.activity.subject, type: out.activity.type, status: 'done' } });
        for (const t of out.tasks) {
          proposals.push({ kind: 'task', payload: { title: t.title, description: t.description, due_at: t.due_at, priority: t.priority, owner_id: userId(t.assignee_name) ?? undefined, ...link },
            summary: { title: t.title, due_at: t.due_at, assignee: t.assignee_name } });
        }
        if (out.follow_up) {
          proposals.push({ kind: 'activity', payload: { type: types.find((t) => t.key === 'visit')?.key ?? out.activity.type, subject: out.follow_up.subject, status: 'planned', due_at: out.follow_up.due_at, ...link },
            summary: { subject: out.follow_up.subject, status: 'planned', due_at: out.follow_up.due_at } });
        }
        const actions = await withTenant(s.tenantId, (tx) => Promise.all(proposals.map(async (p) => (await tx`
          INSERT INTO ai_actions (tenant_id, user_id, kind, payload, summary) VALUES (${s.tenantId}, ${s.userId}, ${p.kind}, ${tx.json(p.payload as never)}, ${tx.json(p.summary as never)})
          RETURNING id, kind, payload, summary, status`)[0])));
        return { customer, candidates: customer ? [] : candidates, customer_name: out.customer_name, actions };
      } catch (e) {
        req.log.error(e);
        return reply.code(502).send({ error: e instanceof ToolError ? e.message : apiError(e) });
      }
    });

    /** Link the voice proposals to a customer chosen afterwards (when the name matched several). */
    r.post('/ai/actions/link', async (req) => {
      const s = req.session;
      const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(20), customer_id: z.string().uuid() }).parse(req.body);
      await withTenant(s.tenantId, (tx) => tx`
        UPDATE ai_actions SET payload = payload || ${tx.json({ customer_id: b.customer_id } as never)}
        WHERE id = ANY(${b.ids}) AND user_id = ${s.userId} AND status = 'pending'`);
      return { ok: true };
    });

    // ------------------------------------------------------------ customer 360 summary
    r.post('/ai/customers/:id/summary', async (req, reply) => {
      const s = req.session;
      const blocked = await gate(s, 'summary');
      if (blocked) return refuse(reply, blocked);
      const { id } = idParam.parse(req.params);
      const locale = z.object({ locale: z.enum(['el', 'en']).default('el') }).parse(req.body ?? {}).locale;
      const def = TOOL_BY_NAME.get('get_customer')!;
      const call = callerFor(app, req);
      let data: unknown;
      try {
        data = await def.run({ id } as never, {
          call, s, conversationId: null,
          hidden: async () => {
            const get = async (f: string) => new Set((((await call('GET', `/forms/${f}/effective`)).data as { fields?: { key: string; hidden: boolean }[] })?.fields ?? []).filter((x) => x.hidden).map((x) => x.key));
            return { customer: await get('customer'), branch: await get('branch') };
          },
        });
      } catch { return reply.code(404).send({ error: 'not_found' }); }
      const t0 = Date.now();
      try {
        const r2 = await (await aiFor(s.tenantId))!.beta.messages.create({
          model: MODEL, max_tokens: 8000, betas: BETAS, fallbacks: 'default', output_config: { effort: 'medium' },
          system: `You brief a salesperson before they contact a customer. Write in ${locale === 'el' ? 'Greek' : 'English'}, markdown, at most ~180 words: ` +
            `**Σε μια ματιά** (who they are, value, status), **Τι τρέχει** (open offers with amounts, last contacts and outcomes, open tasks — with dates), ` +
            `**Προσοχή** (risks: overdue tasks, offers about to expire, long silence, declining), **Επόμενο βήμα** (one concrete recommendation). ` +
            `Use only the data given; skip a section that has nothing. ${contextLine(null)}`,
          messages: [{ role: 'user', content: JSON.stringify(data).slice(0, 150000) }],
        });
        await meter(s, 'summary', r2.model, r2.usage, { request_id: (r2 as { _request_id?: string | null })._request_id, duration_ms: Date.now() - t0, entity: 'customer', entity_id: id }, r2.stop_reason === 'refusal');
        if (r2.stop_reason === 'refusal') return reply.code(502).send({ error: 'refused' });
        return { text: textOf(r2.content), generated_at: new Date().toISOString() };
      } catch (e) {
        req.log.error(e);
        await recordError(s, 'summary', e, { requested_model: MODEL, duration_ms: Date.now() - t0, entity: 'customer', entity_id: id });
        return reply.code(502).send({ error: apiError(e) });
      }
    });

    // ------------------------------------------------------------ customer activities (tab "Ενέργειες"): summary or a question
    r.post('/ai/customers/:id/actions-summary', async (req, reply) => {
      const s = req.session;
      const blocked = await gate(s, 'actions_summary');
      if (blocked) return refuse(reply, blocked);
      const { id } = idParam.parse(req.params);
      const b = z.object({
        locale: z.enum(['el', 'en']).default('el'),
        period: z.enum(['90d', '365d', 'all']).default('365d'),
        question: z.string().trim().max(500).optional(),
      }).parse(req.body ?? {});
      const since = b.period === 'all' ? null : new Date(Date.now() - (b.period === '90d' ? 90 : 365) * 864e5);
      const data = await withTenant(s.tenantId, async (tx) => {
        const [c] = await tx`SELECT name, code, address_city AS city FROM customers WHERE id = ${id}`;
        if (!c) return null;
        // Same visibility as the CRM screens: without "all activities", only own / assigned
        const mine = can(s, 'activities.all') ? tx`` : tx`AND (a.owner_id = ${s.userId} OR a.created_by = ${s.userId} OR a.requested_by = ${s.userId})`;
        const acts = await tx`
          SELECT coalesce(a.due_at, a.created_at) AS date, a.ends_at, a.erp_code AS code, t.name AS series, a.status, es.name AS erp_status, ch.name AS characterization,
                 a.subject, left(coalesce(a.body, ''), 1500) AS remarks, oc.name AS outcome, a.outcome_note, ow.full_name AS handler, rq.full_name AS requested_by,
                 b.name AS store, a.priority
          FROM crm_activities a
          LEFT JOIN crm_activity_types t ON t.tenant_id = a.tenant_id AND t.key = a.type
          LEFT JOIN crm_erp_values ch ON ch.tenant_id = a.tenant_id AND ch.kind = 'characterization' AND ch.code = a.characterization
          LEFT JOIN crm_erp_values es ON es.tenant_id = a.tenant_id AND es.kind = 'status' AND es.code = a.erp_status
          LEFT JOIN crm_outcomes oc ON oc.tenant_id = a.tenant_id AND oc.key = a.outcome
          LEFT JOIN users ow ON ow.id = a.owner_id LEFT JOIN users rq ON rq.id = a.requested_by LEFT JOIN branches b ON b.id = a.branch_id
          WHERE a.customer_id = ${id} ${since ? tx`AND coalesce(a.due_at, a.created_at) >= ${since}` : tx``} ${mine}
          ORDER BY coalesce(a.due_at, a.created_at) DESC LIMIT 300`;
        return { customer: c, today: new Date().toISOString().slice(0, 10), activities: acts };
      });
      if (!data) return reply.code(404).send({ error: 'not_found' });
      if (!data.activities.length) return { text: b.locale === 'el' ? 'Δεν υπάρχουν ενέργειες για αυτό το διάστημα.' : 'No activities in this period.', count: 0, generated_at: new Date().toISOString() };
      const lang = b.locale === 'el' ? 'Greek' : 'English';
      const system = b.question
        ? `You answer a salesperson's question about one customer's CRM activities (calls, visits, offers, notes, with remarks). Write in ${lang}, markdown, concise. ` +
          `Use only the data given; cite dates and activity codes when useful; say plainly when the data does not contain the answer. ${contextLine(null)}`
        : `You summarise one customer's CRM activities for a salesperson. Write in ${lang}, markdown, at most ~220 words, with these sections: ` +
          `**Ιστορικό σχέσης** (what happened over time: offers sent with amounts, visits, agreements, payments — with dates and codes), ` +
          `**Τι λένε οι παρατηρήσεις** (recurring themes, objections, promises, facts about the premises), ` +
          `**Ανοιχτά** (open / upcoming activities with dates and who handles them), ` +
          `**Προσοχή** (risks: overdue, unanswered, cancellations, disputes), **Επόμενο βήμα** (one concrete recommendation). ` +
          `Use only the data given; skip a section that has nothing. ${contextLine(null)}`;
      const t0 = Date.now();
      try {
        const r2 = await (await aiFor(s.tenantId))!.beta.messages.create({
          model: MODEL, max_tokens: 8000, betas: BETAS, fallbacks: 'default', output_config: { effort: 'medium' }, system,
          messages: [{ role: 'user', content: `${b.question ? `Ερώτηση: ${b.question}\n\n` : ''}${JSON.stringify(data).slice(0, 180000)}` }],
        });
        await meter(s, 'actions_summary', r2.model, r2.usage, { request_id: (r2 as { _request_id?: string | null })._request_id, duration_ms: Date.now() - t0, entity: 'customer', entity_id: id }, r2.stop_reason === 'refusal');
        if (r2.stop_reason === 'refusal') return reply.code(502).send({ error: 'refused' });
        return { text: textOf(r2.content), count: data.activities.length, generated_at: new Date().toISOString() };
      } catch (e) {
        req.log.error(e);
        await recordError(s, 'actions_summary', e, { requested_model: MODEL, duration_ms: Date.now() - t0, entity: 'customer', entity_id: id });
        return reply.code(502).send({ error: apiError(e) });
      }
    });

    // ------------------------------------------------------------ natural-language report → definition
    r.post('/ai/report', async (req, reply) => {
      const s = req.session;
      const blocked = await gate(s, 'reports');
      if (blocked) return refuse(reply, blocked);
      const b = z.object({ prompt: z.string().trim().min(3).max(1000) }).parse(req.body);
      const meta = (await callerFor(app, req)('GET', '/reports/meta')).data as { catalogue: Record<string, { label: unknown; measures: Record<string, unknown>; dims: Record<string, unknown>; filters?: unknown }>; users: { id: string; full_name: string }[]; categories: string[]; regions: string[] };
      const sources = Object.keys(meta.catalogue);
      const Schema = z4.object({
        name: z4.string().describe('Short report title in the user language'),
        source: z4.enum(sources as [string, ...string[]]), measure: z4.string(), group: z4.string().describe('A dimension key of the source, or "none"'),
        period: z4.object({ preset: z4.enum(['7d', '30d', '90d', 'month', 'last_month', 'quarter', 'year', 'last_year', 'all', 'custom']), from: z4.string().nullable(), to: z4.string().nullable() }),
        compare: z4.boolean(), chart: z4.enum(['bar', 'column', 'line', 'table', 'kpi']),
        filters: z4.object({ owner: z4.string().nullable(), status: z4.string().nullable(), category: z4.string().nullable(), region: z4.string().nullable() }),
        limit: z4.number().int().min(1).max(200),
      });
      const cat = Object.entries(meta.catalogue).map(([k, v]) => `${k}: measures {${Object.keys(v.measures).join(', ')}} dims {${Object.keys(v.dims).join(', ')}}`).join('\n');
      try {
        const out = await extract(s, 'reports', Schema,
          `Turn the user's request into a report definition for this engine. Sources:\n${cat}\nGroup by "month"/"week" with chart "line" or "column" for trends over time; "kpi" for a single number; "bar" for rankings. compare=true when they ask "vs last year/period". ` +
          `Owners (filters.owner = id): ${meta.users.map((u) => `${u.id}=${u.full_name}`).join(', ')}. Categories: ${meta.categories.join(', ')}. Regions: ${meta.regions.join(', ')}. ${contextLine(null)}`,
          [{ type: 'text', text: b.prompt }], 'low');
        const { name, ...d } = out;
        const definition = { ...d, period: { preset: d.period.preset, ...(d.period.from ? { from: d.period.from } : {}), ...(d.period.to ? { to: d.period.to } : {}) },
          filters: Object.fromEntries(Object.entries(d.filters).filter(([, v]) => v)) };
        const valid = definitionSchema.safeParse(definition);
        if (!valid.success) return reply.code(422).send({ error: 'invalid_definition', detail: valid.error.issues.map((i) => i.message) });
        return { name, definition: valid.data };
      } catch (e) { req.log.error(e); return reply.code(502).send({ error: e instanceof ToolError ? e.message : apiError(e) }); }
    });

    // ------------------------------------------------------------ smart import: business card / PDF / pasted text → customer fields
    r.post('/ai/extract-customer', { bodyLimit: 15_000_000 }, async (req, reply) => {
      const s = req.session;
      const blocked = await gate(s, 'import');
      if (blocked) return refuse(reply, blocked);
      const b = z.object({
        text: z.string().max(20000).nullish(),
        file: z.object({ media_type: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']), data: z.string().max(14_000_000) }).nullish(),
      }).refine((x) => x.text || x.file, 'empty').parse(req.body);
      const Schema = z4.object({
        name: z4.string().nullable().describe('Legal / company name'), trade_name: z4.string().nullable(),
        vat: z4.string().nullable().describe('Greek ΑΦΜ (9 digits) or EU VAT number, digits only for Greek'),
        tax_office: z4.string().nullable(), activity: z4.string().nullable(),
        email: z4.string().nullable(), phone: z4.string().nullable(), mobile: z4.string().nullable(), website: z4.string().nullable(),
        address_street: z4.string().nullable(), address_postal: z4.string().nullable(), address_city: z4.string().nullable(), address_region: z4.string().nullable(), address_country: z4.string().nullable().describe('ISO 3166-1 alpha-2'),
        contact: z4.object({ full_name: z4.string(), role: z4.string().nullable(), email: z4.string().nullable(), phone: z4.string().nullable() }).nullable().describe('The person on the card / signature'),
        notes: z4.string().nullable().describe('Anything else useful, short'),
      });
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      if (b.file) {
        content.push(b.file.media_type === 'application/pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.file.data } }
          : { type: 'image', source: { type: 'base64', media_type: b.file.media_type, data: b.file.data } });
      }
      content.push({ type: 'text', text: b.text ? `Extract the company from this:\n${b.text}` : 'Extract the company from this document.' });
      try {
        const out = await extract(s, 'import', Schema,
          'You read business cards, letterheads, invoices, e-mail signatures and company documents and extract the company\'s details for a CRM. Leave a field null when it is not on the document; never guess a VAT number.', content, 'low');
        // Possible duplicates the user can see
        let duplicates: unknown[] = [];
        const q = out.vat || out.name;
        if (q) {
          const r2 = await callerFor(app, req)('GET', `/customers?q=${encodeURIComponent(q)}&limit=5`);
          duplicates = ((r2.data as { items?: { id: string; name: string; vat?: string | null; address_city?: string | null }[] })?.items ?? []).map(({ id, name, vat, address_city }) => ({ id, name, vat, address_city }));
        }
        return { fields: out, duplicates };
      } catch (e) { req.log.error(e); return reply.code(502).send({ error: e instanceof ToolError ? e.message : apiError(e) }); }
    });
  });
}

// keep the type import used
export type { Session };
void sql;
