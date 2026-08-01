import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";
import { calcInvoiceTotals, toNumber } from "@/modules/sales/invoice-utils";
import { invoiceUpdateSchema } from "@/modules/sales/schemas";

export const dynamic = "force-dynamic";

function parseDueAt(value: string | null | undefined) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00.000Z`);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        customer: true,
        branch: true,
        space: true,
        series: true,
        site: true,
        payments: { orderBy: { paidAt: "desc" } },
        lines: {
          orderBy: { position: "asc" },
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
      },
    });

    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    return NextResponse.json({
      item: {
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
        payments: invoice.payments.map((p) => ({
          ...p,
          amount: toNumber(p.amount),
          paidAt: p.paidAt.toISOString(),
          createdAt: p.createdAt.toISOString(),
        })),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

/** Edit draft invoices only (unless series.editableAfterIssue). */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await context.params;
    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: session.tenantId },
      include: { series: true },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const canEdit =
      invoice.status === "DRAFT" ||
      (invoice.series?.editableAfterIssue === true &&
        invoice.status !== "CANCELLED" &&
        invoice.status !== "PAID");
    if (!canEdit) {
      return NextResponse.json(
        { error: "Το παραστατικό είναι κλειδωμένο" },
        { status: 400 },
      );
    }

    const body = invoiceUpdateSchema.parse(await request.json());
    const totals = body.lines ? calcInvoiceTotals(body.lines) : null;

    const {
      applyRecordPatch,
      dispatchScriptEvent,
    } = await import("@/modules/scripts/service");
    const { scriptActorFromSession } = await import(
      "@/modules/scripts/actor"
    );

    const previous: Record<string, unknown> = {
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      notes: invoice.notes,
      branchId: invoice.branchId,
      spaceId: invoice.spaceId,
      total: toNumber(invoice.total),
    };

    const draftRecord: Record<string, unknown> = {
      ...previous,
      ...(body.branchId !== undefined ? { branchId: body.branchId } : {}),
      ...(body.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt } : {}),
      ...(totals ? { total: totals.total, subtotal: totals.subtotal } : {}),
      ...(body.lines ? { lines: body.lines } : {}),
    };

    const before = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "INVOICES",
      eventKey: "before.update",
      record: draftRecord,
      previous,
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
      "branchId",
      "spaceId",
    ]);

    const updated = await prisma.$transaction(async (tx) => {
      if (body.lines) {
        await tx.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } });
      }
      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          ...(body.branchId !== undefined || patched.branchId !== undefined
            ? {
                branchId:
                  (patched.branchId as string | null | undefined) ??
                  body.branchId,
              }
            : {}),
          ...(body.spaceId !== undefined || patched.spaceId !== undefined
            ? {
                spaceId:
                  (patched.spaceId as string | null | undefined) ?? body.spaceId,
              }
            : {}),
          ...(body.dueAt !== undefined ? { dueAt: parseDueAt(body.dueAt) } : {}),
          ...(body.notes !== undefined || patched.notes !== undefined
            ? {
                notes:
                  (patched.notes as string | null | undefined) ??
                  (body.notes || null),
              }
            : {}),
          ...(totals
            ? {
                subtotal: totals.subtotal,
                vatAmount: totals.vatAmount,
                total: totals.total,
                lines: {
                  create: body.lines!.map((line, idx) => ({
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
              }
            : {}),
        },
        include: { lines: { orderBy: { position: "asc" } } },
      });
    });

    const afterSnapshot: Record<string, unknown> = {
      id: updated.id,
      number: updated.number,
      status: updated.status,
      notes: updated.notes,
      branchId: updated.branchId,
      spaceId: updated.spaceId,
      dueAt: updated.dueAt?.toISOString() ?? null,
      total: toNumber(updated.total),
      subtotal: toNumber(updated.subtotal),
      vatAmount: toNumber(updated.vatAmount),
      lineCount: updated.lines.length,
    };

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.update",
      entity: "invoice",
      entityId: invoice.id,
      meta: buildChangeMeta({
        before: {
          ...previous,
          dueAt: invoice.dueAt?.toISOString() ?? null,
          subtotal: toNumber(invoice.subtotal),
          vatAmount: toNumber(invoice.vatAmount),
        },
        after: afterSnapshot,
        extra: { number: updated.number },
      }),
    });

    const item = {
      id: updated.id,
      status: updated.status,
      total: toNumber(updated.total),
    };

    const after = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "INVOICES",
      eventKey: "after.update",
      record: {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        notes: updated.notes,
        total: item.total,
      },
      previous,
      user: scriptActorFromSession(session),
    });

    if (after.failed) {
      return NextResponse.json({
        item,
        warning: after.failed.message,
        script: after.failed.scriptCode,
      });
    }

    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
