// QuickSell gateway Worker (reference implementation) - compare it with the one you have deployed.
//
// Secrets / variables to set in Cloudflare (Settings > Variables):
//   SUPABASE_URL        e.g. https://xxxx.supabase.co
//   SUPABASE_ANON_KEY   the ANON (public) key.  NEVER put the service_role key here.
//   ALLOWED_ORIGINS     comma separated, e.g. https://app.yourdomain.com,https://yourdomain.com
//
// What it guarantees:
//   * only known Supabase API areas can be reached (no /pg, /graphql, dashboard, etc.)
//   * browsers from other websites are refused (CORS + Origin check)
//   * the ANON key is always the one sent upstream; whatever the browser sends as key is ignored
//   * the signed-in user's own JWT (Authorization header) is passed through untouched, so row-level
//     security keeps applying. The Worker never swaps it for an elevated key.
const ALLOWED_PREFIXES = ['/rest/v1/', '/auth/v1/', '/realtime/v1/', '/storage/v1/', '/functions/v1/'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
    const originAllowed = allowedOrigins.includes(origin);

    const cors = {
      'Access-Control-Allow-Origin': originAllowed ? origin : 'null',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, prefer, range, accept-profile, content-profile, x-upsert',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'content-range, content-length',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: originAllowed ? 204 : 403, headers: cors });
    }

    // Browsers always send Origin on cross-site calls; refuse any that is not ours.
    if (origin && !originAllowed) return new Response('Forbidden origin', { status: 403, headers: cors });

    if (!ALLOWED_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      return new Response('Not found', { status: 404, headers: cors });
    }

    const target = new URL(env.SUPABASE_URL);
    target.pathname = url.pathname;
    target.search = url.search;
    if (target.searchParams.has('apikey')) target.searchParams.set('apikey', env.SUPABASE_ANON_KEY); // realtime websocket

    const headers = new Headers(request.headers);
    headers.set('apikey', env.SUPABASE_ANON_KEY);
    if (!headers.get('Authorization')) headers.set('Authorization', 'Bearer ' + env.SUPABASE_ANON_KEY);
    headers.delete('cookie');
    headers.delete('host');

    const upstream = await fetch(new Request(target.toString(), {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
      redirect: 'manual',
    }));

    // WebSocket upgrade (realtime): hand the upstream response straight back
    if (upstream.status === 101) return upstream;

    const out = new Response(upstream.body, upstream);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
