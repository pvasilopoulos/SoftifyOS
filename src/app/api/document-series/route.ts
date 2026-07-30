import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { documentKindSchema, seriesCreateSchema } from "@/modules/documents/schemas";
import { previewNextNumber } from "@/modules/documents/series";

export const dynamic = "force-dynamic";

const listSchema = z.object({
  kind: documentKindSchema.optional(),
  siteId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const parsed = listSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const items = await prisma.documentSeries.findMany({
      where: {
        tenantId: session.tenantId,
        kind: parsed.data.kind,
        siteId: parsed.data.siteId,
      },
      orderBy: [{ kind: "asc" }, { code: "asc" }],
      include: { site: { select: { id: true, code: true, name: true, kind: true } } },
    });

    return NextResponse.json({
      items: items.map((s) => ({
        ...s,
        previewNumber: previewNextNumber(s),
      })),
    });
  } catch (error) {
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
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = seriesCreateSchema.parse(await request.json());
    if (body.siteId) {
      const site = await prisma.site.findFirst({
        where: { id: body.siteId, tenantId: session.tenantId },
      });
      if (!site) {
        return NextResponse.json({ error: "Μη έγκυρο site" }, { status: 400 });
      }
    }

    const item = await prisma.$transaction(async (tx) => {
      if (body.isDefault) {
        await tx.documentSeries.updateMany({
          where: {
            tenantId: session.tenantId,
            kind: body.kind,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }
      return tx.documentSeries.create({
        data: {
          tenantId: session.tenantId,
          code: body.code,
          name: body.name,
          kind: body.kind,
          prefix: body.prefix,
          padLength: body.padLength ?? 5,
          nextNumber: body.nextNumber ?? 1,
          lastYear: new Date().getFullYear(),
          resetPolicy: body.resetPolicy ?? "YEARLY",
          siteId: body.siteId || null,
          affectsCustomer: body.affectsCustomer ?? "NONE",
          affectsInventory: body.affectsInventory ?? "NONE",
          allowPartial: body.allowPartial ?? false,
          editableAfterIssue: body.editableAfterIssue ?? false,
          myDataEnabled: body.myDataEnabled ?? false,
          myDataInvoiceType: body.myDataInvoiceType || null,
          myDataVatCategory: body.myDataVatCategory || null,
          glDebitAccount: body.glDebitAccount || null,
          glCreditAccount: body.glCreditAccount || null,
          glVatAccount: body.glVatAccount || null,
          isDefault: body.isDefault ?? false,
          isActive: body.isActive ?? true,
        },
      });
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "series.create",
      entity: "document_series",
      entityId: item.id,
      meta: { code: item.code, kind: item.kind },
    });

    return NextResponse.json(
      { item: { ...item, previewNumber: previewNextNumber(item) } },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json({ error: "Ο κωδικός σειράς υπάρχει ήδη" }, { status: 409 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
