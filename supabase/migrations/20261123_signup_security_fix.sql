-- =====================================================================
-- QuickSell POS | CRITICAL FIX | The signup trigger was letting people choose their own role and shop
--
-- Your trigger on_auth_user_created calls handle_auth_user_sync() (not handle_new_user). The old version:
--   * took role and shop_id from the sign-up form data (raw_user_meta_data). Anyone can call the public
--     sign-up API with {"role":"admin","shop_id":"<another company's shop id>"} and get an admin
--     profile inside that company.  <-- cross-company hole
--   * re-keyed ANY existing profile with the same email to the new login (account takeover by email)
--   * never created an organization, so new business registrations got no company at all
--
-- This file:
--   1. rewrites handle_auth_user_sync(): role is always admin of the NEW company, shop/organization are
--      created by the server, nothing security-relevant is read from user-supplied data
--   2. tightens my_shop_ids(): a profile without an organization can never reach any shop, even if its
--      shop_id column is set
--   3. removes the now-unused handle_new_user() (only if no trigger uses it)
--   4. lists suspicious existing accounts (last statement)
-- Safe to re-run. One transaction.
-- =====================================================================
begin;

-- 1. The real signup function ------------------------------------------------------------------
create or replace function public.handle_auth_user_sync() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_business_name text := nullif(trim(new.raw_user_meta_data->>'business_name'), '');
  v_business_type text := coalesce(nullif(trim(new.raw_user_meta_data->>'business_type'), ''), 'retail');
  v_phone         text := nullif(trim(new.raw_user_meta_data->>'phone'), '');
  v_country       text := coalesce(nullif(trim(new.raw_user_meta_data->>'country'), ''), 'Kenya');
  v_full_name     text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
  v_org           uuid;
  v_shop          uuid;
  v_branch_code   text;
begin
  -- Staff logins are created by the staff-admin Edge Function, which creates their profile itself.
  -- Skipping provisioning can never grant access, so honouring either flag is safe.
  if coalesce(new.raw_app_meta_data->>'provisioned_by_server', 'false') = 'true'
     or coalesce(new.raw_user_meta_data->>'provisioned_by_server', 'false') = 'true' then
    return new;
  end if;

  if exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;

  -- never attach a new login to someone else's existing profile
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

  -- role is ALWAYS admin of the brand-new company; shop/organization come from the rows created above
  insert into public.profiles (id, email, full_name, role, shop_id, organization_id, country, phone, is_active)
  values (new.id, new.email, v_full_name, 'admin', v_shop, v_org, v_country, v_phone, true);

  return new;
end $$;

-- 2. A profile only reaches shops that belong to ITS OWN organization ---------------------------
create or replace function public.my_shop_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select s.id
    from public.shops s
    join public.profiles p on p.id = auth.uid() and coalesce(p.is_active, true)
   where p.organization_id is not null
     and s.organization_id = p.organization_id
     and (p.role::text in ('admin', 'owner') or s.id = p.shop_id)
$$;

-- 3. handle_new_user() was never attached to a trigger; remove it so nobody wires it up by mistake
do $$
begin
  if to_regprocedure('public.handle_new_user()') is not null
     and not exists (select 1 from pg_trigger where tgfoid = to_regprocedure('public.handle_new_user()')) then
    drop function public.handle_new_user();
  end if;
end $$;

commit;

-- 4. Look for accounts that may have been created with a chosen role / shop (send me the rows) ---
select u.email,
       u.created_at,
       u.raw_user_meta_data->>'role'    as signup_asked_for_role,
       u.raw_user_meta_data->>'shop_id' as signup_asked_for_shop,
       p.role::text                     as profile_role,
       p.organization_id is not null    as has_company
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.raw_user_meta_data ? 'role' or u.raw_user_meta_data ? 'shop_id' or p.organization_id is null
 order by u.created_at desc;
