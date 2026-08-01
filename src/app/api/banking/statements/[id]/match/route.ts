import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  statusAfterPayment,
  toNumber,
  type InvoiceStatusKey,
} from "@/modules/sales/invoice-utils";
import { tryPostInvoiceCollect } from "@/modules/ledger/service";

export const dynamic = "force-dynamic";

const schema = z.object({
  invoiceId: z.string().trim().min(1).optional().nullable(),
  ignore: z.boolean().optional(),
});

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
    const body = schema.parse(await request.json().catch(() => ({})));
    const line = await prisma.bankStatementLine.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!line) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    if (line.status === "MATCHED") {
      return NextResponse.json({ error: "Ήδη αντιστοιχισμένη" }, { status: 400 });
    }

    if (body.ignore) {
      const updated = await prisma.bankStatementLine.update({
        where: { id },
        data: { status: "IGNORED", matchNote: "Αγνοήθηκε χειροκίνητα" },
      });
      return NextResponse.json({ item: { id: updated.id, status: updated.status } });
    }

    if (!body.invoiceId) {
      return NextResponse.json({ error: "Επίλεξε τιμολόγιο" }, { status: 400 });
    }

    const amount = toNumber(line.amount);
    if (amount <= 0) {
      return NextResponse.json(
        { error: "Μόνο πιστωτικές κινήσεις αντιστοιχίζονται σε είσπραξη" },
        { status: 400 },
      );
    }

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: body.invoiceId,
        tenantId: session.tenantId,
        status: { in: ["ISSUED", "PARTIAL", "OVERDUE"] },
      },
    });
    if (!invoice) {
      return NextResponse.json({ error: "Τιμολόγιο δεν βρέθηκε" }, { status: 404 });
    }

    const balance = Math.max(
      0,
      toNumber(invoice.total) - toNumber(invoice.paidAmount),
    );
    const payAmount = Math.min(amount, balance);
    if (payAmount <= 0) {
      return NextResponse.json({ error: "Το τιμολόγιο είναι εξοφλημένο" }, { status: 400 });
    }

    const paidAmount = toNumber(invoice.paidAmount) + payAmount;
    const nextStatus = statusAfterPayment(
      invoice.status as InvoiceStatusKey,
      paidAmount,
      toNumber(invoice.total),
    );

    await prisma.$transaction(async (tx) => {
      await tx.invoicePayment.create({
        data: {
          tenantId: session.tenantId,
          invoiceId: invoice.id,
          amount: payAmount,
          method: "TRANSFER",
          note: `Bank match · ${line.description}`,
          externalRef: line.reference || line.id,
          paidAt: line.bookedAt,
        },
      });
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount, status: nextStatus },
      });
      await tx.bankStatementLine.update({
        where: { id: line.id },
        data: {
          status: "MATCHED",
          matchedInvoiceId: invoice.id,
          matchNote: `Είσπραξη ${payAmount}`,
        },
      });
    });

    try {
      await tryPostInvoiceCollect(prisma, {
        tenantId: session.tenantId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.number,
        amount: payAmount,
        userId: session.sub,
      });
    } catch {
      /* best-effort GL */
    }

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "banking.match",
      entity: "bank_statement_line",
      entityId: line.id,
      meta: { invoiceId: invoice.id, amount: payAmount },
    });

    return NextResponse.json({
      item: {
        id: line.id,
        status: "MATCHED",
        invoiceId: invoice.id,
        amount: payAmount,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Match failed") },
      { status: 400 },
    );
  }
}
