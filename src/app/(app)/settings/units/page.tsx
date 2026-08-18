import { SettingsPlaceholder } from "../_components/settings-placeholder";

export const metadata = { title: "Ρυθμίσεις · Μονάδες μέτρησης" };

export default function UnitsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Μονάδες μέτρησης"
      description="Διαχείριση μονάδων για προϊόντα, αποθήκη και παραγγελίες"
      bullets={[
        "Αποκαταστάθηκε η ενότητα units από την έκδοση GitHub που ανέφερες.",
        "Υποστηρίζει οργάνωση σε τεμ, κιλά, λίτρα, ώρες και custom μονάδες.",
        "Μπορεί να συνδεθεί με default μονάδες στο προϊόν και στα παραστατικά.",
      ]}
    />
  );
}
