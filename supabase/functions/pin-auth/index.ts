// Supabase Edge Function: pin-auth   (deploy WITHOUT JWT verification: callers are not signed in yet)
//
//   supabase functions deploy pin-auth --no-verify-jwt
//   (dashboard: Edge Functions > pin-auth > turn "Verify JWT" OFF)
//   supabase secrets set ALLOWED_ORIGINS=https://your-backoffice,https://your-mobile-pos
//
// Email + 4-digit PIN sign-in. The browser sends {action:'login', email, pin}. This function asks the
// database to check the PIN (hashed, with lockouts and per-IP throttling) and, only when it matches,
// returns a one-time token the app exchanges for a normal session with supabase.auth.verifyOtp().
// Every failure returns the same generic message, so nobody can tell whether an email exists.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const GENERIC = 'Invalid email or PIN, or too many attempts. Please try again later.';

function originOk(origin: string): boolean {
  if (!origin) return true;                          // native apps / server calls
  if (origin === 'null') return true;                // file:// wrappers
  if (ALLOWED_ORIGINS.length === 0) return true;     // not configured yet
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1';   // local development and app wrappers
  } catch { return false; }
}

function cors(req: Request) {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': origin && originOk(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}
const reply = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== 'POST') return reply(req, { error: 'Method not allowed' }, 405);
  if (!originOk(req.headers.get('Origin') ?? '')) return reply(req, { error: 'Origin not allowed' }, 403);

  try {
    const body = await req.json().catch(() => ({}));
    if (body?.action !== 'login') return reply(req, { error: 'Unknown action' }, 400);

    const email = String(body.email ?? '').trim().toLowerCase();
    const pin = String(body.pin ?? '').trim();   // format is validated by the database (admins are told to use a password before the PIN is checked)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return reply(req, { error: GENERIC }, 401);
    }

    const ip = req.headers.get('cf-connecting-ip')
      ?? (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim()
      ?? 'unknown';

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: check, error: checkErr } = await admin.rpc('pin_login_check', { p_email: email, p_pin: pin, p_ip: ip });
    if (checkErr) console.error('pin_login_check error', checkErr.message);

    // Admins, owners and managers sign in with a password: say so clearly (this is intentional product behaviour)
    if (check?.reason === 'use_password') {
      return reply(req, {
        error: 'use_password',
        message: check.role === 'manager'
          ? 'This is a manager account. Please sign in with your password.'
          : 'This is an admin account. Please sign in with your password.',
      }, 403);
    }

    const userId = check?.ok ? check.user_id : null;
    if (checkErr || !userId) {
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 250)));   // blunt fast guessing
      return reply(req, { error: GENERIC }, 401);
    }

    const { data: authUser } = await admin.auth.admin.getUserById(userId as string);
    const loginEmail = authUser?.user?.email;
    if (!loginEmail) return reply(req, { error: GENERIC }, 401);

    // one-time token; the app swaps it for a real session via supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email: loginEmail });
    const tokenHash = link?.properties?.hashed_token;
    if (linkErr || !tokenHash) {
      console.error('generateLink failed', linkErr?.message);
      return reply(req, { error: 'Sign-in is temporarily unavailable. Please use your password.' }, 500);
    }

    return reply(req, { token_hash: tokenHash });
  } catch (err) {
    console.error('pin-auth error', err);
    return reply(req, { error: 'Unexpected server error.' }, 500);
  }
});
