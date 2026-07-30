import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { defaultMenuTree, type MenuNodeConfig } from "@/platform/navigation";
import { getTenantMenuTree } from "@/platform/navigation/resolve-menu";

export const dynamic = "force-dynamic";

const menuNodeSchema: z.ZodType<MenuNodeConfig> = z.lazy(() =>
  z.object({
    id: z.string().min(1).max(80),
    type: z.enum(["folder", "link"]),
    label: z.string().min(1).max(120),
    href: z.string().max(200).optional(),
    icon: z.string().max(40).optional(),
    visible: z.boolean().optional(),
    children: z.array(menuNodeSchema).optional(),
    roles: z.array(z.enum(["OWNER", "ADMIN", "MEMBER", "VIEWER"])).optional(),
    mobileTab: z.boolean().optional(),
    mobileOrder: z.number().int().min(0).max(20).optional(),
  }),
) as z.ZodType<MenuNodeConfig>;

const saveSchema = z.object({
  menu: z.array(menuNodeSchema).min(1).max(50),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const menu = await getTenantMenuTree(session.tenantId);
    return NextResponse.json({ menu, defaultMenu: defaultMenuTree });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = saveSchema.parse(await request.json());

    await prisma.tenantSettings.upsert({
      where: { tenantId: session.tenantId },
      update: { menuJson: body.menu },
      create: { tenantId: session.tenantId, menuJson: body.menu },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "settings.menu.update",
      entity: "tenant_settings",
      entityId: session.tenantId,
      meta: { nodes: body.menu.length },
    });

    return NextResponse.json({ ok: true, menu: body.menu });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρη δομή μενού" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Save failed") },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // reset to default
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role !== "OWNER" && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const action = (await request.json().catch(() => ({}))) as { reset?: boolean };
    if (action.reset) {
      await prisma.tenantSettings.upsert({
        where: { tenantId: session.tenantId },
        update: { menuJson: defaultMenuTree },
        create: { tenantId: session.tenantId, menuJson: defaultMenuTree },
      });
      return NextResponse.json({ ok: true, menu: defaultMenuTree });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Reset failed") },
      { status: 500 },
    );
  }
}
