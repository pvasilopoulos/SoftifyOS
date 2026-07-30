import { redirect } from "next/navigation";
import { AppShell } from "@/platform/shell/app-shell";
import { getSession } from "@/platform/auth/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return <AppShell session={session}>{children}</AppShell>;
}
