import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { InventoryError } from "@/modules/inventory/service";
import {
  allocateLotsFefo,
  createCountSession,
  createReservation,
  createTransfer,
  listBins,
  loadValuation,
  loadWarehouseDashboard,
  postCount,
  receiveTransfer,
  releaseReservation,
  shipTransfer,
  submitCountLines,
  upsertBin,
} from "@/modules/inventory/warehouse";
import { toNumber } from "@/modules/sales/invoice-utils";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const kind = request.nextUrl.searchParams.get("kind") ?? "dashboard";
    const siteId = request.nextUrl.searchParams.get("siteId") ?? undefined;

    if (kind === "dashboard") {
      return NextResponse.json(
        await loadWarehouseDashboard(prisma, session.tenantId),
      );
    }
    if (kind === "bins") {
      const bins = await listBins(prisma, session.tenantId, siteId);
      return NextResponse.json({ items: bins });
    }
    if (kind === "valuation") {
      return NextResponse.json(
        await loadValuation(prisma, session.tenantId, siteId),
      );
    }
    if (kind === "transfers") {
      const items = await prisma.stockTransfer.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
        take: 50,
        include: {
          fromSite: { select: { code: true, name: true } },
          toSite: { select: { code: true, name: true } },
          lines: {
            include: { product: { select: { sku: true, name: true } } },
          },
        },
      });
      return NextResponse.json({
        items: items.map((t) => ({
          ...t,
          lines: t.lines.map((l) => ({ ...l, qty: toNumber(l.qty) })),
        })),
      });
    }
    if (kind === "counts") {
      const items = await prisma.stockCount.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          site: { select: { code: true, name: true } },
          lines: {
            include: {
              product: { select: { sku: true, name: true, unit: true } },
            },
            orderBy: { lineNo: "asc" },
          },
        },
      });
      return NextResponse.json({
        items: items.map((c) => ({
          ...c,
          lines: c.lines.map((l) => ({
            ...l,
            systemQty: toNumber(l.systemQty),
            countedQty: l.countedQty == null ? null : toNumber(l.countedQty),
            varianceQty:
              l.varianceQty == null ? null : toNumber(l.varianceQty),
          })),
        })),
      });
    }
    if (kind === "reservations") {
      const items = await prisma.stockReservation.findMany({
        where: { tenantId: session.tenantId, status: "ACTIVE" },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          product: { select: { sku: true, name: true } },
          site: { select: { code: true, name: true } },
        },
      });
      return NextResponse.json({
        items: items.map((r) => ({ ...r, qty: toNumber(r.qty) })),
      });
    }
    if (kind === "fefo") {
      const productId = request.nextUrl.searchParams.get("productId");
      const qty = Number(request.nextUrl.searchParams.get("qty") || 0);
      if (!productId || !siteId || !(qty > 0)) {
        return NextResponse.json(
          { error: "productId, siteId, qty required" },
          { status: 400 },
        );
      }
      return NextResponse.json(
        await allocateLotsFefo(prisma, {
          tenantId: session.tenantId,
          siteId,
          productId,
          qty,
        }),
      );
    }
    return NextResponse.json({ error: "Unknown kind" }, { status: 400 });
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
    const action = String(raw?.action || "");

    if (action === "upsert-bin") {
      const body = z
        .object({
          siteId: z.string().min(1),
          code: z.string().trim().min(1).max(40),
          name: z.string().trim().min(1).max(120),
          zone: z.string().trim().max(40).nullable().optional(),
        })
        .parse(raw);
      const item = await upsertBin(prisma, {
        tenantId: session.tenantId,
        ...body,
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    if (action === "create-transfer") {
      const body = z
        .object({
          fromSiteId: z.string().min(1),
          toSiteId: z.string().min(1),
          note: z.string().max(300).nullable().optional(),
          ship: z.boolean().optional(),
          lines: z
            .array(
              z.object({
                productId: z.string().min(1),
                qty: z.coerce.number().positive(),
                lotCode: z.string().nullable().optional(),
              }),
            )
            .min(1),
        })
        .parse(raw);
      const item = await createTransfer(prisma, {
        tenantId: session.tenantId,
        userId: session.sub,
        ...body,
      });
      await writeAuditEvent({
        tenantId: session.tenantId,
        userId: session.sub,
        action: "inventory.transfer.create",
        entity: "stock_transfer",
        entityId: item.id,
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    if (action === "ship-transfer" || action === "receive-transfer") {
      const transferId = String(raw.transferId || "");
      const item =
        action === "ship-transfer"
          ? await shipTransfer(prisma, {
              tenantId: session.tenantId,
              transferId,
              userId: session.sub,
            })
          : await receiveTransfer(prisma, {
              tenantId: session.tenantId,
              transferId,
              userId: session.sub,
            });
      return NextResponse.json({ item });
    }

    if (action === "create-count") {
      const body = z
        .object({
          siteId: z.string().min(1),
          note: z.string().max(300).nullable().optional(),
        })
        .parse(raw);
      const item = await createCountSession(prisma, {
        tenantId: session.tenantId,
        userId: session.sub,
        ...body,
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    if (action === "submit-count") {
      const body = z
        .object({
          countId: z.string().min(1),
          lines: z.array(
            z.object({
              lineId: z.string().min(1),
              countedQty: z.coerce.number().min(0),
            }),
          ),
        })
        .parse(raw);
      const item = await submitCountLines(prisma, {
        tenantId: session.tenantId,
        ...body,
      });
      return NextResponse.json({ item });
    }

    if (action === "post-count") {
      const countId = String(raw.countId || "");
      const item = await postCount(prisma, {
        tenantId: session.tenantId,
        countId,
        userId: session.sub,
      });
      return NextResponse.json({ item });
    }

    if (action === "reserve") {
      const body = z
        .object({
          siteId: z.string().min(1),
          productId: z.string().min(1),
          qty: z.coerce.number().positive(),
          note: z.string().max(300).nullable().optional(),
        })
        .parse(raw);
      const item = await createReservation(prisma, {
        tenantId: session.tenantId,
        userId: session.sub,
        ...body,
      });
      return NextResponse.json({ item }, { status: 201 });
    }

    if (action === "release-reservation") {
      const item = await releaseReservation(prisma, {
        tenantId: session.tenantId,
        reservationId: String(raw.reservationId || ""),
      });
      return NextResponse.json({ item });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    if (error instanceof InventoryError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
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
