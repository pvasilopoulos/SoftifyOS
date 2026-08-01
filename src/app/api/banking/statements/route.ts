import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const importSchema = z.object({
  bankAccountId: z.string().trim().min(1),
  lines: z
    .array(
      z.object({
        bookedAt: z.string().min(8),
        amount: z.coerce.number(),
        description: z.string().trim().min(1).max(300),
        reference: z.string().trim().max(120).optional().nullable(),
        counterparty: z.string().trim().max(200).optional().nullable(),
      }),
    )
    .min(1)
    .max(500),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const status = new URL(request.url).searchParams.get("status");
    const items = await prisma.bankStatementLine.findMany({
      where: {
        tenantId: session.tenantId,
        ...(status ? { status: status as "UNMATCHED" | "MATCHED" | "IGNORED" } : {}),
      },
      orderBy: { bookedAt: "desc" },
      take: 200,
      include: {
        bankAccount: { select: { code: true, name: true } },
      },
    });
    return NextResponse.json({
      items: items.map((l) => ({
        id: l.id,
        bookedAt: l.bookedAt.toISOString(),
        amount: toNumber(l.amount),
        description: l.description,
        reference: l.reference,
        counterparty: l.counterparty,
        status: l.status,
        matchedInvoiceId: l.matchedInvoiceId,
        bankAccount: l.bankAccount,
      })),
    });
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
    const body = importSchema.parse(await request.json());
    const account = await prisma.bankAccount.findFirst({
      where: { id: body.bankAccountId, tenantId: session.tenantId },
    });
    if (!account) {
      return NextResponse.json({ error: "Λογαριασμός δεν βρέθηκε" }, { status: 404 });
    }

    const created = await prisma.$transaction(
      body.lines.map((line) =>
        prisma.bankStatementLine.create({
          data: {
            tenantId: session.tenantId,
            bankAccountId: account.id,
            bookedAt: new Date(line.bookedAt),
            amount: line.amount,
            description: line.description,
            reference: line.reference || null,
            counterparty: line.counterparty || null,
          },
        }),
      ),
    );

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "banking.import",
      entity: "bank_account",
      entityId: account.id,
      meta: { lines: created.length },
    });

    return NextResponse.json({ imported: created.length }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Import failed") },
      { status: 400 },
    );
  }
}
