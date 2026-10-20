import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Cloudflare Worker reverse-proxy gateway
const PROXY_GATEWAY_URL = 'https://quicksell-gateway.davidkasimilu71.workers.dev';

// The second argument satisfies the supabase-js constructor requirement;
// the Worker injects the production Supabase key on the edge.
export const supabase = createClient(PROXY_GATEWAY_URL, 'public-client-proxy', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  },
});