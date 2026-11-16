-- Configurable value lists per tenant (geographic zones, fee schedules, field tours)
-- + new customer/store fields: geographic zone; store trade name, prefecture, zone,
--   fee schedule (αμοιβολόγιο), seasonality, field tour (εξόρμηση).

CREATE TABLE lookup_values (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  list       text NOT NULL CHECK (list IN ('geo_zone', 'fee_schedule', 'tour')),
  name       text NOT NULL,
  sort       int NOT NULL DEFAULT 0,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX lookup_values_name_uq ON lookup_values (tenant_id, list, lower(name));
CREATE INDEX lookup_values_list_idx ON lookup_values (tenant_id, list, sort, name);

ALTER TABLE lookup_values ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lookup_values USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON lookup_values TO softify_app;

-- Customers: geographic zone
ALTER TABLE customers ADD COLUMN geo_zone_id uuid REFERENCES lookup_values(id) ON DELETE SET NULL;
CREATE INDEX customers_geo_zone_fk ON customers (geo_zone_id) WHERE geo_zone_id IS NOT NULL;

-- Stores
ALTER TABLE branches
  ADD COLUMN trade_name      text,
  ADD COLUMN region          text,                -- νομός
  ADD COLUMN geo_zone_id     uuid REFERENCES lookup_values(id) ON DELETE SET NULL,
  ADD COLUMN fee_schedule_id uuid REFERENCES lookup_values(id) ON DELETE SET NULL,   -- αμοιβολόγιο
  ADD COLUMN tour_id         uuid REFERENCES lookup_values(id) ON DELETE SET NULL,   -- εξόρμηση
  ADD COLUMN seasonality     text NOT NULL DEFAULT 'all_year' CHECK (seasonality IN ('all_year', 'summer', 'winter', 'custom')),
  ADD COLUMN season_months   smallint[] NOT NULL DEFAULT '{}' CHECK (season_months <@ ARRAY[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]);

-- FK lookups (deletes of a value) + list filters ("all stores of tour X / zone Y")
CREATE INDEX branches_geo_zone_idx     ON branches (tenant_id, geo_zone_id, name, id) WHERE geo_zone_id IS NOT NULL;
CREATE INDEX branches_tour_idx         ON branches (tenant_id, tour_id, name, id) WHERE tour_id IS NOT NULL;
CREATE INDEX branches_fee_schedule_fk  ON branches (fee_schedule_id) WHERE fee_schedule_id IS NOT NULL;
CREATE INDEX branches_geo_zone_fk      ON branches (geo_zone_id) WHERE geo_zone_id IS NOT NULL;
CREATE INDEX branches_tour_fk          ON branches (tour_id) WHERE tour_id IS NOT NULL;

-- Store search now also covers trade name and prefecture
DROP INDEX IF EXISTS branches_search_idx;
ALTER TABLE branches DROP COLUMN search;
ALTER TABLE branches ADD COLUMN search text GENERATED ALWAYS AS (
  search_key(name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(region, '') || ' '
             || coalesce(address, '') || ' ' || coalesce(postal_code, '') || ' ' || coalesce(manager_name, ''))
) STORED;
CREATE INDEX branches_search_idx ON branches USING gin (search gin_trgm_ops);

-- Default geographic zones for every tenant (new tenants get them via provision_tenant)
CREATE OR REPLACE FUNCTION provision_lookups(t uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO lookup_values (tenant_id, list, name, sort)
  SELECT t, 'geo_zone', z.name, z.sort FROM (VALUES
    ('Αττική', 1), ('Βόρεια Ελλάδα', 2), ('Κεντρική Ελλάδα', 3), ('Δυτική Ελλάδα', 4),
    ('Πελοπόννησος', 5), ('Κρήτη', 6), ('Νησιά Αιγαίου', 7), ('Ιόνια Νησιά', 8)
  ) AS z(name, sort)
  ON CONFLICT DO NOTHING;
$$;
SELECT provision_lookups(id) FROM tenants;

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
  SELECT provision_lookups(t);
$$;
