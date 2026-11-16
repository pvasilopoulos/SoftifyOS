-- Branding per organisation: name/tagline shown in the app, logo, app icon (PWA) and favicon.
ALTER TABLE tenants
  ADD COLUMN brand_name    text CHECK (char_length(brand_name) <= 60),
  ADD COLUMN brand_tagline text CHECK (char_length(brand_tagline) <= 80);
GRANT UPDATE (brand_name, brand_tagline) ON tenants TO softify_app;

-- Small images, resized in the browser before upload (≤ 1 MB each).
-- icon = 512×512, icon192 = 192×192 (PWA / home screen), favicon = 64×64, logo = up to 512 wide.
CREATE TABLE tenant_assets (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('logo', 'icon', 'icon192', 'favicon')),
  mime       text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  data       bytea NOT NULL CHECK (octet_length(data) <= 1048576),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind)
);
ALTER TABLE tenant_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_assets USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant());
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant_assets TO softify_app;
