-- City filter: a stored, normalised city column has real planner statistics
-- (an expression index on search_key(city) was estimated badly and ignored).
ALTER TABLE branches ADD COLUMN city_key text GENERATED ALWAYS AS (nullif(search_key(city), '')) STORED;
DROP INDEX IF EXISTS branches_city_key_idx;
CREATE INDEX branches_city_key_idx ON branches (tenant_id, city_key, name, id) WHERE city_key IS NOT NULL;
ANALYZE branches;
