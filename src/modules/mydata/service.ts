import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { cancelInvoiceMark, sendInvoicesXml, type MyDataEnv } from "./client";
import {
  buildDeliveryNoteInvoicesDocXml,
  buildInvoiceInvoicesDocXml,
  buildPurchaseInvoiceInvoicesDocXml,
  readMyDataConfig,
} from "./payload";

type Db = PrismaClient | Prisma.TransactionClient;

async function resolveMyDataConfig(db: Db, tenantId: string) {
  const settings = await db.tenantSettings.findUnique({
    where: { tenantId },
    select: { integrationsJson: true },
  });
  return readMyDataConfig(settings?.integrationsJson);
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
 * - simulator: local fake MARK
 * - test / prod: live AADE SendInvoices HTTP (requires credentials)
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

  const config = await resolveMyDataConfig(db, input.tenantId);
  const env: MyDataEnv = config.myDataEnv;
  const now = new Date();
  const attempts = row.attempts + 1;

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

  if (input.forceReject || (env === "simulator" && attempts % 7 === 0)) {
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

  // Live AADE for test + prod
  if (env === "test" || env === "prod") {
    const userId = config.myDataUserId?.trim();
    const subscriptionKey = config.myDataSubscriptionKey?.trim();
    if (!userId || !subscriptionKey) {
      return db.myDataSubmission.update({
        where: { id: row.id },
        data: {
          status: "REJECTED",
          attempts,
          lastAttemptAt: now,
          errorMessage:
            "Λείπουν credentials ΑΑΔΕ (user id / subscription key) στις Integrations",
          response: {
            mode: env,
            accepted: false,
            live: true,
            errors: [{ code: "CFG-001", message: "Missing AADE credentials" }],
            processedAt: now.toISOString(),
          },
        },
      });
    }

    try {
      let xml: string;
      if (row.entityType === "invoice") {
        xml = await buildInvoiceInvoicesDocXml(db, {
          tenantId: input.tenantId,
          invoiceId: row.entityId,
          invoiceType: row.invoiceType,
          vatCategory: row.vatCategory,
        });
      } else if (
        row.entityType === "delivery_note" ||
        row.entityType === "deliveryNote"
      ) {
        xml = await buildDeliveryNoteInvoicesDocXml(db, {
          tenantId: input.tenantId,
          deliveryNoteId: row.entityId,
          invoiceType: row.invoiceType,
        });
      } else if (
        row.entityType === "purchase_invoice" ||
        row.entityType === "purchaseInvoice"
      ) {
        xml = await buildPurchaseInvoiceInvoicesDocXml(db, {
          tenantId: input.tenantId,
          purchaseInvoiceId: row.entityId,
          invoiceType: row.invoiceType,
          vatCategory: row.vatCategory,
        });
      } else {
        throw new Error(
          `Live myDATA: μη υποστηριζόμενο entityType=${row.entityType}`,
        );
      }

      const result = await sendInvoicesXml(env, { userId, subscriptionKey }, xml);

      if (!result.ok) {
        return db.myDataSubmission.update({
          where: { id: row.id },
          data: {
            status: "REJECTED",
            attempts,
            lastAttemptAt: now,
            errorMessage:
              result.errors.map((e) => e.message).join("; ") ||
              `Απόρριψη ΑΑΔΕ HTTP ${result.status}`,
            response: {
              mode: env,
              live: true,
              accepted: false,
              endpoint: result.endpoint,
              httpStatus: result.status,
              errors: result.errors,
              rawXml: result.rawXml.slice(0, 8000),
              processedAt: now.toISOString(),
            },
            payload: {
              ...((row.payload as object) || {}),
              requestXml: xml.slice(0, 8000),
            },
          },
        });
      }

      return db.myDataSubmission.update({
        where: { id: row.id },
        data: {
          status: "ACCEPTED",
          attempts,
          lastAttemptAt: now,
          mark: result.mark,
          uid: result.uid,
          errorMessage: null,
          response: {
            mode: env,
            live: true,
            accepted: true,
            endpoint: result.endpoint,
            httpStatus: result.status,
            mark: result.mark,
            uid: result.uid,
            rawXml: result.rawXml.slice(0, 8000),
            processedAt: now.toISOString(),
          },
          payload: {
            ...((row.payload as object) || {}),
            requestXml: xml.slice(0, 8000),
          },
        },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Σφάλμα live myDATA";
      return db.myDataSubmission.update({
        where: { id: row.id },
        data: {
          status: "REJECTED",
          attempts,
          lastAttemptAt: now,
          errorMessage: message,
          response: {
            mode: env,
            live: true,
            accepted: false,
            errors: [{ message }],
            processedAt: now.toISOString(),
          },
        },
      });
    }
  }

  // Local simulator
  const mark = `MARK-SIM-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${row.id.slice(-8).toUpperCase()}`;
  const uid = `UID-SIM-${row.entityId.slice(0, 12).toUpperCase()}`;

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
        note: "Local simulator",
        processedAt: now.toISOString(),
      },
    },
  });
}

/** Cancel an ACCEPTED myDATA submission via AADE CancelInvoice (or simulator). */
export async function cancelMyDataSubmission(
  db: Db,
  input: { tenantId: string; id: string },
) {
  const row = await db.myDataSubmission.findFirst({
    where: { id: input.id, tenantId: input.tenantId },
  });
  if (!row) throw new Error("Η εγγραφή myDATA δεν βρέθηκε");
  if (row.status === "CANCELLED") return row;
  if (row.status !== "ACCEPTED" || !row.mark) {
    throw new Error("Ακύρωση μόνο για αποδεκτές δηλώσεις με MARK");
  }

  const config = await resolveMyDataConfig(db, input.tenantId);
  const env: MyDataEnv = config.myDataEnv;
  const now = new Date();

  if (env === "simulator") {
    return db.myDataSubmission.update({
      where: { id: row.id },
      data: {
        status: "CANCELLED",
        errorMessage: null,
        response: {
          ...((row.response as object) || {}),
          cancelledAt: now.toISOString(),
          mode: env,
          note: "Local simulator cancel",
        },
      },
    });
  }

  const userId = config.myDataUserId?.trim();
  const subscriptionKey = config.myDataSubscriptionKey?.trim();
  if (!userId || !subscriptionKey) {
    throw new Error("Λείπουν credentials ΑΑΔΕ στις Integrations");
  }

  const result = await cancelInvoiceMark(
    env,
    { userId, subscriptionKey },
    row.mark,
  );
  if (!result.ok) {
    throw new Error(
      result.errors.map((e) => e.message).join("; ") ||
        `Απόρριψη ακύρωσης ΑΑΔΕ HTTP ${result.status}`,
    );
  }

  return db.myDataSubmission.update({
    where: { id: row.id },
    data: {
      status: "CANCELLED",
      errorMessage: null,
      response: {
        ...((row.response as object) || {}),
        cancelledAt: now.toISOString(),
        mode: env,
        live: true,
        endpoint: result.endpoint,
        httpStatus: result.status,
        rawXml: result.rawXml.slice(0, 8000),
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
