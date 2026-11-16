-- Deleting a tenant cascades to its customers; the AFTER DELETE counter trigger then tried to
-- upsert a counter for the tenant being deleted and failed on the foreign key.
-- Skip counter maintenance when the tenant no longer exists.
CREATE OR REPLACE FUNCTION trg_customer_counter() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE t uuid := coalesce(NEW.tenant_id, OLD.tenant_id);
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = t) THEN
    RETURN NULL;
  END IF;
  INSERT INTO tenant_counters (tenant_id, key, value)
  VALUES (t, 'customers', CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE -1 END)
  ON CONFLICT (tenant_id, key) DO UPDATE SET value = tenant_counters.value + EXCLUDED.value;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION trg_offer_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = OLD.tenant_id) THEN
    RETURN NULL;
  END IF;
  IF TG_OP IN ('UPDATE','DELETE') THEN
    UPDATE tenant_offer_stats SET count = count - 1, amount = amount - OLD.total_amount
     WHERE tenant_id = OLD.tenant_id AND status = OLD.status;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    INSERT INTO tenant_offer_stats (tenant_id, status, count, amount)
    VALUES (NEW.tenant_id, NEW.status, 1, NEW.total_amount)
    ON CONFLICT (tenant_id, status) DO UPDATE
      SET count = tenant_offer_stats.count + 1, amount = tenant_offer_stats.amount + EXCLUDED.amount;
  END IF;
  RETURN NULL;
END $$;
