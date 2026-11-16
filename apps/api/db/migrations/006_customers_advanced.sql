-- Advanced customer module: business identity, contact, addresses, commercial terms,
-- tags, lead source, archiving; richer contacts, branches and spaces.

ALTER TABLE customers
  ADD COLUMN trade_name        text,
  ADD COLUMN tax_office        text,          -- ΔΟΥ
  ADD COLUMN gemi              text,          -- ΓΕΜΗ
  ADD COLUMN activity          text,          -- δραστηριότητα
  ADD COLUMN email             text,
  ADD COLUMN phone             text,
  ADD COLUMN mobile            text,
  ADD COLUMN website           text,
  ADD COLUMN address_street    text,
  ADD COLUMN address_city      text,
  ADD COLUMN address_postal    text,
  ADD COLUMN address_region    text,
  ADD COLUMN address_country   text NOT NULL DEFAULT 'GR',
  ADD COLUMN billing_address   jsonb,         -- null = same as registered address
  ADD COLUMN payment_terms     text,          -- e.g. cash, 30d, 60d
  ADD COLUMN credit_limit      numeric(14,2),
  ADD COLUMN discount          numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= 100),
  ADD COLUMN tags              text[] NOT NULL DEFAULT '{}',
  ADD COLUMN source            text,          -- lead source: referral, website, exhibition...
  ADD COLUMN notes             text,
  ADD COLUMN archived_at       timestamptz;

-- Search now also covers trade name, email and phone
ALTER TABLE customers DROP COLUMN search;
ALTER TABLE customers ADD COLUMN search text GENERATED ALWAYS AS (
  search_key(name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(vat, '') || ' ' || code
             || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(address_city, ''))
) STORED;
CREATE INDEX customers_search_idx ON customers USING gin (search gin_trgm_ops);

-- Keyset sort orders used by the list (active customers only; archived are rare)
CREATE INDEX customers_recent_idx  ON customers (tenant_id, created_at DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX customers_value_idx   ON customers (tenant_id, annual_value DESC, id DESC) WHERE archived_at IS NULL;
CREATE INDEX customers_manager_idx ON customers (tenant_id, account_manager_id, name, id) WHERE archived_at IS NULL;
CREATE INDEX customers_tags_idx    ON customers USING gin (tags);
CREATE INDEX customers_vat_idx     ON customers (tenant_id, vat) WHERE vat IS NOT NULL;

ALTER TABLE contacts
  ADD COLUMN mobile     text,
  ADD COLUMN is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN notes      text;
-- At most one primary contact per customer
CREATE UNIQUE INDEX contacts_primary_uq ON contacts (customer_id) WHERE is_primary;

ALTER TABLE branches
  ADD COLUMN address      text,
  ADD COLUMN postal_code  text,
  ADD COLUMN phone        text,
  ADD COLUMN manager_name text;

ALTER TABLE spaces
  ADD COLUMN area_sqm numeric(10,2),
  ADD COLUMN notes    text;
