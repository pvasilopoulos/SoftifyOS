import { NewInvoiceForm, type InvoiceDocKind } from "./new-invoice-form";

export const metadata = { title: "Νέο παραστατικό" };
export const dynamic = "force-dynamic";

function parseKind(raw: string | string[] | undefined): InvoiceDocKind {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "SALES_CREDIT" || value === "RETAIL_RECEIPT") return value;
  return "SALES_INVOICE";
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const params = await searchParams;
  const kind = parseKind(params.kind);
  return <NewInvoiceForm key={kind} kind={kind} />;
}
