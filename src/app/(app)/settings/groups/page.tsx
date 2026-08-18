import { SettingsPlaceholder } from "../_components/settings-placeholder";

export const metadata = { title: "Ρυθμίσεις · Ομάδες χρηστών" };

export default function GroupsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Ομάδες χρηστών"
      description="Οργάνωση χρηστών σε ομάδες για απλούστερη διαχείριση πρόσβασης"
      bullets={[
        "Η επιλογή ομάδων επανήλθε στο settings module.",
        "Επιτρέπει φυσικό διαχωρισμό (π.χ. Πωλήσεις, Λογιστήριο, Αποθήκη).",
        "Σχεδιασμένο για μελλοντική μαζική ανάθεση ρόλων/δικαιωμάτων.",
      ]}
    />
  );
}
