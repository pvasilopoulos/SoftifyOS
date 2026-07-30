import { NewOrderForm } from "@/app/(app)/orders/new/new-order-form";

export const metadata = { title: "Νέα προσφορά" };
export const dynamic = "force-dynamic";

export default function NewQuotePage() {
  return <NewOrderForm kind="SALES_QUOTE" />;
}
