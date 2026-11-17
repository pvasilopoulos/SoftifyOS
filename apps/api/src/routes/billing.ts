// Settings → Subscription: plan, usage against limits, Stripe Checkout / Customer Portal, and the Stripe webhook.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql, withTenant } from '../db.js';
import { requireAuth } from '../auth.js';
import { env } from '../env.js';
import { enqueue } from '../jobs.js';
import { monthSpend } from '../ai.js';
import { audit } from './settings.js';
import {
  applySubscription, billingEnabled, invalidatePlan, PAID, PLANS, planOf, priceId, stripe, verifyStripeSignature, type PlanKey,
} from '../billing.js';

const appUrl = (p: string) => `${env.appUrl.replace(/\/$/, '')}${p}`;

export default async function billingRoutes(app: FastifyInstance) {
  // ---------------------------------------------------------------- Stripe webhook (raw body for the signature)
  await app.register(async (w) => {
    w.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 1_000_000 }, (_req, body, done) => done(null, body));
    w.post('/billing/webhook', async (req, reply) => {
      const raw = req.body as Buffer;
      if (!verifyStripeSignature(raw, req.headers['stripe-signature'] as string | undefined)) return reply.code(400).send({ error: 'bad_signature' });
      const ev = JSON.parse(raw.toString('utf8')) as { id: string; type: string; data: { object: Record<string, unknown> } };
      const fresh = await sql`INSERT INTO billing_events (id, type) VALUES (${ev.id}, ${ev.type}) ON CONFLICT DO NOTHING RETURNING id`;
      if (!fresh.length) return { ok: true, duplicate: true };
      const o = ev.data.object as Record<string, never>;
      let tenantId: string | null = null;
      try {
        if (ev.type === 'checkout.session.completed' && o.mode === 'subscription') {
          tenantId = (o.client_reference_id as string) ?? null;
          if (tenantId) await sql`UPDATE tenants SET stripe_customer_id = ${o.customer as string} WHERE id = ${tenantId}`;
          tenantId = await applySubscription(await stripe('GET', `/subscriptions/${o.subscription as string}`) as never, tenantId);
        } else if (ev.type.startsWith('customer.subscription.')) {
          tenantId = await applySubscription(o as never);
        } else if (ev.type === 'invoice.payment_failed') {
          const [t] = await sql`SELECT id FROM tenants WHERE stripe_customer_id = ${o.customer as string}`;
          tenantId = (t?.id as string | undefined) ?? null;
          if (tenantId) {
            const owners = await sql`SELECT user_id FROM memberships WHERE tenant_id = ${tenantId} AND role = 'owner'`;
            if (owners.length) await enqueue('notify', { tenantId, userIds: owners.map((r) => r.user_id as string), title: '⚠️ Η πληρωμή της συνδρομής απέτυχε', body: 'Ενημερώστε τον τρόπο πληρωμής για να μη διακοπεί η υπηρεσία.', url: '/el/settings?s=billing' });
          }
        }
      } catch (e) {
        await sql`DELETE FROM billing_events WHERE id = ${ev.id}`;   // let Stripe retry
        throw e;
      }
      if (tenantId) await sql`UPDATE billing_events SET tenant_id = ${tenantId} WHERE id = ${ev.id}`;
      return { ok: true };
    });
  });

  await app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/settings/billing', async (req) => {
      const s = req.session;
      const p = await planOf(s.tenantId);
      const usage = await withTenant(s.tenantId, async (tx) => {
        const [u] = await tx`SELECT count(*)::int AS users FROM memberships WHERE tenant_id = ${s.tenantId}`;
        const [st] = await tx`SELECT coalesce(sum(size), 0)::bigint AS used FROM document_versions WHERE tenant_id = ${s.tenantId}`;
        return { users: u.users, storage_bytes: Number(st.used), ai_usd: await monthSpend(tx, s.tenantId) };
      });
      return {
        enabled: billingEnabled(), checkout: !!env.stripe.secretKey,
        plan: { ...p, limits: p.limits },
        usage,
        plans: PAID.map((k) => ({ key: k, ...PLANS[k], can_month: !!priceId(k, 'month'), can_year: !!priceId(k, 'year') })),
        trial: PLANS.trial,
        can_manage: s.role === 'owner' && !s.impersonator,
      };
    });

    r.post('/settings/billing/checkout', async (req, reply) => {
      const s = req.session;
      if (s.role !== 'owner' || s.impersonator) return reply.code(403).send({ error: 'forbidden' });
      if (!env.stripe.secretKey) return reply.code(409).send({ error: 'not_configured' });
      const b = z.object({ plan: z.enum(PAID as [PlanKey, ...PlanKey[]]), interval: z.enum(['month', 'year']), locale: z.enum(['el', 'en']).default('el') }).parse(req.body);
      const price = priceId(b.plan, b.interval);
      if (!price) return reply.code(409).send({ error: 'price_missing' });
      const p = await planOf(s.tenantId);
      // Already subscribed: plan changes happen in the Customer Portal (proration handled by Stripe)
      const [t] = await sql`SELECT stripe_subscription_id, name, (SELECT email FROM users WHERE id = ${s.userId}) AS email FROM tenants WHERE id = ${s.tenantId}`;
      if (t.stripe_subscription_id) return reply.code(409).send({ error: 'has_subscription' });
      const session = await stripe<{ url: string }>('POST', '/checkout/sessions', {
        mode: 'subscription',
        line_items: { 0: { price, quantity: 1 } },
        client_reference_id: s.tenantId,
        ...(p.stripe_customer_id ? { customer: p.stripe_customer_id, customer_update: { name: 'auto', address: 'auto' } } : { customer_email: t.email }),
        subscription_data: { metadata: { tenant_id: s.tenantId } },
        metadata: { tenant_id: s.tenantId },
        allow_promotion_codes: 'true',
        billing_address_collection: 'required',
        tax_id_collection: { enabled: 'true' },
        locale: b.locale,
        success_url: appUrl(`/${b.locale}/settings?s=billing&checkout=success`),
        cancel_url: appUrl(`/${b.locale}/settings?s=billing&checkout=cancel`),
      });
      await withTenant(s.tenantId, (tx) => audit(tx, s, 'billing.checkout', null, { plan: b.plan, interval: b.interval }));
      return { url: session.url };
    });

    r.post('/settings/billing/portal', async (req, reply) => {
      const s = req.session;
      if (s.role !== 'owner' || s.impersonator) return reply.code(403).send({ error: 'forbidden' });
      const p = await planOf(s.tenantId);
      if (!env.stripe.secretKey || !p.stripe_customer_id) return reply.code(409).send({ error: 'no_customer' });
      const { locale } = z.object({ locale: z.enum(['el', 'en']).default('el') }).parse(req.body ?? {});
      const session = await stripe<{ url: string }>('POST', '/billing_portal/sessions', {
        customer: p.stripe_customer_id, return_url: appUrl(`/${locale}/settings?s=billing`), locale,
      });
      return { url: session.url };
    });

    /** After returning from Checkout: read the subscription now instead of waiting for the webhook. */
    r.post('/settings/billing/refresh', async (req) => {
      const s = req.session;
      const p = await planOf(s.tenantId);
      if (env.stripe.secretKey && p.stripe_customer_id) {
        const subs = await stripe<{ data: never[] }>('GET', `/subscriptions?customer=${encodeURIComponent(p.stripe_customer_id)}&status=all&limit=1`);
        if (subs.data[0]) await applySubscription(subs.data[0], s.tenantId);
      }
      invalidatePlan(s.tenantId);
      return { ok: true };
    });
  });
}
