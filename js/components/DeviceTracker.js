import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Auth } from '../auth.js';

export const DeviceTracker = {
  heartbeatInterval: null,
  FINGERPRINT_KEY: 'qs_pos_device_fingerprint',

  getFingerprint() {
    let fp = localStorage.getItem(this.FINGERPRINT_KEY);
    if (!fp) {
      fp = 'dev_' + crypto.randomUUID();
      localStorage.setItem(this.FINGERPRINT_KEY, fp);
    }
    return fp;
  },

  getDeviceInfo() {
    const ua = navigator.userAgent;
    let os = 'Unknown OS';
    let browser = 'Unknown Browser';
    let deviceType = 'Desktop';

    // 1. Detect Operating System
    if (/android/i.test(ua)) os = 'Android';
    else if (/iPad|iPhone|iPod/.test(ua)) os = 'iOS';
    else if (/Windows NT/i.test(ua)) os = 'Windows';
    else if (/Macintosh|Mac OS X/i.test(ua)) os = 'macOS';
    else if (/Linux/i.test(ua)) os = 'Linux';

    // 2. Detect Browser
    if (/Edg\//i.test(ua)) browser = 'Edge';
    else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = 'Chrome';
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
    else if (/Firefox\//i.test(ua)) browser = 'Firefox';

    // 3. Detect Form Factor (Mobile, Tablet, Desktop)
    const isTouch = navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
    const isMobileUa = /Mobile|Android|iP(hone|od)/i.test(ua);
    const isTabletUa = /Tablet|iPad/i.test(ua) || (os === 'macOS' && isTouch);

    if (isTabletUa) deviceType = 'Tablet';
    else if (isMobileUa) deviceType = 'Mobile Phone';
    else if (isTouch && window.innerWidth <= 1024) deviceType = 'Touch Terminal';
    else deviceType = 'Desktop PC';

    return {
      name: `${deviceType} (${os} - ${browser})`,
      fingerprint: this.getFingerprint(),
      deviceType,
      os,
      browser,
    };
  },

  async pingHeartbeat() {
    if (!globalState.user?.id || !globalState.activeShopId) return;

    const device = this.getDeviceInfo();
    const nowIso = new Date().toISOString();

    try {
      // 1. Try atomic database RPC function first
      let rpcSuccess = false;
      try {
        const { error: rpcErr } = await supabase.rpc('touch_device_heartbeat', {
          p_device_fingerprint: device.fingerprint,
          p_device_name: device.name,
          p_shop_id: globalState.activeShopId,
        });

        if (!rpcErr) {
          rpcSuccess = true;
        }
      } catch (rpcEx) {
        // Fallback to direct table upsert
      }

      // 2. Fallback direct table upsert into pos_device_sessions
      if (!rpcSuccess) {
        const { data: sessionRecord, error: upsertErr } = await supabase
          .from('pos_device_sessions')
          .upsert([{
            device_fingerprint: device.fingerprint,
            device_name: device.name,
            shop_id: globalState.activeShopId,
            user_id: globalState.user.id,
            last_seen_at: nowIso,
            is_active: true,
            updated_at: nowIso
          }], { onConflict: 'device_fingerprint' })
          .select('is_active')
          .maybeSingle();

        // 3. Security Enforcement: If admin revoked this terminal, log it out
        if (sessionRecord && sessionRecord.is_active === false) {
          this.stopTracking();
          alert('This POS device terminal session has been revoked by an administrator.');
          await Auth.signOut();
        }

        if (upsertErr) {
          console.warn('[DeviceTracker] Heartbeat upsert error:', upsertErr.message);
        }
      }
    } catch (err) {
      console.warn('[DeviceTracker] Heartbeat ping failed:', err.message);
    }
  },

  startTracking(intervalMs = 45000) {
    this.stopTracking();
    this.pingHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        this.pingHeartbeat();
      }
    }, intervalMs);

    window.addEventListener('online', () => this.pingHeartbeat());
  },

  stopTracking() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  },
};