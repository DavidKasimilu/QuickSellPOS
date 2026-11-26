-- =====================================================================
-- QuickSell POS | PHASE 2 (continued) | Shifts enforced by the database + PIN sign-in rules
-- Run AFTER 07. One transaction. Safe to re-run.
--
-- SHIFT MODEL (one shift per shop, shared by every staff member and every device)
--   * a shop has at most ONE open shift at a time (any device/staff can start it; a second attempt just joins it)
--   * no open shift  ->  no sale can be saved (enforced by a trigger on orders, so even a modified app cannot bypass it)
--   * the person who started the shift, or any manager/admin, can close it (with the counted cash)
--   * sales made offline DURING a shift are still accepted when they sync after the shift closed
--   * a shop can switch this off in Features > Shift management (default: ON)
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. Shift columns
-- ---------------------------------------------------------------------
alter table public.shifts
  add column if not exists closed_by      uuid references public.profiles(id),
  add column if not exists expected_cash  numeric,
  add column if not exists cash_variance  numeric,
  add column if not exists orders_count   integer not null default 0,
  add column if not exists total_sales    numeric not null default 0,
  add column if not exists cash_sales     numeric not null default 0,
  add column if not exists other_payments numeric not null default 0,
  add column if not exists credit_sales   numeric not null default 0,
  add column if not exists cash_in        numeric not null default 0,
  add column if not exists cash_out       numeric not null default 0,
  add column if not exists open_notes     text,
  add column if not exists close_notes    text,
  add column if not exists opened_device  text;

-- tidy: if test data left several "open" shifts in one shop, keep the newest and close the rest
update public.shifts s
   set status = 'closed', closed_at = coalesce(s.closed_at, now())
 where s.status = 'open'
   and exists (select 1 from public.shifts n
                where n.shop_id = s.shop_id and n.status = 'open'
                  and (n.opened_at, n.id) > (s.opened_at, s.id));

create unique index if not exists uq_shifts_one_open_per_shop on public.shifts (shop_id) where status = 'open';
create index if not exists idx_shifts_shop_opened on public.shifts (shop_id, opened_at desc);

-- Shift management ON by default for every shop (a shop can still switch it off in Features)
alter table public.store_settings alter column features set default
  '{"kot_notes": false, "addon_apps": true, "time_clock": false, "credit_note": false, "open_orders": false, "order_types": false, "multipayment": false, "service_areas": false, "taxes_charges": true, "manage_currency": false, "shift_management": true, "embedded_barcodes": false, "email_notifications": false}'::jsonb;
update public.store_settings
   set features = jsonb_set(coalesce(features, '{}'::jsonb), '{shift_management}', 'true'::jsonb, true);

-- ---------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------
create or replace function public.shift_required(p_shop_id uuid) returns boolean
language sql stable security invoker set search_path = public as $$
  select coalesce((select (ss.features->>'shift_management')::boolean
                     from public.store_settings ss where ss.shop_id = p_shop_id), true)
$$;

-- live totals of a shift (completed sales only)
create or replace function public.shift_totals(p_shift_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  s        record;
  v_orders integer;
  v_total  numeric;
  v_cash   numeric;
  v_other  numeric;
  v_in     numeric;
  v_out    numeric;
  v_end    timestamptz;
begin
  select * into s from public.shifts where id = p_shift_id;
  if not found then return null; end if;

  select count(*), coalesce(sum(o.total), 0) into v_orders, v_total
    from public.orders o
   where o.shift_id = p_shift_id and o.order_status::text = 'completed' and coalesce(o.is_deleted, false) = false;

  select coalesce(sum(p.amount) filter (where p.payment_method::text = 'cash'), 0),
         coalesce(sum(p.amount) filter (where p.payment_method::text <> 'cash'), 0)
    into v_cash, v_other
    from public.payments p
    join public.orders o on o.id = p.order_id
   where o.shift_id = p_shift_id and o.order_status::text = 'completed' and coalesce(o.is_deleted, false) = false;

  v_end := coalesce(s.closed_at, now());
  select coalesce(sum(ct.amount) filter (where ct.action_type = 'in'), 0),
         coalesce(sum(ct.amount) filter (where ct.action_type = 'out'), 0)
    into v_in, v_out
    from public.cash_transactions ct
   where ct.shop_id = s.shop_id and ct.created_at >= s.opened_at and ct.created_at <= v_end;

  return jsonb_build_object(
    'orders_count', v_orders, 'total_sales', v_total, 'cash_sales', v_cash, 'other_payments', v_other,
    'credit_sales', greatest(0, v_total - v_cash - v_other), 'cash_in', v_in, 'cash_out', v_out,
    'expected_cash', coalesce(s.opening_cash, 0) + v_cash + v_in - v_out);
end $$;

create or replace function public.shift_payload(p_shift_id uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', s.id, 'shop_id', s.shop_id, 'status', s.status,
    'opened_at', s.opened_at, 'closed_at', s.closed_at, 'opening_cash', s.opening_cash,
    'actual_cash', s.actual_cash, 'expected_cash', s.expected_cash, 'cash_variance', s.cash_variance,
    'opened_by', s.staff_id, 'opened_by_name', coalesce(po.full_name, po.email),
    'closed_by', s.closed_by, 'closed_by_name', coalesce(pc.full_name, pc.email),
    'open_notes', s.open_notes, 'close_notes', s.close_notes, 'opened_device', s.opened_device,
    'totals', public.shift_totals(s.id))
  from public.shifts s
  left join public.profiles po on po.id = s.staff_id
  left join public.profiles pc on pc.id = s.closed_by
  where s.id = p_shift_id
$$;

-- ---------------------------------------------------------------------
-- 3. The three operations the apps use
-- ---------------------------------------------------------------------
create or replace function public.get_shift_state(p_shop_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_shop_id is null or p_shop_id not in (select public.my_shop_ids()) then
    raise exception 'You are not allowed to view this store';
  end if;
  select s.id into v_id from public.shifts s
   where s.shop_id = p_shop_id and s.status = 'open' order by s.opened_at desc limit 1;
  return jsonb_build_object(
    'required', public.shift_required(p_shop_id),
    'shift', case when v_id is null then null else public.shift_payload(v_id) end,
    'server_time', now());
end $$;

create or replace function public.open_shift(p_shop_id uuid, p_opening_cash numeric default 0,
                                             p_notes text default null, p_device text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_id uuid; v_email text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_shop_id is null or p_shop_id not in (select public.my_shop_ids()) then
    raise exception 'You are not allowed to start a shift in this store';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 then
    raise exception 'Opening cash cannot be negative';
  end if;

  -- a shift is already running: join it instead of creating another
  select s.id into v_id from public.shifts s where s.shop_id = p_shop_id and s.status = 'open' limit 1;
  if v_id is not null then
    return jsonb_build_object('created', false, 'shift', public.shift_payload(v_id));
  end if;

  perform set_config('qs.shift_rpc', '1', true);
  begin
    insert into public.shifts (shop_id, staff_id, opened_at, opening_cash, status, open_notes, opened_device)
    values (p_shop_id, auth.uid(), now(), p_opening_cash, 'open',
            nullif(left(coalesce(p_notes, ''), 500), ''), nullif(left(coalesce(p_device, ''), 200), ''))
    returning id into v_id;
  exception when unique_violation then
    select s.id into v_id from public.shifts s where s.shop_id = p_shop_id and s.status = 'open' limit 1;
    return jsonb_build_object('created', false, 'shift', public.shift_payload(v_id));
  end;

  select p.email into v_email from public.profiles p where p.id = auth.uid();
  insert into public.access_logs (shop_id, user_id, user_email, event_type, details)
  values (p_shop_id, auth.uid(), coalesce(v_email, ''), 'shift_opened',
          jsonb_build_object('shift_id', v_id, 'opening_cash', p_opening_cash));

  return jsonb_build_object('created', true, 'shift', public.shift_payload(v_id));
end $$;

create or replace function public.close_shift(p_shift_id uuid, p_actual_cash numeric, p_notes text default null)
returns jsonb
language plpgsql security invoker set search_path = public as $$
declare s record; t jsonb; v_role text; v_email text; v_expected numeric;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into s from public.shifts where id = p_shift_id for update;
  if not found or s.shop_id not in (select public.my_shop_ids()) then
    raise exception 'Shift not found';
  end if;
  if s.status <> 'open' then raise exception 'This shift is already closed'; end if;

  v_role := public.my_role();
  if not (s.staff_id = auth.uid() or v_role in ('admin', 'owner', 'manager')) then
    raise exception 'Only the person who started the shift, or a manager, can close it';
  end if;
  if p_actual_cash is null or p_actual_cash < 0 then
    raise exception 'Enter the cash counted in the drawer (0 or more)';
  end if;

  t := public.shift_totals(s.id);
  v_expected := (t->>'expected_cash')::numeric;

  perform set_config('qs.shift_rpc', '1', true);
  update public.shifts
     set status = 'closed', closed_at = now(), closed_by = auth.uid(),
         actual_cash = p_actual_cash, closing_cash = v_expected, expected_cash = v_expected,
         cash_variance = p_actual_cash - v_expected,
         orders_count = (t->>'orders_count')::integer, total_sales = (t->>'total_sales')::numeric,
         cash_sales = (t->>'cash_sales')::numeric, other_payments = (t->>'other_payments')::numeric,
         credit_sales = (t->>'credit_sales')::numeric, cash_in = (t->>'cash_in')::numeric,
         cash_out = (t->>'cash_out')::numeric,
         close_notes = nullif(left(coalesce(p_notes, ''), 500), '')
   where id = s.id;

  select p.email into v_email from public.profiles p where p.id = auth.uid();
  insert into public.access_logs (shop_id, user_id, user_email, event_type, details)
  values (s.shop_id, auth.uid(), coalesce(v_email, ''), 'shift_closed',
          jsonb_build_object('shift_id', s.id, 'expected_cash', v_expected, 'counted_cash', p_actual_cash,
                             'variance', p_actual_cash - v_expected));

  return jsonb_build_object('closed', true, 'shift', public.shift_payload(s.id));
end $$;

revoke all on function public.shift_required(uuid), public.shift_totals(uuid), public.shift_payload(uuid),
                       public.get_shift_state(uuid), public.open_shift(uuid, numeric, text, text),
                       public.close_shift(uuid, numeric, text) from public, anon;
grant execute on function public.shift_required(uuid), public.shift_totals(uuid), public.shift_payload(uuid),
                          public.get_shift_state(uuid), public.open_shift(uuid, numeric, text, text),
                          public.close_shift(uuid, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. NO SHIFT = NO SALE  (applies to every way of saving a POS order, including the app's fallbacks)
-- ---------------------------------------------------------------------
create or replace function public.enforce_open_shift() returns trigger
language plpgsql security invoker set search_path = public as $$
declare v record; v_when timestamptz;
begin
  if auth.uid() is null then return new; end if;                        -- server-side tools / SQL editor
  if coalesce(new.order_channel, 'pos') <> 'pos' then return new; end if; -- web shop / manual back-office orders
  if not public.shift_required(new.shop_id) then return new; end if;     -- shop switched shifts off

  if new.shift_id is null then
    select s.id into new.shift_id from public.shifts s
     where s.shop_id = new.shop_id and s.status = 'open' limit 1;
    if new.shift_id is null then
      raise exception 'No shift is open. Start a shift before making sales.' using errcode = 'P0001';
    end if;
    return new;
  end if;

  select s.id, s.shop_id, s.status, s.opened_at, s.closed_at into v from public.shifts s where s.id = new.shift_id;
  if not found or v.shop_id <> new.shop_id then
    raise exception 'This sale refers to an unknown shift.' using errcode = 'P0001';
  end if;

  if v.status <> 'open' then
    -- only a sale that REALLY happened offline during the shift may arrive after it closed
    v_when := coalesce(new.offline_created_at, new.created_at);
    if not coalesce(new.synced_from_offline, false)
       or v_when is null
       or v_when < v.opened_at - interval '5 minutes'
       or v_when > coalesce(v.closed_at, now()) + interval '5 minutes' then
      raise exception 'That shift is closed. Start a new shift before making sales.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_enforce_shift on public.orders;
create trigger trg_orders_enforce_shift before insert on public.orders
  for each row execute function public.enforce_open_shift();

-- Shift rows can only be changed through open_shift/close_shift, or by a manager/admin
create or replace function public.guard_shift_update() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('qs.shift_rpc', true), '') = '1' then return new; end if;
  if public.my_role() in ('admin', 'owner', 'manager') then return new; end if;
  raise exception 'Shifts can only be opened or closed from the shift screen' using errcode = 'P0001';
end $$;

drop trigger if exists trg_shifts_guard_update on public.shifts;
create trigger trg_shifts_guard_update before update on public.shifts
  for each row execute function public.guard_shift_update();

-- ---------------------------------------------------------------------
-- 5. PIN sign-in: tell admins/managers to use their password
--    (the check now returns jsonb; the pin-auth Edge Function is updated to match)
-- ---------------------------------------------------------------------
drop function if exists public.pin_login_check(text, text, text);

create function public.pin_login_check(p_email text, p_pin text, p_ip text) returns jsonb
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
  if v_recent >= 30 then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  insert into public.pin_login_attempts (ip, email) values (v_ip, left(v_email, 200));

  if v_email = '' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  select p.id, p.role::text, p.organization_id, p.shop_id, coalesce(p.is_active, true)
    into v_user, v_role, v_org, v_shop, v_active
    from public.profiles p where lower(p.email) = v_email limit 1;

  -- admins, owners and managers never use a PIN: tell them to use their password
  if v_user is not null and v_active and v_role in ('admin', 'owner', 'manager') then
    return jsonb_build_object('ok', false, 'reason', 'use_password', 'role', v_role);
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;

  select * into c from public.staff_pin_credentials where user_id = v_user;

  if v_user is null or c.user_id is null or not v_active or not c.enabled
     or v_org is null or v_shop is null or v_role not in ('cashier', 'staff')
     or (c.locked_until is not null and c.locked_until > now()) then
    perform crypt(p_pin, gen_salt('bf', 10));
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if c.pin_hash = crypt(p_pin, c.pin_hash) then
    update public.staff_pin_credentials
       set failed_attempts = 0, lock_count = 0, locked_until = null, last_used_at = now()
     where user_id = v_user;
    return jsonb_build_object('ok', true, 'user_id', v_user);
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
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end $$;
revoke all on function public.pin_login_check(text, text, text) from public, anon, authenticated;
grant execute on function public.pin_login_check(text, text, text) to service_role;

commit;

-- Checks
select 'one-open-shift index exists' as check_name, (count(*) = 1)::text as value
  from pg_indexes where indexname = 'uq_shifts_one_open_per_shop'
union all
select 'sales trigger installed', (count(*) = 1)::text from pg_trigger where tgname = 'trg_orders_enforce_shift'
union all
select 'shops with shift management ON', count(*)::text from public.store_settings where features->>'shift_management' = 'true';
