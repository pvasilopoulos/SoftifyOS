import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import {
  ensureChartOfAccounts,
  ensureCurrentFiscalYear,
} from "@/modules/ledger/service";
import { listFiscalPeriods } from "@/modules/ledger/periods";
import {
  ensureDefaultLegalEntity,
  ensureDefaultParallelLedger,
} from "@/modules/ledger/controlling";
import { toNumber } from "@/modules/sales/invoice-utils";
import {
  loadApRows,
  loadArRows,
  loadVatSummary,
} from "@/modules/finance/analytics";
import { readMyDataConfig } from "@/modules/mydata/payload";
import { FinanceHubClient } from "./finance-hub-client";

export const metadata = { title: "Οικονομικά" };
export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const session = await getSession();
  if (!session) redirect("/login");

  await ensureChartOfAccounts(prisma, session.tenantId);
  const period = await ensureCurrentFiscalYear(prisma, session.tenantId);
  await ensureDefaultLegalEntity(
    prisma,
    session.tenantId,
    session.tenantName,
  );
  await ensureDefaultParallelLedger(prisma, session.tenantId);

  const year = new Date().getFullYear();
  const vatFrom = new Date(`${year}-01-01T00:00:00.000Z`);
  const vatTo = new Date();

  const [
    journals,
    accountCount,
    arRows,
    apRows,
    vat,
    myData,
    periods,
    purchaseInvoices,
    settings,
    draftJournalCount,
    legalEntities,
  ] = await Promise.all([
    prisma.journalEntry.findMany({
      where: { tenantId: session.tenantId },
      orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }],
      take: 80,
      include: {
        lines: {
          include: { glAccount: { select: { code: true, name: true } } },
          orderBy: { lineNo: "asc" },
        },
      },
    }),
    prisma.glAccount.count({
      where: { tenantId: session.tenantId, isActive: true },
    }),
    loadArRows(prisma, session.tenantId),
    loadApRows(prisma, session.tenantId),
    loadVatSummary(prisma, session.tenantId, vatFrom, vatTo),
    prisma.myDataSubmission.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    listFiscalPeriods(prisma, session.tenantId, { year }),
    prisma.purchaseInvoice.findMany({
      where: { tenantId: session.tenantId },
      orderBy: { issueDate: "desc" },
      take: 40,
      include: { supplier: { select: { name: true } } },
    }),
    prisma.tenantSettings.findUnique({
      where: { tenantId: session.tenantId },
      select: { integrationsJson: true },
    }),
    prisma.journalEntry.count({
      where: { tenantId: session.tenantId, status: "DRAFT" },
    }),
    prisma.legalEntity.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, isDefault: true },
    }),
  ]);

  const myDataCfg = readMyDataConfig(settings?.integrationsJson);
  const now = Date.now();
  const cash7 = arRows
    .filter((r) => r.dueAt && new Date(r.dueAt).getTime() <= now + 7 * 86_400_000)
    .reduce((s, r) => s + r.balance, 0);
  const cash30 = arRows
    .filter(
      (r) => r.dueAt && new Date(r.dueAt).getTime() <= now + 30 * 86_400_000,
    )
    .reduce((s, r) => s + r.balance, 0);
  const overdueAr = arRows
    .filter((r) => r.bucket !== "current")
    .reduce((s, r) => s + r.balance, 0);
  const arTotal = arRows.reduce((s, r) => s + r.balance, 0);
  const apTotal = apRows.reduce((s, r) => s + r.total, 0);
  const pendingMyData = myData.filter((s) =>
    ["PENDING", "SENT", "REJECTED"].includes(s.status),
  ).length;

  return (
    <FinanceHubClient
      canWrite={session.role !== "VIEWER"}
      accountCount={accountCount}
      period={{ code: period.code, status: period.status }}
      periods={periods.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        kind: p.kind,
        year: p.year,
        month: p.month,
        status: p.status,
      }))}
      kpis={{
        cash7,
        cash30,
        overdueAr,
        arTotal,
        apTotal,
        vatPayable: vat.netVatPayable,
      }}
      journals={journals.map((j) => ({
        id: j.id,
        number: j.number,
        status: j.status,
        description: j.description,
        sourceType: j.sourceType,
        postedAt: j.postedAt?.toISOString() ?? null,
        entryDate: j.entryDate.toISOString(),
        createdAt: j.createdAt.toISOString(),
        lines: j.lines.map((l) => ({
          id: l.id,
          memo: l.memo,
          debit: toNumber(l.debit),
          credit: toNumber(l.credit),
          accountCode: l.glAccount.code,
          accountName: l.glAccount.name,
        })),
      }))}
      legalEntities={legalEntities}
      arRows={arRows}
      apRows={apRows}
      purchaseInvoices={purchaseInvoices.map((p) => ({
        id: p.id,
        number: p.number,
        status: p.status,
        total: toNumber(p.total),
        paidAmount: toNumber(p.paidAmount),
        supplierName: p.supplier.name,
        issueDate: p.issueDate.toISOString(),
      }))}
      vat={vat}
      myData={myData.map((s) => ({
        id: s.id,
        entityType: s.entityType,
        entityNumber: s.entityNumber,
        invoiceType: s.invoiceType,
        status: s.status,
        mark: s.mark,
        createdAt: s.createdAt.toISOString(),
      }))}
      myDataEnv={myDataCfg.myDataEnv}
      draftJournalCount={draftJournalCount}
      pendingMyData={pendingMyData}
    />
  );
}
