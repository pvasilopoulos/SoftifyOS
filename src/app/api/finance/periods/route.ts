import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { periodActionSchema } from "@/modules/ledger/schemas";
import {
  closeFiscalPeriod,
  listFiscalPeriods,
  reopenFiscalPeriod,
} from "@/modules/ledger/periods";
import { LedgerError } from "@/modules/ledger/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const year = url.searchParams.get("year");
    const kind = url.searchParams.get("kind") as "YEAR" | "MONTH" | null;
    const items = await listFiscalPeriods(prisma, session.tenantId, {
      year: year ? Number(year) : undefined,
      kind: kind ?? undefined,
    });
    return NextResponse.json({ items });
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
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = periodActionSchema.parse(await request.json());
    const item =
      body.action === "close"
        ? await closeFiscalPeriod(prisma, {
            tenantId: session.tenantId,
            periodId: body.periodId,
            userId: session.sub,
          })
        : await reopenFiscalPeriod(prisma, {
            tenantId: session.tenantId,
            periodId: body.periodId,
          });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: `finance.period.${body.action}`,
      entity: "fiscal_period",
      entityId: item.id,
      meta: { code: item.code },
    });

    return NextResponse.json({ item });
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
