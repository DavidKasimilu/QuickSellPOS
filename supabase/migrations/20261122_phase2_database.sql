-- =====================================================================
-- QuickSell POS | PHASE 2 | Database part
-- Run AFTER the Phase 1 files. One transaction: any error rolls everything back.
-- Safe to re-run (everything is "if not exists" / "or replace").
--
--  1. handle_new_user(): skip auto-provisioning for staff created by the server (invite function)
--  2. POS device sessions: updated_at, one row per (shop, device), atomic heartbeat that can't un-revoke
--  3. Tables the app uses but your schema did not contain (created only if missing) + tenant RLS
--  4. Safe get_deleted_items / restore_deleted_item (run as the caller, so RLS applies)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Signup trigger: staff created by the invite function must NOT get their own company
--    (raw_app_meta_data can only be set server-side, never by a user signing up)
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_business_name text := nullif(trim(new.raw_user_meta_data->>'business_name'), '');
  v_business_type text := coalesce(nullif(trim(new.raw_user_meta_data->>'business_type'), ''), 'retail');
  v_phone         text := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  v_country       text := coalesce(nullif(trim(new.raw_user_meta_data->>'country'), ''), 'Kenya');
  v_full_name     text := coalesce(new.raw_user_meta_data->>'full_name', '');
  v_org           uuid;
  v_shop          uuid;
  v_branch_code   text;
begin
  -- staff account created by the server-side invite function: the function creates the profile itself
  if coalesce(new.raw_app_meta_data->>'provisioned_by_server', 'false') = 'true' then
    return new;
  end if;

  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  if exists (select 1 from public.profiles where lower(email) = lower(new.email)) then
    raise exception 'This email already belongs to a staff account. Ask your administrator for an invitation instead of registering a new business.';
  end if;

  v_business_name := coalesce(v_business_name, 'My Business');
  insert into public.organizations (name) values (v_business_name) returning id into v_org;

  v_branch_code := 'QS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') from 1 for 6));

  insert into public.shops (name, branch_code, business_type, phone, country, organization_id)
  values (v_business_name, v_branch_code, v_business_type, v_phone, v_country, v_org)
  returning id into v_shop;

  insert into public.receipt_templates (shop_id, business_name, header_text, footer_text)
  values (v_shop, v_business_name,
          'Thank you for shopping with us!',
          'Goods once sold are not returnable without a valid receipt.')
  on conflict (shop_id) do nothing;

  insert into public.store_settings (shop_id) values (v_shop) on conflict do nothing;

  insert into public.profiles (id, email, full_name, role, shop_id, organization_id, country, phone, is_active)
  values (new.id, new.email, v_full_name, 'admin'::user_role, v_shop, v_org, v_country, v_phone, true);

  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. POS device sessions
-- ---------------------------------------------------------------------
alter table public.pos_device_sessions add column if not exists updated_at timestamptz default now();

-- keep only the newest row per (shop, device) so the unique index can be created
delete from public.pos_device_sessions a
 using public.pos_device_sessions b
 where a.shop_id = b.shop_id
   and a.device_fingerprint = b.device_fingerprint
   and (coalesce(a.last_seen_at, a.created_at), a.id) < (coalesce(b.last_seen_at, b.created_at), b.id);

create unique index if not exists uq_pos_device_sessions_shop_fp
  on public.pos_device_sessions (shop_id, device_fingerprint);

-- drop any older versions of the functions this file (re)creates, whatever their signature
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('touch_device_heartbeat', 'get_deleted_items', 'restore_deleted_item')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- Runs as the CALLER (security invoker): RLS decides what they may touch.
-- Returns the device's is_active flag. It never sets is_active back to true, so a revoked terminal stays revoked.
create function public.touch_device_heartbeat(p_device_fingerprint text, p_device_name text, p_shop_id uuid)
returns boolean
language plpgsql security invoker set search_path = public as $$
declare v_active boolean;
begin
  if p_shop_id not in (select public.my_shop_ids()) then
    raise exception 'Not allowed for this shop';
  end if;

  insert into public.pos_device_sessions
         (shop_id, user_id, device_fingerprint, device_name, last_seen_at, updated_at, is_active)
  values (p_shop_id, auth.uid(), p_device_fingerprint, left(p_device_name, 200), now(), now(), true)
  on conflict (shop_id, device_fingerprint) do update
     set last_seen_at = now(),
         updated_at   = now(),
         device_name  = excluded.device_name,
         user_id      = excluded.user_id
  returning is_active into v_active;

  return v_active;
end $$;

-- ---------------------------------------------------------------------
-- 3. Tables the application uses (created only if they do not exist yet)
-- ---------------------------------------------------------------------
create table if not exists public.store_staff (
  id                 uuid primary key default gen_random_uuid(),
  shop_id            uuid not null references public.shops(id),
  full_name          text not null,
  job_title          text,
  department         text default 'General',
  phone              text,
  email              text,
  is_active          boolean not null default true,
  commission_balance numeric not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references public.profiles(id)
);

create table if not exists public.commission_rules (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id),
  rule_name  text not null,
  rate_type  text not null default 'percentage',
  rate_value numeric not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.staff_commission_logs (
  id                uuid primary key default gen_random_uuid(),
  shop_id           uuid not null references public.shops(id),
  staff_id          uuid references public.store_staff(id),
  order_id          uuid references public.orders(id),
  cashier_id        uuid references public.profiles(id),
  sale_amount       numeric not null default 0,
  commission_amount numeric not null default 0,
  created_at        timestamptz not null default now()
);

create table if not exists public.staff_commission_payouts (
  id             uuid primary key default gen_random_uuid(),
  shop_id        uuid not null references public.shops(id),
  staff_id       uuid not null references public.store_staff(id),
  amount         numeric not null check (amount > 0),
  payment_method text,
  reference_no   text,
  processed_by   uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);

create table if not exists public.pricing_tiers (
  id                   uuid primary key default gen_random_uuid(),
  shop_id              uuid not null references public.shops(id),
  name                 text not null,
  code                 text,
  default_discount_pct numeric not null default 0,
  description          text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz
);

create table if not exists public.product_pricing_rates (
  id           uuid primary key default gen_random_uuid(),
  shop_id      uuid not null references public.shops(id),
  product_id   uuid not null references public.products(id),
  tier_id      uuid not null references public.pricing_tiers(id),
  tier_price   numeric not null default 0,
  min_quantity integer not null default 1,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  shop_id     uuid not null references public.shops(id),
  role_name   text not null,
  role_key    text not null,
  description text,
  permissions text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table if not exists public.user_shop_roles (
  id         uuid primary key default gen_random_uuid(),
  shop_id    uuid not null references public.shops(id),
  user_id    uuid not null references public.profiles(id),
  role_id    uuid not null references public.user_roles(id),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (user_id, shop_id)
);

-- if user_shop_roles already existed without the (user_id, shop_id) uniqueness the app's upsert needs
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.user_shop_roles'::regclass and contype = 'u')
     and not exists (select 1 from public.user_shop_roles group by user_id, shop_id having count(*) > 1) then
    alter table public.user_shop_roles add constraint uq_user_shop_roles unique (user_id, shop_id);
  end if;
end $$;

create index if not exists idx_store_staff_shop            on public.store_staff (shop_id);
create index if not exists idx_commission_rules_shop       on public.commission_rules (shop_id);
create index if not exists idx_staff_commission_logs_shop  on public.staff_commission_logs (shop_id, created_at desc);
create index if not exists idx_staff_commission_pay_shop   on public.staff_commission_payouts (shop_id, created_at desc);
create index if not exists idx_pricing_tiers_shop          on public.pricing_tiers (shop_id);
create index if not exists idx_product_pricing_rates_shop  on public.product_pricing_rates (shop_id);
create index if not exists idx_user_roles_shop             on public.user_roles (shop_id);
create index if not exists idx_user_shop_roles_shop        on public.user_shop_roles (shop_id);

-- ---------------------------------------------------------------------
-- 3b. Tenant RLS for these tables (same rule as Phase 1; old policies dropped first)
-- ---------------------------------------------------------------------
create function pg_temp.reset_policies(tbl regclass) returns void language plpgsql as $$
declare p record;
begin
  for p in select policyname from pg_policies
            where schemaname = 'public'
              and tablename = (select relname from pg_class where oid = tbl)
  loop
    execute format('drop policy %I on %s', p.policyname, tbl);
  end loop;
  execute format('alter table %s enable row level security', tbl);
end $$;

do $$
declare t text;
begin
  foreach t in array array['store_staff', 'commission_rules', 'pricing_tiers', 'user_roles'] loop
    perform pg_temp.reset_policies(format('public.%I', t)::regclass);
    execute format($f$
      create policy tenant_isolation on public.%I for all to authenticated
        using      (shop_id in (select public.my_shop_ids()))
        with check (shop_id in (select public.my_shop_ids()))
    $f$, t);
  end loop;
end $$;

-- tables that point at other rows: the referenced rows must also be visible to the caller
-- (so a row can never be linked to another company's staff / product / order / role)
select pg_temp.reset_policies('public.staff_commission_logs'::regclass);
create policy tenant_isolation on public.staff_commission_logs for all to authenticated
  using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids())
    and (staff_id is null or exists (select 1 from public.store_staff s where s.id = staff_id))
    and (order_id is null or exists (select 1 from public.orders o where o.id = order_id)));

select pg_temp.reset_policies('public.staff_commission_payouts'::regclass);
create policy tenant_isolation on public.staff_commission_payouts for all to authenticated
  using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids())
    and exists (select 1 from public.store_staff s where s.id = staff_id));

select pg_temp.reset_policies('public.product_pricing_rates'::regclass);
create policy tenant_isolation on public.product_pricing_rates for all to authenticated
  using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids())
    and exists (select 1 from public.products p where p.id = product_id)
    and exists (select 1 from public.pricing_tiers t where t.id = tier_id));

select pg_temp.reset_policies('public.user_shop_roles'::regclass);
create policy tenant_isolation on public.user_shop_roles for all to authenticated
  using (shop_id in (select public.my_shop_ids()))
  with check (shop_id in (select public.my_shop_ids())
    and exists (select 1 from public.profiles p where p.id = user_id)
    and exists (select 1 from public.user_roles r where r.id = role_id));

revoke all on public.store_staff, public.commission_rules, public.staff_commission_logs,
              public.staff_commission_payouts, public.pricing_tiers, public.product_pricing_rates,
              public.user_roles, public.user_shop_roles from anon;

-- ---------------------------------------------------------------------
-- 4. Recycle bin functions: run as the caller, so RLS keeps every company inside its own data
-- ---------------------------------------------------------------------
create function public.get_deleted_items(p_shop_id uuid)
returns table (item_id uuid, item_name text, item_type text, details text, deleted_at timestamptz, deleted_by_name text)
language sql stable security invoker set search_path = public as $$
  select p.id, p.name, 'product'::text, coalesce(p.sku, p.barcode), p.deleted_at, pr.full_name
    from public.products p
    left join public.profiles pr on pr.id = p.deleted_by
   where p.shop_id = p_shop_id
     and p.shop_id in (select public.my_shop_ids())
     and p.deleted_at is not null
  union all
  select c.id, c.name, 'category'::text, c.description, c.deleted_at, pr.full_name
    from public.categories c
    left join public.profiles pr on pr.id = c.deleted_by
   where c.shop_id = p_shop_id
     and c.shop_id in (select public.my_shop_ids())
     and (c.is_deleted or c.deleted_at is not null)
  order by 5 desc nulls last
$$;

create function public.restore_deleted_item(p_item_id uuid, p_item_type text)
returns boolean
language plpgsql security invoker set search_path = public as $$
declare n integer;
begin
  if (select public.my_role()) not in ('admin', 'owner', 'manager') then
    raise exception 'Only managers and administrators can restore deleted items';
  end if;

  if p_item_type = 'product' then
    update public.products
       set deleted_at = null, deleted_by = null, updated_at = now()
     where id = p_item_id and deleted_at is not null;
  elsif p_item_type = 'category' then
    update public.categories
       set is_deleted = false, deleted_at = null, deleted_by = null, updated_at = now()
     where id = p_item_id and (is_deleted or deleted_at is not null);
  else
    raise exception 'Unknown item type: %', p_item_type;
  end if;

  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function public.touch_device_heartbeat(text, text, uuid),
                       public.get_deleted_items(uuid),
                       public.restore_deleted_item(uuid, text) from public, anon;
grant execute on function public.touch_device_heartbeat(text, text, uuid),
                          public.get_deleted_items(uuid),
                          public.restore_deleted_item(uuid, text) to authenticated;

commit;

-- After running, send me the result of this (anything listed still needs a policy):
select c.relname as table_without_policy
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
 order by 1;
