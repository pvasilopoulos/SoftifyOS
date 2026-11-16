-- SoftifyOS core schema
-- Multitenancy: shared schema, tenant_id on every tenant-owned table,
-- enforced by Row Level Security under the role "softify_app".
-- Every API transaction runs: SET LOCAL ROLE softify_app; set_config('app.tenant_id', ...)

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Time-ordered UUIDv7: index-friendly primary keys (no random B-tree page splits)
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  ts bytea := substring(int8send((extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3);
  b  bytea := ts || gen_random_bytes_compat(10);
BEGIN
  b := set_byte(b, 6, (get_byte(b, 6) & 15) | 112);  -- version 7
  b := set_byte(b, 8, (get_byte(b, 8) & 63) | 128);  -- variant
  RETURN encode(b, 'hex')::uuid;
END $$;

-- gen_random_uuid() is core since PG13; derive random bytes from it (no pgcrypto needed)
CREATE OR REPLACE FUNCTION gen_random_bytes_compat(n int) RETURNS bytea
LANGUAGE sql VOLATILE AS $$
  SELECT substring(decode(replace(gen_random_uuid()::text, '-', ''), 'hex') FROM 1 FOR n)
$$;

-- Accent-insensitive, case-insensitive search key (Greek + Latin)
CREATE OR REPLACE FUNCTION search_key(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(lower(coalesce(t, '')),
    'άέήίόύώϊϋΐΰςáàâäéèêëíìîïóòôöúùûüç',
    'αεηιουωιυιυσaaaaeeeeiiiioooouuuuc')
$$;

-- Current tenant from the transaction-local setting
CREATE OR REPLACE FUNCTION app_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Application role (RLS applies to it; it has no BYPASSRLS)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'softify_app') THEN
    CREATE ROLE softify_app NOLOGIN;
  END IF;
  EXECUTE format('GRANT softify_app TO %I', current_user);
END $$;

GRANT USAGE ON SCHEMA public TO softify_app;

-- ---------------------------------------------------------------------------
-- Global tables (not tenant-scoped)
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  plan        text NOT NULL DEFAULT 'standard',
  locale      text NOT NULL DEFAULT 'el',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  avatar_url    text,
  locale        text NOT NULL DEFAULT 'el',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));

CREATE TABLE memberships (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner','admin','manager','sales','viewer')),
  title      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships (user_id);

-- ---------------------------------------------------------------------------
-- Tenant-owned tables
-- ---------------------------------------------------------------------------

-- The tenant's own legal entities (issuing companies, e.g. "NOVA Services A.E.")
CREATE TABLE companies (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  vat        text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_tenant_idx ON companies (tenant_id, name);

-- Customers: groups (Όμιλος) and their companies via parent_id
CREATE TABLE customers (
  id                 uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id          uuid REFERENCES customers(id) ON DELETE SET NULL,
  code               text NOT NULL,
  kind               text NOT NULL DEFAULT 'company' CHECK (kind IN ('group','company')),
  name               text NOT NULL,
  vat                text,
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('active','prospect','negotiation','inactive')),
  category           text,
  account_manager_id uuid REFERENCES users(id) ON DELETE SET NULL,
  image_url          text,
  annual_value       numeric(14,2) NOT NULL DEFAULT 0,
  companies_count    int NOT NULL DEFAULT 0,
  branches_count     int NOT NULL DEFAULT 0,
  spaces_count       int NOT NULL DEFAULT 0,
  search             text GENERATED ALWAYS AS (search_key(name || ' ' || coalesce(vat,'') || ' ' || code)) STORED,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
-- Keyset pagination: (tenant_id, name, id) and (tenant_id, status, name, id)
CREATE INDEX customers_list_idx   ON customers (tenant_id, name, id);
CREATE INDEX customers_status_idx ON customers (tenant_id, status, name, id);
CREATE INDEX customers_parent_idx ON customers (tenant_id, parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX customers_search_idx ON customers USING gin (search gin_trgm_ops);

CREATE TABLE branches (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id  uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name         text NOT NULL,
  city         text,
  status       text NOT NULL DEFAULT 'active',
  spaces_count int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX branches_customer_idx ON branches (tenant_id, customer_id, name);

CREATE TABLE spaces (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id   uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'retail' CHECK (kind IN ('retail','warehouse','office','department')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX spaces_branch_idx ON spaces (tenant_id, branch_id);

CREATE TABLE contacts (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  full_name   text NOT NULL,
  email       text,
  phone       text,
  role_title  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_customer_idx ON contacts (tenant_id, customer_id);

-- Offers (Προσφορές) with versions and approval steps
CREATE TABLE offers (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  number          text NOT NULL,
  customer_id     uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES branches(id) ON DELETE SET NULL,
  space_id        uuid REFERENCES spaces(id) ON DELETE SET NULL,
  company_id      uuid REFERENCES companies(id) ON DELETE SET NULL,
  owner_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','in_progress','pending_approval','approved','sent','accepted','rejected')),
  current_version int NOT NULL DEFAULT 1,
  net_amount      numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount      numeric(14,2) NOT NULL DEFAULT 0,
  total_amount    numeric(14,2) NOT NULL DEFAULT 0,
  valid_until     date,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, number)
);
CREATE INDEX offers_list_idx     ON offers (tenant_id, created_at DESC, id DESC);
CREATE INDEX offers_status_idx   ON offers (tenant_id, status, created_at DESC, id DESC);
CREATE INDEX offers_customer_idx ON offers (tenant_id, customer_id, created_at DESC);

CREATE TABLE offer_versions (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  version     int NOT NULL,
  net_amount  numeric(14,2) NOT NULL DEFAULT 0,
  vat_amount  numeric(14,2) NOT NULL DEFAULT 0,
  total_amount numeric(14,2) NOT NULL DEFAULT 0,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, version)
);

CREATE TABLE offer_items (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  version_id  uuid NOT NULL REFERENCES offer_versions(id) ON DELETE CASCADE,
  position    int NOT NULL,
  description text NOT NULL,
  quantity    numeric(12,3) NOT NULL DEFAULT 1,
  unit_price  numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate    numeric(5,2) NOT NULL DEFAULT 24
);
CREATE INDEX offer_items_version_idx ON offer_items (version_id, position);

CREATE TABLE offer_approvals (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  offer_id    uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  step        int NOT NULL,
  title       text NOT NULL,
  approver_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at  timestamptz,
  UNIQUE (offer_id, step)
);
CREATE INDEX offer_approvals_approver_idx ON offer_approvals (tenant_id, approver_id, status);

-- Activity log: the fastest-growing table -> range-partitioned by month
CREATE TABLE activities (
  id           uuid NOT NULL DEFAULT uuid_v7(),
  tenant_id    uuid NOT NULL,
  customer_id  uuid,
  offer_id     uuid,
  actor_id     uuid,
  kind         text NOT NULL, -- offer_updated, meeting_done, email_sent, approval, call, note...
  title        text NOT NULL,
  body         text,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
CREATE INDEX activities_tenant_idx   ON activities (tenant_id, occurred_at DESC);
CREATE INDEX activities_customer_idx ON activities (tenant_id, customer_id, occurred_at DESC);
CREATE TABLE activities_default PARTITION OF activities DEFAULT;

-- Create monthly partitions from (now - back) to (now + ahead) months; safe to re-run
CREATE OR REPLACE FUNCTION ensure_activity_partitions(back int DEFAULT 24, ahead int DEFAULT 3)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  m date;
  tbl text;
BEGIN
  FOR i IN -back..ahead LOOP
    m := (date_trunc('month', now()) + make_interval(months => i))::date;
    tbl := 'activities_' || to_char(m, 'YYYY_MM');
    IF to_regclass(tbl) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF activities FOR VALUES FROM (%L) TO (%L)',
        tbl, m, (m + interval '1 month')::date);
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
      EXECUTE format('GRANT SELECT, INSERT ON %I TO softify_app', tbl);
    END IF;
  END LOOP;
END $$;
SELECT ensure_activity_partitions();

-- Calendar (Ημερολόγιο)
CREATE TABLE events (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  kind        text NOT NULL DEFAULT 'meeting' CHECK (kind IN ('meeting','visit','internal','presentation','followup','task')),
  title       text NOT NULL,
  location    text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  remind_at   timestamptz,
  reminded    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_range_idx  ON events (tenant_id, starts_at);
CREATE INDEX events_owner_idx  ON events (tenant_id, owner_id, starts_at);
CREATE INDEX events_remind_idx ON events (remind_at) WHERE reminded = false AND remind_at IS NOT NULL;

-- In-app notifications
CREATE TABLE notifications (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  body       text,
  url        text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (tenant_id, user_id) WHERE read_at IS NULL;

-- Web Push subscriptions (one per device/browser)
CREATE TABLE push_subscriptions (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, endpoint)
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (tenant_id, user_id);

-- Pre-aggregated counters per tenant: dashboards never COUNT(*) millions of rows
CREATE TABLE tenant_offer_stats (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  status    text NOT NULL,
  count     bigint NOT NULL DEFAULT 0,
  amount    numeric(18,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, status)
);

CREATE TABLE tenant_counters (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       text NOT NULL,
  value     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, key)
);

CREATE OR REPLACE FUNCTION trg_offer_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    UPDATE tenant_offer_stats SET count = count - 1, amount = amount - OLD.total_amount
     WHERE tenant_id = OLD.tenant_id AND status = OLD.status;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    INSERT INTO tenant_offer_stats (tenant_id, status, count, amount)
    VALUES (NEW.tenant_id, NEW.status, 1, NEW.total_amount)
    ON CONFLICT (tenant_id, status) DO UPDATE
      SET count = tenant_offer_stats.count + 1, amount = tenant_offer_stats.amount + EXCLUDED.amount;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER offers_stats AFTER INSERT OR DELETE OR UPDATE OF status, total_amount ON offers
  FOR EACH ROW EXECUTE FUNCTION trg_offer_stats();

CREATE OR REPLACE FUNCTION trg_customer_counter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
BEGIN
  INSERT INTO tenant_counters (tenant_id, key, value)
  VALUES (t, 'customers', CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + EXCLUDED.value;
  RETURN NULL;
END $$;
CREATE TRIGGER customers_counter AFTER INSERT OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION trg_customer_counter();

-- ---------------------------------------------------------------------------
-- Background job queue (Postgres-native: FOR UPDATE SKIP LOCKED, no Redis needed)
-- ---------------------------------------------------------------------------
CREATE TABLE jobs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  kind        text NOT NULL,
  payload     jsonb NOT NULL,
  run_at      timestamptz NOT NULL DEFAULT now(),
  attempts    int NOT NULL DEFAULT 0,
  last_error  text,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_ready_idx ON jobs (run_at) WHERE locked_at IS NULL;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'companies','customers','branches','spaces','contacts','offers','offer_versions',
    'offer_items','offer_approvals','activities','activities_default','events',
    'notifications','push_subscriptions','tenant_offer_stats','tenant_counters'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- Read-only access to global tables for the app role (writes go through the owner connection)
GRANT SELECT ON tenants, memberships TO softify_app;
GRANT SELECT (id, email, full_name, avatar_url, locale) ON users TO softify_app;
GRANT INSERT ON jobs TO softify_app;
GRANT USAGE ON SEQUENCE jobs_id_seq TO softify_app;
