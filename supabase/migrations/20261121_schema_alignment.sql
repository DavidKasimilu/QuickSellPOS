-- QuickSell POS: Schema Alignment for Employees, Customers, Loyalty & Settlements
-- Run this in your Supabase SQL Editor

-- 1. Ensure Loyalty tables match js/views/loyalty.js
CREATE TABLE IF NOT EXISTS public.loyalty_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  spend_amount_per_point NUMERIC NOT NULL DEFAULT 100.00,
  point_redemption_value NUMERIC NOT NULL DEFAULT 1.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.loyalty_point_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('earned', 'redeemed')),
  points INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Align debtor_settlements columns with js/views/debtorManagement.js & creditSettlements.js
ALTER TABLE public.debtor_settlements
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id);

ALTER TABLE public.debtor_settlements
  ALTER COLUMN settlement_no SET DEFAULT ('SET-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 4)),
  ALTER COLUMN amount DROP NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_debtor_settlement_cols()
RETURNS trigger AS $$
BEGIN
  IF NEW.amount_paid IS NOT NULL AND NEW.amount IS NULL THEN
    NEW.amount := NEW.amount_paid;
  ELSIF NEW.amount IS NOT NULL AND NEW.amount_paid IS NULL THEN
    NEW.amount_paid := NEW.amount;
  END IF;
  IF NEW.created_by IS NOT NULL AND NEW.received_by IS NULL THEN
    NEW.received_by := NEW.created_by;
  ELSIF NEW.received_by IS NOT NULL AND NEW.created_by IS NULL THEN
    NEW.created_by := NEW.received_by;
  END IF;
  IF NEW.settlement_no IS NULL OR NEW.settlement_no = '' THEN
    NEW.settlement_no := 'SET-' || to_char(now(), 'YYYYMMDDHH24MISS') || '-' || substr(md5(random()::text), 1, 4);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_debtor_settlement ON public.debtor_settlements;
CREATE TRIGGER trg_sync_debtor_settlement
  BEFORE INSERT OR UPDATE ON public.debtor_settlements
  FOR EACH ROW EXECUTE FUNCTION public.sync_debtor_settlement_cols();

-- 3. Align suppliers columns with js/views/suppliers.js & supplierCredit.js
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS contact_person TEXT,
  ADD COLUMN IF NOT EXISTS tax_pin TEXT,
  ADD COLUMN IF NOT EXISTS balance NUMERIC DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.profiles(id);

-- 4. Enable RLS on new loyalty tables
ALTER TABLE public.loyalty_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loyalty_point_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant full access on loyalty_rules" ON public.loyalty_rules;
CREATE POLICY "Tenant full access on loyalty_rules" ON public.loyalty_rules
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Tenant full access on loyalty_point_logs" ON public.loyalty_point_logs;
CREATE POLICY "Tenant full access on loyalty_point_logs" ON public.loyalty_point_logs
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
