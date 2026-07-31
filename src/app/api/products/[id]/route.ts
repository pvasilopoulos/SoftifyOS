import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { productUpdateSchema } from "@/modules/master-data/schemas";
import {
  resolveProductUnit,
  UnitOfMeasureError,
} from "@/modules/units/service";

export const dynamic = "force-dynamic";

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
    const product = await prisma.product.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        unitOfMeasure: {
          select: { id: true, code: true, name: true, symbol: true },
        },
      },
    });

    if (!product) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const balances = await prisma.stockBalance.findMany({
      where: { tenantId: session.tenantId, productId: id },
      include: { site: { select: { id: true, code: true, name: true } } },
      orderBy: { site: { name: "asc" } },
    });

    return NextResponse.json({
      item: {
        ...product,
        vatRate: toNumber(product.vatRate),
        price: toNumber(product.price),
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
        stock: balances.map((b) => ({
          siteId: b.siteId,
          siteCode: b.site.code,
          siteName: b.site.name,
          qtyOnHand: toNumber(b.qtyOnHand),
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
    const existing = await prisma.product.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = productUpdateSchema.parse(await request.json());
    const {
      applyRecordPatch,
      dispatchScriptEvent,
    } = await import("@/modules/scripts/service");
    const { scriptActorFromSession } = await import("@/modules/scripts/actor");
    const { normalizeCustomFieldsInput } = await import(
      "@/modules/entity-views/service"
    );

    let unitSymbol = existing.unit;
    let unitId = existing.unitId;
    if (body.unitId !== undefined || body.unit !== undefined) {
      const unit = await resolveProductUnit(prisma, {
        tenantId: session.tenantId,
        unitId: body.unitId ?? existing.unitId,
        unit: body.unit ?? existing.unit,
      });
      unitSymbol = unit.symbol;
      unitId = unit.id;
    }

    let customFields = existing.customFields;
    if (body.customFields !== undefined) {
      customFields = await normalizeCustomFieldsInput(
        prisma,
        session.tenantId,
        "PRODUCTS",
        body.customFields,
      );
    }

    const previous: Record<string, unknown> = {
      id: existing.id,
      sku: existing.sku,
      barcode: existing.barcode,
      name: existing.name,
      unit: existing.unit,
      unitId: existing.unitId,
      vatRate: toNumber(existing.vatRate),
      price: toNumber(existing.price),
      notes: existing.notes,
      status: existing.status,
      trackInventory: existing.trackInventory,
      customFields: existing.customFields,
    };

    const draftRecord: Record<string, unknown> = {
      ...previous,
      ...(body.sku !== undefined ? { sku: body.sku } : {}),
      ...(body.barcode !== undefined ? { barcode: body.barcode } : {}),
      ...(body.name !== undefined ? { name: body.name } : {}),
      unit: unitSymbol,
      unitId,
      ...(body.vatRate !== undefined ? { vatRate: body.vatRate } : {}),
      ...(body.price !== undefined ? { price: body.price } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.trackInventory !== undefined
        ? { trackInventory: body.trackInventory }
        : {}),
      customFields,
    };

    const before = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "PRODUCTS",
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
      "sku",
      "barcode",
      "name",
      "unit",
      "unitId",
      "vatRate",
      "price",
      "notes",
      "status",
      "trackInventory",
      "customFields",
    ]);

    const updated = await prisma.product.update({
      where: { id },
      data: {
        sku: String(patched.sku ?? existing.sku),
        barcode:
          patched.barcode === undefined
            ? existing.barcode
            : patched.barcode
              ? String(patched.barcode)
              : null,
        name: String(patched.name ?? existing.name),
        unit: String(patched.unit ?? unitSymbol),
        unitId:
          typeof patched.unitId === "string" ? patched.unitId : unitId,
        vatRate: new Prisma.Decimal(
          Number(patched.vatRate ?? toNumber(existing.vatRate)),
        ),
        price: new Prisma.Decimal(
          Number(patched.price ?? toNumber(existing.price)),
        ),
        notes:
          patched.notes === undefined
            ? existing.notes
            : patched.notes
              ? String(patched.notes)
              : null,
        status:
          patched.status === "INACTIVE" || patched.status === "ACTIVE"
            ? patched.status
            : existing.status,
        trackInventory:
          typeof patched.trackInventory === "boolean"
            ? patched.trackInventory
            : existing.trackInventory,
        customFields:
          (patched.customFields as Prisma.InputJsonValue) ??
          (existing.customFields as Prisma.InputJsonValue) ??
          Prisma.JsonNull,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "product.update",
      entity: "product",
      entityId: updated.id,
      meta: { sku: updated.sku },
    });

    await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "PRODUCTS",
      eventKey: "after.update",
      record: {
        id: updated.id,
        sku: updated.sku,
        name: updated.name,
        status: updated.status,
      },
      previous,
      user: scriptActorFromSession(session),
    });

    return NextResponse.json({
      item: {
        ...updated,
        vatRate: toNumber(updated.vatRate),
        price: toNumber(updated.price),
        createdAt: updated.createdAt.toISOString(),
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof UnitOfMeasureError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Το SKU ή barcode υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
