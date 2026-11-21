import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import {
  renderFeaturesPane,
  renderBillingPane,
  renderTaxesPane,
  renderSoftwareSetupPane,
  renderAddonAppsPane,
  renderOrderTypesPane,
  renderServiceAreasPane,
  renderCurrencyPane,
  renderEmailNotificationsPane,
} from './settings/systemModules.js';
import {
  renderReceiptDesignerPane,
  renderQrReceiptPane,
  renderPaymentTypesPane,
} from './settings/receiptAndPayments.js';
import {
  renderShopsPane,
  renderPosDevicesPane,
} from './settings/shopsAndDevices.js';

export async function mount(container, activeTabParam = null, queryParams = null) {
  let activeSection = queryParams?.get('section') || 'features';
  let settingsRow = null;
  let sessionSubscription = null;

  // Fetch store_settings row once on mount
  if (globalState.activeShopId) {
    const { data } = await supabase
      .from('store_settings')
      .select('*')
      .eq('shop_id', globalState.activeShopId)
      .maybeSingle();

    if (data) {
      settingsRow = data;
      if (data.features) {
        globalState.updateFeatures(data.features);
      }
    }
  }

  function getSystemNavItems() {
    const f = globalState.features || {};
    const items = [
      { key: 'features', label: 'Features' },
      { key: 'billing', label: 'Billing & subscriptions' },
      { key: 'taxes', label: 'Taxes / charges' },
      { key: 'software-setup', label: 'Software setup' },
      { key: 'design-receipt', label: 'Design receipt' },
      { key: 'qr-receipt', label: 'Print QR code in receipt' },
      { key: 'payment-types', label: 'Payment types' },
      { key: 'addon-apps', label: 'Addon apps' },
    ];

    // Dynamically reveal extra config links when their feature toggles are ON
    if (f.order_types) items.push({ key: 'order-types', label: 'Order types' });
    if (f.service_areas) items.push({ key: 'service-areas', label: 'Service areas' });
    if (f.manage_currency) items.push({ key: 'manage-currency', label: 'Manage currency' });
    if (f.email_notifications) items.push({ key: 'email-notifications', label: 'Email notifications' });

    return items;
  }

  function renderLayout() {
    const systemItems = getSystemNavItems();
    const shopItems = [
      { key: 'shops', label: 'Shops' },
      { key: 'pos-devices', label: 'POS devices' },
    ];

    container.innerHTML = `
      <div class="settings-split-shell">
        <!-- LEFT NAVIGATION CARDS -->
        <aside class="settings-nav-column">
          <!-- Card 1: System Settings -->
          <div class="settings-nav-card">
            <div class="settings-nav-card-header">
              <div class="settings-header-badge slate">
                <i data-lucide="settings"></i>
              </div>
              <div>
                <div class="settings-card-title">Settings</div>
                <div class="settings-card-subtitle">System settings</div>
              </div>
            </div>
            <div class="settings-nav-list">
              ${systemItems
                .map(
                  (item) => `
                <button type="button" class="settings-nav-item ${activeSection === item.key ? 'active' : ''}" data-setting-nav="${item.key}">
                  ${item.label}
                </button>
              `
                )
                .join('')}
            </div>
          </div>

          <!-- Card 2: Shop & POS Settings -->
          <div class="settings-nav-card">
            <div class="settings-nav-card-header">
              <div class="settings-header-badge teal">
                <i data-lucide="store"></i>
              </div>
              <div>
                <div class="settings-card-title">Shops</div>
                <div class="settings-card-subtitle">Shop & POS settings</div>
              </div>
            </div>
            <div class="settings-nav-list">
              ${shopItems
                .map(
                  (item) => `
                <button type="button" class="settings-nav-item ${activeSection === item.key ? 'active' : ''}" data-setting-nav="${item.key}">
                  ${item.label}
                </button>
              `
                )
                .join('')}
            </div>
          </div>
        </aside>

        <!-- RIGHT DETAIL CONTENT PANEL -->
        <section class="settings-detail-card" id="settings-detail-pane">
          <div style="padding: 32px; color: var(--text-muted);">Loading configuration...</div>
        </section>
      </div>
    `;

    // Bind left-menu clicks
    container.querySelectorAll('[data-setting-nav]').forEach((btn) => {
      btn.onclick = () => {
        activeSection = btn.dataset.settingNav;
        container.querySelectorAll('[data-setting-nav]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        mountDetailPane();
      };
    });

    if (window.lucide) {
      window.lucide.createIcons({ root: container });
    }
  }

  async function mountDetailPane() {
    const pane = document.getElementById('settings-detail-pane');
    if (!pane) return;

    // Refresh latest settings row if needed
    if (globalState.activeShopId) {
      const { data } = await supabase
        .from('store_settings')
        .select('*')
        .eq('shop_id', globalState.activeShopId)
        .maybeSingle();
      if (data) settingsRow = data;
    }

    switch (activeSection) {
      case 'features':
        await renderFeaturesPane(pane, settingsRow, () => {
          // Re-render sidebar links when conditional features toggle on/off
          renderLayout();
          mountDetailPane();
        });
        break;
      case 'billing':
        await renderBillingPane(pane, settingsRow);
        break;
      case 'taxes':
        await renderTaxesPane(pane);
        break;
      case 'software-setup':
        await renderSoftwareSetupPane(pane, settingsRow);
        break;
      case 'design-receipt':
        await renderReceiptDesignerPane(pane);
        break;
      case 'qr-receipt':
        await renderQrReceiptPane(pane, settingsRow);
        break;
      case 'payment-types':
        await renderPaymentTypesPane(pane);
        break;
      case 'addon-apps':
        await renderAddonAppsPane(pane);
        break;
      case 'order-types':
        await renderOrderTypesPane(pane);
        break;
      case 'service-areas':
        await renderServiceAreasPane(pane);
        break;
      case 'manage-currency':
        await renderCurrencyPane(pane);
        break;
      case 'email-notifications':
        await renderEmailNotificationsPane(pane, settingsRow);
        break;
      case 'shops':
        await renderShopsPane(pane, () => {
          renderLayout();
          mountDetailPane();
        });
        break;
      case 'pos-devices':
        await renderPosDevicesPane(pane);
        break;
      default:
        await renderFeaturesPane(pane, settingsRow);
        break;
    }

    if (window.lucide) {
      window.lucide.createIcons({ root: pane });
    }
  }

  // Subscribe to live device session changes when viewing POS devices
  if (globalState.activeShopId) {
    sessionSubscription = supabase
      .channel(`device_sessions_${globalState.activeShopId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pos_device_sessions', filter: `shop_id=eq.${globalState.activeShopId}` },
        () => {
          if (activeSection === 'pos-devices') {
            mountDetailPane();
          }
        }
      )
      .subscribe();
  }

  renderLayout();
  await mountDetailPane();

  return () => {
    if (sessionSubscription && supabase) {
      supabase.removeChannel(sessionSubscription);
    }
  };
}
