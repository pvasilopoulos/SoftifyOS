import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { loadArRows } from "@/modules/finance/analytics";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = session.tenantId;
    const [overdue, lowStock, mydataFail, draftOrders, arRows] =
      await Promise.all([
        prisma.invoice.findMany({
          where: { tenantId, status: "OVERDUE" },
          orderBy: { dueAt: "asc" },
          take: 8,
          select: {
            id: true,
            number: true,
            total: true,
            paidAmount: true,
            customer: { select: { name: true } },
          },
        }),
        prisma.stockBalance.findMany({
          where: { tenantId, qtyOnHand: { lte: 5 } },
          take: 8,
          orderBy: { qtyOnHand: "asc" },
          include: {
            product: { select: { sku: true, name: true } },
            site: { select: { code: true } },
          },
        }),
        prisma.myDataSubmission.findMany({
          where: { tenantId, status: { in: ["REJECTED", "PENDING"] } },
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true,
            status: true,
            entityNumber: true,
            errorMessage: true,
            entityType: true,
          },
        }),
        prisma.order.count({
          where: {
            tenantId,
            kind: "SALES_ORDER",
            status: "DRAFT",
          },
        }),
        loadArRows(prisma, tenantId),
      ]);

    const overdueTotal = arRows
      .filter((r) => r.bucket !== "current" && r.balance > 0)
      .reduce((s, r) => s + r.balance, 0);

    const items = [
      ...overdue.map((inv) => ({
        id: `overdue:${inv.id}`,
        tone: "rose" as const,
        title: `Ληξιπρόθεσμο ${inv.number}`,
        body: `${inv.customer.name} · υπόλοιπο ${(toNumber(inv.total) - toNumber(inv.paidAmount)).toLocaleString("el-GR")} €`,
        href: `/invoices/${inv.id}`,
        createdAt: new Date().toISOString(),
      })),
      ...lowStock.map((s) => ({
        id: `stock:${s.id}`,
        tone: "amber" as const,
        title: `Χαμηλό στοκ ${s.product.sku}`,
        body: `${s.product.name} · ${s.site.code} · ${toNumber(s.qtyOnHand)}`,
        href: `/inventory`,
        createdAt: new Date().toISOString(),
      })),
      ...mydataFail.map((m) => ({
        id: `mydata:${m.id}`,
        tone: (m.status === "REJECTED" ? "rose" : "amber") as "rose" | "amber",
        title: `myDATA ${m.status}`,
        body: `${m.entityNumber || m.entityType}${m.errorMessage ? ` · ${m.errorMessage}` : ""}`,
        href: `/finance`,
        createdAt: new Date().toISOString(),
      })),
    ];

    if (draftOrders > 0) {
      items.unshift({
        id: "draft-orders",
        tone: "amber" as const,
        title: `${draftOrders} πρόχειρες παραγγελίες`,
        body: "Χρειάζονται επιβεβαίωση ή έκδοση",
        href: "/orders",
        createdAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      items: items.slice(0, 20),
      summary: {
        count: items.length,
        overdueTotal,
        lowStock: lowStock.length,
        mydata: mydataFail.length,
        draftOrders,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Notifications failed") },
      { status: 500 },
    );
  }
}
