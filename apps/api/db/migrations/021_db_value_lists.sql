-- Every pick-list now lives in lookup_values (managed in Settings → Value lists):
-- prefectures, customer categories, customer sources, payment terms, space kinds.
-- These fields keep storing the chosen value's name (text), so search/filters stay as they are;
-- renaming a value in Settings updates the records that use it.

ALTER TABLE lookup_values DROP CONSTRAINT IF EXISTS lookup_values_list_check;
ALTER TABLE lookup_values ADD CONSTRAINT lookup_values_list_check CHECK (list IN (
  'geo_zone', 'fee_schedule', 'tour', 'ongoing_status',
  'prefecture', 'customer_category', 'customer_source', 'payment_terms', 'space_kind'));

-- Space kind: free value from the list (was a fixed code)
ALTER TABLE spaces DROP CONSTRAINT IF EXISTS spaces_kind_check;
ALTER TABLE spaces ALTER COLUMN kind DROP NOT NULL, ALTER COLUMN kind DROP DEFAULT;
ALTER TABLE spaces ADD CONSTRAINT spaces_kind_len CHECK (char_length(kind) <= 80);

-- Old codes → readable names
UPDATE spaces SET kind = CASE kind
  WHEN 'retail' THEN 'Εμπορικός χώρος' WHEN 'warehouse' THEN 'Αποθήκη'
  WHEN 'office' THEN 'Γραφεία' WHEN 'department' THEN 'Τμήμα / Διεύθυνση' ELSE kind END
WHERE kind IN ('retail', 'warehouse', 'office', 'department');

ALTER TABLE customers DISABLE TRIGGER customers_counter;
UPDATE customers SET payment_terms = CASE payment_terms
  WHEN 'cash' THEN 'Μετρητά' WHEN '15d' THEN 'Πίστωση 15 ημερών' WHEN '30d' THEN 'Πίστωση 30 ημερών'
  WHEN '60d' THEN 'Πίστωση 60 ημερών' WHEN '90d' THEN 'Πίστωση 90 ημερών' WHEN 'card' THEN 'Κάρτα'
  WHEN 'transfer' THEN 'Τραπεζική μεταφορά' ELSE payment_terms END
WHERE payment_terms IN ('cash', '15d', '30d', '60d', '90d', 'card', 'transfer');
UPDATE customers SET source = CASE source
  WHEN 'referral' THEN 'Σύσταση' WHEN 'website' THEN 'Ιστοσελίδα' WHEN 'exhibition' THEN 'Έκθεση'
  WHEN 'cold' THEN 'Cold call' WHEN 'partner' THEN 'Συνεργάτης' WHEN 'other' THEN 'Άλλο' ELSE source END
WHERE source IN ('referral', 'website', 'exhibition', 'cold', 'partner', 'other');
UPDATE customers SET category = CASE category
  WHEN 'strategic' THEN 'Στρατηγικός πελάτης' WHEN 'key' THEN 'Βασικός πελάτης' WHEN 'regular' THEN 'Τακτικός' WHEN 'small' THEN 'Μικρός' ELSE category END
WHERE category IN ('strategic', 'key', 'regular', 'small');
ALTER TABLE customers ENABLE TRIGGER customers_counter;

-- Default values for an organisation (new organisations get them from create-tenant / seed)
CREATE OR REPLACE FUNCTION seed_default_lookups(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO lookup_values (tenant_id, list, name, sort)
  SELECT p_tenant, d.list, d.name, d.sort
  FROM (VALUES
    ('customer_category', 'Στρατηγικός πελάτης', 1), ('customer_category', 'Βασικός πελάτης', 2),
    ('customer_category', 'Τακτικός', 3), ('customer_category', 'Μικρός', 4),
    ('customer_source', 'Σύσταση', 1), ('customer_source', 'Ιστοσελίδα', 2), ('customer_source', 'Έκθεση', 3),
    ('customer_source', 'Cold call', 4), ('customer_source', 'Συνεργάτης', 5), ('customer_source', 'Άλλο', 6),
    ('payment_terms', 'Μετρητά', 1), ('payment_terms', 'Πίστωση 15 ημερών', 2), ('payment_terms', 'Πίστωση 30 ημερών', 3),
    ('payment_terms', 'Πίστωση 60 ημερών', 4), ('payment_terms', 'Πίστωση 90 ημερών', 5), ('payment_terms', 'Κάρτα', 6),
    ('payment_terms', 'Τραπεζική μεταφορά', 7),
    ('space_kind', 'Εμπορικός χώρος', 1), ('space_kind', 'Αποθήκη', 2), ('space_kind', 'Γραφεία', 3), ('space_kind', 'Τμήμα / Διεύθυνση', 4),
    ('prefecture', 'Αττικής', 1), ('prefecture', 'Θεσσαλονίκης', 2), ('prefecture', 'Αιτωλοακαρνανίας', 3), ('prefecture', 'Αργολίδας', 4),
    ('prefecture', 'Αρκαδίας', 5), ('prefecture', 'Άρτας', 6), ('prefecture', 'Αχαΐας', 7), ('prefecture', 'Βοιωτίας', 8),
    ('prefecture', 'Γρεβενών', 9), ('prefecture', 'Δράμας', 10), ('prefecture', 'Δωδεκανήσου', 11), ('prefecture', 'Έβρου', 12),
    ('prefecture', 'Ευβοίας', 13), ('prefecture', 'Ευρυτανίας', 14), ('prefecture', 'Ζακύνθου', 15), ('prefecture', 'Ηλείας', 16),
    ('prefecture', 'Ημαθίας', 17), ('prefecture', 'Ηρακλείου', 18), ('prefecture', 'Θεσπρωτίας', 19), ('prefecture', 'Ιωαννίνων', 20),
    ('prefecture', 'Καβάλας', 21), ('prefecture', 'Καρδίτσας', 22), ('prefecture', 'Καστοριάς', 23), ('prefecture', 'Κερκύρας', 24),
    ('prefecture', 'Κεφαλληνίας', 25), ('prefecture', 'Κιλκίς', 26), ('prefecture', 'Κοζάνης', 27), ('prefecture', 'Κορινθίας', 28),
    ('prefecture', 'Κυκλάδων', 29), ('prefecture', 'Λακωνίας', 30), ('prefecture', 'Λαρίσης', 31), ('prefecture', 'Λασιθίου', 32),
    ('prefecture', 'Λέσβου', 33), ('prefecture', 'Λευκάδας', 34), ('prefecture', 'Μαγνησίας', 35), ('prefecture', 'Μεσσηνίας', 36),
    ('prefecture', 'Ξάνθης', 37), ('prefecture', 'Πέλλας', 38), ('prefecture', 'Πιερίας', 39), ('prefecture', 'Πρέβεζας', 40),
    ('prefecture', 'Ρεθύμνου', 41), ('prefecture', 'Ροδόπης', 42), ('prefecture', 'Σάμου', 43), ('prefecture', 'Σερρών', 44),
    ('prefecture', 'Τρικάλων', 45), ('prefecture', 'Φθιώτιδας', 46), ('prefecture', 'Φλώρινας', 47), ('prefecture', 'Φωκίδας', 48),
    ('prefecture', 'Χαλκιδικής', 49), ('prefecture', 'Χανίων', 50), ('prefecture', 'Χίου', 51)
  ) AS d(list, name, sort)
  ON CONFLICT DO NOTHING;
$$;

-- Existing organisations: defaults + any value already used in their data (so nothing is lost)
DO $$
DECLARE t uuid;
BEGIN
  FOR t IN SELECT id FROM tenants LOOP
    PERFORM seed_default_lookups(t);
    INSERT INTO lookup_values (tenant_id, list, name, sort)
    SELECT t, v.list, v.name, 1000 FROM (
      SELECT 'prefecture' AS list, address_region AS name FROM customers WHERE tenant_id = t AND address_region <> ''
      UNION SELECT 'prefecture', region FROM branches WHERE tenant_id = t AND region <> ''
      UNION SELECT 'customer_category', category FROM customers WHERE tenant_id = t AND category <> ''
      UNION SELECT 'customer_source', source FROM customers WHERE tenant_id = t AND source <> ''
      UNION SELECT 'payment_terms', payment_terms FROM customers WHERE tenant_id = t AND payment_terms <> ''
      UNION SELECT 'space_kind', kind FROM spaces WHERE tenant_id = t AND kind <> ''
    ) v
    WHERE NOT EXISTS (SELECT 1 FROM lookup_values l WHERE l.tenant_id = t AND l.list = v.list AND search_key(l.name) = search_key(v.name))
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
