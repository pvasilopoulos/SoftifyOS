import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  loadAccountCard,
  loadBalanceSheet,
  loadConsolidationTrialBalance,
  loadProfitAndLoss,
  loadTrialBalance,
} from "@/modules/ledger/reports";
import { loadCostCenterReport } from "@/modules/ledger/controlling";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") ?? "trial-balance";
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const accountId = url.searchParams.get("accountId");
    const legalEntityId = url.searchParams.get("legalEntityId");
    const opts = {
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      legalEntityId: legalEntityId || null,
    };

    if (kind === "trial-balance") {
      return NextResponse.json({
        kind,
        rows: await loadTrialBalance(prisma, session.tenantId, opts),
      });
    }
    if (kind === "pnl") {
      return NextResponse.json({
        kind,
        ...(await loadProfitAndLoss(prisma, session.tenantId, opts)),
      });
    }
    if (kind === "balance-sheet") {
      return NextResponse.json({
        kind,
        ...(await loadBalanceSheet(prisma, session.tenantId, {
          asOf: opts.to,
          legalEntityId: opts.legalEntityId,
        })),
      });
    }
    if (kind === "account-card") {
      if (!accountId) {
        return NextResponse.json(
          { error: "accountId required" },
          { status: 400 },
        );
      }
      const card = await loadAccountCard(
        prisma,
        session.tenantId,
        accountId,
        opts,
      );
      if (!card) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      return NextResponse.json({ kind, ...card });
    }
    if (kind === "cost-centers") {
      return NextResponse.json({
        kind,
        rows: await loadCostCenterReport(prisma, session.tenantId, opts),
      });
    }
    if (kind === "consolidation") {
      return NextResponse.json({
        kind,
        ...(await loadConsolidationTrialBalance(
          prisma,
          session.tenantId,
          opts,
        )),
      });
    }
    return NextResponse.json({ error: "Unknown report kind" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Report failed") },
      { status: 500 },
    );
  }
}
