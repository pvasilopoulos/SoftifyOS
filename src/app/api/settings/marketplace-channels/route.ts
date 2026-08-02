import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { marketplaceChannelCreateSchema } from "@/modules/marketplace-channels/schemas";
import {
  createMarketplaceChannel,
  listMarketplaceChannels,
  MarketplaceChannelError,
  serializeMarketplaceChannel,
} from "@/modules/marketplace-channels/service";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const rows = await listMarketplaceChannels(prisma, session.tenantId);
    return NextResponse.json({
      items: rows.map(serializeMarketplaceChannel),
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
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = marketplaceChannelCreateSchema.parse(await request.json());
    const item = await createMarketplaceChannel(prisma, {
      tenantId: session.tenantId,
      data: body,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "marketplace_channels.create",
      entity: "marketplace_channel",
      entityId: item.id,
      meta: { code: item.code, provider: item.provider },
    });

    return NextResponse.json(
      { item: serializeMarketplaceChannel(item) },
      { status: 201 },
    );
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
      { error: getErrorMessage(error, "Create failed") },
      { status: 500 },
    );
  }
}
