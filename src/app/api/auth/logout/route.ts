import { NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  getSession,
  sessionCookieOptions,
} from "@/platform/auth/session";
import { writeAuditEvent } from "@/platform/tenancy/audit";

export async function POST() {
  const session = await getSession();
  if (session) {
    await writeAuditEvent({
      tenantId: session.tenantId,
      userId: session.sub,
      action: "auth.logout",
      entity: "user",
      entityId: session.sub,
    }).catch(() => undefined);
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(0),
    maxAge: 0,
  });
  return response;
}
