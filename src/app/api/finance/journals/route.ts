import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { journalCreateSchema } from "@/modules/ledger/schemas";
import {
  createJournal,
  ensureChartOfAccounts,
  LedgerError,
} from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

function serializeJournal(j: {
  lines: Array<{ debit: unknown; credit: unknown; [k: string]: unknown }>;
  [k: string]: unknown;
}) {
  return {
    ...j,
    lines: j.lines.map((l) => ({
      ...l,
      debit: toNumber(l.debit),
      credit: toNumber(l.credit),
    })),
  };
}

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureChartOfAccounts(prisma, session.tenantId);
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const items = await prisma.journalEntry.findMany({
      where: {
        tenantId: session.tenantId,
        ...(status ? { status: status as "DRAFT" | "POSTED" | "VOID" } : {}),
      },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: 150,
      include: {
        lines: {
          include: {
            glAccount: { select: { code: true, name: true } },
            costCenter: { select: { code: true, name: true } },
          },
          orderBy: { lineNo: "asc" },
        },
        fiscalPeriod: { select: { code: true, name: true } },
      },
    });
    return NextResponse.json({
      items: items.map(serializeJournal),
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

    const body = journalCreateSchema.parse(await request.json());
    const item = await createJournal(prisma, {
      tenantId: session.tenantId,
      description: body.description,
      createdByUserId: session.sub,
      entryDate: body.entryDate,
      isOpening: body.isOpening,
      post: body.post,
      lines: body.lines,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: body.post ? "finance.journal.post" : "finance.journal.draft",
      entity: "journal_entry",
      entityId: item.id,
      meta: { number: item.number, lines: item.lines.length, status: item.status },
    });

    return NextResponse.json({ item: serializeJournal(item) }, { status: 201 });
  } catch (error) {
    if (error instanceof LedgerError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Post failed") },
      { status: 400 },
    );
  }
}
