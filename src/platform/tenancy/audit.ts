import { prisma } from "@/server/db";
import type { SessionPayload } from "@/platform/auth/session";
import type { Prisma } from "@/generated/prisma/client";

export async function writeAuditEvent(input: {
  tenantId: string;
  userId?: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  meta?: Prisma.InputJsonValue;
}) {
  return prisma.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      meta: input.meta,
    },
  });
}

export function tenantHeaderFromSession(session: SessionPayload) {
  return {
    "x-softify-tenant": session.tenantId,
    "x-softify-role": session.role,
  };
}
