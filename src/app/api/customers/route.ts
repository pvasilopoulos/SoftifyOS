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
        vatNumber: string | null;
        email: string | null;
        phone: string | null;
        status: string;
        createdAt: Date;
        branchCount: bigint;
        customFields: unknown;
      }>
    >`
      SELECT
        c.id, c.code, c.name, c."vatNumber", c.email, c.phone, c.status, c."createdAt",
        c."customFields",
        (SELECT COUNT(*) FROM branches b WHERE b."customerId" = c.id AND b."tenantId" = c."tenantId") AS "branchCount"
      FROM customers c
      WHERE c."tenantId" = ${session.tenantId}
        ${status ? Prisma.sql`AND c.status = ${status}::"CustomerStatus"` : Prisma.empty}
        ${
          q
            ? Prisma.sql`AND (
                c.name ILIKE ${"%" + q + "%"}
                OR c.code ILIKE ${"%" + q + "%"}
                OR COALESCE(c."vatNumber", '') ILIKE ${"%" + q + "%"}
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
      ...row,
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
      code: body.code,
      name: body.name,
      vatNumber: body.vatNumber || null,
      email: body.email || null,
      phone: body.phone || null,
      notes: body.notes || null,
      status: body.status ?? "ACTIVE",
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

    const patched = applyRecordPatch(draftRecord, before.record, [
      "code",
      "name",
      "vatNumber",
      "email",
      "phone",
      "notes",
      "status",
      "customFields",
    ]);
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

    const customer = await prisma.customer.create({
      data: {
        tenantId: session.tenantId,
        code: String(patched.code),
        name: String(patched.name),
        vatNumber: (patched.vatNumber as string | null) || null,
        email: (patched.email as string | null) || null,
        phone: (patched.phone as string | null) || null,
        notes: (patched.notes as string | null) || null,
        status: (patched.status as "ACTIVE" | "INACTIVE") ?? "ACTIVE",
        customFields,
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "customer.create",
      entity: "customer",
      entityId: customer.id,
      meta: { code: customer.code },
    });

    const afterRecord: Record<string, unknown> = {
      id: customer.id,
      code: customer.code,
      name: customer.name,
      vatNumber: customer.vatNumber,
      email: customer.email,
      phone: customer.phone,
      notes: customer.notes,
      status: customer.status,
      customFields: customer.customFields,
    };
    const after = await dispatchScriptEvent(prisma, {
      tenantId: session.tenantId,
      module: "CUSTOMERS",
      eventKey: "after.create",
      record: afterRecord,
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
          item: customer,
          warning: after.failed.message,
          script: after.failed.scriptCode,
        },
        { status: 201 },
      );
    }

    return NextResponse.json({ item: customer }, { status: 201 });
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
