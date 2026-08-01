import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  module: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(80),
  payload: z.record(z.string(), z.unknown()),
});

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const module = new URL(request.url).searchParams.get("module") || undefined;
    const items = await prisma.savedFilter.findMany({
      where: {
        tenantId: session.tenantId,
        userId: session.sub,
        ...(module ? { module } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
    return NextResponse.json({
      items: items.map((i) => ({
        id: i.id,
        module: i.module,
        name: i.name,
        payload: i.payload,
        updatedAt: i.updatedAt.toISOString(),
      })),
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
    const body = upsertSchema.parse(await request.json());
    const payload = body.payload as unknown as Prisma.InputJsonValue;
    const item = await prisma.savedFilter.upsert({
      where: {
        tenantId_userId_module_name: {
          tenantId: session.tenantId,
          userId: session.sub,
          module: body.module,
          name: body.name,
        },
      },
      create: {
        tenantId: session.tenantId,
        userId: session.sub,
        module: body.module,
        name: body.name,
        payload,
      },
      update: { payload },
    });
    return NextResponse.json({
      item: {
        id: item.id,
        module: item.module,
        name: item.name,
        payload: item.payload,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const id = new URL(request.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Λείπει id" }, { status: 400 });
    }
    const existing = await prisma.savedFilter.findFirst({
      where: { id, tenantId: session.tenantId, userId: session.sub },
    });
    if (!existing) {
      return NextResponse.json({ error: "Δεν βρέθηκε" }, { status: 404 });
    }
    await prisma.savedFilter.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 400 },
    );
  }
}
