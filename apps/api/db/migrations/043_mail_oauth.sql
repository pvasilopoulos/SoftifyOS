-- Organisation mailbox connected with OAuth (Microsoft 365 / Google): emails are sent through
-- Microsoft Graph / Gmail API from that mailbox, without SMTP passwords.
ALTER TABLE tenants
  ADD COLUMN mail_oauth_enc  text,     -- encrypted JSON { provider, email, refresh, access, expires_at }
  ADD COLUMN mail_oauth_meta jsonb;    -- { provider, email, status, set_by, set_at, last_error }
GRANT UPDATE (mail_oauth_enc, mail_oauth_meta) ON tenants TO softify_app;
