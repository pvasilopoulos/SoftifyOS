import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { postOpeningBalances } from "@/modules/ledger/greek-books";
import { LedgerError } from "@/modules/ledger/service";

export const dynamic = "force-dynamic";

const lineSchema = z.object({
  glAccountCode: z.string().trim().min(1).max(40),
  debit: z.coerce.number().min(0).max(50_000_000).optional().default(0),
  credit: z.coerce.number().min(0).max(50_000_000).optional().default(0),
  memo: z.string().trim().max(200).optional().nullable(),
});

const schema = z.object({
  entryDate: z.string().datetime().optional().nullable(),
  description: z.string().trim().max(200).optional().nullable(),
  legalEntityId: z.string().min(1).optional().nullable(),
  lines: z.array(lineSchema).min(2).max(200),
});

/** Φ5 — Wizard υπολοίπων έναρξης */
export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = schema.parse(await request.json());
    const journal = await postOpeningBalances(prisma, {
      tenantId: session.tenantId,
      legalEntityId: body.legalEntityId ?? session.legalEntityId,
      entryDate: body.entryDate ? new Date(body.entryDate) : null,
      description: body.description,
      userId: session.sub,
      lines: body.lines,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "opening.wizard",
      entity: "journal_entry",
      entityId: journal.id,
      meta: { number: journal.number, lines: body.lines.length },
    });

    return NextResponse.json(
      {
        item: {
          id: journal.id,
          number: journal.number,
          status: journal.status,
          isOpening: journal.isOpening,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Opening balances failed") },
      { status: 400 },
    );
  }
}
