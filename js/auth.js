import { supabase } from './supabaseClient.js';
import { globalState } from './state.js';
import { Toast } from './components/Toast.js';

export const Auth = {
  // Sign in using email and password
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await this.syncSession();
    return data;
  },

  // Initiate registration (triggers Brevo 6-digit OTP delivery)
  async signUp(email, password, fullName) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    });
    if (error) throw error;
    return data;
  },

  // Confirm registration 6-digit OTP token
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
        }])
        .select()
        .single();
      profile = createdProfile;
    }

    // Load active shop context
    if (profile?.shop_id) {
      const { data: shop } = await supabase
        .from('shops')
        .select('*')
        .eq('id', profile.shop_id)
        .maybeSingle();
      if (shop) globalState.setActiveShop(shop);
    } else {
      // If admin has no store pinned, select the first available branch
      const { data: firstShop } = await supabase
        .from('shops')
        .select('*')
        .order('created_at')
        .limit(1)
        .maybeSingle();
      if (firstShop) globalState.setActiveShop(firstShop);
    }

    globalState.setUser(user, profile);
    return globalState;
  },

  // Log out and return to sign in
  async signOut() {
    await supabase.auth.signOut();
    globalState.clear();
    window.location.hash = '#dashboard';
    window.location.reload();
  },
};