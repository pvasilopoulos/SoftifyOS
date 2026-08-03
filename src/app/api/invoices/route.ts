import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/shared/lib/cursor";
import { getErrorMessage } from "@/shared/lib/safe";
import { calcInvoiceTotals, toNumber } from "@/modules/sales/invoice-utils";
import { invoiceCreateSchema } from "@/modules/sales/schemas";
import { syncOverdueInvoices } from "@/modules/sales/overdue";
import {
  allocateFromSeries,
  resolveDefaultSeries,
} from "@/modules/documents/series";
import {
  InvoiceStatusOptionError,
  resolveInvoiceStatusOption,
} from "@/modules/sales/invoice-status-options";
import {
  companySqlAnd,
  companyStamp,
  isCompanyScopeError,
  requireCompanyId,
} from "@/platform/tenancy/company-scope";

export const dynamic = "force-dynamic";

const listSchema = listQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z
    .enum(["DRAFT", "ISSUED", "PARTIAL", "PAID", "OVERDUE", "CANCELLED"])
    .optional(),
  tab: z
    .enum(["all", "pending", "issued", "overdue", "paid", "draft"])
    .optional(),
  customerId: z.string().min(1).optional(),
  kind: z.enum(["SALES_INVOICE", "SALES_CREDIT", "RETAIL_RECEIPT"]).optional(),
});

async function nextInvoiceNumberFallback(
  tenantId: string,
  legalEntityId: string,
  kind: string,
) {
  const year = new Date().getFullYear();
  const code =
    kind === "SALES_CREDIT" ? "ΠΙΣ" : kind === "RETAIL_RECEIPT" ? "ΑΠΥ" : "ΤΙΜ";
  const prefix = `${code}-${year}-`;
  const latest = await prisma.invoice.findFirst({
    where: { tenantId, legalEntityId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = latest?.number?.slice(prefix.length) ?? "0";
  const seq = Number.parseInt(lastSeq, 10);
  const next = Number.isFinite(seq) ? seq + 1 : 1;
  return `${prefix}${String(next).padStart(5, "0")}`;
}

function parseDueAt(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const legalEntityId = requireCompanyId(session);

    await syncOverdueInvoices(session.tenantId);

    const parsed = listSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { limit, cursor: cursorParam, q, status, tab, customerId, kind } =
      parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const statusFilter = status
      ? Prisma.sql`AND i.status = ${status}::"InvoiceStatus"`
      : tab === "draft"
        ? Prisma.sql`AND i.status = 'DRAFT'::"InvoiceStatus"`
        : tab === "paid"
          ? Prisma.sql`AND i.status = 'PAID'::"InvoiceStatus"`
          : tab === "overdue"
            ? Prisma.sql`AND i.status = 'OVERDUE'::"InvoiceStatus"`
            : tab === "issued"
              ? Prisma.sql`AND i.status = 'ISSUED'::"InvoiceStatus"`
              : tab === "pending"
                ? Prisma.sql`AND i.status IN ('ISSUED'::"InvoiceStatus", 'PARTIAL'::"InvoiceStatus", 'OVERDUE'::"InvoiceStatus")`
                : Prisma.empty;

    const companyFilter = companySqlAnd(session);

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        number: string;
        status: string;
        kind: string;
        issuedAt: Date | null;
        dueAt: Date | null;
        total: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        createdAt: Date;
        customerId: string;
        customerName: string;
        customerCode: string;
        branchName: string | null;
        spaceName: string | null;
        customFields: unknown;
      }>
    >`
      SELECT
        i.id, i.number, i.status, i.kind, i."issuedAt", i."dueAt",
        i.total, i."paidAmount", i."createdAt", i."customFields",
        i."customerId", c.name AS "customerName", c.code AS "customerCode",
        b.name AS "branchName", s.name AS "spaceName"
      FROM invoices i
      JOIN customers c ON c.id = i."customerId"
      LEFT JOIN branches b ON b.id = i."branchId"
      LEFT JOIN spaces s ON s.id = i."spaceId"
      WHERE i."tenantId" = ${session.tenantId}
        ${companyFilter}
        ${statusFilter}
        ${kind ? Prisma.sql`AND i.kind = ${kind}::"InvoiceKind"` : Prisma.empty}
        ${customerId ? Prisma.sql`AND i."customerId" = ${customerId}` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                i.number ILIKE ${"%" + q + "%"}
                OR c.name ILIKE ${"%" + q + "%"}
                OR c.code ILIKE ${"%" + q + "%"}
              )`
            : Prisma.empty
        }
        ${
          cursor
            ? Prisma.sql`AND (i."createdAt", i.id) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY i."createdAt" DESC, i.id DESC
      LIMIT ${limit + 1}
    `;

    const counts = await prisma.$queryRaw<
      Array<{
        all: bigint;
        draft: bigint;
        pending: bigint;
        issued: bigint;
        overdue: bigint;
        paid: bigint;
      }>
    >`
      SELECT
        COUNT(*)::bigint AS all,
        COUNT(*) FILTER (WHERE status = 'DRAFT')::bigint AS draft,
        COUNT(*) FILTER (WHERE status IN ('ISSUED','PARTIAL','OVERDUE'))::bigint AS pending,
        COUNT(*) FILTER (WHERE status = 'ISSUED')::bigint AS issued,
        COUNT(*) FILTER (WHERE status = 'OVERDUE')::bigint AS overdue,
        COUNT(*) FILTER (WHERE status = 'PAID')::bigint AS paid
      FROM invoices
      WHERE "tenantId" = ${session.tenantId}
        AND "legalEntityId" = ${legalEntityId}
    `;

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => {
      const total = toNumber(row.total);
      const paidAmount = toNumber(row.paidAmount);
      return {
        id: row.id,
        number: row.number,
        status: row.status,
        kind: row.kind,
        issuedAt: row.issuedAt?.toISOString() ?? null,
        dueAt: row.dueAt?.toISOString() ?? null,
        total,
        paidAmount,
        createdAt: row.createdAt.toISOString(),
        customerId: row.customerId,
        customerName: row.customerName,
        customerCode: row.customerCode,
        branchName: row.branchName,
        spaceName: row.spaceName,
        customFields:
          row.customFields && typeof row.customFields === "object"
            ? row.customFields
            : {},
      };
    });
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    const c = counts[0];
    return NextResponse.json({
      items,
      nextCursor,
      counts: {
        all: Number(c?.all ?? 0),
        draft: Number(c?.draft ?? 0),
        pending: Number(c?.pending ?? 0),
        issued: Number(c?.issued ?? 0),
        overdue: Number(c?.overdue ?? 0),
        paid: Number(c?.paid ?? 0),
      },
      meta: { ms: Date.now() - started, count: items.length, hasMore },
    });
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "List failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const legalEntityId = requireCompanyId(session);

    const body = invoiceCreateSchema.parse(await request.json());
    const customer = await prisma.customer.findFirst({
      where: { id: body.customerId, tenantId: session.tenantId },
      select: { id: true },
    });
    if (!customer) {
      return NextResponse.json(
        { error: "Ο πελάτης δεν βρέθηκε" },
        { status: 400 },
      );
    }

    let spaceId: string | null = body.spaceId || null;
    const branchId: string | null = body.branchId || null;

    if (branchId) {
      const branch = await prisma.branch.findFirst({
        where: {
          id: branchId,
          tenantId: session.tenantId,
          customerId: customer.id,
        },
        select: { id: true },
      });
      if (!branch) {
        return NextResponse.json(
          { error: "Το υποκατάστημα δεν ανήκει στον πελάτη" },
          { status: 400 },
        );
      }
    } else {
      spaceId = null;
    }

    if (spaceId) {
      if (!branchId) {
        return NextResponse.json(
          { error: "Επιλέξτε υποκατάστημα για τον χώρο" },
          { status: 400 },
        );
      }
      const space = await prisma.space.findFirst({
        where: {
          id: spaceId,
          tenantId: session.tenantId,
          branchId,
        },
        select: { id: true },
      });
      if (!space) {
        return NextResponse.json(
          { error: "Ο χώρος δεν ανήκει στο υποκατάστημα" },
          { status: 400 },
        );
      }
    }

    const totals = calcInvoiceTotals(body.lines);
    const docKind = body.kind ?? "SALES_INVOICE";
    const settleMethods = (body.settleMethods ?? []).filter((m) => m.amount > 0);
    const wantsSettleNow =
      settleMethods.length > 0 && docKind !== "SALES_CREDIT";

    let statusOption;
    try {
      statusOption = await resolveInvoiceStatusOption(prisma, session.tenantId, {
        statusOptionId: body.statusOptionId,
        statusCode: wantsSettleNow
          ? "ISSUED"
          : (body.status ?? "DRAFT"),
        forCreate: true,
      });
    } catch (err) {
      if (err instanceof InvoiceStatusOptionError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status },
        );
      }
      throw err;
    }
    // Tender lines on create always issue (like POS) so settlement can run.
    let status: "DRAFT" | "ISSUED" =
      wantsSettleNow || statusOption.workflow === "ISSUED" ? "ISSUED" : "DRAFT";
    if (wantsSettleNow && statusOption.workflow !== "ISSUED") {
      try {
        statusOption = await resolveInvoiceStatusOption(prisma, session.tenantId, {
          statusCode: "ISSUED",
          forCreate: true,
        });
      } catch {
        // keep previous option; status still ISSUED via workflow override
      }
    }
    const issuedAt = status === "ISSUED" ? new Date() : null;
    const dueAt = parseDueAt(body.dueAt ?? null);

    const series =
      (body.seriesId
        ? await prisma.documentSeries.findFirst({
            where: {
              id: body.seriesId,
              tenantId: session.tenantId,
              legalEntityId,
              kind: docKind,
              isActive: true,
            },
          })
        : null) ??
      (await resolveDefaultSeries(
        prisma,
        session.tenantId,
        docKind,
        null,
        legalEntityId,
      ));

    if (!series && !body.number?.trim()) {
      return NextResponse.json(
        {
          error:
            "Δεν υπάρχει ενεργή σειρά για αυτόν τον τύπο — ρυθμίστε Σειρές & Τύποι",
        },
        { status: 400 },
      );
    }

    let relatedInvoiceId: string | null = body.relatedInvoiceId || null;
    let notes = body.notes || null;
    if (relatedInvoiceId) {
      if (docKind !== "SALES_CREDIT") {
        return NextResponse.json(
          { error: "Σύνδεση με τιμολόγιο επιτρέπεται μόνο σε πιστωτικά" },
          { status: 400 },
        );
      }
      const related = await prisma.invoice.findFirst({
        where: {
          id: relatedInvoiceId,
          tenantId: session.tenantId,
          legalEntityId,
          customerId: customer.id,
          kind: { in: ["SALES_INVOICE", "RETAIL_RECEIPT"] },
          status: { not: "CANCELLED" },
        },
        select: { id: true, number: true },
      });
      if (!related) {
        return NextResponse.json(
          { error: "Το συνδεδεμένο τιμολόγιο δεν βρέθηκε ή δεν είναι έγκυρο" },
          { status: 400 },
        );
      }
      relatedInvoiceId = related.id;
      if (!notes?.trim()) {
        notes = `Πιστωτικό για ${related.number}`;
      }
    }

    const {
      applyRecordPatch,
      dispatchScriptEvent,
    } = await import("@/modules/scripts/service");
    const { scriptActorFromSession } = await import(
      "@/modules/scripts/actor"
    );

    const draftRecord: Record<string, unknown> = {
      customerId: customer.id,
      branchId,
      spaceId,
      seriesId: series?.id ?? body.seriesId ?? null,
      relatedInvoiceId,
      kind: docKind,
      number: body.number?.trim() || null,
      status,
      notes,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      total: totals.total,
      lines: body.lines,
    };

    const before = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "INVOICES",
      eventKey: "before.create",
      record: draftRecord,
      user: scriptActorFromSession(session),
    });
    if (before.failed) {
      return NextResponse.json(
        { error: before.failed.message, script: before.failed.scriptCode },
        { status: 400 },
      );
    }

    const patched = applyRecordPatch(draftRecord, before.record, [
      "notes",
      "number",
      "status",
    ]);
    notes = (patched.notes as string | null) || null;

    const invoice = await prisma.$transaction(async (tx) => {
      let number = String(patched.number ?? "").trim() || "";
      let seriesId: string | null = series?.id ?? null;
      let siteId: string | null = series?.siteId ?? null;
      if (!number) {
        if (series) {
          const allocated = await allocateFromSeries(tx, {
            tenantId: session.tenantId,
            seriesId: series.id,
            kind: docKind,
            legalEntityId,
          });
          number = allocated.number;
          seriesId = allocated.seriesId;
          siteId = allocated.siteId;
        } else {
          number = await nextInvoiceNumberFallback(
            session.tenantId,
            legalEntityId,
            docKind,
          );
        }
      }

      return tx.invoice.create({
        data: {
          tenantId: session.tenantId,
          ...companyStamp(session),
          customerId: customer.id,
          branchId,
          spaceId,
          seriesId,
          siteId,
          relatedInvoiceId,
          kind: docKind,
          number,
          status,
          statusOptionId: statusOption.id,
          issuedAt,
          dueAt,
          currency: "EUR",
          subtotal: totals.subtotal,
          vatAmount: totals.vatAmount,
          total: totals.total,
          paidAmount: 0,
          notes,
          lines: {
            create: body.lines.map((line, idx) => ({
              tenantId: session.tenantId,
              productId: line.productId || null,
              position: idx + 1,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              vatRate: line.vatRate,
              lineTotal: totals.lines[idx]!.lineTotal,
            })),
          },
        },
        include: {
          lines: { orderBy: { position: "asc" } },
          customer: true,
          branch: true,
          space: true,
          series: true,
        },
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.create",
      entity: "invoice",
      entityId: invoice.id,
      meta: {
        number: invoice.number,
        status: invoice.status,
        kind: invoice.kind,
        seriesId: invoice.seriesId,
      },
    });

    const item = {
      ...invoice,
      subtotal: toNumber(invoice.subtotal),
      vatAmount: toNumber(invoice.vatAmount),
      total: toNumber(invoice.total),
      paidAmount: toNumber(invoice.paidAmount),
      issuedAt: invoice.issuedAt?.toISOString() ?? null,
      dueAt: invoice.dueAt?.toISOString() ?? null,
      createdAt: invoice.createdAt.toISOString(),
      updatedAt: invoice.updatedAt.toISOString(),
      lines: invoice.lines.map((line) => ({
        ...line,
        quantity: toNumber(line.quantity),
        unitPrice: toNumber(line.unitPrice),
        vatRate: toNumber(line.vatRate),
        lineTotal: toNumber(line.lineTotal),
      })),
    };

    let autoSettleWarning: string | undefined;
    let autoSettleMeta: {
      settlementId?: string;
      settlementNumber?: string;
      paymentMethodCode?: string;
    } | null = null;

    if (status === "ISSUED" && series && wantsSettleNow) {
      try {
        const { createReceiptSettlement } = await import(
          "@/modules/settlements/service"
        );
        const { settlement } = await createReceiptSettlement(prisma, {
          tenantId: session.tenantId,
          userId: session.sub,
          legalEntityId,
          data: {
            invoiceId: invoice.id,
            notes: "Εξόφληση κατά την καταχώρηση",
            methods: settleMethods.map((m) => ({
              paymentMethodId: m.paymentMethodId,
              amount: m.amount,
              changeAmount: m.changeAmount ?? 0,
              externalRef: m.externalRef ?? null,
            })),
          },
        });
        autoSettleMeta = {
          settlementId: settlement.id,
          settlementNumber: settlement.number,
        };
        const firstPm = settleMethods[0]?.paymentMethodId;
        if (firstPm) {
          const pm = await prisma.paymentMethod.findFirst({
            where: { id: firstPm, tenantId: session.tenantId },
            select: { code: true },
          });
          if (pm?.code) autoSettleMeta.paymentMethodCode = pm.code;
        }
        await writeAuditEvent({
          tenantId: session.tenantId,
          userId: session.sub,
          action: "invoice.settleOnCreate",
          entity: "invoice",
          entityId: invoice.id,
          meta: autoSettleMeta,
        });
        const refreshed = await prisma.invoice.findFirst({
          where: { id: invoice.id },
          select: { status: true, paidAmount: true },
        });
        if (refreshed) {
          item.status = refreshed.status;
          item.paidAmount = toNumber(refreshed.paidAmount);
        }
      } catch (error) {
        const { SettlementError: SettleErr } = await import(
          "@/modules/settlements/service"
        );
        autoSettleWarning =
          error instanceof SettleErr
            ? `Εξόφληση: ${error.message}`
            : "Η εξόφληση κατά την καταχώρηση απέτυχε";
      }
    } else if (status === "ISSUED" && series) {
      const { tryAutoSettleOnIssue } = await import(
        "@/modules/settlements/service"
      );
      const autoSettle = await tryAutoSettleOnIssue(prisma, {
        tenantId: session.tenantId,
        userId: session.sub,
        legalEntityId,
        invoiceId: invoice.id,
        seriesId: series.id,
        autoSettleOnIssue: series.autoSettleOnIssue,
      });
      if (autoSettle.settled) {
        autoSettleMeta = {
          settlementId: autoSettle.settlementId,
          settlementNumber: autoSettle.settlementNumber,
          paymentMethodCode: autoSettle.paymentMethodCode,
        };
        await writeAuditEvent({
          tenantId: session.tenantId,
          userId: session.sub,
          action: "invoice.autoSettle",
          entity: "invoice",
          entityId: invoice.id,
          meta: autoSettleMeta,
        });
        const refreshed = await prisma.invoice.findFirst({
          where: { id: invoice.id },
          select: { status: true, paidAmount: true },
        });
        if (refreshed) {
          item.status = refreshed.status;
          item.paidAmount = toNumber(refreshed.paidAmount);
        }
      } else if (autoSettle.warning) {
        autoSettleWarning = autoSettle.warning;
      }
    }

    const after = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "INVOICES",
      eventKey: "after.create",
      record: {
        id: invoice.id,
        number: invoice.number,
        kind: invoice.kind,
        status: item.status,
        customerId: invoice.customerId,
        total: item.total,
        notes: invoice.notes,
      },
      user: scriptActorFromSession(session),
    });

    const warnings = [after.failed?.message, autoSettleWarning].filter(
      Boolean,
    ) as string[];

    return NextResponse.json(
      {
        item: { ...item, autoSettle: autoSettleMeta },
        ...(warnings.length ? { warning: warnings.join(" · ") } : {}),
        ...(after.failed ? { script: after.failed.scriptCode } : {}),
      },
      { status: 201 },
    );
  } catch (error) {
    if (isCompanyScopeError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Μη έγκυρα δεδομένα τιμολογίου" },
        { status: 400 },
      );
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ο αριθμός τιμολογίου υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
