import { SettingsPlaceholder } from "../_components/settings-placeholder";

export const metadata = { title: "Ρυθμίσεις · Ρόλοι εφαρμογής" };

export default function RolesSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Ρόλοι εφαρμογής"
      description="Διαχείριση δικαιωμάτων ανά επιχειρησιακό ρόλο"
      bullets={[
        "Επαναφέρθηκε η σελίδα ρόλων που έλειπε από τη νεότερη έκδοση.",
        "Η ιεραρχία συστήματος (SUPER_ADMIN, OWNER, ADMIN, MEMBER, VIEWER) παραμένει ενεργή.",
        "Το module είναι έτοιμο για granular permission matrix ανά feature.",
      ]}
    />
  );
}
