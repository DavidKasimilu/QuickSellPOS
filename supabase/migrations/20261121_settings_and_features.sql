-- QuickSell POS: Settings Redesign & Feature Flags Migration
-- Run this in your Supabase SQL Editor

-- 1. Store Features & System Settings (1-to-1 per shop)
CREATE TABLE IF NOT EXISTS public.store_settings (
  shop_id UUID PRIMARY KEY REFERENCES public.shops(id) ON DELETE CASCADE,
  features JSONB NOT NULL DEFAULT '{
    "open_orders": false,
    "shift_management": false,
    "time_clock": false,
    "multipayment": false,
    "taxes_charges": true,
    "order_types": false,
    "service_areas": false,
    "manage_currency": false,
    "email_notifications": false,
    "addon_apps": true,
    "kot_notes": false,
    "credit_note": false,
    "embedded_barcodes": false
  }'::jsonb,
  software_setup JSONB NOT NULL DEFAULT '{
    "auto_print_receipt": false,
    "sound_effects": true,
    "low_stock_alert_threshold": 5,
    "offline_sync_interval_sec": 30,
    "require_pin_per_sale": false
  }'::jsonb,
  qr_receipt_config JSONB NOT NULL DEFAULT '{
    "enabled": false,
    "qr_type": "etims_or_url",
    "custom_url": "",
    "label_text": "Scan to verify receipt",
    "qr_size": 120
  }'::jsonb,
  email_notifications_config JSONB NOT NULL DEFAULT '{
    "daily_sales_summary": false,
    "user_login_logout": false,
    "low_stock_alerts": false,
    "recipient_email": ""
  }'::jsonb,
  subscription_plan TEXT NOT NULL DEFAULT 'starter',
  subscription_status TEXT NOT NULL DEFAULT 'active',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Taxes & Charges Table
CREATE TABLE IF NOT EXISTS public.store_taxes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rate NUMERIC(6,2) NOT NULL DEFAULT 16.00,
  tax_type TEXT NOT NULL DEFAULT 'tax', -- 'tax' | 'charge'
  application_mode TEXT NOT NULL DEFAULT 'included', -- 'included' | 'excluded' | 'attached'
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Order Types (Dining, Delivery, Take away, etc.)
CREATE TABLE IF NOT EXISTS public.store_order_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Service Areas (Tables, Rooms, Counters)
CREATE TABLE IF NOT EXISTS public.store_service_areas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  area_group TEXT DEFAULT 'Main Floor',
  capacity INT DEFAULT 4,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Multi-Currency Rates
CREATE TABLE IF NOT EXISTS public.store_currencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  currency_code TEXT NOT NULL,
  symbol TEXT NOT NULL,
  exchange_rate NUMERIC(12,4) NOT NULL DEFAULT 1.0000,
  is_base BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Addon Apps Registry
CREATE TABLE IF NOT EXISTS public.store_addons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  addon_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_installed BOOLEAN NOT NULL DEFAULT false,
  config JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shop_id, addon_key)
);

-- 7. Ensure profiles has pin_code & phone for Employees CRUD
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS pos_pin TEXT;

-- Enable RLS
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_taxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_order_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_service_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_addons ENABLE ROW LEVEL SECURITY;

-- Permissive tenant policies (adjust if your auth policies use custom helper functions)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['store_settings', 'store_taxes', 'store_order_types', 'store_service_areas', 'store_currencies', 'store_addons']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Tenant full access on %I" ON public.%I;', tbl, tbl);
    EXECUTE format('CREATE POLICY "Tenant full access on %I" ON public.%I FOR ALL USING (auth.role() = ''authenticated'') WITH CHECK (auth.role() = ''authenticated'');', tbl, tbl);
  END LOOP;
END $$;
