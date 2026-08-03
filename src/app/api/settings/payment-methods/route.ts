import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { paymentMethodUpsertSchema } from "@/modules/payments/schemas";
import {
  createPaymentMethod,
  listPaymentMethods,
  PaymentMethodError,
} from "@/modules/payments/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = new URL(request.url);
    const seriesId = url.searchParams.get("seriesId");
    const collectOnly = url.searchParams.get("collect") === "1";
    const posOnly = url.searchParams.get("pos") === "1";

    if (seriesId) {
      const { resolveSeriesPaymentMethods } = await import(
        "@/modules/documents/series-payments"
      );
      const items = await resolveSeriesPaymentMethods(prisma, {
        tenantId: session.tenantId,
        seriesId,
        collectOnly: collectOnly || undefined,
        posOnly: posOnly || undefined,
        activeOnly: true,
      });
      return NextResponse.json({ items });
    }

    const items = await listPaymentMethods(prisma, session.tenantId, {
      activeOnly: true,
      collectOnly: collectOnly || undefined,
      posOnly: posOnly || undefined,
    });
    return NextResponse.json({ items });
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

    const body = paymentMethodUpsertSchema.parse(await request.json());
    const item = await createPaymentMethod(prisma, {
      tenantId: session.tenantId,
      data: body,
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "payment_methods.create",
      entity: "payment_method",
      entityId: item.id,
      meta: { code: item.code },
    });

    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    if (error instanceof PaymentMethodError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 500 },
    );
  }
}
