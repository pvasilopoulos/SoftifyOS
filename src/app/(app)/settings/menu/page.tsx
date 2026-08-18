import { SettingsPlaceholder } from "../_components/settings-placeholder";

export const metadata = { title: "Ρυθμίσεις · Μενού πλοήγησης" };

export default function MenuSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Μενού πλοήγησης"
      description="Οργάνωση κύριου και mobile μενού εφαρμογής"
      bullets={[
        "Αποκαταστάθηκε η ενότητα από το παλαιότερο GitHub settings structure.",
        "Μπορείς να ορίσεις ποια modules εμφανίζονται σε desktop και mobile.",
        "Υποστηρίζεται επέκταση για drag & drop ταξινόμηση στο επόμενο βήμα.",
      ]}
    />
  );
}
