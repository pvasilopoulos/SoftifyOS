-- Scale proof: covering keyset index for (tenant, createdAt, id)
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_events_tenant_created_id_idx
  ON audit_events ("tenantId", "createdAt" DESC, id DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_events_tenant_action_created_id_idx
  ON audit_events ("tenantId", action, "createdAt" DESC, id DESC);

ANALYZE audit_events;
