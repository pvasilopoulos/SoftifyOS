-- lower() only folds ASCII when the database locale is "C", so Greek capitals were kept as-is
-- and searches like "ψυγειο" did not match "Ψυγείο". Fold Greek capitals explicitly so the
-- search key no longer depends on the server locale.
CREATE OR REPLACE FUNCTION search_key(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT translate(lower(coalesce(t, '')),
    'ΑΒΓΔΕΖΗΘΙΚΛΜΝΞΟΠΡΣΤΥΦΧΨΩΆΈΉΊΌΎΏΪΫάέήίόύώϊϋΐΰςáàâäéèêëíìîïóòôöúùûüç',
    'αβγδεζηθικλμνξοπρστυφχψωαεηιουωιυαεηιουωιυιυσaaaaeeeeiiiioooouuuuc')
$$;

-- Recompute the stored generated columns that use it
UPDATE customers SET name = name;
UPDATE products SET name = name;
