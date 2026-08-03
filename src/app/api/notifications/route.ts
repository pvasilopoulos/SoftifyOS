import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";
import { loadApRows, loadArRows } from "@/modules/finance/analytics";

export const dynamic = "force-dynamic";

export type NotificationCategory =
  | "finance"
  | "inventory"
  | "sales"
  | "mydata"
  | "ops";

export type NotificationPriority = "critical" | "high" | "medium" | "low";

export type NotificationTone = "rose" | "amber" | "slate" | "teal";

function money(n: number) {
  return `${n.toLocaleString("el-GR", { maximumFractionDigits: 2 })} €`;
}

function iso(d: Date | string | null | undefined) {
  if (!d) return new Date().toISOString();
  return typeof d === "string" ? d : d.toISOString();
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const tenantId = session.tenantId;
    const [
      overdue,
      lowStock,
      mydataFail,
      draftOrders,
      draftInvoices,
      partialInvoices,
      arRows,
      apRows,
    ] = await Promise.all([
      prisma.invoice.findMany({
        where: { tenantId, status: "OVERDUE" },
        orderBy: { dueAt: "asc" },
        take: 12,
        select: {
          id: true,
          number: true,
          total: true,
          paidAmount: true,
          dueAt: true,
          issuedAt: true,
          customer: { select: { name: true, code: true } },
        },
      }),
      prisma.stockBalance.findMany({
        where: { tenantId, qtyOnHand: { lte: 5 } },
        take: 12,
        orderBy: { qtyOnHand: "asc" },
        include: {
          product: { select: { sku: true, name: true } },
          site: { select: { code: true, name: true } },
        },
      }),
      prisma.myDataSubmission.findMany({
        where: { tenantId, status: { in: ["REJECTED", "PENDING"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          status: true,
          entityNumber: true,
          errorMessage: true,
          entityType: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.order.count({
        where: { tenantId, kind: "SALES_ORDER", status: "DRAFT" },
      }),
      prisma.invoice.count({
        where: { tenantId, status: "DRAFT" },
      }),
      prisma.invoice.findMany({
        where: { tenantId, status: "PARTIAL" },
        orderBy: { updatedAt: "desc" },
        take: 8,
        select: {
          id: true,
          number: true,
          total: true,
          paidAmount: true,
          updatedAt: true,
          customer: { select: { name: true } },
        },
      }),
      loadArRows(prisma, tenantId),
      loadApRows(prisma, tenantId),
    ]);

    type Item = {
      id: string;
      category: NotificationCategory;
      priority: NotificationPriority;
      tone: NotificationTone;
      title: string;
      body: string;
      href: string;
      entityLabel?: string;
      amount?: number | null;
      meta?: Array<{ label: string; value: string }>;
      tags?: string[];
      actions: Array<{
        id: string;
        label: string;
        href: string;
        primary?: boolean;
      }>;
      createdAt: string;
    };

    const items: Item[] = [];

    const overduePastDue = arRows.filter(
      (r) => r.bucket !== "current" && r.balance > 0,
    );
    const overdueTotal = overduePastDue.reduce((s, r) => s + r.balance, 0);
    const ar90 = overduePastDue
      .filter((r) => r.bucket === "90+")
      .reduce((s, r) => s + r.balance, 0);

    if (overduePastDue.length > 0) {
      items.push({
        id: "summary:ar-aging",
        category: "finance",
        priority: ar90 > 0 ? "critical" : "high",
        tone: ar90 > 0 ? "rose" : "amber",
        title: `${overduePastDue.length} ληξιπρόθεσμες απαιτήσεις`,
        body: `Συνολικό υπόλοιπο ${money(overdueTotal)}${ar90 > 0 ? ` · εκ των οποίων ${money(ar90)} >90ημ` : ""}`,
        href: "/finance",
        amount: overdueTotal,
        tags: ["AR", "Aging"],
        meta: [
          { label: "Ανοιχτά", value: String(overduePastDue.length) },
          { label: "Υπόλοιπο", value: money(overdueTotal) },
          ...(ar90 > 0
            ? [{ label: ">90ημ", value: money(ar90) }]
            : []),
        ],
        actions: [
          { id: "open-finance", label: "Οικονομικά", href: "/finance", primary: true },
          { id: "ar-grid", label: "AR Grid", href: "/reports" },
        ],
        createdAt: new Date().toISOString(),
      });
    }

    for (const inv of overdue) {
      const balance = Math.round(
        (toNumber(inv.total) - toNumber(inv.paidAmount)) * 100,
      ) / 100;
      const days = inv.dueAt
        ? Math.max(
            0,
            Math.floor((Date.now() - inv.dueAt.getTime()) / 86_400_000),
          )
        : 0;
      items.push({
        id: `overdue:${inv.id}`,
        category: "finance",
        priority: days > 60 ? "critical" : days > 30 ? "high" : "medium",
        tone: "rose",
        title: `Ληξιπρόθεσμο ${inv.number}`,
        body: `${inv.customer.name} · υπόλοιπο ${money(balance)}`,
        href: `/invoices/${inv.id}`,
        entityLabel: inv.number,
        amount: balance,
        tags: ["OVERDUE", `${days}ημ`],
        meta: [
          { label: "Πελάτης", value: inv.customer.name },
          { label: "Κωδικός", value: inv.customer.code },
          { label: "Καθυστέρηση", value: `${days} ημέρες` },
          { label: "Υπόλοιπο", value: money(balance) },
        ],
        actions: [
          {
            id: "open",
            label: "Άνοιγμα",
            href: `/invoices/${inv.id}`,
            primary: true,
          },
          { id: "collect", label: "Είσπραξη", href: `/invoices/${inv.id}` },
        ],
        createdAt: iso(inv.dueAt ?? inv.issuedAt),
      });
    }

    for (const inv of partialInvoices) {
      const balance = Math.round(
        (toNumber(inv.total) - toNumber(inv.paidAmount)) * 100,
      ) / 100;
      if (balance <= 0.005) continue;
      items.push({
        id: `partial:${inv.id}`,
        category: "finance",
        priority: "medium",
        tone: "amber",
        title: `Μερική είσπραξη ${inv.number}`,
        body: `${inv.customer.name} · υπόλοιπο ${money(balance)}`,
        href: `/invoices/${inv.id}`,
        entityLabel: inv.number,
        amount: balance,
        tags: ["PARTIAL"],
        meta: [
          { label: "Πελάτης", value: inv.customer.name },
          { label: "Υπόλοιπο", value: money(balance) },
        ],
        actions: [
          {
            id: "open",
            label: "Άνοιγμα",
            href: `/invoices/${inv.id}`,
            primary: true,
          },
        ],
        createdAt: iso(inv.updatedAt),
      });
    }

    const apTotal = apRows.reduce((s, r) => s + r.balance, 0);
    if (apRows.length > 0) {
      items.push({
        id: "summary:ap-open",
        category: "ops",
        priority: apTotal > 10000 ? "high" : "medium",
        tone: "slate",
        title: `${apRows.length} ανοιχτά τιμολόγια αγοράς`,
        body: `Υπόλοιπο προς πληρωμή ${money(apTotal)}`,
        href: "/finance",
        amount: apTotal,
        tags: ["AP", "PI"],
        meta: [
          { label: "Τιμ.", value: String(apRows.length) },
          { label: "Υπόλοιπο", value: money(apTotal) },
        ],
        actions: [
          {
            id: "open-ap",
            label: "Υποχρεώσεις",
            href: "/finance",
            primary: true,
          },
        ],
        createdAt: new Date().toISOString(),
      });
    }

    for (const s of lowStock) {
      const qty = toNumber(s.qtyOnHand);
      items.push({
        id: `stock:${s.id}`,
        category: "inventory",
        priority: qty <= 0 ? "critical" : qty <= 2 ? "high" : "medium",
        tone: qty <= 0 ? "rose" : "amber",
        title: `Χαμηλό στοκ ${s.product.sku}`,
        body: `${s.product.name} · ${s.site.code} · ${qty}`,
        href: "/inventory",
        entityLabel: s.product.sku,
        tags: ["STOCK", s.site.code],
        meta: [
          { label: "Είδος", value: s.product.name },
          { label: "Site", value: `${s.site.code} · ${s.site.name}` },
          { label: "Υπόλοιπο", value: String(qty) },
        ],
        actions: [
          { id: "inventory", label: "Αποθήκη", href: "/inventory", primary: true },
          { id: "purchasing", label: "Αγορές", href: "/purchasing" },
        ],
        createdAt: iso(s.updatedAt),
      });
    }

    for (const m of mydataFail) {
      items.push({
        id: `mydata:${m.id}`,
        category: "mydata",
        priority: m.status === "REJECTED" ? "critical" : "high",
        tone: m.status === "REJECTED" ? "rose" : "amber",
        title: `myDATA ${m.status === "REJECTED" ? "απόρριψη" : "εκκρεμές"}`,
        body: `${m.entityNumber || m.entityType}${m.errorMessage ? ` · ${m.errorMessage}` : ""}`,
        href: "/mydata",
        entityLabel: m.entityNumber || m.entityType,
        tags: ["myDATA", m.status],
        meta: [
          { label: "Κατάσταση", value: m.status },
          { label: "Τύπος", value: m.entityType },
          ...(m.errorMessage
            ? [{ label: "Σφάλμα", value: m.errorMessage.slice(0, 80) }]
            : []),
        ],
        actions: [
          { id: "mydata", label: "myDATA Live", href: "/mydata", primary: true },
        ],
        createdAt: iso(m.updatedAt ?? m.createdAt),
      });
    }

    if (draftOrders > 0) {
      items.push({
        id: "draft-orders",
        category: "sales",
        priority: draftOrders >= 5 ? "high" : "medium",
        tone: "amber",
        title: `${draftOrders} πρόχειρες παραγγελίες`,
        body: "Χρειάζονται επιβεβαίωση ή έκδοση παραστατικού",
        href: "/orders",
        tags: ["DRAFT", "ORDERS"],
        meta: [{ label: "Πλήθος", value: String(draftOrders) }],
        actions: [
          { id: "orders", label: "Παραγγελίες", href: "/orders", primary: true },
        ],
        createdAt: new Date().toISOString(),
      });
    }

    if (draftInvoices > 0) {
      items.push({
        id: "draft-invoices",
        category: "sales",
        priority: draftInvoices >= 5 ? "high" : "low",
        tone: "slate",
        title: `${draftInvoices} πρόχειρα τιμολόγια`,
        body: "Εκκρεμεί οριστικοποίηση / έκδοση",
        href: "/invoices",
        tags: ["DRAFT", "INVOICES"],
        meta: [{ label: "Πλήθος", value: String(draftInvoices) }],
        actions: [
          {
            id: "invoices",
            label: "Τιμολόγια",
            href: "/invoices",
            primary: true,
          },
        ],
        createdAt: new Date().toISOString(),
      });
    }

    const priorityRank: Record<NotificationPriority, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    items.sort((a, b) => {
      const pr = priorityRank[a.priority] - priorityRank[b.priority];
      if (pr !== 0) return pr;
      return b.createdAt.localeCompare(a.createdAt);
    });

    const byCategory = {
      finance: 0,
      inventory: 0,
      sales: 0,
      mydata: 0,
      ops: 0,
    } satisfies Record<NotificationCategory, number>;
    const byPriority = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    } satisfies Record<NotificationPriority, number>;
    for (const it of items) {
      byCategory[it.category] += 1;
      byPriority[it.priority] += 1;
    }

    return NextResponse.json({
      items: items.slice(0, 60),
      summary: {
        count: items.length,
        overdueTotal,
        lowStock: lowStock.length,
        mydata: mydataFail.length,
        draftOrders,
        draftInvoices,
        partialInvoices: partialInvoices.length,
        apOpen: apRows.length,
        byCategory,
        byPriority,
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Notifications failed") },
      { status: 500 },
    );
  }
}
