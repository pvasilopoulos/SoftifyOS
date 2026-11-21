-- CRM activities ⇄ ERP (SoftOne Soft1): extra fields as in the ERP, the ERP value lists
-- (characterisation + status), connection settings and two-way sync bookkeeping.

-- ---------------------------------------------------------------- activity fields
ALTER TABLE crm_activities
  ADD COLUMN ends_at          timestamptz,                                   -- ERP "Λήξη" (start = due_at)
  ADD COLUMN requested_by     uuid REFERENCES users(id) ON DELETE SET NULL,  -- ERP "Εντολέας" (owner_id = "Χειριστής")
  ADD COLUMN erp_code         text CHECK (char_length(erp_code) <= 60),      -- ERP document code, e.g. OFF0008820
  ADD COLUMN characterization text CHECK (char_length(characterization) <= 40),   -- code in crm_erp_values (kind characterization)
  ADD COLUMN erp_status       text CHECK (char_length(erp_status) <= 40),         -- code in crm_erp_values (kind status)
  -- sync bookkeeping (null = never synced / ERP not connected)
  ADD COLUMN erp_state        text CHECK (erp_state IN ('pending', 'synced', 'error', 'conflict', 'skipped')),
  ADD COLUMN erp_error        text CHECK (char_length(erp_error) <= 1000),
  ADD COLUMN erp_synced_at    timestamptz,
  ADD COLUMN erp_hash         text;                                          -- hash of the ERP-side values at the last sync
CREATE INDEX crm_act_erp_pending_idx ON crm_activities (tenant_id) WHERE erp_state = 'pending';
CREATE INDEX crm_act_requested_fk ON crm_activities (requested_by) WHERE requested_by IS NOT NULL;

-- ---------------------------------------------------------------- ERP value lists
-- kind 'characterization': free list of the ERP (code 101, 122 …), may imply a core status
-- kind 'status':           the ERP status list, each mapped to one of the four core statuses
CREATE TABLE crm_erp_values (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('characterization', 'status')),
  code      text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 40),
  name      text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  active    boolean NOT NULL DEFAULT true,
  maps_to   text CHECK (maps_to IN ('planned', 'in_progress', 'done', 'cancelled')),  -- null = does not change the status
  types     text[],                                                               -- activity types it applies to (null = all)
  sort      int NOT NULL DEFAULT 100,
  PRIMARY KEY (tenant_id, kind, code)
);

-- Deleted activities that exist in the ERP: the sync deletes them there, then removes the row here
CREATE TABLE erp_deletions (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity      text NOT NULL DEFAULT 'activity',
  external_id text NOT NULL,
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, entity, external_id)
);

-- What the sync did (last 30 days are kept)
CREATE TABLE erp_sync_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  level       text NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warning', 'error')),
  action      text NOT NULL,          -- pull | push | create | delete | conflict | lists | test …
  activity_id uuid,
  external_id text,
  message     text NOT NULL CHECK (char_length(message) <= 2000)
);
CREATE INDEX erp_sync_log_idx ON erp_sync_log (tenant_id, at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_erp_values', 'erp_deletions', 'erp_sync_log'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- connection settings per organisation
ALTER TABLE tenants
  ADD COLUMN erp_enc  text,    -- encrypted JSON { url, username, password, app_id, company, branch, module, refid }
  ADD COLUMN erp_meta jsonb;   -- mapping + sync settings + last run (no secrets)
GRANT UPDATE (erp_enc, erp_meta) ON tenants TO softify_app;

-- ---------------------------------------------------------------- change tracking
-- Changes made by the sync itself run with SET LOCAL app.erp_sync = '1' and are not sent back (no echo loop).
CREATE OR REPLACE FUNCTION erp_enabled(p_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT (erp_meta->>'enabled')::boolean AND coalesce(erp_meta->>'direction', 'both') IN ('both', 'push')
                   FROM tenants WHERE id = p_tenant), false)
$$;

-- Before a local change: mark the activity for sending (only fields the ERP has)
CREATE OR REPLACE FUNCTION erp_mark_pending() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF current_setting('app.erp_sync', true) = '1' OR NOT erp_enabled(NEW.tenant_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.type = NEW.type AND OLD.subject = NEW.subject AND OLD.body IS NOT DISTINCT FROM NEW.body
     AND OLD.status = NEW.status AND OLD.priority = NEW.priority AND OLD.due_at IS NOT DISTINCT FROM NEW.due_at
     AND OLD.ends_at IS NOT DISTINCT FROM NEW.ends_at AND OLD.owner_id IS NOT DISTINCT FROM NEW.owner_id
     AND OLD.requested_by IS NOT DISTINCT FROM NEW.requested_by AND OLD.customer_id IS NOT DISTINCT FROM NEW.customer_id
     AND OLD.branch_id IS NOT DISTINCT FROM NEW.branch_id AND OLD.characterization IS NOT DISTINCT FROM NEW.characterization
     AND OLD.erp_status IS NOT DISTINCT FROM NEW.erp_status THEN
    RETURN NEW;
  END IF;
  NEW.erp_state := 'pending';
  NEW.erp_error := NULL;
  RETURN NEW;
END $$;
CREATE TRIGGER crm_activities_erp_mark BEFORE INSERT OR UPDATE ON crm_activities
FOR EACH ROW EXECUTE FUNCTION erp_mark_pending();

-- After a local change or delete: queue one push job per organisation (coalesced)
CREATE OR REPLACE FUNCTION erp_enqueue_push() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rec crm_activities;
BEGIN
  rec := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF current_setting('app.erp_sync', true) = '1' OR NOT erp_enabled(rec.tenant_id) THEN RETURN NULL; END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.external_id IS NULL THEN RETURN NULL; END IF;
    INSERT INTO erp_deletions (tenant_id, external_id) VALUES (OLD.tenant_id, OLD.external_id) ON CONFLICT DO NOTHING;
  ELSIF NEW.erp_state IS DISTINCT FROM 'pending' THEN
    RETURN NULL;
  END IF;
  INSERT INTO jobs (kind, payload, run_at)
  SELECT 'erp_push', jsonb_build_object('tenantId', rec.tenant_id), now() + interval '5 seconds'
  WHERE NOT EXISTS (SELECT 1 FROM jobs WHERE kind = 'erp_push' AND payload->>'tenantId' = rec.tenant_id::text AND locked_at IS NULL);
  RETURN NULL;
END $$;
CREATE TRIGGER crm_activities_erp_push AFTER INSERT OR UPDATE OR DELETE ON crm_activities
FOR EACH ROW EXECUTE FUNCTION erp_enqueue_push();

-- ---------------------------------------------------------------- core status ⇄ ERP status / characterisation
-- The ERP status (or, when it is empty, the characterisation) decides the core status. When the core status is
-- changed elsewhere (complete dialog, bulk, rules, API) the ERP status follows, so both always agree.
CREATE OR REPLACE FUNCTION erp_align_status() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m text;
BEGIN
  IF NEW.erp_status IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.erp_status IS DISTINCT FROM OLD.erp_status) THEN
    SELECT maps_to INTO m FROM crm_erp_values WHERE tenant_id = NEW.tenant_id AND kind = 'status' AND code = NEW.erp_status;
    IF m IS NOT NULL THEN NEW.status := m; END IF;
  ELSIF NEW.erp_status IS NULL AND NEW.characterization IS NOT NULL
        AND (TG_OP = 'INSERT' OR NEW.characterization IS DISTINCT FROM OLD.characterization) THEN
    SELECT maps_to INTO m FROM crm_erp_values WHERE tenant_id = NEW.tenant_id AND kind = 'characterization' AND code = NEW.characterization;
    IF m IS NOT NULL THEN NEW.status := m; END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.erp_status IS NOT NULL THEN
    SELECT maps_to INTO m FROM crm_erp_values WHERE tenant_id = NEW.tenant_id AND kind = 'status' AND code = NEW.erp_status;
    IF m IS DISTINCT FROM NEW.status THEN
      NEW.erp_status := (SELECT code FROM crm_erp_values WHERE tenant_id = NEW.tenant_id AND kind = 'status' AND maps_to = NEW.status AND active
                         ORDER BY sort, code LIMIT 1);
    END IF;
  END IF;
  IF NEW.status = 'done' AND NEW.completed_at IS NULL THEN NEW.completed_at := now(); END IF;
  IF NEW.status <> 'done' AND NEW.completed_at IS NOT NULL AND TG_OP = 'UPDATE' AND OLD.status = 'done' THEN NEW.completed_at := NULL; END IF;
  RETURN NEW;
END $$;
-- Runs before crm_activities_erp_mark (triggers fire in name order), so the mark sees the final values
CREATE TRIGGER crm_activities_erp_align BEFORE INSERT OR UPDATE ON crm_activities
FOR EACH ROW EXECUTE FUNCTION erp_align_status();
