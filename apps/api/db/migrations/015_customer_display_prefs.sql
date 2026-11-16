-- Customers display preferences: organisation default + optional per-user override.
ALTER TABLE tenants ADD COLUMN show_customer_avatar boolean NOT NULL DEFAULT true;
GRANT UPDATE (show_customer_avatar) ON tenants TO softify_app;

-- Per-user preferences within an organisation (absent key = follow the organisation default)
ALTER TABLE memberships ADD COLUMN prefs jsonb NOT NULL DEFAULT '{}'::jsonb;
GRANT UPDATE (prefs) ON memberships TO softify_app;
