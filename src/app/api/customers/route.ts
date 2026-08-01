import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import {
  decodeCursor,
  encodeCursor,
  listQuerySchema,
} from "@/shared/lib/cursor";
import { customerCreateSchema } from "@/modules/master-data/schemas";
import {
  CUSTOMER_PATCHABLE_KEYS,
  prismaCustomerDataFromPatched,
  serializeCustomer,
} from "@/modules/customers/payload";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const customerListSchema = listQuerySchema.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

export async function GET(request: NextRequest) {
  const started = Date.now();
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = customerListSchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid query" }, { status: 400 });
    }

    const { limit, cursor: cursorParam, q, status } = parsed.data;
    const cursor = cursorParam ? decodeCursor(cursorParam) : null;
    if (cursorParam && !cursor) {
      return NextResponse.json({ error: "Invalid cursor" }, { status: 400 });
    }

    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        code: string;
        name: string;
        tradeName: string | null;
        legalForm: string | null;
        vatNumber: string | null;
        taxOffice: string | null;
        vatStatus: string;
        email: string | null;
        phone: string | null;
        mobile: string | null;
        address: string | null;
        city: string | null;
        postalCode: string | null;
        region: string | null;
        country: string;
        category: string | null;
        salesperson: string | null;
        paymentTermsDays: number | null;
        creditLimit: unknown;
        currency: string;
        isBlocked: boolean;
        status: string;
        createdAt: Date;
        branchCount: bigint;
        customFields: unknown;
      }>
    >`
      SELECT
        c.id, c.code, c.name, c."tradeName", c."legalForm"::text AS "legalForm",
        c."vatNumber", c."taxOffice", c."vatStatus"::text AS "vatStatus",
        c.email, c.phone, c.mobile, c.address, c.city, c."postalCode", c.region, c.country,
        c.category::text AS category, c.salesperson, c."paymentTermsDays",
        c."creditLimit", c.currency, c."isBlocked", c.status::text AS status,
        c."createdAt", c."customFields",
        (SELECT COUNT(*) FROM branches b WHERE b."customerId" = c.id AND b."tenantId" = c."tenantId") AS "branchCount"
      FROM customers c
      WHERE c."tenantId" = ${session.tenantId}
        ${status ? Prisma.sql`AND c.status = ${status}::"CustomerStatus"` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                c.name ILIKE ${"%" + q + "%"}
                OR c.code ILIKE ${"%" + q + "%"}
                OR COALESCE(c."tradeName", '') ILIKE ${"%" + q + "%"}
                OR COALESCE(c."vatNumber", '') ILIKE ${"%" + q + "%"}
                OR COALESCE(c."taxOffice", '') ILIKE ${"%" + q + "%"}
                OR COALESCE(c.city, '') ILIKE ${"%" + q + "%"}
                OR COALESCE(c.email, '') ILIKE ${"%" + q + "%"}
                OR COALESCE(c.phone, '') ILIKE ${"%" + q + "%"}
              )`
            : Prisma.empty
        }
        ${
          cursor
            ? Prisma.sql`AND (c."createdAt", c.id) < (${new Date(cursor.createdAt)}::timestamptz, ${cursor.id})`
            : Prisma.empty
        }
      ORDER BY c."createdAt" DESC, c.id DESC
      LIMIT ${limit + 1}
    `;

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
      ...serializeCustomer({ ...row } as Record<string, unknown>),
      id: row.id,
      branchCount: Number(row.branchCount),
      createdAt: row.createdAt.toISOString(),
      customFields:
        row.customFields && typeof row.customFields === "object"
          ? row.customFields
          : {},
    }));
    const last = items[items.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null;

    return NextResponse.json({
      items,
      nextCursor,
      meta: { ms: Date.now() - started, count: items.length, hasMore },
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
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = customerCreateSchema.parse(await request.json());
    const { normalizeCustomFieldsInput } = await import(
      "@/modules/entity-views/service"
    );
    const {
      applyRecordPatch,
      dispatchScriptEvent,
    } = await import("@/modules/scripts/service");

    let customFields = await normalizeCustomFieldsInput(
      prisma,
      session.tenantId,
      "CUSTOMERS",
      body.customFields,
    );

    const draftRecord: Record<string, unknown> = {
      ...body,
      vatNumber: body.vatNumber || null,
      email: body.email || null,
      phone: body.phone || null,
      notes: body.notes || null,
      status: body.status ?? "ACTIVE",
      country: body.country || "GR",
      currency: body.currency || "EUR",
      locale: body.locale || "el-GR",
      vatStatus: body.vatStatus || "NORMAL",
      isPerson: body.isPerson ?? false,
      isBlocked: body.isBlocked ?? false,
      sendEinvoice: body.sendEinvoice ?? false,
      customFields,
    };

    const before = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "CUSTOMERS",
      eventKey: "before.create",
      record: draftRecord,
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
      patched.customFields &&
      typeof patched.customFields === "object" &&
      !Array.isArray(patched.customFields)
    ) {
      customFields = await normalizeCustomFieldsInput(
        prisma,
        session.tenantId,
        "CUSTOMERS",
        patched.customFields as Record<string, unknown>,
      );
    }

    const data = prismaCustomerDataFromPatched(patched);
    const customer = await prisma.customer.create({
      data: {
        tenantId: session.tenantId,
        ...data,
        customFields,
      } as Parameters<typeof prisma.customer.create>[0]["data"],
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.create",
      entity: "customer",
      entityId: customer.id,
      meta: { code: customer.code },
    });

    const afterRecord = {
      id: customer.id,
      ...serializeCustomer({ ...customer } as Record<string, unknown>),
      customFields: customer.customFields,
    };
    const after = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "CUSTOMERS",
      eventKey: "after.create",
      record: afterRecord as Record<string, unknown>,
      user: {
        id: session.sub,
        role: session.role,
        email: session.email,
        name: session.name,
      },
    });
    if (after.failed) {
      return NextResponse.json(
        {
          item: serializeCustomer({ ...customer } as Record<string, unknown>),
          warning: after.failed.message,
          script: after.failed.scriptCode,
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      {
        item: serializeCustomer({ ...customer } as Record<string, unknown>),
      },
      { status: 201 },
    );
  } catch (error) {
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
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
