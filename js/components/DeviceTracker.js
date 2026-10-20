import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';

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
      await supabase.rpc('touch_device_heartbeat', {
        p_device_fingerprint: device.fingerprint,
        p_device_name: device.name,
        p_shop_id: globalState.activeShopId,
      });
    } catch (err) {
      console.warn('Device heartbeat ping failed:', err.message);
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