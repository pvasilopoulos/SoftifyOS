import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { IssueGiftCardClient } from "./issue-gift-card-client";

export const metadata = { title: "Νέα δωροκάρτα" };
export const dynamic = "force-dynamic";

export default async function NewGiftCardPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "VIEWER") redirect("/gift-cards");

  const customers = await prisma.customer.findMany({
    where: { tenantId: session.tenantId, status: "ACTIVE" },
    orderBy: { name: "asc" },
    take: 200,
    select: { id: true, code: true, name: true },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/gift-cards"
          className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Δωροκάρτες
        </Link>
        <PageHeader
          title="Έκδοση δωροκάρτας"
          description="Νέος κωδικός με αρχικό υπόλοιπο και προαιρετική σύνδεση πελάτη"
        />
      </div>
      <IssueGiftCardClient customers={customers} />
    </div>
  );
}
