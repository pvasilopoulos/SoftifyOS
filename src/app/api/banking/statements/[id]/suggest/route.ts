import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { suggestBankMatches } from "@/modules/banking/suggest";

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
    const line = await prisma.bankStatementLine.findFirst({
      where: { id, tenantId: session.tenantId },
      include: { bankAccount: { select: { legalEntityId: true } } },
    });
    if (!line) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }

    const items = await suggestBankMatches(prisma, {
      tenantId: session.tenantId,
      amount: toNumber(line.amount),
      description: line.description,
      reference: line.reference,
      counterparty: line.counterparty,
      legalEntityId:
        session.legalEntityId ?? line.bankAccount.legalEntityId ?? null,
    });

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Suggest failed") },
      { status: 500 },
    );
  }
}
