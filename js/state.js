// Local caches that belong to a tenant/user and must never survive a user switch.
export function wipeLocalCaches() {
  try {
    const KEEP = new Set(['qs_pos_device_fingerprint']);
    Object.keys(window.localStorage).forEach((k) => {
      if ((k.startsWith('qs_') || k.startsWith('quicksell_')) && !KEEP.has(k)) {
        window.localStorage.removeItem(k);
      }
    });
    window.sessionStorage.clear();
  } catch (e) {
    /* storage unavailable */
  }
}

const DEFAULT_FEATURES = {
  open_orders: false,
  shift_management: false,
  time_clock: false,
  multipayment: false,
  taxes_charges: true,
  order_types: false,
  service_areas: false,
  manage_currency: false,
  email_notifications: false,
  addon_apps: true,
  kot_notes: false,
  credit_note: false,
  embedded_barcodes: false,
};

const DEFAULT_PREFERENCES = {
  currency: 'KES',
  timezone: 'Africa/Nairobi',
  dateFormat: 'DD/MM/YYYY',
  timeFormat: '24h',
  language: 'en',
};

export const globalState = {
  // Session & User
  user: null,
  profile: null,
  role: null, // 'admin' | 'manager' | 'cashier' | 'staff'

  // Active Store & Shift
  activeShopId: null,
  activeShop: null,
  currentShift: null,

  // System Feature Flags (Synced with store_settings)
  features: { ...DEFAULT_FEATURES },

  // Regional & Currency Preferences (Defaults)
  preferences: { ...DEFAULT_PREFERENCES },

  // Active Date Filter for Analytics & Date Ranges
  filterDate: new Date().toISOString().split('T')[0],
  filterDateEnd: new Date().toISOString().split('T')[0],
  datePeriod: 'today', // 'today' | 'yesterday' | '7days' | 'month' | 'last-month' | 'custom'

  // Real-time synced entity collections
  products: [],
  categories: [],
  inventory: [],
  customers: [],
  orders: [],
  payments: [],

  // State mutation listeners
  _subscribers: new Set(),
  _keySubscribers: new Map(),

  // Subscribe to general state changes (e.g. currency switch, shop switch)
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  },

  // Subscribe to specific entity or key changes (e.g. 'orders', 'inventory')
  subscribeKey(key, fn) {
    if (!this._keySubscribers.has(key)) {
      this._keySubscribers.set(key, new Set());
    }
    this._keySubscribers.get(key).add(fn);
    return () => {
      const set = this._keySubscribers.get(key);
      if (set) set.delete(fn);
    };
  },

  notify() {
    this._subscribers.forEach((fn) => {
      try {
        fn(this);
      } catch (err) {
        console.error('State subscriber error:', err);
      }
    });
  },

  notifyKey(key, value) {
    if (this._keySubscribers.has(key)) {
      this._keySubscribers.get(key).forEach((fn) => {
        try {
          fn(value, this);
        } catch (err) {
          console.error(`State key subscriber error [${key}]:`, err);
        }
      });
    }
    // Also dispatch a window event for views
    window.dispatchEvent(new CustomEvent(`qs-state:${key}`, { detail: value }));
  },

  // Generic collection setter
  setCollection(key, items = []) {
    this[key] = Array.isArray(items) ? items : [];
    this.notifyKey(key, this[key]);
    this.notify();
  },

  // Upsert a single record into an entity array (triggered by Supabase Realtime)
  upsertEntity(key, record) {
    if (!Array.isArray(this[key])) {
      this[key] = [];
    }
    const list = [...this[key]];
    const index = list.findIndex((item) => item.id === record.id);
    if (index >= 0) {
      list[index] = { ...list[index], ...record };
    } else {
      list.unshift(record);
    }
    this[key] = list;
    this.notifyKey(key, this[key]);
    this.notify();
  },

  // Remove a single record by ID (triggered by Supabase Realtime DELETE)
  removeEntity(key, id) {
    if (!Array.isArray(this[key])) return;
    this[key] = this[key].filter((item) => item.id !== id);
    this.notifyKey(key, this[key]);
    this.notify();
  },

  // Helper setters
  setUser(user, profile = null) {
    this.user = user;
    this.profile = profile;
    // Role comes ONLY from the server-side profile. Least privilege when unknown.
    this.role = profile?.role || 'cashier';
    if (profile?.shop_id) {
      this.activeShopId = profile.shop_id;
    }
    this.notify();
  },

  setActiveShop(shop) {
    // Tenant guard: never accept a shop outside the signed-in user's own scope.
    if (shop) {
      const p = this.profile;
      const isOrgAdmin = ['admin', 'owner'].includes(this.role);
      if (p?.organization_id && shop.organization_id && shop.organization_id !== p.organization_id) {
        console.error('[Tenant] Blocked switch to a shop outside your organization.');
        return false;
      }
      if (p && !isOrgAdmin && p.shop_id && shop.id !== p.shop_id) {
        console.error('[Tenant] Blocked switch: your role is limited to your assigned shop.');
        return false;
      }
    }
    this.activeShop = shop;
    this.activeShopId = shop?.id || null;
    // The shop is the single source of truth for currency (shared by every staff member and device)
    if (shop?.currency) {
      this.preferences = { ...this.preferences, currency: shop.currency };
      try { localStorage.setItem('quicksell_prefs', JSON.stringify(this.preferences)); } catch (e) { /* ignore */ }
    }
    this.notify();
    return true;
  },

  // Apply saved changes to the active shop record (e.g. currency) without a reload
  updateActiveShop(patch = {}) {
    if (!this.activeShop) return;
    this.activeShop = { ...this.activeShop, ...patch };
    if (patch.currency) {
      this.preferences = { ...this.preferences, currency: patch.currency };
      try { localStorage.setItem('quicksell_prefs', JSON.stringify(this.preferences)); } catch (e) { /* ignore */ }
    }
    this.notify();
  },

  setFilterDate(dateStr) {
    this.filterDate = dateStr;
    this.filterDateEnd = dateStr;
    this.notify();
  },

  setDateRange(startStr, endStr = startStr, periodKey = 'custom') {
    this.filterDate = startStr;
    this.filterDateEnd = endStr;
    this.datePeriod = periodKey;
    this.notify();
  },

  updatePreferences(newPrefs = {}) {
    this.preferences = { ...this.preferences, ...newPrefs };
    localStorage.setItem('quicksell_prefs', JSON.stringify(this.preferences));
    this.notify();
  },


  updateFeatures(newFeatures = {}) {
    this.features = { ...this.features, ...newFeatures };
    localStorage.setItem('quicksell_features', JSON.stringify(this.features));
    this.notifyKey('features', this.features);
    this.notify();
  },

  loadStoredFeatures() {
    try {
      const saved = localStorage.getItem('quicksell_features');
      if (saved) {
        this.features = { ...this.features, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Could not read cached features');
    }
  },

  loadStoredPreferences() {
    try {
      const saved = localStorage.getItem('quicksell_prefs');
      if (saved) {
        this.preferences = { ...this.preferences, ...JSON.parse(saved) };
      }
    } catch (e) {
      console.warn('Could not read cached preferences');
    }
  },

  clear() {
    this.user = null;
    this.profile = null;
    this.role = null;
    this.activeShopId = null;
    this.activeShop = null;
    this.currentShift = null;
    this.features = { ...DEFAULT_FEATURES };
    this.preferences = { ...DEFAULT_PREFERENCES };
    this.products = [];
    this.categories = [];
    this.inventory = [];
    this.customers = [];
    this.orders = [];
    this.payments = [];
    this.notify();
  },
};

// Initialize cached preferences on module load
globalState.loadStoredPreferences();
globalState.loadStoredFeatures();``