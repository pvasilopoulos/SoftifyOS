-- Every foreign key column needs its own index (leading column), otherwise each delete/update of
-- the referenced row (ON DELETE CASCADE / SET NULL checks) sequentially scans the child table.
-- Our tenant-first indexes (tenant_id, x) cannot serve "WHERE x = ?" lookups made by FK actions.
-- Nullable references get partial indexes (smaller, the NULLs are never looked up).

CREATE INDEX IF NOT EXISTS customers_parent_fk      ON customers (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS customers_manager_fk     ON customers (account_manager_id) WHERE account_manager_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS branches_customer_fk     ON branches (customer_id);
CREATE INDEX IF NOT EXISTS spaces_branch_fk         ON spaces (branch_id);
CREATE INDEX IF NOT EXISTS contacts_customer_fk     ON contacts (customer_id);

CREATE INDEX IF NOT EXISTS offers_customer_fk       ON offers (customer_id);
CREATE INDEX IF NOT EXISTS offers_branch_fk         ON offers (branch_id) WHERE branch_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offers_space_fk          ON offers (space_id) WHERE space_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offers_company_fk        ON offers (company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offers_owner_fk          ON offers (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_versions_creator_fk ON offer_versions (created_by) WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_items_product_fk   ON offer_items (product_id) WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS offer_approvals_approver_fk ON offer_approvals (approver_id) WHERE approver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS events_customer_fk       ON events (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_owner_fk          ON events (owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notifications_user_fk    ON notifications (user_id);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_fk ON push_subscriptions (user_id);
