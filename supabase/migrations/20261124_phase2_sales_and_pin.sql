-- =====================================================================
-- QuickSell POS | PHASE 2 (continued) | Sales function hardening + email/PIN sign-in
-- One transaction. Safe to re-run.
--
-- PART A  process_pos_sale() was SECURITY DEFINER (ignores row-level security) and trusted the shop,
--         customer, product, cashier and cost values sent by the browser. Any logged-in user of ANY
--         company could post sales into another company's shop, deduct its stock and change its
--         customers' balances. It also left shop_id empty on order_items and payments, which the
--         new tenant rules treat as "invisible to everyone" (sales reports would come up short).
-- PART B  Database side of "sign in with email + 4-digit PIN": hashed PINs, lockouts, throttling.
-- =====================================================================
begin;

-- =====================================================================
-- PART A. process_pos_sale
-- =====================================================================

-- A1. Repair rows the old function left without a shop (invisible under the tenant rules)
update public.order_items oi set shop_id = o.shop_id from public.orders o where oi.order_id = o.id and oi.shop_id is null;
update public.payments p set shop_id = o.shop_id from public.orders o where p.order_id = o.id and p.shop_id is null;
update public.deleted_order_items d set shop_id = o.shop_id from public.orders o where d.order_id = o.id and d.shop_id is null;
update public.order_charges c set shop_id = o.shop_id from public.orders o where c.order_id = o.id and c.shop_id is null;
update public.order_item_modifiers m set shop_id = oi.shop_id from public.order_items oi where m.order_item_id = oi.id and m.shop_id is null;

-- A2. The function now runs AS THE CALLER (security invoker): row-level security applies to every
--     statement inside it, on top of the explicit checks below.
create or replace function public.process_pos_sale(p_order jsonb, p_items jsonb, p_payments jsonb)
returns jsonb
language plpgsql security invoker set search_path = public
as $$
declare
  v_order_id     uuid;
  v_existing     record;
  v_receipt_no   text;
  v_shop_id      uuid;
  v_customer_id  uuid;
  v_cashier_id   uuid;
  v_shift_id     uuid;
  v_status       order_status;
  v_currency     text;
  v_item         jsonb;
  v_payment      jsonb;
  v_product_id   uuid;
  v_qty          numeric;
  v_track_inv    boolean;
  v_unit_cost    numeric;
  v_points       numeric := 0;
  v_total_paid   numeric := 0;
  v_order_total  numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_order is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A sale needs at least one item';
  end if;
  p_payments := coalesce(p_payments, '[]'::jsonb);
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Invalid payments';
  end if;

  -- 1. The shop must be one this user is allowed to sell in (their own shop, or any shop of their company for admins)
  v_shop_id := nullif(p_order->>'shop_id', '')::uuid;
  if v_shop_id is null or v_shop_id not in (select public.my_shop_ids()) then
    raise exception 'You are not allowed to record sales for this store';
  end if;

  v_receipt_no := nullif(trim(coalesce(p_order->>'receipt_no', '')), '');
  if v_receipt_no is null then
    raise exception 'Receipt number is required';
  end if;

  v_order_total := (p_order->>'total')::numeric;
  if v_order_total is null or v_order_total < 0 or coalesce((p_order->>'subtotal')::numeric, 0) < 0 then
    raise exception 'Invalid order totals';
  end if;

  v_status := coalesce(nullif(p_order->>'order_status', '')::order_status, 'completed'::order_status);

  -- 2. Idempotency: a retried offline sync must not double-post
  if nullif(p_order->>'id', '') is not null then
    v_order_id := (p_order->>'id')::uuid;
    select o.id, o.shop_id, o.receipt_no into v_existing from public.orders o where o.id = v_order_id;
    if found then
      if v_existing.shop_id is distinct from v_shop_id then
        raise exception 'Order could not be recorded';
      end if;
      return jsonb_build_object('success', true, 'order_id', v_existing.id, 'receipt_no', v_existing.receipt_no,
                                'message', 'Order already processed (idempotent)');
    end if;
  else
    v_order_id := gen_random_uuid();
  end if;

  -- 3. Everything the order points at must belong to THIS shop
  v_customer_id := nullif(p_order->>'customer_id', '')::uuid;
  if v_customer_id is not null
     and not exists (select 1 from public.customers c where c.id = v_customer_id and c.shop_id = v_shop_id) then
    raise exception 'Customer does not belong to this store';
  end if;

  v_cashier_id := nullif(p_order->>'cashier_id', '')::uuid;
  if v_cashier_id is null
     or not exists (select 1 from public.profiles p where p.id = v_cashier_id and p.shop_id = v_shop_id) then
    v_cashier_id := auth.uid();   -- never trust an arbitrary cashier id from the browser
  end if;

  v_shift_id := nullif(p_order->>'shift_id', '')::uuid;
  if v_shift_id is not null
     and not exists (select 1 from public.shifts s where s.id = v_shift_id and s.shop_id = v_shop_id) then
    v_shift_id := null;
  end if;

  select s.currency into v_currency from public.shops s where s.id = v_shop_id;

  -- 4. The order (currency is stamped from the shop, not from the browser)
  begin
    insert into public.orders (
      id, receipt_no, shop_id, cashier_id, customer_id, shift_id,
      subtotal, discount_amount, tax_amount, total,
      order_status, service_type, synced_from_offline, offline_created_at, created_at,
      currency_code, exchange_rate
    ) values (
      v_order_id, v_receipt_no, v_shop_id, v_cashier_id, v_customer_id, v_shift_id,
      coalesce((p_order->>'subtotal')::numeric, v_order_total),
      coalesce((p_order->>'discount_amount')::numeric, 0.00),
      coalesce((p_order->>'tax_amount')::numeric, 0.00),
      v_order_total,
      v_status,
      coalesce(nullif(p_order->>'service_type', '')::order_service_type, 'walk_in'::order_service_type),
      coalesce((p_order->>'synced_from_offline')::boolean, false),
      nullif(p_order->>'offline_created_at', '')::timestamptz,
      coalesce(nullif(p_order->>'created_at', '')::timestamptz, now()),
      coalesce(v_currency, 'KES'), 1.0000
    );
  exception when unique_violation then
    -- two retries racing each other, or a receipt number already used
    select o.id, o.shop_id, o.receipt_no into v_existing from public.orders o where o.id = v_order_id;
    if found and v_existing.shop_id = v_shop_id then
      return jsonb_build_object('success', true, 'order_id', v_existing.id, 'receipt_no', v_existing.receipt_no,
                                'message', 'Order already processed (idempotent)');
    end if;
    raise exception 'Receipt number % is already in use', v_receipt_no;
  end;

  -- 5. Line items and stock
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty        := (v_item->>'quantity')::numeric;

    if v_qty is null or v_qty <= 0 then
      raise exception 'Invalid quantity for %', coalesce(v_item->>'product_name', 'an item');
    end if;
    if coalesce((v_item->>'unit_price')::numeric, 0) < 0 or coalesce((v_item->>'total')::numeric, 0) < 0 then
      raise exception 'Invalid price for %', coalesce(v_item->>'product_name', 'an item');
    end if;

    -- product must belong to this shop (deleted products are still accepted: an offline sale already happened)
    select p.track_inventory, p.cost_price
      into v_track_inv, v_unit_cost
      from public.products p
     where p.id = v_product_id and p.shop_id = v_shop_id;
    if not found then
      raise exception 'A product in this sale does not belong to this store';
    end if;

    insert into public.order_items (
      id, order_id, product_id, product_name, unit_price, cost_price, quantity,
      tax_rate, discount_amount, total, shop_id
    ) values (
      coalesce(nullif(v_item->>'id', '')::uuid, gen_random_uuid()),
      v_order_id, v_product_id, v_item->>'product_name',
      (v_item->>'unit_price')::numeric,
      coalesce(v_unit_cost, 0.00),                    -- cost comes from the database, not the browser
      v_qty,
      coalesce((v_item->>'tax_rate')::numeric, 0.00),
      coalesce((v_item->>'discount_amount')::numeric, 0.00),
      (v_item->>'total')::numeric,
      v_shop_id
    );

    if coalesce(v_track_inv, true) then
      -- serialize first-time stock rows for this product so two sales cannot create duplicates
      perform pg_advisory_xact_lock(hashtextextended(v_shop_id::text || v_product_id::text, 0));

      update public.inventory
         set quantity_on_hand = quantity_on_hand - v_qty, updated_at = now()
       where product_id = v_product_id and shop_id = v_shop_id;

      if not found then
        insert into public.inventory (shop_id, product_id, quantity_on_hand, min_stock_level, updated_at)
        values (v_shop_id, v_product_id, -v_qty, 5.00, now());
      end if;

      insert into public.inventory_transactions (shop_id, product_id, transaction_type, quantity, unit_cost, reference, created_at)
      values (v_shop_id, v_product_id, 'sale', -v_qty, coalesce(v_unit_cost, 0.00), 'Sale Receipt: ' || v_receipt_no, now());
    end if;
  end loop;

  -- 6. Payments
  for v_payment in select * from jsonb_array_elements(p_payments) loop
    if coalesce((v_payment->>'amount')::numeric, 0) < 0 then
      raise exception 'Invalid payment amount';
    end if;

    insert into public.payments (id, order_id, amount, payment_method, reference_no, reference_code, created_at, shop_id)
    values (
      coalesce(nullif(v_payment->>'id', '')::uuid, gen_random_uuid()),
      v_order_id,
      (v_payment->>'amount')::numeric,
      (v_payment->>'payment_method')::payment_method,
      v_payment->>'reference_no',
      v_payment->>'reference_code',
      coalesce(nullif(v_payment->>'created_at', '')::timestamptz, now()),
      v_shop_id
    );
    v_total_paid := v_total_paid + (v_payment->>'amount')::numeric;
  end loop;

  -- a completed sale that is not fully paid must be charged to a customer account (otherwise goods leave for free)
  if v_status::text = 'completed' and (v_order_total - v_total_paid) > 0.009 and v_customer_id is null then
    raise exception 'An unpaid balance of % needs a customer account', round(v_order_total - v_total_paid, 2);
  end if;

  -- 7. Customer: loyalty points and credit balance
  if v_customer_id is not null then
    v_points := floor(v_order_total / 100);

    update public.customers
       set loyalty_points      = coalesce(loyalty_points, 0) + v_points,
           outstanding_balance = coalesce(outstanding_balance, 0) + greatest(0, v_order_total - v_total_paid),
           updated_at          = now()
     where id = v_customer_id and shop_id = v_shop_id;

    if v_points > 0 then
      insert into public.loyalty_logs (shop_id, customer_id, points_delta, action_type, order_id)
      values (v_shop_id, v_customer_id, v_points, 'earned_from_sale', v_order_id);
    end if;
  end if;

  return jsonb_build_object('success', true, 'order_id', v_order_id, 'receipt_no', v_receipt_no,
                            'currency', coalesce(v_currency, 'KES'));
end $$;

-- only signed-in users can post sales (the old function was open to the anonymous role as well)
revoke all on function public.process_pos_sale(jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.process_pos_sale(jsonb, jsonb, jsonb) to authenticated;

-- =====================================================================
-- PART B. Email + 4-digit PIN sign-in (database layer)
-- =====================================================================
create extension if not exists pgcrypto with schema extensions;

-- Hashed PINs live in their own table that NO browser can read or write (no policies, no grants).
create table if not exists public.staff_pin_credentials (
  user_id         uuid primary key references public.profiles(id) on delete cascade,
  pin_hash        text not null,
  enabled         boolean not null default true,
  failed_attempts integer not null default 0,
  lock_count      integer not null default 0,
  locked_until    timestamptz,
  last_used_at    timestamptz,
  updated_at      timestamptz not null default now()
);
alter table public.staff_pin_credentials enable row level security;
revoke all on public.staff_pin_credentials from anon, authenticated;

create table if not exists public.pin_login_attempts (
  id         bigserial primary key,
  ip         text not null,
  email      text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pin_login_attempts_ip on public.pin_login_attempts (ip, created_at);
alter table public.pin_login_attempts enable row level security;
revoke all on public.pin_login_attempts from anon, authenticated;

-- B1. Refuse easy-to-guess PINs (repeated digits, sequences, the most common choices)
create or replace function public.is_weak_pin(p text) returns boolean
language sql immutable as $$
  select p is null
      or p !~ '^[0-9]{4}$'
      or p ~ '^([0-9])\1{3}$'
      or p in ('0123','1234','2345','3456','4567','5678','6789','3210','4321','5432','6543','7654','8765','9876',
               '1212','2121','1122','2211','0101','1010','2580','0852','1357','2468','1004','2000','2001','6969','4200','1313','1999')
$$;

-- B2. Set a PIN for any user. Server-side only: called by the Edge Functions with the service role.
create or replace function public.set_staff_pin(p_user_id uuid, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if public.is_weak_pin(p_pin) then
    raise exception 'That PIN is too easy to guess. Use 4 digits that are not repeated or in a sequence.';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'User not found';
  end if;

  insert into public.staff_pin_credentials (user_id, pin_hash, enabled, failed_attempts, lock_count, locked_until, updated_at)
  values (p_user_id, crypt(p_pin, gen_salt('bf', 10)), true, 0, 0, null, now())
  on conflict (user_id) do update
     set pin_hash = excluded.pin_hash, enabled = true, failed_attempts = 0, lock_count = 0,
         locked_until = null, updated_at = now();
end $$;
revoke all on function public.set_staff_pin(uuid, text) from public, anon, authenticated;
grant execute on function public.set_staff_pin(uuid, text) to service_role;

-- B3. A signed-in employee sets or clears THEIR OWN PIN (from the mobile Settings screen)
create or replace function public.set_my_pin(p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_role text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select p.role::text into v_role from public.profiles p
   where p.id = auth.uid() and coalesce(p.is_active, true) and p.organization_id is not null;
  if v_role is null then raise exception 'Your account is not active'; end if;
  if v_role not in ('cashier', 'staff') then
    raise exception 'PIN sign-in is only available for cashier and staff accounts';
  end if;
  perform public.set_staff_pin(auth.uid(), p_pin);
end $$;

create or replace function public.clear_my_pin() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from public.staff_pin_credentials where user_id = auth.uid();
end $$;

revoke all on function public.set_my_pin(text), public.clear_my_pin() from public, anon;
grant execute on function public.set_my_pin(text), public.clear_my_pin() to authenticated;

-- B4. Check an email + PIN. Server-side only (the pin-auth Edge Function). Returns the user id or NULL.
--     Every failure looks the same to the caller (no way to tell "no such user" from "wrong PIN" from "locked").
--       * 5 wrong PINs lock that account for 15 minutes, doubling each time (up to 24 hours)
--       * at most 30 attempts per IP address per 10 minutes
--       * only active cashier/staff accounts that have a PIN can use it (never admins or managers)
create or replace function public.pin_login_check(p_email text, p_pin text, p_ip text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_email   text := lower(trim(coalesce(p_email, '')));
  v_ip      text := left(coalesce(nullif(trim(p_ip), ''), 'unknown'), 64);
  v_user    uuid;
  v_role    text;
  v_org     uuid;
  v_shop    uuid;
  v_active  boolean;
  c         record;
  v_recent  integer;
  v_minutes integer;
begin
  delete from public.pin_login_attempts where created_at < now() - interval '1 day';

  select count(*) into v_recent from public.pin_login_attempts
   where ip = v_ip and created_at > now() - interval '10 minutes';
  if v_recent >= 30 then return null; end if;
  insert into public.pin_login_attempts (ip, email) values (v_ip, left(v_email, 200));

  if v_email = '' or p_pin is null or p_pin !~ '^[0-9]{4}$' then return null; end if;

  select p.id, p.role::text, p.organization_id, p.shop_id, coalesce(p.is_active, true)
    into v_user, v_role, v_org, v_shop, v_active
    from public.profiles p where lower(p.email) = v_email limit 1;

  select * into c from public.staff_pin_credentials where user_id = v_user;

  if v_user is null or c.user_id is null or not v_active or not c.enabled
     or v_org is null or v_shop is null or v_role not in ('cashier', 'staff')
     or (c.locked_until is not null and c.locked_until > now()) then
    perform crypt(p_pin, gen_salt('bf', 10));          -- same work either way, so timing reveals nothing
    return null;
  end if;

  if c.pin_hash = crypt(p_pin, c.pin_hash) then
    update public.staff_pin_credentials
       set failed_attempts = 0, lock_count = 0, locked_until = null, last_used_at = now()
     where user_id = v_user;
    return v_user;
  end if;

  if c.failed_attempts + 1 >= 5 then
    v_minutes := least(15 * (2 ^ c.lock_count)::integer, 1440);
    update public.staff_pin_credentials
       set failed_attempts = 0, lock_count = lock_count + 1, locked_until = now() + make_interval(mins => v_minutes)
     where user_id = v_user;
    insert into public.access_logs (shop_id, user_id, user_email, event_type, ip_address, details)
    values (v_shop, v_user, v_email, 'pin_lockout', v_ip, jsonb_build_object('locked_minutes', v_minutes));
  else
    update public.staff_pin_credentials set failed_attempts = failed_attempts + 1 where user_id = v_user;
  end if;
  return null;
end $$;
revoke all on function public.pin_login_check(text, text, text) from public, anon, authenticated;
grant execute on function public.pin_login_check(text, text, text) to service_role;

-- B5. Plain-text PINs in profiles.pos_pin were readable by every colleague in the shop. Wipe them
--     (PIN sign-in uses the hashed table above; the mobile app never read this column).
update public.profiles set pos_pin = null where pos_pin is not null;

commit;

-- Sanity checks (all three should look as described):
select 'process_pos_sale runs as caller' as check_name, (not prosecdef)::text as value
  from pg_proc where proname = 'process_pos_sale' and pronamespace = 'public'::regnamespace
union all
select 'order_items without a shop (should be 0)', count(*)::text from public.order_items where shop_id is null
union all
select 'payments without a shop (should be 0)', count(*)::text from public.payments where shop_id is null;
