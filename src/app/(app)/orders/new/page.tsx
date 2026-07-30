import { NewOrderForm } from "./new-order-form";

export const metadata = { title: "Νέα παραγγελία" };
export const dynamic = "force-dynamic";

export default function NewOrderPage() {
  return <NewOrderForm kind="SALES_ORDER" />;
}
