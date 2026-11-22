-- =====================================================================
-- QuickSell POS  |  PHASE 1  |  Tenant isolation (company A can never see company B)
--
-- HOW TO RUN
--   1. Run on a Supabase BRANCH / staging copy first, never straight on production.
--   2. BEFORE running, make sure YOUR admin profile has a shop_id:
--        select id, email, role, shop_id from public.profiles order by created_at;
--      Profiles with no shop_id end up with NO access after this migration.
--   3. Run this whole file (one transaction: any error rolls everything back).
--   4. Then run 02_signup_trigger_REVIEW_FIRST.sql (read its header first).
--   5. Then deploy the patched JS, then run 03_phase1_verify.sql.
--
-- MODEL
--   organizations (company) -> shops (branches) -> everything else via shop_id
--   admin/owner : all shops in their own organization
--   everyone else: only their assigned shop
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 0. Organizations
-- ---------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now()
);

alter table public.shops    add column if not exists organization_id uuid references public.organizations(id) on delete restrict;
alter table public.profiles add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists idx_shops_org       on public.shops(organization_id);
create index if not exists idx_profiles_org    on public.profiles(organization_id);
create index if not exists idx_profiles_shop   on public.profiles(shop_id);

-- Backfill: every existing shop becomes its OWN organization (strictest option).
-- If several shops really belong to one company, merge them afterwards, e.g.:
--   update public.shops    set organization_id = '<org uuid>' where id in ('<shop1>','<shop2>');
--   update public.profiles p set organization_id = s.organization_id from public.shops s where p.shop_id = s.id;
do $$
declare
  rec     record;
  new_org uuid;
begin
  for rec in select id, name from public.shops where organization_id is null loop
    insert into public.organizations(name) values (rec.name) returning id into new_org;
    update public.shops set organization_id = new_org where id = rec.id;
  end loop;

  update public.profiles pr
     set organization_id = sh.organization_id
    from public.shops sh
   where pr.shop_id = sh.id and pr.organization_id is null;
end $$;

-- ---------------------------------------------------------------------
-- 1. Helper functions (SECURITY DEFINER so they can read profiles without RLS recursion)
-- ---------------------------------------------------------------------
create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select p.organization_id from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_active, true)
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select p.role::text from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_active, true)
$$;

-- every shop in the caller's organization
create or replace function public.org_shop_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id
    from public.shops s
    join public.profiles p on p.id = auth.uid() and coalesce(p.is_active, true)
   where p.organization_id is not null and s.organization_id = p.organization_id
$$;

-- shops the caller may actually work in: admins/owners = whole org, everyone else = own shop
create or replace function public.my_shop_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id
    from public.shops s
    join public.profiles p on p.id = auth.uid() and coalesce(p.is_active, true)
   where (p.role::text in ('admin','owner') and p.organization_id is not null and s.organization_id = p.organization_id)
      or  s.id = p.shop_id
$$;

revoke all on function public.my_org_id(), public.my_role(), public.org_shop_ids(), public.my_shop_ids() from public, anon;
grant execute on function public.my_org_id(), public.my_role(), public.org_shop_ids(), public.my_shop_ids() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Temp helpers used only by this script
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

-- policy for tables WITHOUT shop_id: row is allowed only if its parent row is visible
-- (the parent's own RLS applies inside the sub-select)
create function pg_temp.child_policy(child text, cond text) returns void language plpgsql as $$
begin
  if to_regclass(format('public.%I', child)) is null then
    raise notice 'skip % (table does not exist)', child;
    return;
  end if;
  perform pg_temp.reset_policies(format('public.%I', child)::regclass);
  execute format('create policy tenant_isolation on public.%I for all to authenticated using (%s) with check (%s)', child, cond, cond);
end $$;

-- ---------------------------------------------------------------------
-- 3. Every table that has a shop_id column: strict tenant policy.
--    ALL pre-existing policies on these tables are dropped first, because permissive
--    policies are OR-ed together (an old "authenticated = true" policy would defeat this).
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public'
       and c.column_name  = 'shop_id'
       and c.table_name not in ('profiles', 'measurement_units', 'role_permissions')
  loop
    perform pg_temp.reset_policies(format('public.%I', t)::regclass);
    execute format($f$
      create policy tenant_isolation on public.%I for all to authenticated
        using      (shop_id in (select public.my_shop_ids()))
        with check (shop_id in (select public.my_shop_ids()))
    $f$, t);
    raise notice 'tenant policy applied: %', t;
  end loop;
end $$;

-- Shared-readable tables: rows with shop_id NULL are system defaults (readable, never writable)
do $$
declare t text;
begin
  foreach t in array array['measurement_units', 'role_permissions'] loop
    if to_regclass(format('public.%I', t)) is null then continue; end if;
    perform pg_temp.reset_policies(format('public.%I', t)::regclass);
    execute format('create policy %1$s_select on public.%1$I for select to authenticated using (shop_id is null or shop_id in (select public.my_shop_ids()))', t);
    execute format('create policy %1$s_insert on public.%1$I for insert to authenticated with check (shop_id in (select public.my_shop_ids()))', t);
    execute format('create policy %1$s_update on public.%1$I for update to authenticated using (shop_id in (select public.my_shop_ids())) with check (shop_id in (select public.my_shop_ids()))', t);
    execute format('create policy %1$s_delete on public.%1$I for delete to authenticated using (shop_id in (select public.my_shop_ids()))', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 4. Child tables without shop_id: inherit visibility from their parent(s)
-- ---------------------------------------------------------------------
select pg_temp.child_policy('purchase_order_items',  'exists (select 1 from public.purchase_orders p where p.id = po_id)');
select pg_temp.child_policy('grn_items',             'exists (select 1 from public.goods_received_notes p where p.id = grn_id)');
select pg_temp.child_policy('prn_items',             'exists (select 1 from public.purchase_return_notes p where p.id = prn_id)');
select pg_temp.child_policy('inventory_audit_items', 'exists (select 1 from public.inventory_audits p where p.id = audit_id)');
select pg_temp.child_policy('stock_transfer_items',  'exists (select 1 from public.stock_transfers p where p.id = transfer_id)');
select pg_temp.child_policy('product_modifiers',
  'exists (select 1 from public.products p where p.id = product_id) and exists (select 1 from public.modifiers m where m.id = modifier_id)');
select pg_temp.child_policy('product_modifier_groups',
  'exists (select 1 from public.products p where p.id = product_id) and exists (select 1 from public.modifier_groups g where g.id = modifier_group_id)');
select pg_temp.child_policy('product_assemblies',
  'exists (select 1 from public.products p where p.id = parent_product_id) and exists (select 1 from public.products r where r.id = raw_material_id)');

-- ---------------------------------------------------------------------
-- 5. stock_transfers (two shops, no shop_id column)
-- ---------------------------------------------------------------------
select pg_temp.reset_policies('public.stock_transfers'::regclass);
create policy transfers_select on public.stock_transfers for select to authenticated
  using (source_shop_id in (select public.my_shop_ids()) or target_shop_id in (select public.my_shop_ids()));
create policy transfers_insert on public.stock_transfers for insert to authenticated
  with check (source_shop_id in (select public.my_shop_ids()) and target_shop_id in (select public.org_shop_ids()));
create policy transfers_update on public.stock_transfers for update to authenticated
  using (source_shop_id in (select public.my_shop_ids()) or target_shop_id in (select public.my_shop_ids()))
  with check (source_shop_id in (select public.org_shop_ids()) and target_shop_id in (select public.org_shop_ids()));
create policy transfers_delete on public.stock_transfers for delete to authenticated
  using (source_shop_id in (select public.my_shop_ids()));

-- ---------------------------------------------------------------------
-- 6. organizations + shops
-- ---------------------------------------------------------------------
select pg_temp.reset_policies('public.organizations'::regclass);
create policy org_select on public.organizations for select to authenticated
  using (id = (select public.my_org_id()));
-- no insert/update/delete policy => only the server (signup trigger / service role) can write

select pg_temp.reset_policies('public.shops'::regclass);
create policy shops_select on public.shops for select to authenticated
  using (id in (select public.my_shop_ids()));
create policy shops_insert on public.shops for insert to authenticated
  with check (organization_id = (select public.my_org_id()) and (select public.my_role()) in ('admin','owner'));
create policy shops_update on public.shops for update to authenticated
  using      (id in (select public.my_shop_ids()) and (select public.my_role()) in ('admin','owner'))
  with check (id in (select public.my_shop_ids()) and (select public.my_role()) in ('admin','owner'));
-- no delete policy: shops can only be removed server-side

create or replace function public.guard_shop_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;            -- SQL editor / service role / auth triggers
  if tg_op = 'INSERT' then
    new.organization_id := public.my_org_id();               -- client can never choose the company
  elsif new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_shop_write on public.shops;
create trigger trg_guard_shop_write before insert or update on public.shops
  for each row execute function public.guard_shop_write();

-- ---------------------------------------------------------------------
-- 7. profiles: scoped visibility + no self-promotion / no cross-tenant moves
-- ---------------------------------------------------------------------
select pg_temp.reset_policies('public.profiles'::regclass);

create policy profiles_select on public.profiles for select to authenticated using (
  id = auth.uid()
  or shop_id in (select public.my_shop_ids())
  or (organization_id = (select public.my_org_id()) and (select public.my_role()) in ('admin','owner'))
);
create policy profiles_insert on public.profiles for insert to authenticated with check (
  organization_id = (select public.my_org_id()) and (select public.my_role()) in ('admin','owner','manager')
);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()
         or (organization_id = (select public.my_org_id()) and (select public.my_role()) in ('admin','owner','manager')))
  with check (id = auth.uid()
         or (organization_id = (select public.my_org_id()) and (select public.my_role()) in ('admin','owner','manager')));
create policy profiles_delete on public.profiles for delete to authenticated using (
  organization_id = (select public.my_org_id()) and (select public.my_role()) in ('admin','owner') and id <> auth.uid()
);

create or replace function public.guard_profile_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  caller    uuid := auth.uid();
  c_role    text;
  c_org     uuid;
  c_shop    uuid;
  is_admin  boolean;
  is_mgr    boolean;
begin
  if caller is null then return new; end if;                -- SQL editor / service role / auth triggers

  select p.role::text, p.organization_id, p.shop_id
    into c_role, c_org, c_shop
    from public.profiles p
   where p.id = caller and coalesce(p.is_active, true);
  if c_role is null then raise exception 'Caller has no active profile'; end if;

  is_admin := c_role in ('admin','owner');
  is_mgr   := (c_role = 'manager');

  if tg_op = 'INSERT' then
    if not (is_admin or is_mgr) then raise exception 'You are not allowed to create users'; end if;
    new.organization_id := c_org;                            -- forced: users are created inside the creator's company
    if is_mgr and new.role::text in ('admin','owner') then raise exception 'Managers cannot create admins'; end if;
    if is_mgr and new.shop_id is distinct from c_shop then raise exception 'Managers can only add staff to their own shop'; end if;
    if new.shop_id is not null and not exists (select 1 from public.org_shop_ids() x where x = new.shop_id) then
      raise exception 'Shop does not belong to your organization';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.id is distinct from old.id then raise exception 'id is immutable'; end if;
  if new.organization_id is distinct from old.organization_id then raise exception 'organization_id is immutable'; end if;

  if new.role is distinct from old.role
     or new.shop_id is distinct from old.shop_id
     or new.is_active is distinct from old.is_active
     or new.commission_rate is distinct from old.commission_rate
     or new.email is distinct from old.email
     or new.pos_pin is distinct from old.pos_pin then

    if not (is_admin or (is_mgr and old.id <> caller)) then
      raise exception 'Only an administrator can change role, shop, status, email, PIN or commission';
    end if;
    if is_mgr then
      if old.role::text in ('admin','owner') or new.role::text in ('admin','owner') then
        raise exception 'Managers cannot modify or grant administrator access';
      end if;
      if old.shop_id is distinct from c_shop or (new.shop_id is not null and new.shop_id is distinct from c_shop) then
        raise exception 'Managers can only manage staff of their own shop';
      end if;
    end if;
    if new.shop_id is not null and not exists (select 1 from public.org_shop_ids() x where x = new.shop_id) then
      raise exception 'Shop does not belong to your organization';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_profile_write on public.profiles;
create trigger trg_guard_profile_write before insert or update on public.profiles
  for each row execute function public.guard_profile_write();

-- ---------------------------------------------------------------------
-- 8. The anonymous role gets nothing
-- ---------------------------------------------------------------------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;

-- ---------------------------------------------------------------------
-- 9. Diagnostics (read the NOTICE output)
-- ---------------------------------------------------------------------
do $$
declare r record; n bigint;
begin
  for r in
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb
        on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'shop_id' and c.is_nullable = 'YES'
       and c.table_name not in ('measurement_units', 'role_permissions')
  loop
    execute format('select count(*) from public.%I where shop_id is null', r.table_name) into n;
    if n > 0 then
      raise notice 'ORPHANED ROWS: % has % row(s) with NULL shop_id (now invisible to everyone - assign a shop_id)', r.table_name, n;
    end if;
  end loop;

  select count(*) into n from public.profiles where organization_id is null;
  if n > 0 then raise notice 'PROFILES WITHOUT AN ORGANIZATION: % (they have no access until a shop is assigned)', n; end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- 10. Run these two queries afterwards and send me the results.
--     Anything listed here still needs a policy (they are tables I could not see in your schema).
-- ---------------------------------------------------------------------
-- tables with RLS OFF:
select c.relname as table_without_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
 order by 1;

-- tables with RLS ON but no policy at all (they deny everything):
select c.relname as table_with_rls_but_no_policy
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
   and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname)
 order by 1;
