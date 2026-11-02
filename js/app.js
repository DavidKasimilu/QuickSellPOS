import { Auth } from './auth.js';
import { globalState } from './state.js';
import { navigate } from './router.js';
import { Toast } from './components/Toast.js';
import { DeviceTracker } from './components/DeviceTracker.js';
import { supabase } from './supabaseClient.js';

let pendingAuthEmail = '';
let realtimeChannel = null;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Initial Icon Rendering
  if (window.lucide) {
    window.lucide.createIcons();
  }

  // 2. Bind DOM Handlers & Navigation Interactions
  bindAuthFormTransitions();
  bindAuthActions();
  bindProfileDrawer();
  bindDateFilters();
  bindGlobalNavActions();
  bindSidebarFlyoutMenu();

  // 3. Subscribe UI updates to Global State
  globalState.subscribe((state) => {
    updateTopBarUserMeta(state);
  });

  // 4. Session Validation & Device Tracker Activation
  try {
    const sessionState = await Auth.syncSession();
    if (!sessionState?.user) {
      tearDownRealtime();
      DeviceTracker.stopTracking();
      showAuthOverlay(true);
    } else {
      showAuthOverlay(false);
      DeviceTracker.startTracking();
      
      const activeShopId = globalState.activeShopId || sessionState.profile?.shop_id;
      if (activeShopId) {
        setupGlobalRealtime(activeShopId);
      }
      
      navigate(); // Mount initial hash route
    }
  } catch (err) {
    console.error('Session bootstrap failed:', err);
    tearDownRealtime();
    DeviceTracker.stopTracking();
    showAuthOverlay(true);
  }
});

// =========================================================================
// Pure Click-Based Collapsible Sidebar & Flyout Navigation
// =========================================================================
function adjustMenuBoundary(menuElement, triggerElement = null) {
  if (!menuElement) return;

  const viewportHeight = window.innerHeight;
  const bottomPadding = 24;

  if (triggerElement) {
    const rect = triggerElement.getBoundingClientRect();
    const availableSpace = viewportHeight - rect.top - bottomPadding;
    const maxAllowed = Math.min(210, Math.max(120, availableSpace));
    menuElement.style.maxHeight = `${maxAllowed}px`;
  } else {
    const rect = menuElement.getBoundingClientRect();
    const availableSpace = viewportHeight - rect.top - bottomPadding;
    menuElement.style.maxHeight = `${Math.max(150, availableSpace)}px`;
  }
  
  menuElement.style.overflowY = 'auto';
}

function bindSidebarFlyoutMenu() {
  const triggers = document.querySelectorAll('[data-menu-trigger]');
  const flyoutPanel = document.getElementById('subnav-flyout');
  const flyoutGroups = document.querySelectorAll('[data-flyout-parent]');
  const backdrop = document.getElementById('subnav-backdrop');
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  const sidebar = document.getElementById('main-sidebar');
  const mainContent = document.querySelector('.main-content');

  // Set initial collapsed state so content is unimpeded
  if (sidebar) sidebar.classList.add('collapsed');
  if (mainContent) mainContent.classList.add('expanded');

  function closeFlyout() {
    if (flyoutPanel) flyoutPanel.classList.add('hidden');
    if (backdrop) backdrop.classList.add('hidden');
    triggers.forEach((btn) => btn.classList.remove('active'));
  }

  function openFlyout(categoryKey, targetBtn) {
    let hasGroup = false;

    flyoutGroups.forEach((group) => {
      if (group.dataset.flyoutParent === categoryKey) {
        group.classList.remove('hidden');
        hasGroup = true;
      } else {
        group.classList.add('hidden');
      }
    });

    if (hasGroup) {
      triggers.forEach((btn) => btn.classList.remove('active'));
      if (targetBtn) {
        targetBtn.classList.add('active');

        const rect = targetBtn.getBoundingClientRect();
        const iconTop = rect.top;
        const windowHeight = window.innerHeight;

        if (flyoutPanel) {
          if (iconTop + 320 > windowHeight) {
            flyoutPanel.style.top = 'auto';
            flyoutPanel.style.bottom = '16px';
            flyoutPanel.style.maxHeight = `${windowHeight - 32}px`;
          } else {
            flyoutPanel.style.bottom = 'auto';
            flyoutPanel.style.top = `${Math.max(12, iconTop)}px`;
            flyoutPanel.style.maxHeight = `${windowHeight - Math.max(12, iconTop) - 24}px`;
          }
        }
      }
      
      if (flyoutPanel) flyoutPanel.classList.remove('hidden');
      if (backdrop) backdrop.classList.remove('hidden');
    } else {
      closeFlyout();
    }
  }

  // 1. Burger button click toggles side rail visibility
  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isCollapsed = sidebar.classList.contains('collapsed');
      if (isCollapsed) {
        sidebar.classList.remove('collapsed');
        if (mainContent) mainContent.classList.remove('expanded');
      } else {
        sidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('expanded');
        closeFlyout();
      }
    });
  }

  // 2. Category trigger button click toggles flyout menu
  triggers.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const categoryKey = btn.dataset.menuTrigger;

      if (btn.classList.contains('active') && flyoutPanel && !flyoutPanel.classList.contains('hidden')) {
        closeFlyout();
      } else {
        openFlyout(categoryKey, btn);
      }
    });
  });

  // 3. Accordion dropdown toggles inside flyouts
  const dropdownTriggers = document.querySelectorAll('[data-dropdown-trigger]');
  dropdownTriggers.forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = trigger.dataset.dropdownTrigger;
      const content = document.querySelector(`[data-dropdown-content="${key}"]`);

      if (content) {
        const isHidden = content.classList.contains('hidden');
        if (isHidden) {
          content.classList.remove('hidden');
          trigger.classList.add('open');
          adjustMenuBoundary(content, trigger);
        } else {
          content.classList.add('hidden');
          trigger.classList.remove('open');
        }
      }
    });
  });

  // 4. Subnav item click -> Navigate & close menu
  const subnavItems = document.querySelectorAll('.subnav-item, .subnav-subitem');
  subnavItems.forEach((item) => {
    item.addEventListener('click', () => {
      closeFlyout();
      if (sidebar) sidebar.classList.add('collapsed');
      if (mainContent) mainContent.classList.add('expanded');
    });
  });

  // 5. Direct icon clicks -> Collapse sidebar
  const directNavLinks = document.querySelectorAll('.sidebar-nav a.nav-icon-link');
  directNavLinks.forEach((link) => {
    link.addEventListener('click', () => {
      closeFlyout();
      if (sidebar) sidebar.classList.add('collapsed');
      if (mainContent) mainContent.classList.add('expanded');
    });
  });

  // 6. Backdrop & outside click closes flyout
  if (backdrop) {
    backdrop.addEventListener('click', closeFlyout);
  }

  document.addEventListener('click', (e) => {
    if (flyoutPanel && !flyoutPanel.contains(e.target) && !e.target.closest('[data-menu-trigger]')) {
      closeFlyout();
    }
  });
}

// =========================================================================
// Supabase Real-Time Channel Synchronization
// =========================================================================
function setupGlobalRealtime(shopId) {
  if (!supabase || !shopId) return;

  tearDownRealtime();

  realtimeChannel = supabase
    .channel(`backoffice_shop_${shopId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products', filter: `shop_id=eq.${shopId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          globalState.removeEntity('products', payload.old.id);
        } else {
          globalState.upsertEntity('products', payload.new);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'categories', filter: `shop_id=eq.${shopId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          globalState.removeEntity('categories', payload.old.id);
        } else {
          globalState.upsertEntity('categories', payload.new);
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory', filter: `shop_id=eq.${shopId}` },
      (payload) => {
        globalState.upsertEntity('inventory', payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders', filter: `shop_id=eq.${shopId}` },
      (payload) => {
        globalState.upsertEntity('orders', payload.new);
        Toast.info(`Incoming sale recorded: #${payload.new.receipt_no}`);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders', filter: `shop_id=eq.${shopId}` },
      (payload) => {
        globalState.upsertEntity('orders', payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'customers', filter: `shop_id=eq.${shopId}` },
      (payload) => {
        if (payload.eventType === 'DELETE') {
          globalState.removeEntity('customers', payload.old.id);
        } else {
          globalState.upsertEntity('customers', payload.new);
        }
      }
    )
    .subscribe((status) => {
      console.log(`[Backoffice Realtime] Status: ${status}`);
    });
}

function tearDownRealtime() {
  if (realtimeChannel && supabase) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}

// =========================================================================
// UI Authentication Overlays & Form Switching
// =========================================================================
function showAuthOverlay(visible = true) {
  const authWrapper = document.getElementById('auth-container');
  if (visible) {
    authWrapper.classList.remove('hidden');
  } else {
    authWrapper.classList.add('hidden');
  }
}

function switchAuthView(viewId) {
  const forms = ['form-login', 'form-register', 'form-otp', 'form-forgot', 'form-reset-password'];
  forms.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const active = document.getElementById(viewId);
  if (active) active.classList.remove('hidden');

  const subtitle = document.getElementById('auth-subtitle');
  switch (viewId) {
    case 'form-login':
      subtitle.textContent = 'Sign in to access your backoffice terminal';
      break;
    case 'form-register':
      subtitle.textContent = 'Register a new backoffice administrator account';
      break;
    case 'form-otp':
      subtitle.textContent = 'Enter the 6-digit code delivered to your inbox';
      break;
    case 'form-forgot':
      subtitle.textContent = 'Reset your portal password via email OTP';
      break;
    case 'form-reset-password':
      subtitle.textContent = 'Set and confirm your new secure password';
      break;
  }

  if (window.lucide) window.lucide.createIcons();
}

function bindAuthFormTransitions() {
  document.getElementById('link-goto-register').onclick = (e) => {
    e.preventDefault();
    switchAuthView('form-register');
  };

  document.getElementById('link-goto-forgot').onclick = (e) => {
    e.preventDefault();
    switchAuthView('form-forgot');
  };

  document.getElementById('link-goto-login-1').onclick = (e) => {
    e.preventDefault();
    switchAuthView('form-login');
  };

  document.getElementById('link-goto-login-2').onclick = (e) => {
    e.preventDefault();
    switchAuthView('form-login');
  };

  document.getElementById('btn-cancel-otp').onclick = () => {
    switchAuthView('form-login');
  };
}

// =========================================================================
// Authentication Execution
// =========================================================================
function bindAuthActions() {
  const formLogin = document.getElementById('form-login');
  formLogin.onsubmit = async (e) => {
    e.preventDefault();
    const btn = formLogin.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Signing in...';

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      await Auth.signIn(email, password);
      DeviceTracker.startTracking();
      showAuthOverlay(false);

      const activeShopId = globalState.activeShopId || globalState.profile?.shop_id;
      if (activeShopId) {
        setupGlobalRealtime(activeShopId);
      }

      Toast.success('Signed in successfully.');
      navigate();
    } catch (err) {
      Toast.error(err.message || 'Login failed. Verify credentials.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  };

  const formRegister = document.getElementById('form-register');
  formRegister.onsubmit = async (e) => {
    e.preventDefault();
    const btn = formRegister.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Dispatching code...';

    const name = document.getElementById('reg-fullname').value.trim();
    const businessName = document.getElementById('reg-business-name').value.trim();
    const businessType = document.getElementById('reg-business-type').value;
    const phone = document.getElementById('reg-phone').value.trim();
    const country = document.getElementById('reg-country').value;
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    try {
      await Auth.signUp(email, password, name, businessName, businessType, phone, country);
      pendingAuthEmail = email;
      document.getElementById('otp-target-email').textContent = email;
      Toast.success('Verification code dispatched to your inbox.');
      switchAuthView('form-otp');
    } catch (err) {
      Toast.error(err.message || 'Registration failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Register Store & Send OTP';
    }
  };

  const formOtp = document.getElementById('form-otp');
  formOtp.onsubmit = async (e) => {
    e.preventDefault();
    const btn = formOtp.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Verifying token...';

    const token = document.getElementById('otp-code').value.trim();

    try {
      await Auth.verifySignUpOTP(pendingAuthEmail, token);
      DeviceTracker.startTracking();
      showAuthOverlay(false);

      const activeShopId = globalState.activeShopId || globalState.profile?.shop_id;
      if (activeShopId) {
        setupGlobalRealtime(activeShopId);
      }

      Toast.success('Account successfully verified.');
      navigate();
    } catch (err) {
      Toast.error(err.message || 'Invalid or expired OTP token.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verify Code';
    }
  };

  const formForgot = document.getElementById('form-forgot');
  formForgot.onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const btn = formForgot.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Requesting token...';

    try {
      await Auth.requestPasswordReset(email);
      pendingAuthEmail = email;
      Toast.success('Reset code sent to email.');
      switchAuthView('form-reset-password');
    } catch (err) {
      Toast.error(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send Reset Code';
    }
  };

  const formResetPass = document.getElementById('form-reset-password');
  formResetPass.onsubmit = async (e) => {
    e.preventDefault();
    const token = document.getElementById('reset-otp').value.trim();
    const newPassword = document.getElementById('reset-new-password').value;
    const btn = formResetPass.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Updating credentials...';

    try {
      await Auth.verifyPasswordResetOTP(pendingAuthEmail, token);
      await Auth.updatePassword(newPassword);
      Toast.success('Password updated. Please log in.');
      switchAuthView('form-login');
    } catch (err) {
      Toast.error(err.message || 'Password reset failed.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Set New Password';
    }
  };
}

// =========================================================================
// Profile Drawer & Date Filtering
// =========================================================================
function bindProfileDrawer() {
  const drawer = document.getElementById('drawer-profile');
  const openBtn = document.getElementById('btn-open-profile');
  const closeBtn = document.getElementById('btn-close-profile');
  const form = document.getElementById('form-profile-update');

  openBtn.onclick = () => {
    document.getElementById('profile-email').value = globalState.user?.email || '';
    document.getElementById('profile-fullname').value = globalState.profile?.full_name || '';
    document.getElementById('profile-currency').value = globalState.preferences.currency;
    document.getElementById('profile-timezone').value = globalState.preferences.timezone;
    document.getElementById('profile-date-format').value = globalState.preferences.dateFormat;
    document.getElementById('profile-time-format').value = globalState.preferences.timeFormat;
    document.getElementById('profile-language').value = globalState.preferences.language;
    
    drawer.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons({ root: drawer });
  };

  closeBtn.onclick = () => drawer.classList.add('hidden');

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('profile-fullname').value.trim();
    const newPassword = document.getElementById('profile-new-password').value;

    const newPreferences = {
      currency: document.getElementById('profile-currency').value,
      timezone: document.getElementById('profile-timezone').value,
      dateFormat: document.getElementById('profile-date-format').value,
      timeFormat: document.getElementById('profile-time-format').value,
      language: document.getElementById('profile-language').value,
    };

    globalState.updatePreferences(newPreferences);

    if (globalState.user?.id) {
      await supabase
        .from('profiles')
        .update({ full_name: fullName, updated_at: new Date().toISOString() })
        .eq('id', globalState.user.id);
      if (globalState.profile) globalState.profile.full_name = fullName;
    }

    if (newPassword && newPassword.length >= 6) {
      try {
        await Auth.updatePassword(newPassword);
        Toast.success('Password updated successfully.');
      } catch (err) {
        Toast.error(err.message);
      }
    }

    Toast.success('Profile preferences saved.');
    drawer.classList.add('hidden');
    navigate();
  };
}

function bindDateFilters() {
  const chips = document.querySelectorAll('.date-chip[data-period]');
  const calInput = document.getElementById('stats-calendar-filter');

  if (calInput) calInput.value = globalState.filterDate;

  chips.forEach((chip) => {
    chip.onclick = () => {
      chips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');

      const period = chip.dataset.period;
      const now = new Date();

      if (period === 'today') {
        globalState.datePeriod = 'today';
        globalState.setFilterDate(now.toISOString().split('T')[0]);
      } else if (period === 'yesterday') {
        globalState.datePeriod = 'yesterday';
        now.setDate(now.getDate() - 1);
        globalState.setFilterDate(now.toISOString().split('T')[0]);
      } else if (period === '7days') {
        globalState.datePeriod = '7days';
        now.setDate(now.getDate() - 6);
        globalState.setFilterDate(now.toISOString().split('T')[0]);
      } else if (period === 'month') {
        globalState.datePeriod = 'month';
        const startM = new Date(now.getFullYear(), now.getMonth(), 1);
        globalState.setFilterDate(startM.toISOString().split('T')[0]);
      } else if (period === 'last-month') {
        globalState.datePeriod = 'last-month';
        const startPrevM = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        globalState.setFilterDate(startPrevM.toISOString().split('T')[0]);
      }

      if (calInput) calInput.value = globalState.filterDate;
      navigate();
    };
  });

  if (calInput) {
    calInput.onchange = (e) => {
      chips.forEach((c) => c.classList.remove('active'));
      globalState.datePeriod = 'custom';
      globalState.setFilterDate(e.target.value);
      navigate();
    };
  }
}

function updateTopBarUserMeta(state) {
  const roleEl = document.getElementById('user-role-label');
  const emailEl = document.getElementById('user-email-label');
  const shopEl = document.getElementById('badge-active-shop');

  if (roleEl) roleEl.textContent = (state.role || 'cashier').toUpperCase();
  if (emailEl) emailEl.textContent = state.user?.email || 'Unauthorized';
  if (shopEl) shopEl.textContent = state.activeShop?.name || 'Main Branch';
}

function bindGlobalNavActions() {
  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      if (confirm('Are you sure you want to log out of QuickSell POS?')) {
        tearDownRealtime();
        DeviceTracker.stopTracking();
        await Auth.signOut();
      }
    };
  }
}