import { SettingsPlaceholder } from "../_components/settings-placeholder";

export const metadata = { title: "Ρυθμίσεις · Permissions" };

export default function PermissionsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Permissions"
      description="Κατάλογος ενεργειών που προστατεύονται από role-based access"
      bullets={[
        "Η ενότητα permissions αποκαταστάθηκε από το GitHub settings layout.",
        "Οι βασικοί περιορισμοί ρόλων ισχύουν ήδη στα API endpoints.",
        "Μπορεί να συνδεθεί με granular policy ανά module και action.",
      ]}
    />
  );
}
