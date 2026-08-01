CREATE TABLE IF NOT EXISTS "entity_detail_layouts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "entity" "EntityModule" NOT NULL,
    "configJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_detail_layouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "entity_detail_layouts_tenantId_entity_key"
  ON "entity_detail_layouts"("tenantId", "entity");
CREATE INDEX IF NOT EXISTS "entity_detail_layouts_tenantId_entity_idx"
  ON "entity_detail_layouts"("tenantId", "entity");

DO $$ BEGIN
  ALTER TABLE "entity_detail_layouts"
    ADD CONSTRAINT "entity_detail_layouts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
