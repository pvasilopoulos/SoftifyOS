-- "Customers & stores" view gets its own visible-filter settings (until now shared with "Customers").
-- Start it with the same configuration so nothing changes for anyone.
UPDATE tenants SET index_defaults = index_defaults || jsonb_build_object('tree_filters', index_defaults->'customers_filters')
WHERE index_defaults ? 'customers_filters' AND NOT index_defaults ? 'tree_filters';
UPDATE memberships SET prefs = prefs || jsonb_build_object('tree_filters', prefs->'customers_filters')
WHERE prefs ? 'customers_filters' AND NOT prefs ? 'tree_filters';
