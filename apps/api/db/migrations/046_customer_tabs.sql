-- Customer page tabs: order and visibility. Organisation default here; a user's own choice in
-- memberships.prefs.customer_tabs (absent = follow the organisation). Shape: [{ "key": "offers", "hidden": false }, …]
ALTER TABLE tenants ADD COLUMN customer_tabs jsonb;
GRANT UPDATE (customer_tabs) ON tenants TO softify_app;
