-- The Users settings screen shows whether an invited user has set a password yet.
-- softify_app has column-level SELECT on users; add the new (non-sensitive) column.
GRANT SELECT (password_set) ON users TO softify_app;
