-- Greeklish search for customers and stores: "athina", "a8hna", "ΑΘΗΝΑ" and "Αθήνα" all find "Αθήνα".
-- phonetic_key() is the same algorithm as the web app's phonetic() (lib/search.ts) and the API's (db.ts):
-- Greek and Latin spellings reduce to one phonetic form. The search columns keep the plain form and add
-- the phonetic one, so the existing trigram indexes serve both.
CREATE OR REPLACE FUNCTION phonetic_key(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(translate(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(translate(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(search_key(t), 'ου', 'ou'), 'ευ', 'ev'), 'αυ', 'av'), 'αι', 'e'), 'ει', 'i'), 'οι', 'i'), 'υι', 'i'), 'μπ', 'b'), 'ντ', 'd'), 'γκ', 'g'), 'γγ', 'g'), 'τσ', 'ts'), 'τζ', 'tz'), 'ψ', 'ps'), 'αβγδεζηθικλμνξοπρστυφχω', 'avgdezi8iklmnxoprstifxo'), 'th', '8'), 'ch', 'x'), 'kh', 'x'), 'ks', 'x'), 'ph', 'f'), 'eu', 'ev'), 'ef', 'ev'), 'au', 'av'), 'af', 'av'), 'ou', 'u'), 'ai', 'e'), 'ei', 'i'), 'oi', 'i'), 'mp', 'b'), 'nt', 'd'), 'gk', 'g'), 'gg', 'g'), 'hwybcq', 'ioivkk'), '(.)\1+', '\1', 'g')
$$;

DROP INDEX IF EXISTS customers_search_idx;
ALTER TABLE customers DROP COLUMN search;
ALTER TABLE customers ADD COLUMN search text GENERATED ALWAYS AS (
  search_key(name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(vat, '') || ' ' || code
             || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(address_city, ''))
  || ' ' || phonetic_key(name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(address_city, ''))
) STORED;
CREATE INDEX customers_search_idx ON customers USING gin (search gin_trgm_ops);

DROP INDEX IF EXISTS branches_search_idx;
ALTER TABLE branches DROP COLUMN search;
ALTER TABLE branches ADD COLUMN search text GENERATED ALWAYS AS (
  search_key(name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(region, '') || ' '
             || coalesce(address, '') || ' ' || coalesce(postal_code, '') || ' ' || coalesce(manager_name, ''))
  || ' ' || phonetic_key(name || ' ' || coalesce(trade_name, '') || ' ' || coalesce(city, '') || ' ' || coalesce(region, '') || ' '
             || coalesce(address, '') || ' ' || coalesce(manager_name, ''))
) STORED;
CREATE INDEX branches_search_idx ON branches USING gin (search gin_trgm_ops);
