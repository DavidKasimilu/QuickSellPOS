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

    try {
      // One atomic server call: registers/updates this terminal and returns whether it is still allowed.
      // (A revoked terminal stays revoked: the server never flips is_active back to true.)
      const { data: isActive, error } = await supabase.rpc('touch_device_heartbeat', {
        p_device_fingerprint: device.fingerprint,
        p_device_name: device.name,
        p_shop_id: globalState.activeShopId,
      });

      if (error) {
        console.warn('[DeviceTracker] Heartbeat error:', error.message);
        return;
      }

      if (isActive === false) {
        this.stopTracking();
        alert('This POS device terminal session has been revoked by an administrator.');
        await Auth.signOut();
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

    if (!this._onlineBound) {
      this._onlineBound = true;
      window.addEventListener('online', () => this.pingHeartbeat());
    }
  },

  stopTracking() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  },
};