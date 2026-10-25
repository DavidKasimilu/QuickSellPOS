import { supabase } from './supabaseClient.js';
import { globalState } from './state.js';
import { Toast } from './components/Toast.js';

export const Auth = {
  // Sign in using email and password
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await this.syncSession();

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
    if (error) throw error;
    return data;
  },

  // Confirm registration 8-digit OTP token
  async verifySignUpOTP(email, token) {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'signup',
    });
    if (error) throw error;
    await this.syncSession();
    return data;
  },

  // Request password reset OTP
  async requestPasswordReset(email) {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
    return data;
  },

  // Verify password recovery OTP
  async verifyPasswordResetOTP(email, token) {
    const { data, error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: 'recovery',
    });
    if (error) throw error;
    return data;
  },

  // Set new password after OTP verification
  async updatePassword(newPassword) {
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
    return data;
  },

  // Read session, load Postgres trigger profile, and synchronize memory store
  async syncSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error || !session?.user) {
      globalState.clear();
      this.clearLocalStorageMirrors();
      return null;
    }

    const user = session.user;

    // Fetch user profile from the database
    let { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Fallback profile synchronization if trigger hasn't committed yet
    if (!profile) {
      const isAdminAccount = user.email === 'davidkasimilu71@gmail.com';
      const { data: createdProfile } = await supabase
        .from('profiles')
        .upsert([{
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || '',
          role: isAdminAccount ? 'admin' : 'cashier',
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      profile = createdProfile;
    }

    // Load active shop context
    let activeShop = null;
    if (profile?.shop_id) {
      const { data: shop } = await supabase
        .from('shops')
        .select('*')
        .eq('id', profile.shop_id)
        .maybeSingle();
      if (shop) activeShop = shop;
    } else {
      // If admin has no store pinned, select the first available branch
      const { data: firstShop } = await supabase
        .from('shops')
        .select('*')
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (firstShop) activeShop = firstShop;
    }

    if (activeShop) {
      globalState.setActiveShop(activeShop);
      window.localStorage.setItem('qs_active_shop_id', activeShop.id);
    }

    if (profile) {
      window.localStorage.setItem('qs_user_profile', JSON.stringify(profile));
    }

    globalState.setUser(user, profile);
    return globalState;
  },

  clearLocalStorageMirrors() {
    window.localStorage.removeItem('qs_user_profile');
    window.localStorage.removeItem('qs_active_shop_id');
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
    globalState.clear();
    this.clearLocalStorageMirrors();
    window.location.hash = '#dashboard';
    window.location.reload();
  },
};