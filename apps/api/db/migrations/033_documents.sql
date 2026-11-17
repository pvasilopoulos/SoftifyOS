-- Documents: files per organisation in folders, linked to customers / stores / spaces / offers / activities,
-- with versions, categories, expiry reminders and share links. File bytes live on disk (UPLOAD_DIR).

ALTER TABLE tenants ADD COLUMN storage_quota_bytes bigint NOT NULL DEFAULT 5368709120;   -- 5 GB

CREATE TABLE doc_categories (
  id        uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key       text NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  name      text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  color     text NOT NULL DEFAULT 'primary',
  sort      int NOT NULL DEFAULT 100,
  active    boolean NOT NULL DEFAULT true,
  UNIQUE (tenant_id, key)
);

CREATE TABLE doc_folders (
  id         uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id  uuid REFERENCES doc_folders(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX doc_folders_parent_idx ON doc_folders (tenant_id, parent_id, name);

CREATE TABLE documents (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  folder_id     uuid REFERENCES doc_folders(id) ON DELETE SET NULL,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  description   text CHECK (char_length(description) <= 2000),
  category      text,
  tags          text[] NOT NULL DEFAULT '{}',
  mime          text NOT NULL,
  ext           text NOT NULL,
  size          bigint NOT NULL,                 -- current version
  version       int NOT NULL DEFAULT 1,
  storage_key   text NOT NULL,                   -- current version file
  customer_id   uuid REFERENCES customers(id) ON DELETE SET NULL,
  branch_id     uuid REFERENCES branches(id) ON DELETE SET NULL,
  space_id      uuid REFERENCES spaces(id) ON DELETE SET NULL,
  offer_id      uuid REFERENCES offers(id) ON DELETE SET NULL,
  activity_id   uuid REFERENCES crm_activities(id) ON DELETE SET NULL,
  task_id       uuid,                            -- FK added with the tasks module
  expires_at    date,
  expiry_notified boolean NOT NULL DEFAULT false,
  share_token   text UNIQUE,
  share_expires_at timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  search        text GENERATED ALWAYS AS (
                  search_key(name || ' ' || coalesce(description, '')) || ' ' || phonetic_key(name)) STORED
);
CREATE INDEX documents_folder_idx   ON documents (tenant_id, folder_id, created_at DESC);
CREATE INDEX documents_recent_idx   ON documents (tenant_id, created_at DESC, id DESC);
CREATE INDEX documents_customer_idx ON documents (tenant_id, customer_id, created_at DESC) WHERE customer_id IS NOT NULL;
CREATE INDEX documents_offer_idx    ON documents (offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX documents_branch_idx   ON documents (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX documents_space_idx    ON documents (space_id) WHERE space_id IS NOT NULL;
CREATE INDEX documents_activity_idx ON documents (activity_id) WHERE activity_id IS NOT NULL;
CREATE INDEX documents_task_idx     ON documents (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX documents_expiry_idx   ON documents (expires_at) WHERE expires_at IS NOT NULL AND expiry_notified = false;
CREATE INDEX documents_search_idx   ON documents USING gin (search gin_trgm_ops);

CREATE TABLE document_versions (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version     int NOT NULL,
  storage_key text NOT NULL,
  name        text NOT NULL,
  mime        text NOT NULL,
  size        bigint NOT NULL,
  sha256      text NOT NULL,
  note        text CHECK (char_length(note) <= 300),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX document_versions_tenant_idx ON document_versions (tenant_id);

-- Files whose rows were deleted: the worker removes them from disk
CREATE TABLE storage_trash (
  storage_key text PRIMARY KEY,
  deleted_at  timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['doc_categories', 'doc_folders', 'documents', 'document_versions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;
GRANT INSERT ON storage_trash TO softify_app;

CREATE OR REPLACE FUNCTION seed_doc_defaults(p_tenant uuid) RETURNS void LANGUAGE sql AS $$
  INSERT INTO doc_categories (tenant_id, key, name, color, sort) VALUES
    (p_tenant, 'contract',    'Συμβόλαια',      'primary', 1),
    (p_tenant, 'invoice',     'Τιμολόγια',      'info',    2),
    (p_tenant, 'offer',       'Προσφορές',      'success', 3),
    (p_tenant, 'photo',       'Φωτογραφίες',    'warning', 4),
    (p_tenant, 'technical',   'Τεχνικά',        'muted',   5),
    (p_tenant, 'certificate', 'Πιστοποιητικά',  'danger',  6),
    (p_tenant, 'other',       'Λοιπά',          'muted',   7)
  ON CONFLICT (tenant_id, key) DO NOTHING;
$$;
SELECT seed_doc_defaults(id) FROM tenants;
CREATE OR REPLACE FUNCTION tenants_seed_docs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM seed_doc_defaults(NEW.id); RETURN NEW; END $$;
CREATE TRIGGER tenants_seed_docs AFTER INSERT ON tenants FOR EACH ROW EXECUTE FUNCTION tenants_seed_docs();
