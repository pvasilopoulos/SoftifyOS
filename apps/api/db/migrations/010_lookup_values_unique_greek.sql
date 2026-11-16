-- lower() does not fold Greek capitals with the "C" locale, so "Αμοιβολόγιο Α" and
-- "αμοιβολόγιο α" became two values. Compare with search_key() (case + accent insensitive).

-- Merge duplicates created before this fix: keep the oldest, repoint references
WITH d AS (
  SELECT id, first_value(id) OVER (PARTITION BY tenant_id, list, search_key(name) ORDER BY created_at, id) AS keep_id
  FROM lookup_values
)
, fix_c AS (UPDATE customers c SET geo_zone_id = d.keep_id FROM d WHERE c.geo_zone_id = d.id AND d.id <> d.keep_id)
, fix_z AS (UPDATE branches b SET geo_zone_id = d.keep_id FROM d WHERE b.geo_zone_id = d.id AND d.id <> d.keep_id)
, fix_f AS (UPDATE branches b SET fee_schedule_id = d.keep_id FROM d WHERE b.fee_schedule_id = d.id AND d.id <> d.keep_id)
, fix_t AS (UPDATE branches b SET tour_id = d.keep_id FROM d WHERE b.tour_id = d.id AND d.id <> d.keep_id)
SELECT 1;

DELETE FROM lookup_values l
USING (
  SELECT id, first_value(id) OVER (PARTITION BY tenant_id, list, search_key(name) ORDER BY created_at, id) AS keep_id
  FROM lookup_values
) d
WHERE l.id = d.id AND d.id <> d.keep_id;

DROP INDEX IF EXISTS lookup_values_name_uq;
CREATE UNIQUE INDEX lookup_values_name_uq ON lookup_values (tenant_id, list, search_key(name));
