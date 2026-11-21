-- Grid layouts (columns, order, widths, density, grouping) per organisation; a user's own layout lives in
-- memberships.prefs.grid_layouts. Shape: { "<grid>": { cols: [{ key, width, hidden }], dense, group } }
ALTER TABLE tenants ADD COLUMN grid_layouts jsonb NOT NULL DEFAULT '{}'::jsonb;
GRANT UPDATE (grid_layouts) ON tenants TO softify_app;
