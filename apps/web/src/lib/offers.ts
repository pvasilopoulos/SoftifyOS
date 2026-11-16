export type OfferItem = {
  id?: string; position: number; product_id?: string | null; description: string; unit: string;
  quantity: string; unit_price: string; discount: string; vat_rate: string; net_amount: string; vat_amount: string;
};

export type OfferDetail = {
  offer: {
    id: string; number: string; status: string; current_version: number;
    net_amount: string; vat_amount: string; total_amount: string; valid_until: string | null; created_at: string;
    customer_id: string; customer_name: string; branch_id: string | null; branch_name: string | null;
    space_id: string | null; space_name: string | null; company_id: string | null; company_name: string | null; company_vat: string | null;
    owner_name: string | null; notes: string | null;
    sent_at: string | null; sent_to: string | null; responded_at: string | null; responder_name: string | null; response_note: string | null;
  };
  version: number;
  versions: { version: number; net_amount: string; vat_amount: string; total_amount: string; created_at: string; note: string | null; created_by_name: string | null }[];
  items: (OfferItem & { id: string })[];
  approvals: { id: string; step: number; title: string; required_role: string; status: string; decided_at: string | null; comment: string | null; approver_name: string | null }[];
  publicUrl: string | null;
  can: { edit: boolean; submit: boolean; approve: boolean; send: boolean };
};

export type PublicOffer = {
  offer: {
    number: string; status: string; current_version: number; net_amount: string; vat_amount: string; total_amount: string;
    valid_until: string | null; sent_at: string | null; responded_at: string | null; responder_name: string | null; notes: string | null;
    customer_name: string; branch_name: string | null; space_name: string | null; company_name: string | null; company_vat: string | null;
    tenant_name: string; owner_name: string | null; owner_email: string | null;
  };
  items: OfferItem[];
  expired: boolean;
};
