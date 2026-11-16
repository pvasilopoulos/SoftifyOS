-- Admins can permanently delete API keys (the request log keeps its rows, key_id becomes NULL).
GRANT DELETE ON api_keys TO softify_app;
