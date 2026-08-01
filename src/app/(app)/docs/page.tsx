import { redirect } from "next/navigation";
import { getSession } from "@/platform/auth/session";
import { DocsClient } from "./docs-client";

export const metadata = { title: "Docs" };
export const dynamic = "force-dynamic";

export default async function DocsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <DocsClient />;
}
