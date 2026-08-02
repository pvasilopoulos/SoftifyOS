import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  createClearingSettlementSchema,
  createPaymentSettlementSchema,
  createReceiptSettlementSchema,
} from "@/modules/settlements/schemas";
import {
  createClearingSettlement,
  createPaymentSettlement,
  createReceiptSettlement,
  listPendingClearing,
  listSettlements,
  serializeSettlement,
  SettlementError,
} from "@/modules/settlements/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (request.nextUrl.searchParams.get("pendingClearing") === "1") {
      const pending = await listPendingClearing(prisma, session.tenantId, {
        legalEntityId: session.legalEntityId,
      });
      return NextResponse.json({ items: pending });
    }
    const kind = request.nextUrl.searchParams.get("kind") as
      | "RECEIPT"
      | "PAYMENT"
      | "CLEARING"
      | null;
    const rows = await listSettlements(prisma, session.tenantId, {
      kind: kind || undefined,
      legalEntityId: session.legalEntityId,
    });
    return NextResponse.json({ items: rows.map(serializeSettlement) });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
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

    const raw = await request.json();
    const kind =
      raw?.kind === "PAYMENT"
        ? "PAYMENT"
        : raw?.kind === "CLEARING"
          ? "CLEARING"
          : "RECEIPT";

    if (kind === "CLEARING") {
      const body = createClearingSettlementSchema.parse(raw);
      const { settlement, journalId } = await createClearingSettlement(prisma, {
        tenantId: session.tenantId,
        userId: session.sub,
        legalEntityId: session.legalEntityId,
        data: body,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "settlement.clearing.create",
        entity: "settlement",
        entityId: settlement.id,
        meta: { number: settlement.number, journalId },
      });
      const item = await prisma.settlement.findFirstOrThrow({
        where: { id: settlement.id },
        include: {
          customer: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, code: true } },
          allocations: true,
          methods: true,
        },
      });
      return NextResponse.json(
        { item: serializeSettlement(item), journalId },
        { status: 201 },
      );
    }

    if (kind === "PAYMENT") {
      const body = createPaymentSettlementSchema.parse(raw);
      const { settlement, journalId } = await createPaymentSettlement(prisma, {
        tenantId: session.tenantId,
        userId: session.sub,
        legalEntityId: session.legalEntityId,
        data: body,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "settlement.payment.create",
        entity: "settlement",
        entityId: settlement.id,
        meta: { number: settlement.number, journalId },
      });
      const item = await prisma.settlement.findFirstOrThrow({
        where: { id: settlement.id },
        include: {
          customer: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true, code: true } },
          allocations: true,
          methods: true,
        },
      });
      return NextResponse.json(
        { item: serializeSettlement(item), journalId },
        { status: 201 },
      );
    }

    const body = createReceiptSettlementSchema.parse(raw);
    const { settlement, journalId } = await createReceiptSettlement(prisma, {
      tenantId: session.tenantId,
      userId: session.sub,
      legalEntityId: session.legalEntityId,
      data: body,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "settlement.receipt.create",
      entity: "settlement",
      entityId: settlement.id,
      meta: { number: settlement.number, journalId },
    });
    const item = await prisma.settlement.findFirstOrThrow({
      where: { id: settlement.id },
      include: {
        customer: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true, code: true } },
        allocations: true,
        methods: true,
      },
    });
    return NextResponse.json(
      { item: serializeSettlement(item), journalId },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SettlementError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα εξόφλησης" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Settlement failed") },
      { status: 400 },
    );
  }
}
