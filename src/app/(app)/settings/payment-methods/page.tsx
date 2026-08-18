import { SettingsPlaceholder } from "../_components/settings-placeholder";

export const metadata = { title: "Ρυθμίσεις · Τρόποι πληρωμής" };

export default function PaymentMethodsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Τρόποι πληρωμής"
      description="Παραμετροποίηση μεθόδων πληρωμής για POS και εισπράξεις"
      bullets={[
        "Η επιλογή payment methods επανήλθε στις ρυθμίσεις.",
        "Καλύπτει μετρητά, κάρτα, μεταφορά και μεικτούς τρόπους είσπραξης.",
        "Έτοιμο για επέκταση με λογιστικούς λογαριασμούς και κανόνες ανά σειρά.",
      ]}
    />
  );
}
