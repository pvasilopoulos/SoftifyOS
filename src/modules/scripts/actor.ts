import type { SessionPayload } from "@/platform/auth/session";
import type { ScriptActor } from "./run-log";

export function scriptActorFromSession(
  session: SessionPayload,
): NonNullable<ScriptActor> & { id: string; role?: string } {
  return {
    id: session.sub,
    role: session.role,
    email: session.email,
    name: session.name,
  };
}
