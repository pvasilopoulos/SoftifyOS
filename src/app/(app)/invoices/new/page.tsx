import Link from "next/link";
import { PageHeader } from "@/shared/ui/page-header";
import { Badge } from "@/shared/ui/badge";

export const metadata = { title: "Νέο τιμολόγιο" };

export default function NewInvoicePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="Νέο τιμολόγιο"
        description="Η φόρμα δημιουργίας έρχεται στο επόμενο βήμα"
      />
      <div className="soft-panel space-y-3 p-6">
        <Badge tone="teal">Coming next</Badge>
        <p className="text-sm text-slate-600">
          Θα επιλέγετε πελάτη → υποκατάστημα → χώρο και γραμμές παραστατικού.
          Προς το παρόν χρησιμοποιήστε τα seeded τιμολόγια από{" "}
          <Link href="/invoices" className="font-medium text-teal-700">
            τη λίστα
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
