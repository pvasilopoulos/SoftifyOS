-- Open in-app tabs per user and device, so "Tabs from other devices" can offer them elsewhere.
CREATE TABLE user_tabs (
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id    text NOT NULL CHECK (char_length(device_id) BETWEEN 4 AND 40),
  device_label text NOT NULL CHECK (char_length(device_label) <= 80),
  tabs         jsonb NOT NULL,                       -- [{url, title, icon}]
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, device_id)
);
CREATE INDEX user_tabs_user_fk ON user_tabs (user_id);
ALTER TABLE user_tabs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_tabs USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON user_tabs TO softify_app;
