import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { marketplaceChannelPatchSchema } from "@/modules/marketplace-channels/schemas";
import {
  deleteMarketplaceChannel,
  getMarketplaceChannel,
  MarketplaceChannelError,
  serializeMarketplaceChannel,
  updateMarketplaceChannel,
} from "@/modules/marketplace-channels/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await ctx.params;
    const item = await getMarketplaceChannel(prisma, session.tenantId, id);
    if (!item) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    return NextResponse.json({ item: serializeMarketplaceChannel(item) });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const body = marketplaceChannelPatchSchema.parse(await request.json());
    const item = await updateMarketplaceChannel(prisma, {
      tenantId: session.tenantId,
      id,
      data: body,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "marketplace_channels.update",
      entity: "marketplace_channel",
      entityId: id,
      meta: { code: item.code, status: item.status },
    });

    return NextResponse.json({ item: serializeMarketplaceChannel(item) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof MarketplaceChannelError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 500 },
    );
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    await deleteMarketplaceChannel(prisma, {
      tenantId: session.tenantId,
      id,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "marketplace_channels.delete",
      entity: "marketplace_channel",
      entityId: id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MarketplaceChannelError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 500 },
    );
  }
}
