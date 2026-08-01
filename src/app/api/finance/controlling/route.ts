import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  costAllocationSchema,
  intercompanyMatchSchema,
  parallelLedgerSchema,
} from "@/modules/ledger/schemas";
import {
  createAndPostCostAllocation,
  createIntercompanyMatch,
  listCostAllocations,
  listIntercompanyMatches,
  listParallelLedgers,
  upsertParallelLedger,
} from "@/modules/ledger/controlling";
import { LedgerError } from "@/modules/ledger/service";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const kind = new URL(request.url).searchParams.get("kind") ?? "all";
    if (kind === "allocations") {
      const items = await listCostAllocations(prisma, session.tenantId);
      return NextResponse.json({
        items: items.map((a) => ({
          ...a,
          amount: toNumber(a.amount),
          targets: a.targets.map((t) => ({
            ...t,
            weight: toNumber(t.weight),
            amount: toNumber(t.amount),
          })),
        })),
      });
    }
    if (kind === "intercompany") {
      const items = await listIntercompanyMatches(prisma, session.tenantId);
      return NextResponse.json({
        items: items.map((m) => ({
          ...m,
          amount: toNumber(m.amount),
          difference: toNumber(m.difference),
        })),
      });
    }
    if (kind === "ledgers") {
      return NextResponse.json({
        items: await listParallelLedgers(prisma, session.tenantId),
      });
    }
    const [allocations, intercompany, ledgers] = await Promise.all([
      listCostAllocations(prisma, session.tenantId),
      listIntercompanyMatches(prisma, session.tenantId),
      listParallelLedgers(prisma, session.tenantId),
    ]);
    return NextResponse.json({
      allocations: allocations.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        method: a.method,
        amount: toNumber(a.amount),
        status: a.status,
        sourceCostCenter: a.sourceCostCenter,
        glAccount: a.glAccount,
        journalEntry: a.journalEntry,
      })),
      intercompany: intercompany.map((m) => ({
        id: m.id,
        code: m.code,
        amount: toNumber(m.amount),
        difference: toNumber(m.difference),
        status: m.status,
        legalEntityA: m.legalEntityA,
        legalEntityB: m.legalEntityB,
        journalEntry: m.journalEntry,
      })),
      ledgers,
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
    const body = await request.json();
    const op = String(body.op || body.kind || "");

    if (op === "allocation") {
      const parsed = costAllocationSchema.parse(body);
      const item = await createAndPostCostAllocation(prisma, {
        tenantId: session.tenantId,
        ...parsed,
        userId: session.sub,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "finance.cost-allocation",
        entity: "cost_allocation",
        entityId: item.id,
        meta: { code: item.code, amount: toNumber(item.amount) },
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    if (op === "intercompany") {
      const parsed = intercompanyMatchSchema.parse(body);
      const item = await createIntercompanyMatch(prisma, {
        tenantId: session.tenantId,
        ...parsed,
        userId: session.sub,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "finance.intercompany-match",
        entity: "intercompany_match",
        entityId: item.id,
        meta: { code: item.code, status: item.status },
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    if (op === "ledger") {
      const parsed = parallelLedgerSchema.parse(body);
      const item = await upsertParallelLedger(prisma, {
        tenantId: session.tenantId,
        ...parsed,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "finance.parallel-ledger",
        entity: "parallel_ledger",
        entityId: item.id,
        meta: { code: item.code },
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
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
