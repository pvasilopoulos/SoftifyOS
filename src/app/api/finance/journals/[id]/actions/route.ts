import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  LedgerError,
  postJournal,
  reverseJournal,
  voidJournal,
} from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["post", "void", "reverse"]),
  description: z.string().trim().max(300).nullable().optional(),
});

export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;
    const body = bodySchema.parse(await request.json());

    let item;
    if (body.action === "post") {
      item = await postJournal(prisma, session.tenantId, id);
    } else if (body.action === "void") {
      item = await voidJournal(prisma, session.tenantId, id);
    } else {
      item = await reverseJournal(prisma, {
        tenantId: session.tenantId,
        journalId: id,
        createdByUserId: session.sub,
        description: body.description,
      });
    }

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: `finance.journal.${body.action}`,
      entity: "journal_entry",
      entityId: item.id,
      meta: { number: item.number },
    });

    return NextResponse.json({
      item: {
        ...item,
        lines: item.lines.map((l) => ({
          ...l,
          debit: toNumber(l.debit),
          credit: toNumber(l.credit),
        })),
      },
    });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Action failed") },
      { status: 400 },
    );
  }
}
