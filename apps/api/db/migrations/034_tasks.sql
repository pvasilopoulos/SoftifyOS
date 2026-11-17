-- Tasks: internal to-dos of the team (not customer contacts), with checklist, watchers, comments with @mentions,
-- recurrence, reminders, templates, and links to customer / store / offer / activity. Attachments = documents.task_id.

CREATE TABLE task_templates (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  description text CHECK (char_length(description) <= 500),
  items       jsonb NOT NULL DEFAULT '[]',   -- [{ title, description?, due_in_days?, priority?, checklist?: string[] }]
  sort        int NOT NULL DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title         text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  description   text CHECK (char_length(description) <= 20000),
  status        text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'waiting', 'done', 'cancelled')),
  priority      smallint NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),
  due_at        timestamptz,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id   uuid REFERENCES customers(id) ON DELETE SET NULL,
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  offer_id      uuid REFERENCES offers(id) ON DELETE SET NULL,
  activity_id   uuid REFERENCES crm_activities(id) ON DELETE SET NULL,
  tags          text[] NOT NULL DEFAULT '{}',
  checklist     jsonb NOT NULL DEFAULT '[]',   -- [{ id, text, done }]
  recurrence    jsonb,
  series_id     uuid,
  template_id   uuid REFERENCES task_templates(id) ON DELETE SET NULL,
  remind_before_min int CHECK (remind_before_min BETWEEN 0 AND 10080),
  remind_at     timestamptz,
  reminded      boolean NOT NULL DEFAULT false,
  completed_at  timestamptz,
  completed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  position      double precision NOT NULL DEFAULT 0,   -- order inside a kanban column
  comments_count int NOT NULL DEFAULT 0,
  custom        jsonb NOT NULL DEFAULT '{}',
  search        text GENERATED ALWAYS AS (
                  search_key(title || ' ' || coalesce(description, '')) || ' ' || phonetic_key(title)) STORED,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_open_idx     ON tasks (tenant_id, coalesce(due_at, 'infinity'::timestamptz), id) WHERE status NOT IN ('done', 'cancelled');
CREATE INDEX tasks_owner_idx    ON tasks (tenant_id, owner_id, status, due_at);
CREATE INDEX tasks_creator_idx  ON tasks (tenant_id, created_by, status);
CREATE INDEX tasks_customer_idx ON tasks (tenant_id, customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX tasks_offer_idx    ON tasks (offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX tasks_branch_fk    ON tasks (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX tasks_activity_fk  ON tasks (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX tasks_done_idx     ON tasks (tenant_id, completed_at DESC) WHERE status = 'done';
CREATE INDEX tasks_updated_idx  ON tasks (tenant_id, updated_at, id);
CREATE INDEX tasks_series_idx   ON tasks (series_id, due_at) WHERE series_id IS NOT NULL;
CREATE INDEX tasks_remind_idx   ON tasks (remind_at) WHERE reminded = false AND remind_at IS NOT NULL;
CREATE INDEX tasks_tags_idx     ON tasks USING gin (tags);
CREATE INDEX tasks_search_idx   ON tasks USING gin (search gin_trgm_ops);

CREATE TABLE task_watchers (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id   uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX task_watchers_user_idx ON task_watchers (tenant_id, user_id);

CREATE TABLE task_comments (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id    uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  body       text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 5000),
  mentions   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
CREATE INDEX task_comments_task_idx ON task_comments (task_id, created_at);

ALTER TABLE documents ADD CONSTRAINT documents_task_fk FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['task_templates', 'tasks', 'task_watchers', 'task_comments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION seed_task_defaults(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO task_templates (tenant_id, name, description, items, sort)
  SELECT p_tenant, v.name, v.description, v.items::jsonb, v.sort FROM (VALUES
    ('Onboarding νέου πελάτη', 'Βήματα για κάθε νέο πελάτη', '[
      {"title":"Καλωσόρισμα & γνωριμία","due_in_days":1,"priority":1},
      {"title":"Συλλογή στοιχείων τιμολόγησης","due_in_days":2,"checklist":["ΑΦΜ / ΔΟΥ","Διεύθυνση τιμολόγησης","Τρόπος πληρωμής"]},
      {"title":"Καταχώρηση καταστημάτων & χώρων","due_in_days":5},
      {"title":"Πρώτη προσφορά","due_in_days":7,"priority":1},
      {"title":"Υπογραφή συμβολαίου","due_in_days":14,"checklist":["Αποστολή συμβολαίου","Υπογραφή","Ανέβασμα στα Έγγραφα"]},
      {"title":"Follow-up ικανοποίησης","due_in_days":30,"priority":3}
    ]', 1),
    ('Προετοιμασία προσφοράς', 'Από το αίτημα μέχρι την αποστολή', '[
      {"title":"Επίσκεψη / μετρήσεις","due_in_days":2},
      {"title":"Κοστολόγηση","due_in_days":4},
      {"title":"Σύνταξη & έγκριση προσφοράς","due_in_days":6,"priority":1}
    ]', 2)
  ) AS v(name, description, items, sort)
  WHERE NOT EXISTS (SELECT 1 FROM task_templates x WHERE x.tenant_id = p_tenant);
$$;
SELECT seed_task_defaults(id) FROM tenants;
CREATE OR REPLACE FUNCTION tenants_seed_tasks() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM seed_task_defaults(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER tenants_seed_tasks AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_seed_tasks();

-- New permission: see / manage the whole team's tasks
UPDATE roles SET permissions = permissions || ARRAY['tasks.all']
WHERE key IN ('owner', 'admin', 'manager') AND NOT ('tasks.all' = ANY (permissions));
CREATE OR REPLACE FUNCTION seed_system_roles(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO roles (tenant_id, key, name, description, permissions, approval_level, is_system, sort) VALUES
    (p_tenant, 'owner',   'Ιδιοκτήτης',    'Πλήρης έλεγχος, και διαχείριση ιδιοκτητών',
      ARRAY['customers.edit','customers.delete','offers.edit','activities.all','tasks.all','views.share','forms.manage','settings.manage','users.manage','integrations.manage','audit.view'], 4, true, 1),
    (p_tenant, 'admin',   'Διαχειριστής',  'Ρυθμίσεις, χρήστες, κατάλογοι',
      ARRAY['customers.edit','customers.delete','offers.edit','activities.all','tasks.all','views.share','forms.manage','settings.manage','users.manage','integrations.manage','audit.view'], 3, true, 2),
    (p_tenant, 'manager', 'Manager',       'Εγκρίσεις, διαγραφές, αρχειοθέτηση',
      ARRAY['customers.edit','customers.delete','offers.edit','activities.all','tasks.all','views.share'], 2, true, 3),
    (p_tenant, 'sales',   'Πωλήσεις',      'Πελάτες, προσφορές, ημερολόγιο',
      ARRAY['customers.edit','offers.edit'], 1, true, 4),
    (p_tenant, 'viewer',  'Μόνο ανάγνωση', 'Μόνο προβολή δεδομένων', ARRAY[]::text[], 0, true, 5)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$$;
