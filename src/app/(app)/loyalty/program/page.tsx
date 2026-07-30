import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";

export const metadata = { title: "Πρόγραμμα Loyalty" };
export const dynamic = "force-dynamic";

/** Legacy route — program editor lives on /loyalty?tab=program */
export default async function LoyaltyProgramPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") {
    redirect("/loyalty");
  }
  redirect("/loyalty?tab=program");
}
