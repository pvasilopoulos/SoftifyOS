-- The app role updates tenants column by column: allow the AI settings and the encrypted key.
GRANT UPDATE (ai_settings, ai_key_enc, ai_key_meta) ON tenants TO softify_app;
