-- CRM activities module: calls, meetings, visits, tasks… planned or done, with outcomes, follow-ups,
-- recurrence, reminders, templates and automation rules. Replaces the calendar `events` table
-- (its rows are moved here); the `activities` table stays as the system history log.

-- ---------------------------------------------------------------- value lists
CREATE TABLE crm_activity_types (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  icon        text NOT NULL DEFAULT 'circle',
  color       text NOT NULL DEFAULT 'primary',
  default_duration int NOT NULL DEFAULT 0 CHECK (default_duration BETWEEN 0 AND 1440),
  sort        int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key)
);
CREATE TABLE crm_outcomes (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  color       text NOT NULL DEFAULT 'muted',
  positive    boolean NOT NULL DEFAULT false,      -- counts as a success in reports
  sort        int NOT NULL DEFAULT 100,
  active      boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key)
);
CREATE TABLE crm_templates (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  type        text NOT NULL,
  subject     text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body        text,
  priority    smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  duration_min int NOT NULL DEFAULT 0 CHECK (duration_min BETWEEN 0 AND 1440),
  due_in_days int CHECK (due_in_days BETWEEN 0 AND 365),
  remind_before_min int CHECK (remind_before_min BETWEEN 0 AND 10080),
  sort        int NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Automation: when <trigger> then create an activity
CREATE TABLE crm_rules (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  active      boolean NOT NULL DEFAULT true,
  trigger     text NOT NULL CHECK (trigger IN ('offer_created', 'offer_sent', 'offer_accepted', 'offer_rejected', 'customer_created', 'activity_done', 'no_contact')),
  config      jsonb NOT NULL DEFAULT '{}',   -- { days?, type?, outcome?, customer_status? }
  action      jsonb NOT NULL,                -- { type, subject, body?, due_in_days, priority, assign: owner|account_manager|actor|<user id>, remind_before_min? }
  runs        int NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- activities
CREATE TABLE crm_activities (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id   text CHECK (char_length(external_id) <= 100),
  type          text NOT NULL,
  subject       text NOT NULL CHECK (char_length(subject) BETWEEN 1 AND 200),
  body          text CHECK (char_length(body) <= 20000),
  status        text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'in_progress', 'done', 'cancelled')),
  priority      smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),   -- 1 high, 2 normal, 3 low
  due_at        timestamptz,
  duration_min  int NOT NULL DEFAULT 0 CHECK (duration_min BETWEEN 0 AND 10080),
  all_day       boolean NOT NULL DEFAULT false,
  location      text CHECK (char_length(location) <= 300),
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id   uuid REFERENCES customers(id) ON DELETE CASCADE,
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  contact_id    uuid REFERENCES contacts(id) ON DELETE SET NULL,
  offer_id      uuid REFERENCES offers(id) ON DELETE SET NULL,
  outcome       text,
  outcome_note  text CHECK (char_length(outcome_note) <= 5000),
  completed_at  timestamptz,
  completed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  remind_before_min int CHECK (remind_before_min BETWEEN 0 AND 10080),
  remind_at     timestamptz,
  reminded      boolean NOT NULL DEFAULT false,
  series_id     uuid,                       -- recurring: all occurrences share it
  recurrence    jsonb,                      -- { freq: daily|weekly|monthly, interval, count?, until? } on every occurrence
  parent_id     uuid REFERENCES crm_activities(id) ON DELETE SET NULL,   -- follow-up of
  rule_id       uuid REFERENCES crm_rules(id) ON DELETE SET NULL,
  custom        jsonb NOT NULL DEFAULT '{}',
  search        text GENERATED ALWAYS AS (
                  search_key(subject || ' ' || coalesce(body, '') || ' ' || coalesce(location, '') || ' ' || coalesce(outcome_note, ''))
                  || ' ' || phonetic_key(subject || ' ' || coalesce(location, ''))) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_act_open_idx     ON crm_activities (tenant_id, coalesce(due_at, 'infinity'::timestamptz), id) WHERE status IN ('planned', 'in_progress');
CREATE INDEX crm_act_owner_idx    ON crm_activities (tenant_id, owner_id, status, due_at);
CREATE INDEX crm_act_due_idx      ON crm_activities (tenant_id, due_at);
CREATE INDEX crm_act_customer_idx ON crm_activities (tenant_id, customer_id, due_at DESC);
CREATE INDEX crm_act_done_idx     ON crm_activities (tenant_id, completed_at DESC) WHERE status = 'done';
CREATE INDEX crm_act_updated_idx  ON crm_activities (tenant_id, updated_at, id);
CREATE INDEX crm_act_series_idx   ON crm_activities (series_id, due_at) WHERE series_id IS NOT NULL;
CREATE INDEX crm_act_remind_idx   ON crm_activities (remind_at) WHERE reminded = false AND remind_at IS NOT NULL;
CREATE INDEX crm_act_offer_fk     ON crm_activities (offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX crm_act_branch_fk    ON crm_activities (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX crm_act_contact_fk   ON crm_activities (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX crm_act_search_idx   ON crm_activities USING gin (search gin_trgm_ops);
CREATE UNIQUE INDEX crm_act_external_uq ON crm_activities (tenant_id, external_id) WHERE external_id IS NOT NULL;

-- Morning digest: one per user per day
CREATE TABLE crm_digests (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day       date NOT NULL,
  PRIMARY KEY (tenant_id, user_id, day)
);
-- Read-only calendar feed (iCal) per user
CREATE TABLE crm_ical_tokens (
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crm_activity_types', 'crm_outcomes', 'crm_templates', 'crm_rules', 'crm_activities', 'crm_digests', 'crm_ical_tokens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- defaults per organisation
CREATE OR REPLACE FUNCTION seed_crm_defaults(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO crm_activity_types (tenant_id, key, name, icon, color, default_duration, sort) VALUES
    (p_tenant, 'call',         'Κλήση',       'phone',         'primary', 15, 1),
    (p_tenant, 'email',        'Email',       'mail',          'info',     0, 2),
    (p_tenant, 'meeting',      'Συνάντηση',   'users',         'success', 60, 3),
    (p_tenant, 'visit',        'Επίσκεψη',    'map-pin',       'success', 60, 4),
    (p_tenant, 'presentation', 'Παρουσίαση',  'presentation',  'primary', 60, 5),
    (p_tenant, 'followup',     'Follow-up',   'repeat',        'warning', 15, 6),
    (p_tenant, 'task',         'Εργασία',     'square-check',  'warning',  0, 7),
    (p_tenant, 'note',         'Σημείωση',    'notebook-pen',  'muted',    0, 8)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  INSERT INTO crm_outcomes (tenant_id, key, name, color, positive, sort) VALUES
    (p_tenant, 'interested',     'Ενδιαφέρον',           'success', true,  1),
    (p_tenant, 'meeting_booked', 'Κλείσαμε ραντεβού',    'success', true,  2),
    (p_tenant, 'offer_requested','Ζήτησε προσφορά',      'success', true,  3),
    (p_tenant, 'won',            'Κλείσαμε συμφωνία',    'success', true,  4),
    (p_tenant, 'callback',       'Να ξανακαλέσουμε',     'warning', false, 5),
    (p_tenant, 'no_answer',      'Χωρίς απάντηση',       'muted',   false, 6),
    (p_tenant, 'not_interested', 'Δεν ενδιαφέρεται',     'danger',  false, 7)
  ON CONFLICT (tenant_id, key) DO NOTHING;
  INSERT INTO crm_templates (tenant_id, name, type, subject, body, priority, duration_min, due_in_days, remind_before_min, sort)
  SELECT p_tenant, v.* FROM (VALUES
    ('Follow-up προσφοράς', 'call', 'Follow-up προσφοράς', 'Επικοινωνία για την προσφορά που στάλθηκε.', 2, 15, 3, 30, 1),
    ('Επίσκεψη καταστήματος', 'visit', 'Επίσκεψη καταστήματος', NULL, 2, 60, 7, 60, 2),
    ('Ετήσια ανασκόπηση', 'meeting', 'Ετήσια ανασκόπηση συνεργασίας', NULL, 3, 60, 30, 1440, 3)
  ) AS v(name, type, subject, body, priority, duration_min, due_in_days, remind_before_min, sort)
  WHERE NOT EXISTS (SELECT 1 FROM crm_templates x WHERE x.tenant_id = p_tenant);
  INSERT INTO crm_rules (tenant_id, name, active, trigger, config, action)
  SELECT p_tenant, v.name, false, v.trigger, v.config::jsonb, v.action::jsonb FROM (VALUES
    ('Κλήση 3 ημέρες μετά την αποστολή προσφοράς', 'offer_sent', '{}', '{"type":"call","subject":"Follow-up προσφοράς {offer}","due_in_days":3,"priority":2,"assign":"actor","remind_before_min":30}'),
    ('Πελάτης χωρίς επαφή 60 ημέρες', 'no_contact', '{"days":60}', '{"type":"call","subject":"Επικοινωνία με {customer}","due_in_days":1,"priority":2,"assign":"account_manager"}')
  ) AS v(name, trigger, config, action)
  WHERE NOT EXISTS (SELECT 1 FROM crm_rules x WHERE x.tenant_id = p_tenant);
$$;
SELECT seed_crm_defaults(id) FROM tenants;
CREATE OR REPLACE FUNCTION tenants_seed_crm() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM seed_crm_defaults(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER tenants_seed_crm AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_seed_crm();

-- ---------------------------------------------------------------- calendar events → activities
INSERT INTO crm_activities (id, tenant_id, type, subject, status, due_at, duration_min, location, owner_id, created_by, customer_id,
                            remind_at, reminded, completed_at, created_at, updated_at)
SELECT e.id, e.tenant_id,
       CASE e.kind WHEN 'internal' THEN 'meeting' ELSE e.kind END,
       left(e.title, 200),
       CASE WHEN e.ends_at < now() THEN 'done' ELSE 'planned' END,
       e.starts_at, greatest(0, least(10080, (extract(epoch FROM e.ends_at - e.starts_at) / 60)::int)), e.location,
       e.owner_id, e.owner_id, e.customer_id, e.remind_at, e.reminded,
       CASE WHEN e.ends_at < now() THEN e.ends_at END, e.created_at, e.created_at
FROM events e
ON CONFLICT (id) DO NOTHING;

-- New permission: see / manage everyone's activities (otherwise only your own)
UPDATE roles SET permissions = permissions || ARRAY['activities.all']
WHERE key IN ('owner', 'admin', 'manager') AND NOT ('activities.all' = ANY (permissions));
CREATE OR REPLACE FUNCTION seed_system_roles(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO roles (tenant_id, key, name, description, permissions, approval_level, is_system, sort) VALUES
    (p_tenant, 'owner',   'Ιδιοκτήτης',    'Πλήρης έλεγχος, και διαχείριση ιδιοκτητών',
      ARRAY['customers.edit','customers.delete','offers.edit','activities.all','views.share','forms.manage','settings.manage','users.manage','integrations.manage','audit.view'], 4, true, 1),
    (p_tenant, 'admin',   'Διαχειριστής',  'Ρυθμίσεις, χρήστες, κατάλογοι',
      ARRAY['customers.edit','customers.delete','offers.edit','activities.all','views.share','forms.manage','settings.manage','users.manage','integrations.manage','audit.view'], 3, true, 2),
    (p_tenant, 'manager', 'Manager',       'Εγκρίσεις, διαγραφές, αρχειοθέτηση',
      ARRAY['customers.edit','customers.delete','offers.edit','activities.all','views.share'], 2, true, 3),
    (p_tenant, 'sales',   'Πωλήσεις',      'Πελάτες, προσφορές, ημερολόγιο',
      ARRAY['customers.edit','offers.edit'], 1, true, 4),
    (p_tenant, 'viewer',  'Μόνο ανάγνωση', 'Μόνο προβολή δεδομένων', ARRAY[]::text[], 0, true, 5)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$$;

-- Custom fields of the activity form now belong to crm_activities
UPDATE custom_fields SET updated_at = now() WHERE form = 'activity';
