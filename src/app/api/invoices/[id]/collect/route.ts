import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  roundMoney,
  toNumber,
} from "@/modules/sales/invoice-utils";
import { invoiceCollectSchema } from "@/modules/sales/schemas";
import {
  createReceiptSettlement,
  SettlementError,
} from "@/modules/settlements/service";

export const dynamic = "force-dynamic";

/**
 * Backward-compatible collect → Settlement Engine (Φ1).
 * Body may include `methods[]` for multi-tender, or legacy single method/amount.
 */
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
    const raw = await request.json();

    const multiSchema = z.object({
      methods: z
        .array(
          z.object({
            paymentMethodId: z.string().min(1).optional().nullable(),
            method: z.string().trim().min(1).max(40).optional(),
            amount: z.coerce.number().positive().max(10_000_000),
            changeAmount: z.coerce.number().min(0).optional().default(0),
            externalRef: z.string().trim().max(120).optional().nullable(),
            note: z.string().trim().max(500).optional().nullable(),
          }),
        )
        .min(1)
        .max(20),
      note: z.string().trim().max(500).optional().nullable(),
    });

    let methods: Array<{
      paymentMethodId?: string | null;
      method?: string;
      amount: number;
      changeAmount: number;
      externalRef?: string | null;
    }>;
    let note: string | null = null;

    if (Array.isArray(raw?.methods) && raw.methods.length > 0) {
      const body = multiSchema.parse(raw);
      methods = body.methods.map((m) => ({
        paymentMethodId: m.paymentMethodId,
        method: m.method,
        amount: m.amount,
        changeAmount: m.changeAmount ?? 0,
        externalRef: m.externalRef,
      }));
      note = body.note ?? null;
    } else {
      const body = invoiceCollectSchema.parse(raw);
      methods = [
        {
          paymentMethodId: body.paymentMethodId,
          method: body.method,
          amount: body.amount,
          changeAmount: 0,
        },
      ];
      note = body.note ?? null;
    }

    const { settlement, journalId } = await createReceiptSettlement(prisma, {
      tenantId: session.tenantId,
      userId: session.sub,
      legalEntityId: session.legalEntityId,
      data: {
        invoiceId: id,
        notes: note,
        methods,
      },
    });

    const invoice = await prisma.invoice.findFirstOrThrow({
      where: { id, tenantId: session.tenantId },
      select: {
        id: true,
        number: true,
        status: true,
        paidAmount: true,
        total: true,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "invoice.collect",
      entity: "invoice",
      entityId: invoice.id,
      meta: {
        settlementId: settlement.id,
        settlementNumber: settlement.number,
        amount: toNumber(settlement.totalAmount),
        methods: methods.map((m) => m.method || m.paymentMethodId || ""),
        journalId,
      },
    });

    return NextResponse.json({
      item: {
        id: invoice.id,
        number: invoice.number,
        status: invoice.status,
        paidAmount: toNumber(invoice.paidAmount),
        total: toNumber(invoice.total),
        balance: roundMoney(
          toNumber(invoice.total) - toNumber(invoice.paidAmount),
        ),
        journalId,
        settlementId: settlement.id,
        settlementNumber: settlement.number,
      },
    });
  } catch (error) {
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
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
