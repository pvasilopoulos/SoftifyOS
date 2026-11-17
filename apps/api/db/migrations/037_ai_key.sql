-- Anthropic API key per organisation (Settings → AI), encrypted at rest; the server .env key is the fallback.
ALTER TABLE tenants ADD COLUMN ai_key_enc text;
ALTER TABLE tenants ADD COLUMN ai_key_meta jsonb;   -- { last4, set_by, set_at } (the key itself is never sent to the browser)
