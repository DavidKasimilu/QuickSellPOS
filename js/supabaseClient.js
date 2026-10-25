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
  realtime: {
    params: {
      eventsPerSecond: 15,
    },
  },
});

// Helper to reliably retrieve active shop ID for tenant-scoped subscriptions
export const getActiveShopId = () => {
  try {
    const rawState = window.localStorage.getItem('qs_app_state');
    if (rawState) {
      const parsed = JSON.parse(rawState);
      if (parsed.currentShop?.id) return parsed.currentShop.id;
      if (parsed.userProfile?.shop_id) return parsed.userProfile.shop_id;
    }

    const rawProfile = window.localStorage.getItem('qs_user_profile');
    if (rawProfile) {
      const profile = JSON.parse(rawProfile);
      if (profile.shop_id) return profile.shop_id;
    }

    const rawDirectShop = window.localStorage.getItem('qs_active_shop_id');
    if (rawDirectShop) return rawDirectShop;
  } catch (err) {
    console.warn('[SupabaseClient] Error reading active shop id:', err);
  }
  return null;
};

// Helper to retrieve cached user profile
export const getActiveProfile = () => {
  try {
    const rawProfile = window.localStorage.getItem('qs_user_profile');
    if (rawProfile) return JSON.parse(rawProfile);

    const rawState = window.localStorage.getItem('qs_app_state');
    if (rawState) {
      const parsed = JSON.parse(rawState);
      if (parsed.userProfile) return parsed.userProfile;
    }
  } catch (err) {
    console.warn('[SupabaseClient] Error reading profile:', err);
  }
  return null;
};