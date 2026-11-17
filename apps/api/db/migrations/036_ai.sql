-- AI (Copilot, voice visits, summaries, report builder, offer drafts, smart import).
-- Per-tenant switch + consent + monthly budget, conversations, proposed actions (run only on confirmation)
-- and metered usage. Who may use it is the role permission "ai.use".

ALTER TABLE tenants ADD COLUMN ai_settings jsonb NOT NULL DEFAULT '{}';
-- { enabled, consent_at, consent_by, monthly_budget_usd, features: { copilot, voice, summary, reports, offer_draft, import } }

-- Roles that can edit customers get AI by default; admins can change it in Users & roles
UPDATE roles SET permissions = array_append(permissions, 'ai.use')
WHERE 'customers.edit' = ANY(permissions) AND NOT ('ai.use' = ANY(permissions));

CREATE TABLE ai_conversations (
  id          uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT '' CHECK (char_length(title) <= 200),
  context     jsonb,                      -- where it was opened: { kind: customer|offer|..., id }
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_conversations_user_idx ON ai_conversations (tenant_id, user_id, updated_at DESC);

-- Messages exactly as sent to / received from the model (content blocks, thinking included), append-only
CREATE TABLE ai_messages (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant')),
  content         jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_conv_idx ON ai_messages (conversation_id, id);

-- Changes the assistant proposes; nothing happens until the user confirms
CREATE TABLE ai_actions (
  id              uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES ai_conversations(id) ON DELETE CASCADE,
  kind            text NOT NULL,          -- task | activity | offer_draft | save_report
  payload         jsonb NOT NULL,
  summary         jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'cancelled', 'failed')),
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE INDEX ai_actions_conv_idx ON ai_actions (conversation_id, created_at);

CREATE TABLE ai_usage (
  id            uuid PRIMARY KEY DEFAULT uuid_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  feature       text NOT NULL,
  model         text NOT NULL,
  input_tokens  integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  cache_read    integer NOT NULL DEFAULT 0,
  cache_write   integer NOT NULL DEFAULT 0,
  cost_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_month_idx ON ai_usage (tenant_id, created_at);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ai_conversations', 'ai_messages', 'ai_actions', 'ai_usage'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant()) WITH CHECK (tenant_id = app_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO softify_app', t);
  END LOOP;
END $$;
