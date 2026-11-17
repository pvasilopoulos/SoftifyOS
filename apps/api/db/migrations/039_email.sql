-- Email from the app: per-organisation SMTP (encrypted), sender/templates, a log of every message
-- with open tracking, and the customer's view / e-signature on the public offer page.

ALTER TABLE tenants
  ADD COLUMN email_settings jsonb NOT NULL DEFAULT '{}',
  -- { from_name, reply_to_owner, reply_to, signature, track_opens, notify_view, templates: { offer_send: { el: {subject, body}, en: {...} } } }
  ADD COLUMN smtp_enc  text,        -- encrypted JSON { host, port, secure, user, pass, from }
  ADD COLUMN smtp_meta jsonb;       -- { host, user, from, set_by, set_at } (shown in Settings, never the password)
GRANT UPDATE (email_settings, smtp_enc, smtp_meta) ON tenants TO softify_app;

CREATE TABLE email_messages (
  id           uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  offer_id     uuid REFERENCES offers(id) ON DELETE CASCADE,
  customer_id  uuid REFERENCES customers(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  kind         text NOT NULL DEFAULT 'offer',
  to_addr      text NOT NULL CHECK (char_length(to_addr) <= 320),
  cc_addr      text CHECK (char_length(cc_addr) <= 320),
  subject      text NOT NULL CHECK (char_length(subject) <= 300),
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'logged')),
  error        text,
  track_token  text UNIQUE,
  open_count   int NOT NULL DEFAULT 0,
  opened_at    timestamptz,
  last_open_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE INDEX email_messages_offer_idx    ON email_messages (tenant_id, offer_id, created_at DESC);
CREATE INDEX email_messages_customer_idx ON email_messages (tenant_id, customer_id, created_at DESC);
CREATE INDEX email_messages_list_idx     ON email_messages (tenant_id, created_at DESC);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON email_messages USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON email_messages TO softify_app;

-- Customer side of the public link
ALTER TABLE offers
  ADD COLUMN viewed_at        timestamptz,     -- first time the customer opened the link
  ADD COLUMN last_viewed_at   timestamptz,
  ADD COLUMN view_count       int NOT NULL DEFAULT 0,
  ADD COLUMN signature        text CHECK (char_length(signature) <= 300000),   -- PNG data URL drawn by the customer
  ADD COLUMN responder_email  text CHECK (char_length(responder_email) <= 320),
  ADD COLUMN responder_ip     text,
  ADD COLUMN responder_ua     text CHECK (char_length(responder_ua) <= 500);
