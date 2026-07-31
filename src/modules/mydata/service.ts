import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Enqueue a document for myDATA when series has myDataEnabled. */
export async function enqueueMyDataSubmission(
  db: Db,
  input: {
    tenantId: string;
    entityType: string;
    entityId: string;
    entityNumber?: string | null;
    invoiceType?: string | null;
    vatCategory?: string | null;
    payload?: Prisma.InputJsonValue;
  },
) {
  const existing = await db.myDataSubmission.findFirst({
    where: {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      status: { in: ["PENDING", "SENT", "ACCEPTED"] },
    },
  });
  if (existing) return existing;

  return db.myDataSubmission.create({
    data: {
      tenantId: input.tenantId,
      entityType: input.entityType,
      entityId: input.entityId,
      entityNumber: input.entityNumber ?? null,
      invoiceType: input.invoiceType ?? null,
      vatCategory: input.vatCategory ?? null,
      status: "PENDING",
      payload: input.payload ?? undefined,
    },
  });
}

/**
 * Local simulator — marks PENDING as SENT then ACCEPTED with a fake MARK.
 * Real AADE client plugs in here later.
 */
export async function processMyDataSubmission(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await db.myDataSubmission.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new Error("Η εγγραφή myDATA δεν βρέθηκε");
  if (row.status === "ACCEPTED" || row.status === "CANCELLED") {
    return row;
  }

  const now = new Date();
  const mark = `MARK-SIM-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${row.id.slice(-8).toUpperCase()}`;
  const uid = `UID-SIM-${row.entityId.slice(0, 12).toUpperCase()}`;

  return db.myDataSubmission.update({
    where: { id: row.id },
    data: {
      status: "ACCEPTED",
      attempts: row.attempts + 1,
      lastAttemptAt: now,
      mark,
      uid,
      errorMessage: null,
      response: {
        mode: "simulator",
        accepted: true,
        mark,
        uid,
        processedAt: now.toISOString(),
      },
    },
  });
}
