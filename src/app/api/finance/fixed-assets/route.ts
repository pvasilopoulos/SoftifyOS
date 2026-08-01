import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { fixedAssetCreateSchema } from "@/modules/ledger/schemas";
import {
  createFixedAsset,
  listFixedAssets,
  postMonthlyDepreciation,
} from "@/modules/ledger/assets";
import { ensureChartOfAccounts, LedgerError } from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await ensureChartOfAccounts(prisma, session.tenantId);
    const items = await listFixedAssets(prisma, session.tenantId);
    return NextResponse.json({
      items: items.map((a) => ({
        ...a,
        acquisitionCost: toNumber(a.acquisitionCost),
        residualValue: toNumber(a.residualValue),
        movements: a.movements.map((m) => ({
          ...m,
          amount: toNumber(m.amount),
        })),
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
    const raw = await request.json();
    if (raw?.action === "depreciate") {
      const fixedAssetId = String(raw.fixedAssetId || "");
      const result = await postMonthlyDepreciation(prisma, {
        tenantId: session.tenantId,
        fixedAssetId,
        userId: session.sub,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "finance.fixed_asset.depreciate",
        entity: "fixed_asset",
        entityId: fixedAssetId,
        meta: { amount: result.amount },
      });
      return NextResponse.json({ amount: result.amount, journalId: result.journal.id });
    }

    const body = fixedAssetCreateSchema.parse(raw);
    const { asset, journalId } = await createFixedAsset(prisma, {
      tenantId: session.tenantId,
      ...body,
      userId: session.sub,
    });
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "finance.fixed_asset.create",
      entity: "fixed_asset",
      entityId: asset.id,
      meta: { code: asset.code, journalId },
    });
    return NextResponse.json(
      {
        item: {
          ...asset,
          acquisitionCost: toNumber(asset.acquisitionCost),
          residualValue: toNumber(asset.residualValue),
        },
        journalId,
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
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}
