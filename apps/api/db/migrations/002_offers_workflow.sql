-- Offers workflow: product catalogue, configurable approval flows, numbering,
-- richer line items, and a public link for customer acceptance.

-- ---------------------------------------------------------------------------
-- Product & service catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE products (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku         text NOT NULL,
  name        text NOT NULL,
  unit        text NOT NULL DEFAULT 'τεμ.',
  unit_price  numeric(14,2) NOT NULL DEFAULT 0,
  vat_rate    numeric(5,2) NOT NULL DEFAULT 24,
  active      boolean NOT NULL DEFAULT true,
  search      text GENERATED ALWAYS AS (search_key(name || ' ' || sku)) STORED,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, sku)
);
CREATE INDEX products_search_idx ON products USING gin (search gin_trgm_ops);
CREATE INDEX products_list_idx ON products (tenant_id, name) WHERE active;

-- ---------------------------------------------------------------------------
-- Line items: product link, unit, discount, computed line totals
-- ---------------------------------------------------------------------------
ALTER TABLE offer_items
  ADD COLUMN product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN unit       text NOT NULL DEFAULT 'τεμ.',
  ADD COLUMN discount   numeric(5,2) NOT NULL DEFAULT 0 CHECK (discount >= 0 AND discount <= 100),
  ADD COLUMN net_amount numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN vat_amount numeric(14,2) NOT NULL DEFAULT 0;
CREATE INDEX offer_items_tenant_idx ON offer_items (tenant_id, version_id);

ALTER TABLE offer_versions ADD COLUMN note text;
CREATE INDEX offer_versions_offer_idx ON offer_versions (tenant_id, offer_id, version DESC);

-- ---------------------------------------------------------------------------
-- Approval flows (per tenant, ordered steps, approver = minimum role)
-- ---------------------------------------------------------------------------
CREATE TABLE approval_flow_steps (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  step          int NOT NULL,
  title         text NOT NULL,
  required_role text NOT NULL DEFAULT 'manager' CHECK (required_role IN ('sales','manager','admin','owner')),
  -- Steps only apply above this offer total (0 = always)
  min_amount    numeric(14,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, step)
);

ALTER TABLE offer_approvals
  ADD COLUMN required_role text NOT NULL DEFAULT 'manager',
  ADD COLUMN version int NOT NULL DEFAULT 1,
  ADD COLUMN comment text;
-- approvals are recreated per submitted version
ALTER TABLE offer_approvals DROP CONSTRAINT offer_approvals_offer_id_step_key;
CREATE UNIQUE INDEX offer_approvals_offer_version_step_uq ON offer_approvals (offer_id, version, step);

-- ---------------------------------------------------------------------------
-- Offers: public acceptance link + customer response
-- ---------------------------------------------------------------------------
ALTER TABLE offers
  ADD COLUMN public_token      text UNIQUE,
  ADD COLUMN sent_at           timestamptz,
  ADD COLUMN sent_to           text,
  ADD COLUMN responded_at      timestamptz,
  ADD COLUMN responder_name    text,
  ADD COLUMN response_note     text,
  ADD COLUMN notes             text;

-- ---------------------------------------------------------------------------
-- RLS + grants for new tables
-- ---------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','approval_flow_steps'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- Default settings for a tenant (called for existing tenants here, and when a tenant is created)
CREATE OR REPLACE FUNCTION provision_tenant(t uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO approval_flow_steps (tenant_id, step, title, required_role, min_amount) VALUES
    (t, 1, 'Εμπορικός Διευθυντής', 'manager', 0),
    (t, 2, 'Οικονομική Διεύθυνση', 'admin', 50000)
  ON CONFLICT DO NOTHING;
  INSERT INTO products (tenant_id, sku, name, unit, unit_price, vat_rate)
  SELECT t, p.sku, p.name, p.unit, p.price, 24 FROM (VALUES
    ('SRV-001', 'Μελέτη & σχεδιασμός χώρου', 'ώρα', 65.00),
    ('SRV-002', 'Εγκατάσταση εξοπλισμού', 'ώρα', 45.00),
    ('SRV-003', 'Ετήσια συντήρηση', 'έτος', 1800.00),
    ('EQP-101', 'Ράφι μεταλλικό 2m', 'τεμ.', 240.00),
    ('EQP-102', 'Ψυγείο βιτρίνα', 'τεμ.', 3200.00),
    ('EQP-103', 'Ταμείο POS πλήρες', 'τεμ.', 1450.00),
    ('EQP-104', 'Φωτιστικό LED οροφής', 'τεμ.', 85.00),
    ('EQP-105', 'Σύστημα ασφαλείας & κάμερες', 'σετ', 4900.00),
    ('LIC-201', 'Άδεια λογισμικού ERP (ανά χρήστη)', 'έτος', 360.00),
    ('LIC-202', 'Cloud hosting', 'μήνας', 120.00)
  ) AS p(sku, name, unit, price)
  ON CONFLICT DO NOTHING;
$$;

SELECT provision_tenant(id) FROM tenants;
