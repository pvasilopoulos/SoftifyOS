-- Operations: grouped error log (API, worker, browser) and the worker heartbeat used by /api/health.
-- Platform-level tables (no tenant RLS): written and read only through the owner connection.

CREATE TABLE error_events (
  fingerprint text PRIMARY KEY,               -- sha1 of source + message + top stack frame
  source      text NOT NULL CHECK (source IN ('api', 'worker', 'web')),
  message     text NOT NULL,
  stack       text,
  context     jsonb,                          -- last request: method, route, status, tenant, user agent…
  count       int NOT NULL DEFAULT 1,
  first_seen  timestamptz NOT NULL DEFAULT now(),
  last_seen   timestamptz NOT NULL DEFAULT now(),
  alerted_at  timestamptz,
  resolved_at timestamptz
);
CREATE INDEX error_events_recent_idx ON error_events (last_seen DESC);

CREATE TABLE system_heartbeat (
  name       text PRIMARY KEY,                -- 'worker'
  beat_at    timestamptz NOT NULL DEFAULT now(),
  info       jsonb
);
