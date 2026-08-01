import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { getErrorMessage } from "@/shared/lib/safe";
import { defaultMenuTree, type MenuNodeConfig } from "@/platform/navigation";
import { getTenantMenuSettings } from "@/platform/navigation/resolve-menu";

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
    groupIds: z.array(z.string().min(1).max(80)).max(100).optional(),
    userIds: z.array(z.string().min(1).max(80)).max(200).optional(),
    defaultExpanded: z.boolean().optional(),
    mobileTab: z.boolean().optional(),
    mobileOrder: z.number().int().min(0).max(20).optional(),
  }),
) as z.ZodType<MenuNodeConfig>;

const footerIdsSchema = z.array(z.string().min(1).max(80)).max(3);

const saveSchema = z.object({
  menu: z.array(menuNodeSchema).min(1).max(50),
  navGroupsDefaultExpanded: z.boolean().optional(),
  mobileFooterOverrides: z
    .object({
      byUserId: z.record(z.string(), footerIdsSchema).optional(),
      byGroupId: z.record(z.string(), footerIdsSchema).optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const settings = await getTenantMenuSettings(session.tenantId);

    const [groups, memberships] = await Promise.all([
      prisma.userGroup.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { name: "asc" },
        select: { id: true, code: true, name: true },
      }),
      prisma.membership.findMany({
        where: { tenantId: session.tenantId },
        orderBy: { user: { name: "asc" } },
        select: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return NextResponse.json({
      menu: settings.menuTree,
      defaultMenu: defaultMenuTree,
      navGroupsDefaultExpanded: settings.navGroupsDefaultExpanded,
      mobileFooterOverrides: settings.mobileFooterOverrides,
      audienceOptions: {
        groups,
        users: memberships.map((m) => m.user),
      },
    });
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

    const data: {
      menuJson: MenuNodeConfig[];
      navGroupsDefaultExpanded?: boolean;
      mobileFooterOverrides?: {
        byUserId?: Record<string, string[]>;
        byGroupId?: Record<string, string[]>;
      };
    } = { menuJson: body.menu };
    if (typeof body.navGroupsDefaultExpanded === "boolean") {
      data.navGroupsDefaultExpanded = body.navGroupsDefaultExpanded;
    }
    if (body.mobileFooterOverrides) {
      data.mobileFooterOverrides = body.mobileFooterOverrides;
    }

    await prisma.tenantSettings.upsert({
      where: { tenantId: session.tenantId },
      update: data,
      create: {
        tenantId: session.tenantId,
        menuJson: body.menu,
        navGroupsDefaultExpanded: body.navGroupsDefaultExpanded ?? true,
        mobileFooterOverrides: body.mobileFooterOverrides ?? {},
      },
    });

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "settings.menu.update",
      entity: "tenant_settings",
      entityId: session.tenantId,
      meta: {
        nodes: body.menu.length,
        navGroupsDefaultExpanded: body.navGroupsDefaultExpanded,
        footerUserOverrides: Object.keys(
          body.mobileFooterOverrides?.byUserId ?? {},
        ).length,
        footerGroupOverrides: Object.keys(
          body.mobileFooterOverrides?.byGroupId ?? {},
        ).length,
      },
    });

    const settings = await getTenantMenuSettings(session.tenantId);
    return NextResponse.json({
      ok: true,
      menu: settings.menuTree,
      navGroupsDefaultExpanded: settings.navGroupsDefaultExpanded,
      mobileFooterOverrides: settings.mobileFooterOverrides,
    });
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
    const action = (await request.json().catch(() => ({}))) as {
      reset?: boolean;
    };
    if (action.reset) {
      await prisma.tenantSettings.upsert({
        where: { tenantId: session.tenantId },
        update: {
          menuJson: defaultMenuTree,
          navGroupsDefaultExpanded: true,
          mobileFooterOverrides: {},
        },
        create: {
          tenantId: session.tenantId,
          menuJson: defaultMenuTree,
          navGroupsDefaultExpanded: true,
          mobileFooterOverrides: {},
        },
      });
      return NextResponse.json({
        ok: true,
        menu: defaultMenuTree,
        navGroupsDefaultExpanded: true,
        mobileFooterOverrides: { byUserId: {}, byGroupId: {} },
      });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Reset failed") },
      { status: 500 },
    );
  }
}
