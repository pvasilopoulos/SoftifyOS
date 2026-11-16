-- Branding: the badge shown when there is no logo (sidebar, login): text, colours, shape.
ALTER TABLE tenants ADD COLUMN brand_badge jsonb NOT NULL DEFAULT '{}';
GRANT UPDATE (brand_badge) ON tenants TO softify_app;
