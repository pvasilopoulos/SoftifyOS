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
import { resolveSeriesPaymentMethods } from "@/modules/documents/series-payments";

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
      select: {
        id: true,
        number: true,
        status: true,
        total: true,
        paidAmount: true,
        seriesId: true,
        series: {
          select: { glDebitAccount: true },
        },
      },
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

    const allowed = await resolveSeriesPaymentMethods(prisma, {
      tenantId: session.tenantId,
      seriesId: invoice.seriesId,
      collectOnly: true,
      activeOnly: true,
    });

    if (allowed.length === 0) {
      return NextResponse.json(
        { error: "Δεν υπάρχουν διαθέσιμοι τρόποι είσπραξης" },
        { status: 400 },
      );
    }

    let method =
      allowed.find((m) => m.id === body.paymentMethodId) ??
      allowed.find((m) => m.code === body.method) ??
      allowed.find((m) => m.isDefault) ??
      allowed[0]!;

    // Legacy enum fallback when series has no strict allow-list match
    if (
      !body.paymentMethodId &&
      body.method &&
      !allowed.some((m) => m.code === body.method)
    ) {
      const legacy = allowed.find((m) => m.kind === body.method);
      if (legacy) method = legacy;
    }

    if (
      body.paymentMethodId &&
      !allowed.some((m) => m.id === body.paymentMethodId)
    ) {
      return NextResponse.json(
        { error: "Ο τρόπος πληρωμής δεν επιτρέπεται για αυτή τη σειρά" },
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

    const updated = await prisma.$transaction(async (tx) => {
      await tx.invoicePayment.create({
        data: {
          tenantId: session.tenantId,
          invoiceId: invoice.id,
          amount: body.amount,
          method: method.code,
          paymentMethodId: method.id,
          note: body.note || null,
        },
      });
      return tx.invoice.update({
        where: { id: invoice.id },
        data: { paidAmount, status: nextStatus },
      });
    });

    let journalId: string | null = null;
    try {
      const payment = await prisma.invoicePayment.findFirst({
        where: { tenantId: session.tenantId, invoiceId: invoice.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const pmGl = await prisma.paymentMethod.findFirst({
        where: { id: method.id, tenantId: session.tenantId },
        select: { glAccount: true, glClearingAccount: true },
      });
      const { tryPostInvoiceCollect } = await import("@/modules/ledger/service");
      const journal = await tryPostInvoiceCollect(prisma, {
        tenantId: session.tenantId,
        invoiceId: invoice.id,
        invoiceNumber: updated.number,
        amount: body.amount,
        paymentId: payment?.id ?? null,
        glArAccount: invoice.series?.glDebitAccount ?? "30.00.00",
        glCashAccount:
          pmGl?.glAccount ||
          pmGl?.glClearingAccount ||
          "38.00.00",
        userId: session.sub,
      });
      journalId = journal?.id ?? null;
    } catch {
      journalId = null;
    }

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.collect",
      entity: "invoice",
      entityId: invoice.id,
      meta: {
        amount: body.amount,
        method: method.code,
        paymentMethodId: method.id,
        paidAmount,
        status: nextStatus,
        note: body.note || null,
        journalId,
      },
    });

    return NextResponse.json({
      item: {
        id: updated.id,
        number: updated.number,
        status: updated.status,
        paidAmount: toNumber(updated.paidAmount),
        total: toNumber(updated.total),
        balance: roundMoney(
          toNumber(updated.total) - toNumber(updated.paidAmount),
        ),
        journalId,
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
