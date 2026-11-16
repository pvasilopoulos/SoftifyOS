-- Stores: "Status on going" — a tenant-defined value list (Settings → Value lists).
ALTER TABLE lookup_values DROP CONSTRAINT IF EXISTS lookup_values_list_check;
ALTER TABLE lookup_values ADD CONSTRAINT lookup_values_list_check
  CHECK (list IN ('geo_zone', 'fee_schedule', 'tour', 'ongoing_status'));

ALTER TABLE branches ADD COLUMN ongoing_status_id uuid REFERENCES lookup_values(id) ON DELETE SET NULL;
CREATE INDEX branches_ongoing_idx ON branches (tenant_id, ongoing_status_id, name, id) WHERE ongoing_status_id IS NOT NULL;
CREATE INDEX branches_ongoing_fk  ON branches (ongoing_status_id) WHERE ongoing_status_id IS NOT NULL;

-- Default values (new tenants get them through provision_lookups)
CREATE OR REPLACE FUNCTION provision_lookups(t uuid) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO lookup_values (tenant_id, list, name, sort)
  SELECT t, 'geo_zone', z.name, z.sort FROM (VALUES
    ('Αττική', 1), ('Βόρεια Ελλάδα', 2), ('Κεντρική Ελλάδα', 3), ('Δυτική Ελλάδα', 4),
    ('Πελοπόννησος', 5), ('Κρήτη', 6), ('Νησιά Αιγαίου', 7), ('Ιόνια Νησιά', 8)
  ) AS z(name, sort)
  ON CONFLICT DO NOTHING;
  INSERT INTO lookup_values (tenant_id, list, name, sort)
  SELECT t, 'ongoing_status', s.name, s.sort FROM (VALUES
    ('Σε αναμονή', 1), ('Σε εξέλιξη', 2), ('Σε παύση', 3), ('Ολοκληρώθηκε', 4)
  ) AS s(name, sort)
  ON CONFLICT DO NOTHING;
$$;
SELECT provision_lookups(id) FROM tenants;
