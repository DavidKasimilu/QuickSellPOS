import { supabase } from './supabaseClient.js';
import { globalState, wipeLocalCaches } from './state.js';
import { Toast } from './components/Toast.js';

export const Auth = {
  // Sign in using email and password
  async signIn(email, password) {
    this.resetClientState(); // never inherit anything from a previous user on this device
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const state = await this.syncSession();
    if (!state) throw new Error(this.lastRejection || 'Sign-in blocked for this account.');

    // Audit login access event
    try {
      await supabase.from('access_logs').insert([{
        shop_id: globalState.activeShopId || null,
        user_id: data.user?.id,
        user_email: email,
        event_type: 'login',
        details: { platform: 'web_backoffice', user_agent: navigator.userAgent },
        created_at: new Date().toISOString()
      }]);
    } catch (e) {
      console.warn('[Auth] Access log write failed:', e);
    }

    return data;
  },

  // Initiate registration (includes business name, business type, phone, and country metadata)
  async signUp(email, password, fullName, businessName, businessType, phone, country) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
          business_name: businessName,
          business_type: businessType,
          phone: phone,
          country: country,
        },
      },
    });
    if (error) {
      if (/database error saving new user/i.test(error.message || '')) {
        throw new Error('We could not create this account. The email may already belong to a staff account or be registered - try signing in, or ask your administrator for an invitation.');
      }
      throw error;
    }
    return data;
  },

  // Confirm registration 8-digit OTP token
  async verifySignUpOTP(email, token) {
    const cleanToken = token ? token.trim() : '';
    if (cleanToken.length !== 8 || !/^\d{8}$/.test(cleanToken)) {
      throw new Error('Please enter a valid 8-digit security verification code.');
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: cleanToken,
      type: 'signup',
    });
    if (error) throw error;
    const state = await this.syncSession();
    if (!state) throw new Error(this.lastRejection || 'Your account is not ready yet. Please sign in again shortly.');
    return data;
  },

  // Request password reset OTP
  async requestPasswordReset(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
    return data;
  },

  // Verify password recovery 8-digit OTP token
  async verifyPasswordResetOTP(email, token) {
    const cleanToken = token ? token.trim() : '';
    if (cleanToken.length !== 8 || !/^\d{8}$/.test(cleanToken)) {
      throw new Error('Please enter a valid 8-digit security verification code.');
    }

    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token: cleanToken,
      type: 'recovery',
    });
    if (error) throw error;
    return data;
  },

  // Set new password after OTP verification (minimum 8 characters)
  async updatePassword(newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw new Error('Password must be at least 8 characters in length.');
    }

    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return data;
  },

  lastRejection: '',

  // Wipe every cached trace of the previous session (shared POS terminals!)
  resetClientState() {
    globalState.clear();
    wipeLocalCaches();
  },

  async rejectSession(message) {
    this.lastRejection = message;
    try { await supabase.auth.signOut(); } catch (e) { /* ignore */ }
    this.resetClientState();
    return null;
  },

  // The signup DB trigger creates the profile; allow a short window for it to commit.
  async loadProfile(userId) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (data) return data;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return null;
  },

  // Read session, load profile + shop (strictly the user's own), and synchronize memory store
  async syncSession() {
    this.lastRejection = '';
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.user) {
      this.resetClientState();
      return null;
    }

    const user = session.user;

    // Caches left by a different user on this browser must not leak into this session
    const cacheOwner = window.localStorage.getItem('qs_cache_owner');
    if (cacheOwner && cacheOwner !== user.id) this.resetClientState();
    window.localStorage.setItem('qs_cache_owner', user.id);

    // Profile is created server-side only (signup trigger). No client-side fallback creation:
    // a client must never be able to mint its own role or store assignment.
    const profile = await this.loadProfile(user.id);
    if (!profile) {
      return this.rejectSession('Your account is not linked to a store yet. Contact your administrator.');
    }
    if (profile.is_active === false) {
      return this.rejectSession('This account has been deactivated. Contact your administrator.');
    }

    // Resolve the active shop strictly from the profile's own assignment / organization
    let shopQuery = null;
    if (profile.shop_id) {
      shopQuery = supabase.from('shops').select('*').eq('id', profile.shop_id);
    } else if (profile.organization_id) {
      shopQuery = supabase.from('shops').select('*')
        .eq('organization_id', profile.organization_id)
        .order('created_at').limit(1);
    }
    const { data: shop } = shopQuery ? await shopQuery.maybeSingle() : { data: null };

    if (!shop) {
      return this.rejectSession('No store is assigned to your account. Contact your administrator.');
    }
    if (profile.organization_id && shop.organization_id && profile.organization_id !== shop.organization_id) {
      return this.rejectSession('Account/store mismatch detected. Contact support.');
    }

    globalState.setUser(user, profile);
    globalState.setActiveShop(shop);
    return globalState;
  },

  // Log out and return to sign in
  async signOut() {
    try {
      if (globalState.user?.email) {
        await supabase.from('access_logs').insert([{
          shop_id: globalState.activeShopId || null,
          user_id: globalState.user?.id,
          user_email: globalState.user?.email,
          event_type: 'logout',
          created_at: new Date().toISOString()
        }]);
      }
    } catch (e) {
      // Non-blocking log write
    }

    await supabase.auth.signOut();
    this.resetClientState();
    window.location.hash = '#dashboard';
    window.location.reload();
  },
};