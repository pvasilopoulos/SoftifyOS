-- Default views of the index pages (e.g. which customers view opens first), per organisation and per role.
-- {"customers_view": {"org": "list", "roles": {"sales": "tree"}}}; per-user choice lives in memberships.prefs.customers_view
ALTER TABLE tenants ADD COLUMN index_defaults jsonb NOT NULL DEFAULT '{}';
