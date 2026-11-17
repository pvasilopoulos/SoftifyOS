-- Calendar sync with Google Calendar and Microsoft 365 / Outlook, per user.
-- SoftifyOS → external: every CRM activity with a date that a user owns is created/updated/deleted in their calendar.
-- External → SoftifyOS: their other events are imported as "busy" blocks shown in the SoftifyOS calendar.

CREATE TABLE calendar_connections (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  account_email text,
  calendar_id   text NOT NULL DEFAULT 'primary',
  access_enc    text,
  refresh_enc   text NOT NULL,
  expires_at    timestamptz,
  push_enabled  boolean NOT NULL DEFAULT true,     -- SoftifyOS activities → external calendar
  import_busy   boolean NOT NULL DEFAULT true,     -- external events → busy blocks here
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error    text,
  last_sync_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id, provider)
);
CREATE INDEX calendar_connections_user_idx ON calendar_connections (user_id);

-- Which external event mirrors which activity
CREATE TABLE calendar_event_links (
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id   uuid NOT NULL,          -- no FK: the link must outlive the activity so the external event can be deleted
  external_id   text NOT NULL,
  synced_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, activity_id)
);
CREATE INDEX calendar_event_links_activity_idx ON calendar_event_links (activity_id);

-- Events from the external calendar (only time and title), refreshed by the worker
CREATE TABLE calendar_busy (
  connection_id uuid NOT NULL REFERENCES calendar_connections(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  title         text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  all_day       boolean NOT NULL DEFAULT false,
  PRIMARY KEY (connection_id, external_id)
);
CREATE INDEX calendar_busy_range_idx ON calendar_busy (tenant_id, user_id, starts_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calendar_connections', 'calendar_event_links', 'calendar_busy'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- Any change to an activity (screens, API, rules, AI, import…) queues a sync job when its owner(s) has a connection.
-- SECURITY DEFINER: runs as the table owner, so it sees connections regardless of RLS and may write the job queue.
CREATE OR REPLACE FUNCTION calendar_sync_enqueue() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec crm_activities;
  owners uuid[];
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  owners := ARRAY[]::uuid[];
  IF TG_OP <> 'INSERT' AND OLD.owner_id IS NOT NULL THEN owners := owners || OLD.owner_id; END IF;
  IF TG_OP <> 'DELETE' AND NEW.owner_id IS NOT NULL AND NOT (NEW.owner_id = ANY(owners)) THEN owners := owners || NEW.owner_id; END IF;
  -- Only fields that show in a calendar matter
  IF TG_OP = 'UPDATE' AND OLD.owner_id IS NOT DISTINCT FROM NEW.owner_id AND OLD.subject = NEW.subject
     AND OLD.body IS NOT DISTINCT FROM NEW.body AND OLD.location IS NOT DISTINCT FROM NEW.location
     AND OLD.due_at IS NOT DISTINCT FROM NEW.due_at AND OLD.duration_min = NEW.duration_min AND OLD.all_day = NEW.all_day
     AND OLD.status = NEW.status AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM calendar_connections c WHERE c.tenant_id = rec.tenant_id AND c.user_id = ANY(owners)
             AND c.status = 'active' AND c.push_enabled) THEN
    INSERT INTO jobs (kind, payload, run_at)
    VALUES ('calendar_push', jsonb_build_object('tenantId', rec.tenant_id, 'activityId', rec.id), now() + interval '3 seconds');
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER crm_activities_calendar_sync
AFTER INSERT OR UPDATE OR DELETE ON crm_activities
FOR EACH ROW EXECUTE FUNCTION calendar_sync_enqueue();
