-- SaaS subscriptions: plan + status per organisation, Stripe ids, processed webhook events.
-- These columns are written only by the billing code (owner connection) — never through the app role,
-- so no organisation can change its own plan.

-- tenants.plan exists since 001 (unused 'standard'): it becomes the subscription plan
UPDATE tenants SET plan = 'enterprise';
ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'trial',
  ADD CONSTRAINT tenants_plan_check CHECK (plan IN ('trial', 'starter', 'business', 'enterprise'));

ALTER TABLE tenants
  ADD COLUMN plan_status          text NOT NULL DEFAULT 'trialing' CHECK (plan_status IN ('trialing', 'active', 'past_due', 'canceled')),
  ADD COLUMN billing_interval     text CHECK (billing_interval IN ('month', 'year')),
  ADD COLUMN trial_ends_at        timestamptz DEFAULT now() + interval '14 days',
  ADD COLUMN current_period_end   timestamptz,
  ADD COLUMN cancel_at_period_end boolean NOT NULL DEFAULT false,
  ADD COLUMN past_due_since       timestamptz,
  ADD COLUMN stripe_customer_id   text UNIQUE,
  ADD COLUMN stripe_subscription_id text UNIQUE;

-- Organisations that exist before billing are kept on the full plan
UPDATE tenants SET plan = 'enterprise', plan_status = 'active', trial_ends_at = NULL;

CREATE TABLE billing_events (
  id          text PRIMARY KEY,           -- Stripe event id (idempotency)
  type        text NOT NULL,
  tenant_id   uuid REFERENCES tenants(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX billing_events_tenant_idx ON billing_events (tenant_id, created_at DESC);
