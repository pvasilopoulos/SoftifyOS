import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";
import { customerUpdateSchema } from "@/modules/master-data/schemas";
import { mergeCustomFields } from "@/modules/entity-views/service";
import {
  CUSTOMER_PATCHABLE_KEYS,
  prismaCustomerDataFromPatched,
  serializeCustomer,
} from "@/modules/customers/payload";

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
    const customer = await prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
      include: {
        contacts: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
        },
        branches: {
          orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
          include: {
            spaces: { orderBy: [{ type: "asc" }, { name: "asc" }] },
            _count: { select: { spaces: true } },
          },
        },
      },
    });

    if (!customer) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const { contacts, branches, ...rest } = customer;

    return NextResponse.json({
      item: {
        ...serializeCustomer({ ...rest } as Record<string, unknown>),
        customFields:
          customer.customFields && typeof customer.customFields === "object"
            ? customer.customFields
            : {},
        contacts,
        branches: branches.map((b) => ({
          ...b,
          spaces: b.spaces.map((s) => ({
            ...s,
            areaSqm: s.areaSqm == null ? null : Number(s.areaSqm),
          })),
          spaceCount: b._count.spaces,
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
    const existing = await prisma.customer.findFirst({
      where: { id, tenantId: session.tenantId },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const body = customerUpdateSchema.parse(await request.json());
    const {
      applyRecordPatch,
      dispatchScriptEvent,
    } = await import("@/modules/scripts/service");

    let customFields: Prisma.InputJsonValue | undefined;
    if (body.customFields !== undefined) {
      customFields = await mergeCustomFields(
        prisma,
        session.tenantId,
        "CUSTOMERS",
        existing.customFields,
        body.customFields,
      );
    }

    const previous = {
      id: existing.id,
      ...serializeCustomer({ ...existing } as Record<string, unknown>),
      customFields: existing.customFields,
    };

    const draftRecord: Record<string, unknown> = {
      ...previous,
      ...Object.fromEntries(
        Object.entries(body).filter(([, v]) => v !== undefined),
      ),
      ...(customFields !== undefined ? { customFields } : {}),
    };

    const before = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "CUSTOMERS",
      eventKey: "before.update",
      record: draftRecord,
      previous: previous as Record<string, unknown>,
      user: {
        id: session.sub,
        role: session.role,
        email: session.email,
        name: session.name,
      },
    });
    if (before.failed) {
      return NextResponse.json(
        { error: before.failed.message, script: before.failed.scriptCode },
        { status: 400 },
      );
    }

    const patched = applyRecordPatch(
      draftRecord,
      before.record,
      [...CUSTOMER_PATCHABLE_KEYS],
    );

    if (
      body.customFields !== undefined ||
      patched.customFields !== draftRecord.customFields
    ) {
      customFields = await mergeCustomFields(
        prisma,
        session.tenantId,
        "CUSTOMERS",
        existing.customFields,
        (patched.customFields as Record<string, unknown>) ?? {},
      );
    }

    const data = prismaCustomerDataFromPatched(patched);
    const customer = await prisma.customer.update({
      where: { id },
      data: {
        ...data,
        ...(customFields !== undefined ? { customFields } : {}),
      } as Parameters<typeof prisma.customer.update>[0]["data"],
    });

    const afterRecord = {
      id: customer.id,
      ...serializeCustomer({ ...customer } as Record<string, unknown>),
      customFields: customer.customFields,
    };

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.update",
      entity: "customer",
      entityId: customer.id,
      meta: buildChangeMeta({
        before: previous as Record<string, unknown>,
        after: afterRecord as Record<string, unknown>,
        extra: { code: customer.code },
      }),
    });

    const after = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "CUSTOMERS",
      eventKey: "after.update",
      record: afterRecord as Record<string, unknown>,
      previous: previous as Record<string, unknown>,
      user: {
        id: session.sub,
        role: session.role,
        email: session.email,
        name: session.name,
      },
    });
    if (after.failed) {
      return NextResponse.json({
        item: serializeCustomer({ ...customer } as Record<string, unknown>),
        warning: after.failed.message,
        script: after.failed.scriptCode,
      });
    }

    return NextResponse.json({
      item: serializeCustomer({ ...customer } as Record<string, unknown>),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return NextResponse.json(
        { error: "Ο κωδικός πελάτη υπάρχει ήδη" },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
