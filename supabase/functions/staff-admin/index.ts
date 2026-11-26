// Supabase Edge Function: staff-admin
// Creates / removes staff LOGINS and their profiles on the server, so the browser can never
// choose a role, an organization or another company's shop for anyone.
//
// Deploy:   supabase functions deploy staff-admin
// Secrets:  supabase secrets set ALLOWED_ORIGINS=https://your-app-domain.com
// (SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
//
// Business-rule errors are returned as HTTP 200 + {"error": "..."} so the browser can show the message.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CREATABLE_BY_ADMIN = ['admin', 'manager', 'cashier', 'staff'];
const CREATABLE_BY_MANAGER = ['cashier', 'staff'];
const PIN_ROLES = ['cashier', 'staff'];   // PIN sign-in is never offered to managers or admins

// same rule as public.is_weak_pin() in the database (which is the final authority)
function isWeakPin(pin: string): boolean {
  if (!/^\d{4}$/.test(pin)) return true;
  if (/^(\d)\1{3}$/.test(pin)) return true;
  return ['0123','1234','2345','3456','4567','5678','6789','3210','4321','5432','6543','7654','8765','9876',
          '1212','2121','1122','2211','0101','1010','2580','0852','1357','2468','1004','2000','2001','6969','4200','1313','1999'].includes(pin);
}
const PIN_HELP = 'The PIN must be 4 digits and easy patterns are refused (1234, 0000, 1111, 2580, ...).';

function corsHeaders(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  const allow = ALLOWED_ORIGINS.length === 0 ? '*' : ALLOWED_ORIGINS.includes(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function reply(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}
const fail = (req: Request, message: string) => reply(req, { error: message }, 200);

function tempPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);

  try {
    // ---- 1. Who is calling? (verified from their own JWT, never from the request body) ----
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return reply(req, { error: 'Not signed in' }, 401);

    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return reply(req, { error: 'Not signed in' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: caller } = await admin
      .from('profiles')
      .select('id, role, shop_id, organization_id, is_active')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!caller || caller.is_active === false || !caller.organization_id) return fail(req, 'Your account is not active.');
    const callerRole = String(caller.role);
    const isAdmin = ['admin', 'owner'].includes(callerRole);
    const isManager = callerRole === 'manager';
    if (!isAdmin && !isManager) return fail(req, 'Only managers and administrators can manage staff.');

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');

    // ---- helper: load a target profile and check the caller may manage it ----
    async function loadManageableTarget(id: unknown) {
      if (typeof id !== 'string' || !UUID.test(id)) return { error: 'Invalid employee id.' };
      if (id === caller!.id) return { error: 'You cannot do this to your own account.' };
      const { data: target } = await admin
        .from('profiles')
        .select('id, role, shop_id, organization_id, email')
        .eq('id', id)
        .maybeSingle();
      // same wording whether it does not exist or belongs to another company (no information leak)
      if (!target || target.organization_id !== caller!.organization_id) return { error: 'Employee not found.' };
      if (!isAdmin) {
        if (['admin', 'owner', 'manager'].includes(String(target.role))) return { error: 'Managers cannot manage administrators or other managers.' };
        if (target.shop_id !== caller!.shop_id) return { error: 'You can only manage staff of your own store.' };
      }
      return { target };
    }

    // ================= CREATE =================
    if (action === 'create') {
      const fullName = String(body.full_name ?? '').trim();
      const email = String(body.email ?? '').trim().toLowerCase();
      const role = String(body.role ?? 'cashier');
      const shopId = body.shop_id ? String(body.shop_id) : null;
      const phone = body.phone ? String(body.phone).trim().slice(0, 30) : null;
      const posPin = body.pos_pin ? String(body.pos_pin).trim() : null;
      const givenPassword = body.password ? String(body.password) : '';
      const commission = Number(body.commission_rate ?? 0);
      const isActive = body.is_active !== false;

      if (!fullName || fullName.length > 120) return fail(req, 'Full name is required.');
      if (!EMAIL.test(email)) return fail(req, 'Enter a valid email address.');
      if (posPin && isWeakPin(posPin)) return fail(req, PIN_HELP);
      if (givenPassword && (givenPassword.length < 8 || givenPassword.length > 72)) {
        return fail(req, 'The password must be 8 to 72 characters.');
      }
      if (givenPassword && givenPassword.toLowerCase() === email) return fail(req, 'The password cannot be the email address.');
      if (!(commission >= 0 && commission <= 100)) return fail(req, 'Commission must be between 0 and 100.');

      const allowedRoles = isAdmin ? CREATABLE_BY_ADMIN : CREATABLE_BY_MANAGER;
      if (!allowedRoles.includes(role)) return fail(req, 'You are not allowed to create that role.');

      if (posPin && !PIN_ROLES.includes(role)) return fail(req, 'PIN sign-in is only available for cashier and staff accounts.');
      if (role !== 'admin' && !shopId) return fail(req, 'Choose a store branch for this employee.');
      if (shopId) {
        if (!UUID.test(shopId)) return fail(req, 'Invalid store branch.');
        if (!isAdmin && shopId !== caller.shop_id) return fail(req, 'You can only add staff to your own store.');
        const { data: shop } = await admin
          .from('shops').select('id').eq('id', shopId).eq('organization_id', caller.organization_id).maybeSingle();
        if (!shop) return fail(req, 'That store branch is not part of your company.');
      }

      // A profile row already using this email blocks the new login. If it belongs to a real login it is
      // a genuine duplicate; if it is a leftover without a login (failed earlier attempt, old employee
      // screen) it is cleaned up so the email can be used again.
      const emailPattern = email.replace(/[\\%_]/g, (c) => '\\' + c);
      const { data: existingProfile } = await admin.from('profiles').select('id').ilike('email', emailPattern).maybeSingle();
      if (existingProfile) {
        const { data: existingLogin } = await admin.auth.admin.getUserById(existingProfile.id);
        if (existingLogin?.user) return fail(req, 'This email is already in use by another account. Use a different email.');
        const { error: leftoverErr } = await admin.from('profiles').delete().eq('id', existingProfile.id);
        if (leftoverErr) {
          return fail(req, 'An old staff record with this email still has sales history and cannot be reused. Use a different email.');
        }
      }

      // Password: the one you typed, else a generated one. A PIN-only employee gets a random password
      // nobody knows (they sign in with email + PIN, and can set a password later with "Forgot password").
      const generated = !givenPassword && !posPin;
      const password = givenPassword || tempPassword();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        // The signup trigger reads this flag and skips creating a new company for this person.
        // (Skipping provisioning can never grant access, so it is safe even if a user could set it.)
        user_metadata: { full_name: fullName, provisioned_by_server: true },
        app_metadata: { provisioned_by_server: true },
      });
      if (createErr || !created?.user) {
        if (/already|registered|exists/i.test(createErr?.message ?? '')) {
          return fail(req, 'This email is already registered. Use a different email, or ask the person to sign in.');
        }
        // GoTrue hides the real cause behind "Database error creating new user"; the cause is in Postgres logs.
        console.error('createUser failed', JSON.stringify({ message: createErr?.message, status: createErr?.status, code: (createErr as any)?.code }));
        if (/database error/i.test(createErr?.message ?? '')) {
          return fail(req, 'The database rejected the new login (a trigger on the auth users table raised an error). The exact reason is in Supabase > Logs > Postgres, at the time you clicked Create.');
        }
        return fail(req, 'Could not create the login: ' + (createErr?.message ?? 'unknown error'));
      }

      // upsert: a signup trigger may already have inserted a bare profile row for this new login;
      // this overwrites it with the correct role / shop / company (always the CALLER's company)
      const { error: profileErr } = await admin.from('profiles').upsert({
        id: created.user.id,
        email,
        full_name: fullName,
        phone,
        role,
        shop_id: shopId,
        organization_id: caller.organization_id,
        pos_pin: null,                              // plain-text PINs are no longer stored; see staff_pin_credentials
        commission_rate: commission,
        is_active: isActive,
      }, { onConflict: 'id' });
      if (profileErr) {
        await admin.from('profiles').delete().eq('id', created.user.id);   // no leftover profile
        await admin.auth.admin.deleteUser(created.user.id);                // no half-created account
        return fail(req, 'Could not save the employee: ' + profileErr.message);
      }

      if (posPin) {
        const { error: pinErr } = await admin.rpc('set_staff_pin', { p_user_id: created.user.id, p_pin: posPin });
        if (pinErr) {
          await admin.from('profiles').delete().eq('id', created.user.id);
          await admin.auth.admin.deleteUser(created.user.id);
          return fail(req, pinErr.message);
        }
      }

      return reply(req, {
        ok: true,
        id: created.user.id,
        temp_password: generated ? password : undefined,   // only returned when the system generated it
        password_set: !!givenPassword,
        pin_set: !!posPin,
      });
    }

    // ================= REMOVE =================
    if (action === 'remove') {
      const t = await loadManageableTarget(body.id);
      if ('error' in t) return fail(req, t.error!);
      const target = t.target!;

      if (['admin', 'owner'].includes(String(target.role))) {
        const { count } = await admin
          .from('profiles').select('id', { count: 'exact', head: true })
          .eq('organization_id', caller.organization_id).in('role', ['admin', 'owner']).eq('is_active', true);
        if ((count ?? 0) <= 1) return fail(req, 'You cannot remove the last administrator of the company.');
      }

      const { error: delErr } = await admin.from('profiles').delete().eq('id', target.id);
      if (delErr) {
        if (delErr.code === '23503') {
          // has sales history: keep the record for audit, switch the person off completely
          await admin.from('profiles')
            .update({ is_active: false, shop_id: null, updated_at: new Date().toISOString() })
            .eq('id', target.id);
          await admin.auth.admin.updateUserById(target.id, { ban_duration: '876000h' });
          return reply(req, { ok: true, mode: 'deactivated' });
        }
        return fail(req, 'Could not remove the employee: ' + delErr.message);
      }
      await admin.auth.admin.deleteUser(target.id);
      return reply(req, { ok: true, mode: 'deleted' });
    }

    // ================= SET / CLEAR SIGN-IN PIN =================
    if (action === 'set_pin' || action === 'clear_pin') {
      const t = await loadManageableTarget(body.id);
      if ('error' in t) return fail(req, t.error!);
      if (action === 'clear_pin') {
        await admin.from('staff_pin_credentials').delete().eq('user_id', t.target!.id);
        return reply(req, { ok: true });
      }
      const pin = String(body.pin ?? '').trim();
      if (isWeakPin(pin)) return fail(req, PIN_HELP);
      if (!PIN_ROLES.includes(String(t.target!.role))) return fail(req, 'PIN sign-in is only available for cashier and staff accounts.');
      const { error: pinErr } = await admin.rpc('set_staff_pin', { p_user_id: t.target!.id, p_pin: pin });
      if (pinErr) return fail(req, pinErr.message);
      return reply(req, { ok: true });
    }

    // ================= RESET PASSWORD =================
    if (action === 'reset_password') {
      const t = await loadManageableTarget(body.id);
      if ('error' in t) return fail(req, t.error!);
      const password = tempPassword();
      const { error: pwErr } = await admin.auth.admin.updateUserById(t.target!.id, { password });
      if (pwErr) return fail(req, 'Could not reset the password: ' + pwErr.message);
      return reply(req, { ok: true, temp_password: password });
    }

    return fail(req, 'Unknown action.');
  } catch (err) {
    console.error('staff-admin error', err);
    return reply(req, { error: 'Unexpected server error.' }, 500);
  }
});
