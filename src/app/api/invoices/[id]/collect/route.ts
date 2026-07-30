import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  roundMoney,
  statusAfterPayment,
  toNumber,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import { invoiceCollectSchema } from "@/modules/sales/schemas";

export const dynamic = "force-dynamic";

export async function POST(
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
    const body = invoiceCollectSchema.parse(await request.json());

    const invoice = await prisma.invoice.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const status = invoice.status as InvoiceStatusKey;
    if (status === "DRAFT") {
      return NextResponse.json(
        { error: "Έκδώστε πρώτα το πρόχειρο τιμολόγιο" },
        { status: 400 },
      );
    }
    if (status === "CANCELLED") {
      return NextResponse.json(
        { error: "Το ακυρωμένο τιμολόγιο δεν δέχεται είσπραξη" },
        { status: 400 },
      );
    }
    if (status === "PAID") {
      return NextResponse.json(
        { error: "Το τιμολόγιο είναι ήδη εξοφλημένο" },
        { status: 400 },
      );
    }

    const total = toNumber(invoice.total);
    const currentPaid = toNumber(invoice.paidAmount);
    const balance = roundMoney(total - currentPaid);
    if (body.amount > balance + 0.001) {
      return NextResponse.json(
        {
          error: `Το ποσό υπερβαίνει το υπόλοιπο (${balance.toFixed(2)} €)`,
        },
        { status: 400 },
      );
    }

    const paidAmount = roundMoney(currentPaid + body.amount);
    const nextStatus = statusAfterPayment(status, paidAmount, total);

    const updated = await prisma.invoice.update({
      where: { id: invoice.id },
      data: { paidAmount, status: nextStatus },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.collect",
      entity: "invoice",
      entityId: invoice.id,
      meta: {
        amount: body.amount,
        paidAmount,
        status: nextStatus,
        note: body.note || null,
      },
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        paidAmount: toNumber(updated.paidAmount),
        total: toNumber(updated.total),
        balance: roundMoney(toNumber(updated.total) - toNumber(updated.paidAmount)),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Μη έγκυρο ποσό είσπραξης" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Collect failed") },
      { status: 400 },
    );
  }
}
