-- AlterTable
ALTER TABLE "memberships" ADD COLUMN "appRoleId" TEXT;

-- CreateTable
CREATE TABLE "tenant_settings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "menuJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_roles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_group_members" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_group_members_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_group_roles" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "appRoleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_group_roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenant_settings_tenantId_key" ON "tenant_settings"("tenantId");
CREATE UNIQUE INDEX "app_roles_tenantId_code_key" ON "app_roles"("tenantId", "code");
CREATE INDEX "app_roles_tenantId_isSystem_idx" ON "app_roles"("tenantId", "isSystem");
CREATE UNIQUE INDEX "user_groups_tenantId_code_key" ON "user_groups"("tenantId", "code");
CREATE INDEX "user_groups_tenantId_idx" ON "user_groups"("tenantId");
CREATE UNIQUE INDEX "user_group_members_groupId_membershipId_key" ON "user_group_members"("groupId", "membershipId");
CREATE INDEX "user_group_members_tenantId_groupId_idx" ON "user_group_members"("tenantId", "groupId");
CREATE UNIQUE INDEX "user_group_roles_groupId_appRoleId_key" ON "user_group_roles"("groupId", "appRoleId");
CREATE INDEX "user_group_roles_tenantId_groupId_idx" ON "user_group_roles"("tenantId", "groupId");
CREATE INDEX "memberships_tenantId_appRoleId_idx" ON "memberships"("tenantId", "appRoleId");

ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_roles" ADD CONSTRAINT "app_roles_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_group_roles" ADD CONSTRAINT "user_group_roles_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "user_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_group_roles" ADD CONSTRAINT "user_group_roles_appRoleId_fkey" FOREIGN KEY ("appRoleId") REFERENCES "app_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_appRoleId_fkey" FOREIGN KEY ("appRoleId") REFERENCES "app_roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
