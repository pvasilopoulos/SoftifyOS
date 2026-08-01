import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  iban: z.string().trim().max(40).optional().nullable(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    let accounts = await prisma.bankAccount.findMany({
      where: { tenantId: session.tenantId, isActive: true },
      orderBy: { code: "asc" },
    });
    if (accounts.length === 0) {
      const created = await prisma.bankAccount.create({
        data: {
          tenantId: session.tenantId,
          code: "MAIN",
          name: "Κύριος λογαριασμός",
          currency: "EUR",
        },
      });
      accounts = [created];
    }
    return NextResponse.json({ items: accounts });
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
    const body = createSchema.parse(await request.json());
    const item = await prisma.bankAccount.create({
      data: {
        tenantId: session.tenantId,
        code: body.code,
        name: body.name,
        iban: body.iban || null,
      },
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 400 },
    );
  }
}
