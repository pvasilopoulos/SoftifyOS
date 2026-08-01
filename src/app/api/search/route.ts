import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { getErrorMessage } from "@/shared/lib/safe";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") || "").trim();
    if (q.length < 1) {
      return NextResponse.json({ items: [] });
    }

    const tenantId = session.tenantId;
    const take = 6;

    const [customers, invoices, orders, products, suppliers] = await Promise.all([
      prisma.customer.findMany({
        where: {
          tenantId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
            { vatNumber: { contains: q, mode: "insensitive" } },
          ],
        },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.invoice.findMany({
        where: {
          tenantId,
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        },
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.order.findMany({
        where: {
          tenantId,
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { name: { contains: q, mode: "insensitive" } } },
          ],
        },
        take,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          number: true,
          status: true,
          kind: true,
          total: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.product.findMany({
        where: {
          tenantId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
            { barcode: { contains: q, mode: "insensitive" } },
          ],
        },
        take,
        orderBy: { updatedAt: "desc" },
        select: { id: true, sku: true, name: true, price: true },
      }),
      prisma.supplier.findMany({
        where: {
          tenantId,
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { code: { contains: q, mode: "insensitive" } },
          ],
        },
        take: 4,
        orderBy: { updatedAt: "desc" },
        select: { id: true, code: true, name: true },
      }),
    ]);

    const items = [
      ...customers.map((c) => ({
        id: `customer:${c.id}`,
        type: "customer" as const,
        title: c.name,
        subtitle: c.code,
        href: `/customers/${c.id}`,
      })),
      ...invoices.map((i) => ({
        id: `invoice:${i.id}`,
        type: "invoice" as const,
        title: i.number,
        subtitle: `${i.customer.name} · ${toNumber(i.total).toLocaleString("el-GR")} € · ${i.status}`,
        href: `/invoices/${i.id}`,
      })),
      ...orders.map((o) => ({
        id: `order:${o.id}`,
        type: "order" as const,
        title: o.number,
        subtitle: `${o.customer.name} · ${o.kind === "SALES_QUOTE" ? "Προσφορά" : "Παραγγελία"} · ${o.status}`,
        href: `/orders/${o.id}`,
      })),
      ...products.map((p) => ({
        id: `product:${p.id}`,
        type: "product" as const,
        title: p.name,
        subtitle: `${p.sku} · ${toNumber(p.price).toLocaleString("el-GR")} €`,
        href: `/products/${p.id}`,
      })),
      ...suppliers.map((s) => ({
        id: `supplier:${s.id}`,
        type: "supplier" as const,
        title: s.name,
        subtitle: s.code,
        href: `/purchasing?supplier=${s.id}`,
      })),
    ];

    return NextResponse.json({ items, q });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Search failed") },
      { status: 500 },
    );
  }
}
