-- AADE / VIES lookup settings per organisation (the AADE password is stored encrypted by the API).
ALTER TABLE tenants ADD COLUMN registry_settings jsonb NOT NULL DEFAULT '{}';
GRANT UPDATE (registry_settings) ON tenants TO softify_app;
