import { prisma } from "@/server/db";
import { SYSTEM_ROLE_PERMISSIONS } from "@/platform/auth/permissions";

const SYSTEM_ROLE_META: Record<
  keyof typeof SYSTEM_ROLE_PERMISSIONS,
  { name: string; description: string }
> = {
  OWNER: {
    name: "Ιδιοκτήτης",
    description: "Πλήρης πρόσβαση στο tenant",
  },
  ADMIN: {
    name: "Διαχειριστής",
    description: "Διαχείριση ρυθμίσεων, χρηστών και δεδομένων",
  },
  MEMBER: {
    name: "Μέλος",
    description: "Καθημερινή εργασία σε πωλήσεις και λειτουργίες",
  },
  VIEWER: {
    name: "Αναγνώστης",
    description: "Μόνο ανάγνωση",
  },
  SUPER_ADMIN: {
    name: "Super Admin",
    description: "Καθολική πρόσβαση διαχείρισης",
  },
};

/** Ensure default AppRoles exist for a tenant (idempotent). */
export async function ensureSystemRoles(tenantId: string) {
  for (const code of Object.keys(SYSTEM_ROLE_PERMISSIONS) as Array<
    keyof typeof SYSTEM_ROLE_PERMISSIONS
  >) {
    const meta = SYSTEM_ROLE_META[code];
    await prisma.appRole.upsert({
      where: { tenantId_code: { tenantId, code } },
      create: {
        tenantId,
        code,
        name: meta.name,
        description: meta.description,
        permissions: [...SYSTEM_ROLE_PERMISSIONS[code]],
        isSystem: true,
      },
      update: {
        name: meta.name,
        description: meta.description,
        permissions: [...SYSTEM_ROLE_PERMISSIONS[code]],
        isSystem: true,
      },
    });
  }
}
