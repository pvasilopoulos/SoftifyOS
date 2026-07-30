import { NextResponse } from "next/server";
import { getSession } from "@/platform/auth/session";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.sub,
      email: session.email,
      name: session.name,
    },
    tenant: {
      id: session.tenantId,
      slug: session.tenantSlug,
      name: session.tenantName,
      role: session.role,
    },
  });
}
