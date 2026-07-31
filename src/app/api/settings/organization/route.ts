import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { getSession } from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";
import { buildChangeMeta } from "@/platform/tenancy/audit-diff";
import { getErrorMessage } from "@/shared/lib/safe";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  legalName: z.string().trim().max(200).optional().nullable(),
  tradeName: z.string().trim().max(200).optional().nullable(),
  vatNumber: z.string().trim().max(32).optional().nullable(),
  taxOffice: z.string().trim().max(120).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  city: z.string().trim().max(120).optional().nullable(),
  postalCode: z.string().trim().max(20).optional().nullable(),
  country: z.string().trim().max(2).optional(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  website: z.string().trim().max(200).optional().nullable(),
  logoUrl: z.string().trim().url().optional().nullable().or(z.literal("")),
  currency: z.string().trim().min(3).max(3).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
  timezone: z.string().trim().min(2).max(64).optional(),
  maintenanceMode: z.boolean().optional(),
});

async function ensureSettings(tenantId: string) {
  return prisma.tenantSettings.upsert({
    where: { tenantId },
    create: { tenantId },
    update: {},
  });
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const [tenant, settings] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: session.tenantId },
        select: { id: true, slug: true, name: true },
      }),
      ensureSettings(session.tenantId),
    ]);
    return NextResponse.json({
      tenant,
      settings: {
        legalName: settings.legalName,
        tradeName: settings.tradeName,
        vatNumber: settings.vatNumber,
        taxOffice: settings.taxOffice,
        address: settings.address,
        city: settings.city,
        postalCode: settings.postalCode,
        country: settings.country,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        logoUrl: settings.logoUrl,
        currency: settings.currency,
        locale: settings.locale,
        timezone: settings.timezone,
        maintenanceMode: settings.maintenanceMode,
        updatedAt: settings.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "Load failed") },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (session.role === "VIEWER" || session.role === "MEMBER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = patchSchema.parse(await request.json());
    const current = await ensureSettings(session.tenantId);
    const before = {
      legalName: current.legalName,
      tradeName: current.tradeName,
      vatNumber: current.vatNumber,
      taxOffice: current.taxOffice,
      address: current.address,
      city: current.city,
      postalCode: current.postalCode,
      country: current.country,
      phone: current.phone,
      email: current.email,
      website: current.website,
      logoUrl: current.logoUrl,
      currency: current.currency,
      locale: current.locale,
      timezone: current.timezone,
      maintenanceMode: current.maintenanceMode,
    };

    const settings = await prisma.tenantSettings.update({
      where: { tenantId: session.tenantId },
      data: {
        ...(body.legalName !== undefined ? { legalName: body.legalName || null } : {}),
        ...(body.tradeName !== undefined ? { tradeName: body.tradeName || null } : {}),
        ...(body.vatNumber !== undefined ? { vatNumber: body.vatNumber || null } : {}),
        ...(body.taxOffice !== undefined ? { taxOffice: body.taxOffice || null } : {}),
        ...(body.address !== undefined ? { address: body.address || null } : {}),
        ...(body.city !== undefined ? { city: body.city || null } : {}),
        ...(body.postalCode !== undefined ? { postalCode: body.postalCode || null } : {}),
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
        ...(body.email !== undefined ? { email: body.email || null } : {}),
        ...(body.website !== undefined ? { website: body.website || null } : {}),
        ...(body.logoUrl !== undefined ? { logoUrl: body.logoUrl || null } : {}),
        ...(body.currency !== undefined ? { currency: body.currency.toUpperCase() } : {}),
        ...(body.locale !== undefined ? { locale: body.locale } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.maintenanceMode !== undefined
          ? { maintenanceMode: body.maintenanceMode }
          : {}),
      },
    });

    if (body.legalName || body.tradeName) {
      const name = body.legalName || body.tradeName;
      if (name) {
        await prisma.tenant.update({
          where: { id: session.tenantId },
          data: { name },
        });
      }
    }

    const after = {
      legalName: settings.legalName,
      tradeName: settings.tradeName,
      vatNumber: settings.vatNumber,
      taxOffice: settings.taxOffice,
      address: settings.address,
      city: settings.city,
      postalCode: settings.postalCode,
      country: settings.country,
      phone: settings.phone,
      email: settings.email,
      website: settings.website,
      logoUrl: settings.logoUrl,
      currency: settings.currency,
      locale: settings.locale,
      timezone: settings.timezone,
      maintenanceMode: settings.maintenanceMode,
    };

    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "tenant_settings.update",
      entity: "tenant_settings",
      entityId: settings.id,
      meta: buildChangeMeta({
        before,
        after,
        extra: { fields: Object.keys(body) },
      }),
    });

    return NextResponse.json({
      settings: {
        legalName: settings.legalName,
        tradeName: settings.tradeName,
        vatNumber: settings.vatNumber,
        taxOffice: settings.taxOffice,
        address: settings.address,
        city: settings.city,
        postalCode: settings.postalCode,
        country: settings.country,
        phone: settings.phone,
        email: settings.email,
        website: settings.website,
        logoUrl: settings.logoUrl,
        currency: settings.currency,
        locale: settings.locale,
        timezone: settings.timezone,
        maintenanceMode: settings.maintenanceMode,
        updatedAt: settings.updatedAt.toISOString(),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Μη έγκυρα δεδομένα" }, { status: 400 });
    }
    return NextResponse.json(
      { error: getErrorMessage(error, "Update failed") },
      { status: 400 },
    );
  }
}
