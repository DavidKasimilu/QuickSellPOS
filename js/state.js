export const globalState = {
  // Session & User
  user: null,
  profile: null,
  role: null, // 'admin' | 'manager' | 'cashier' | 'staff'

  // Active Store & Shift
  activeShopId: null,
  activeShop: null,
  currentShift: null,

  // Regional & Currency Preferences (Defaults)
  preferences: {
    currency: 'KES',
    timezone: 'Africa/Nairobi',
    dateFormat: 'DD/MM/YYYY',
    timeFormat: '24h',
    language: 'en',
  },

  // Active Date Filter for Analytics
  filterDate: new Date().toISOString().split('T')[0],

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
    this.role = profile?.role || (user?.email === 'davidkasimilu71@gmail.com' ? 'admin' : 'cashier');
    if (profile?.shop_id) {
      this.activeShopId = profile.shop_id;
    }
    this.notify();
  },

  setActiveShop(shop) {
    this.activeShop = shop;
    this.activeShopId = shop?.id || null;
    this.notify();
  },

  setFilterDate(dateStr) {
    this.filterDate = dateStr;
    this.notify();
  },

  updatePreferences(newPrefs = {}) {
    this.preferences = { ...this.preferences, ...newPrefs };
    localStorage.setItem('quicksell_prefs', JSON.stringify(this.preferences));
    this.notify();
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