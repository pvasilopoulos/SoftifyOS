import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

type MyDataEnv = "simulator" | "test" | "prod";

async function resolveMyDataEnv(db: Db, tenantId: string): Promise<MyDataEnv> {
  const settings = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: { integrationsJson: true },
  });
  const json = (settings?.integrationsJson as { myDataEnv?: MyDataEnv } | null) ?? {};
  return json.myDataEnv ?? "simulator";
}

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
 * Process queue item.
 * - simulator / test: local fake MARK (test prefix differs)
 * - prod: still simulator until AADE credentials land — returns clear mode flag
 */
export async function processMyDataSubmission(
  db: Db,
  input: {
    tenantId: string;
    id: string;
    forceReject?: boolean;
  },
) {
  const row = await db.myDataSubmission.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new Error("Η εγγραφή myDATA δεν βρέθηκε");
  if (row.status === "ACCEPTED" || row.status === "CANCELLED") {
    return row;
  }

  const env = await resolveMyDataEnv(db, input.tenantId);
  const now = new Date();
  const attempts = row.attempts + 1;

  // Intermediate SENT hop for observability
  if (row.status === "PENDING") {
    await db.myDataSubmission.update({
      where: { id: row.id },
      data: {
        status: "SENT",
        attempts,
        lastAttemptAt: now,
        response: {
          mode: env,
          phase: "sent",
          at: now.toISOString(),
        },
      },
    });
  }

  if (input.forceReject || (env === "test" && attempts % 7 === 0)) {
    return db.myDataSubmission.update({
      where: { id: row.id },
      data: {
        status: "REJECTED",
        attempts,
        lastAttemptAt: now,
        errorMessage: "Προσομοίωση απόρριψης AADE (validation)",
        response: {
          mode: env,
          accepted: false,
          errors: [{ code: "VAL-001", message: "Simulated rejection" }],
          processedAt: now.toISOString(),
        },
      },
    });
  }

  const prefix = env === "prod" ? "MARK-STUB" : env === "test" ? "MARK-TEST" : "MARK-SIM";
  const mark = `${prefix}-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${row.id.slice(-8).toUpperCase()}`;
  const uid = `UID-${env.toUpperCase()}-${row.entityId.slice(0, 12).toUpperCase()}`;

  return db.myDataSubmission.update({
    where: { id: row.id },
    data: {
      status: "ACCEPTED",
      attempts,
      lastAttemptAt: now,
      mark,
      uid,
      errorMessage: null,
      response: {
        mode: env,
        accepted: true,
        mark,
        uid,
        note:
          env === "prod"
            ? "Stub — δεν υπάρχει ακόμα live AADE client"
            : "Local simulator",
        processedAt: now.toISOString(),
      },
    },
  });
}

export async function processPendingMyDataBatch(
  db: Db,
  input: { tenantId: string; limit?: number },
) {
  const pending = await db.myDataSubmission.findMany({
    where: {
      tenantId: input.tenantId,
      status: { in: ["PENDING", "SENT", "REJECTED"] },
    },
    orderBy: { createdAt: "asc" },
    take: input.limit ?? 25,
    select: { id: true },
  });
  const results = [];
  for (const p of pending) {
    results.push(
      await processMyDataSubmission(db, {
        tenantId: input.tenantId,
        id: p.id,
      }),
    );
  }
  return results;
}
