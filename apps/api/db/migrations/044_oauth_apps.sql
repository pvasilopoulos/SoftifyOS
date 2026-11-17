-- OAuth app credentials (Microsoft Entra ID / Google Cloud) per organisation, set in Settings → Email.
-- Used for the organisation mailbox and its users' calendar sync; without them the installation's .env app is used.
ALTER TABLE tenants
  ADD COLUMN oauth_apps_enc  text,     -- encrypted JSON { google: { client_id, client_secret }, microsoft: { client_id, client_secret, tenant } }
  ADD COLUMN oauth_apps_meta jsonb;    -- { google: { client_id, set_at, set_by }, microsoft: { client_id, tenant, set_at, set_by } } (no secrets)
GRANT UPDATE (oauth_apps_enc, oauth_apps_meta) ON tenants TO softify_app;
