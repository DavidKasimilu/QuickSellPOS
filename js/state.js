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

  // State mutation listeners
  _subscribers: new Set(),

  // Subscribe to state changes (e.g. currency switch, shop switch)
  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
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
    this.notify();
  },
};

// Initialize cached preferences on module load
globalState.loadStoredPreferences();