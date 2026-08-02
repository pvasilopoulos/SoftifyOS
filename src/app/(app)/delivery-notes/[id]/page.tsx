import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSession } from "@/platform/auth/session";
import { requireCompanyId } from "@/platform/tenancy/company-scope";
import { prisma } from "@/server/db";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";
import { toNumber } from "@/modules/sales/invoice-utils";
import { DeliveryNoteActions } from "./delivery-note-actions";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  DRAFT: "Πρόχειρο",
  ISSUED: "Εκδομένο",
  CANCELLED: "Ακυρωμένο",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const note = await prisma.deliveryNote.findFirst({
    where: { id },
    select: { number: true },
  });
  return { title: note?.number ?? "Δελτίο αποστολής" };
}

export default async function DeliveryNoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const legalEntityId = requireCompanyId(session);
  const { id } = await params;

  const note = await prisma.deliveryNote.findFirst({
    where: { id, tenantId: session.tenantId, legalEntityId },
    include: {
      customer: { select: { id: true, code: true, name: true } },
      site: { select: { id: true, code: true, name: true } },
      series: { select: { id: true, code: true, name: true } },
      invoice: { select: { id: true, number: true, status: true } },
      lines: {
        orderBy: { position: "asc" },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
        },
      },
    },
  });
  if (!note) notFound();

  const movements = await prisma.stockMovement.findMany({
    where: {
      tenantId: session.tenantId,
      refType: "delivery_note",
      refId: note.id,
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    include: {
      product: { select: { sku: true, name: true } },
      site: { select: { code: true } },
    },
  });

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/delivery-notes"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-ink-900"
        >
          <ArrowLeft size={14} /> Πίσω στα δελτία
        </Link>
        <PageHeader
          title={note.number}
          description={`${note.customer.name} · ${note.customer.code}${note.site ? ` · ${note.site.name}` : ""}`}
          actions={
            <DeliveryNoteActions
              noteId={note.id}
              status={note.status}
              canWrite={session.role !== "VIEWER"}
            />
          }
        />
      </div>

      <section className="soft-panel p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={note.status === "ISSUED" ? "emerald" : "slate"}>
            {statusLabel[note.status] ?? note.status}
          </Badge>
          {note.series ? <Badge tone="slate">{note.series.code}</Badge> : null}
          {note.issuedAt ? (
            <span className="text-sm text-slate-500">
              Έκδοση {note.issuedAt.toLocaleDateString("el-GR")}
            </span>
          ) : null}
        </div>
        {note.shippingAddress ? (
          <p className="mt-3 text-sm text-slate-600">
            Διεύθυνση: {note.shippingAddress}
          </p>
        ) : null}
        {note.invoice ? (
          <p className="mt-2 text-sm">
            Τιμολόγιο{" "}
            <Link
              href={`/invoices/${note.invoice.id}`}
              className="font-medium text-teal-800 hover:underline"
            >
              {note.invoice.number}
            </Link>
          </p>
        ) : null}
      </section>

      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Γραμμές
        </div>
        <ul className="divide-y divide-slate-100 text-sm">
          {note.lines.map((line) => (
            <li
              key={line.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <p className="font-medium text-ink-900">{line.description}</p>
                <p className="text-xs text-slate-500">
                  {line.product?.sku ? `${line.product.sku} · ` : ""}
                  {line.unit}
                </p>
              </div>
              <p className="font-semibold tabular-nums">
                {toNumber(line.quantity).toLocaleString("el-GR")}
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section className="soft-panel overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3 text-sm font-semibold">
          Κινήσεις αποθήκης
        </div>
        {movements.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">
            Δεν υπάρχουν κινήσεις (έκδωσε το δελτίο για stock OUT).
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {movements.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div>
                  <p className="font-medium">
                    {m.product.sku} · {m.product.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {m.site.code} · {m.type} ·{" "}
                    {m.createdAt.toLocaleString("el-GR")}
                  </p>
                </div>
                <span className="font-semibold tabular-nums">
                  {toNumber(m.qty).toLocaleString("el-GR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {note.notes ? (
        <section className="soft-panel p-4">
          <h2 className="text-sm font-semibold">Σημειώσεις</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600">
            {note.notes}
          </p>
        </section>
      ) : null}
    </div>
  );
}
