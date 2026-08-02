import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import {
  MarketplaceChannelError,
  pingMarketplaceChannelSync,
  serializeMarketplaceChannel,
} from "@/modules/marketplace-channels/service";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const bodySchema = z.object({
  ok: z.boolean().optional(),
  message: z.string().max(500).optional().nullable(),
});

/** Manual sync heartbeat — Script Hooks update the same fields after real sync. */
export async function POST(request: Request, ctx: Ctx) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const raw = await request.json().catch(() => ({}));
    const body = bodySchema.parse(raw);
    const item = await pingMarketplaceChannelSync(prisma, {
      tenantId: session.tenantId,
      id,
      ok: body.ok,
      message: body.message,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "marketplace_channels.sync_ping",
      entity: "marketplace_channel",
      entityId: id,
      meta: { ok: body.ok !== false, status: item.status },
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
      { error: getErrorMessage(error, "Sync ping failed") },
      { status: 500 },
    );
  }
}
