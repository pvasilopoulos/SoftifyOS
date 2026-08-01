import { redirect } from "next/navigation";

/** Legacy route — audit lives under Settings. */
export default function AuditRedirectPage() {
  redirect("/settings/audit");
}
