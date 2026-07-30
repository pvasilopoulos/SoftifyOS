import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { hashPassword } from "@/platform/auth/password";
import { getErrorMessage } from "@/shared/lib/safe";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export const dynamic = "force-dynamic";

const SYSTEM_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

function requireAdmin(session: { role: string } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

function mapMembership(m: {
  id: string;
  role: (typeof SYSTEM_ROLES)[number];
  appRoleId: string | null;
  appRole: { id: string; code: string; name: string } | null;
  user: { id: string; email: string; name: string; createdAt: Date };
  groups: { group: { id: string; code: string; name: string } }[];
}) {
  return {
    membershipId: m.id,
    role: m.role,
    appRoleId: m.appRoleId,
    appRole: m.appRole,
    user: {
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      createdAt: m.user.createdAt.toISOString(),
    },
    groups: m.groups.map((g) => g.group),
  };
}

const includeUser = {
  user: { select: { id: true, email: true, name: true, createdAt: true } },
  appRole: { select: { id: true, code: true, name: true } },
  groups: {
    include: { group: { select: { id: true, code: true, name: true } } },
  },
} as const;

async function countOwners(tenantId: string) {
  return prisma.membership.count({
    where: { tenantId, role: "OWNER" },
  });
}

async function assertAppRole(tenantId: string, appRoleId: string | null | undefined) {
  if (!appRoleId) return null;
  const role = await prisma.appRole.findFirst({
    where: { id: appRoleId, tenantId },
  });
  if (!role) {
    return NextResponse.json({ error: "Ο ρόλος δεν βρέθηκε" }, { status: 404 });
  }
  return null;
}

export async function GET() {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const users = await prisma.membership.findMany({
      where: { tenantId: session!.tenantId },
      include: includeUser,
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      items: users.map(mapMembership),
      currentUserId: session!.sub,
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(200),
  password: z.string().min(8).max(200).optional(),
  role: z.enum(SYSTEM_ROLES).default("MEMBER"),
  appRoleId: z.string().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = createSchema.parse(await req.json());
    const email = body.email.toLowerCase();

    if (body.role === "OWNER" && session!.role !== "OWNER") {
      return NextResponse.json(
        { error: "Μόνο OWNER μπορεί να ορίσει ρόλο OWNER" },
        { status: 403 },
      );
    }

    const appRoleErr = await assertAppRole(session!.tenantId, body.appRoleId);
    if (appRoleErr) return appRoleErr;

    const existingUser = await prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      const already = await prisma.membership.findFirst({
        where: { tenantId: session!.tenantId, userId: existingUser.id },
      });
      if (already) {
        return NextResponse.json(
          { error: "Ο χρήστης είναι ήδη μέλος αυτού του tenant" },
          { status: 409 },
        );
      }

      // Keep existing credentials; optionally refresh name if blank-ish
      if (body.name && body.name !== existingUser.name) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { name: body.name },
        });
      }

      const membership = await prisma.membership.create({
        data: {
          tenantId: session!.tenantId,
          userId: existingUser.id,
          role: body.role,
          appRoleId: body.appRoleId ?? null,
        },
        include: includeUser,
      });

      await writeAuditEvent({
        tenantId: session!.tenantId,
        userId: session!.sub,
        action: "settings.users.create",
        entity: "membership",
        entityId: membership.id,
        meta: { userId: existingUser.id, email, linkedExisting: true, role: body.role },
      });

      return NextResponse.json({
        item: mapMembership(membership),
        linkedExisting: true,
      });
    }

    if (!body.password || body.password.length < 8) {
      return NextResponse.json(
        { error: "Απαιτείται κωδικός τουλάχιστον 8 χαρακτήρων" },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(body.password);
    const membership = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          name: body.name,
          passwordHash,
        },
      });
      return tx.membership.create({
        data: {
          tenantId: session!.tenantId,
          userId: user.id,
          role: body.role,
          appRoleId: body.appRoleId ?? null,
        },
        include: includeUser,
      });
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.users.create",
      entity: "membership",
      entityId: membership.id,
      meta: { userId: membership.user.id, email, role: body.role },
    });

    return NextResponse.json({ item: mapMembership(membership), linkedExisting: false });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Create failed") },
      { status: 500 },
    );
  }
}

const patchSchema = z.object({
  membershipId: z.string().min(1),
  name: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  password: z.string().min(8).max(200).optional(),
  appRoleId: z.string().nullable().optional(),
  role: z.enum(SYSTEM_ROLES).optional(),
});

export async function PATCH(req: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = patchSchema.parse(await req.json());
    const membership = await prisma.membership.findFirst({
      where: { id: body.membershipId, tenantId: session!.tenantId },
      include: { user: true },
    });
    if (!membership) {
      return NextResponse.json({ error: "Ο χρήστης δεν βρέθηκε" }, { status: 404 });
    }

    if (body.role === "OWNER" && session!.role !== "OWNER") {
      return NextResponse.json(
        { error: "Μόνο OWNER μπορεί να ορίσει ρόλο OWNER" },
        { status: 403 },
      );
    }

    if (
      membership.role === "OWNER" &&
      body.role &&
      body.role !== "OWNER" &&
      session!.role !== "OWNER"
    ) {
      return NextResponse.json(
        { error: "Μόνο OWNER μπορεί να αλλάξει ρόλο OWNER" },
        { status: 403 },
      );
    }

    if (membership.role === "OWNER" && body.role && body.role !== "OWNER") {
      const owners = await countOwners(session!.tenantId);
      if (owners <= 1) {
        return NextResponse.json(
          { error: "Πρέπει να παραμένει τουλάχιστον ένας OWNER" },
          { status: 400 },
        );
      }
    }

    const appRoleErr = await assertAppRole(session!.tenantId, body.appRoleId);
    if (appRoleErr) return appRoleErr;

    if (body.email) {
      const email = body.email.toLowerCase();
      if (email !== membership.user.email) {
        const taken = await prisma.user.findFirst({
          where: { email, NOT: { id: membership.userId } },
          select: { id: true },
        });
        if (taken) {
          return NextResponse.json(
            { error: "Το email χρησιμοποιείται ήδη" },
            { status: 409 },
          );
        }
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (body.name || body.email || body.password) {
        await tx.user.update({
          where: { id: membership.userId },
          data: {
            ...(body.name ? { name: body.name } : {}),
            ...(body.email ? { email: body.email.toLowerCase() } : {}),
            ...(body.password
              ? { passwordHash: await hashPassword(body.password) }
              : {}),
          },
        });
      }

      return tx.membership.update({
        where: { id: membership.id },
        data: {
          ...(body.appRoleId !== undefined ? { appRoleId: body.appRoleId } : {}),
          ...(body.role ? { role: body.role } : {}),
        },
        include: includeUser,
      });
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.users.update",
      entity: "membership",
      entityId: membership.id,
      meta: {
        appRoleId: body.appRoleId,
        role: body.role,
        name: body.name,
        email: body.email,
        passwordChanged: Boolean(body.password),
      },
    });

    return NextResponse.json({ item: mapMembership(updated) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 500 },
    );
  }
}

const deleteSchema = z.object({
  membershipId: z.string().min(1),
});

export async function DELETE(req: Request) {
  try {
    const session = await getSession();
    const denied = requireAdmin(session);
    if (denied) return denied;

    const body = deleteSchema.parse(await req.json());
    const membership = await prisma.membership.findFirst({
      where: { id: body.membershipId, tenantId: session!.tenantId },
    });
    if (!membership) {
      return NextResponse.json({ error: "Ο χρήστης δεν βρέθηκε" }, { status: 404 });
    }

    if (membership.userId === session!.sub) {
      return NextResponse.json(
        { error: "Δεν μπορείτε να διαγράψετε τον εαυτό σας" },
        { status: 400 },
      );
    }

    if (membership.role === "OWNER") {
      if (session!.role !== "OWNER") {
        return NextResponse.json(
          { error: "Μόνο OWNER μπορεί να διαγράψει OWNER" },
          { status: 403 },
        );
      }
      const owners = await countOwners(session!.tenantId);
      if (owners <= 1) {
        return NextResponse.json(
          { error: "Πρέπει να παραμένει τουλάχιστον ένας OWNER" },
          { status: 400 },
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id: membership.id } });
      const remaining = await tx.membership.count({
        where: { userId: membership.userId },
      });
      if (remaining === 0) {
        await tx.user.delete({ where: { id: membership.userId } });
      }
    });

    await writeAuditEvent({
      tenantId: session!.tenantId,
      userId: session!.sub,
      action: "settings.users.delete",
      entity: "membership",
      entityId: membership.id,
      meta: { userId: membership.userId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Delete failed") },
      { status: 500 },
    );
  }
}
