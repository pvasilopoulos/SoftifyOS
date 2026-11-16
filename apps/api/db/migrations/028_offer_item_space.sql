-- Each offer line can be placed in a space of the offer's store (e.g. "Ψυγείο 2", "Αποθήκη").
ALTER TABLE offer_items ADD COLUMN space_id uuid REFERENCES spaces(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS offer_items_space_fk ON offer_items (space_id) WHERE space_id IS NOT NULL;

-- Existing offers that had one space for the whole offer: carry it to their lines.
UPDATE offer_items i SET space_id = o.space_id
FROM offer_versions v JOIN offers o ON o.id = v.offer_id
WHERE i.version_id = v.id AND o.space_id IS NOT NULL AND i.space_id IS NULL;
