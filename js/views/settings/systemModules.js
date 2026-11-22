import { supabase } from '../../supabaseClient.js';
import { globalState } from '../../state.js';
import { Modal } from '../../components/Modal.js';
import { renderDataTable } from '../../components/DataTable.js';
import { Toast } from '../../components/Toast.js';
import { scoped } from '../../tenant.js';

// =========================================================================
// 1. FEATURES TOGGLES (Matches Screenshots 1 & 2)
// =========================================================================
export const FEATURE_DEFINITIONS = [
  {
    key: 'open_orders',
    icon: 'file-text',
    title: 'Open orders',
    description: "Save and hold, keep updating multiple orders until they're fully paid.",
  },
  {
    key: 'shift_management',
    icon: 'clock',
    title: 'Shift management',
    description: 'Track employee shift start and end time, cash in and out with a reason.',
  },
  {
    key: 'time_clock',
    icon: 'timer',
    title: 'Time clock',
    description: "Track employees' clock in/out time and calculate their total work hours.",
  },
  {
    key: 'multipayment',
    icon: 'coins',
    title: 'Multipayment',
    description: 'Enable multi payment to accept payments in multiple options.',
  },
  {
    key: 'taxes_charges',
    icon: 'percent',
    title: 'Taxes / charges',
    description: 'Maintain taxes as include, exclude or attach to the receipt total.',
  },
  {
    key: 'order_types',
    icon: 'shopping-bag',
    title: 'Order types',
    description: 'Maintain multiple order types like dining, delivery, take away.',
  },
  {
    key: 'service_areas',
    icon: 'layout-grid',
    title: 'Service areas',
    description: 'Predefined table numbers, room names, or other service options facilitate easier order tracking and delivery.',
  },
  {
    key: 'manage_currency',
    icon: 'circle-dollar-sign',
    title: 'Manage currency',
    description: 'Create and manage multiple currencies, and accept payments for sales in other currencies.',
  },
  {
    key: 'email_notifications',
    icon: 'bell',
    title: 'Email notification settings',
    description: 'Receive alerts for events like daily sales summary, user login/log out.',
  },
  {
    key: 'addon_apps',
    icon: 'puzzle',
    title: 'Addon apps',
    description: "Enable addons as it's necessary to streamline the business processes.",
  },
  {
    key: 'kot_notes',
    icon: 'file-edit',
    title: 'KOT notes',
    description: 'Send orders to the kitchen with more specific details.',
  },
  {
    key: 'credit_note',
    icon: 'file-minus',
    title: 'Credit note',
    description: 'Issued to indicate a return of incorrect or damaged products.',
  },
  {
    key: 'embedded_barcodes',
    icon: 'barcode',
    title: 'Embedded barcodes',
    description: 'Allow to scan barcodes with embedded weight or price.',
  },
];

export async function renderFeaturesPane(target, settingsRow, onFeaturesUpdated) {
  const currentFeatures = { ...globalState.features, ...(settingsRow?.features || {}) };

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Features</h2>
    </div>
    <div class="settings-feature-list">
      ${FEATURE_DEFINITIONS.map((feat) => {
        const isChecked = !!currentFeatures[feat.key];
        return `
          <div class="settings-feature-row" data-feature-row="${feat.key}">
            <div class="settings-feature-icon">
              <i data-lucide="${feat.icon}"></i>
            </div>
            <div class="settings-feature-info">
              <div class="settings-feature-title">${feat.title}</div>
              <div class="settings-feature-desc">${feat.description}</div>
            </div>
            <label class="qs-switch" title="Toggle ${feat.title}">
              <input type="checkbox" data-feature-toggle="${feat.key}" ${isChecked ? 'checked' : ''} />
              <span class="qs-slider"></span>
            </label>
          </div>
        `;
      }).join('')}
    </div>
  `;

  target.querySelectorAll('[data-feature-toggle]').forEach((input) => {
    input.addEventListener('change', async (e) => {
      const key = e.target.dataset.featureToggle;
      const enabled = e.target.checked;
      const updatedFeatures = { ...currentFeatures, [key]: enabled };
      currentFeatures[key] = enabled;

      // Optimistic local state update
      globalState.updateFeatures(updatedFeatures);
      if (typeof onFeaturesUpdated === 'function') {
        onFeaturesUpdated(updatedFeatures);
      }

      if (!globalState.activeShopId) {
        Toast.success(`Feature "${key.replace(/_/g, ' ')}" updated locally.`);
        return;
      }

      const { error } = await supabase
        .from('store_settings')
        .upsert(
          [
            {
              shop_id: globalState.activeShopId,
              features: updatedFeatures,
              updated_at: new Date().toISOString(),
            },
          ],
          { onConflict: 'shop_id' }
        );

      if (error) {
        Toast.error(`Could not sync setting: ${error.message}`);
      } else {
        Toast.success(`${enabled ? 'Enabled' : 'Disabled'} ${FEATURE_DEFINITIONS.find((f) => f.key === key)?.title || key}`);
      }
    });
  });
}

// =========================================================================
// 2. BILLING & SUBSCRIPTIONS
// =========================================================================
export async function renderBillingPane(target, settingsRow) {
  const plan = (settingsRow?.subscription_plan || 'starter').toUpperCase();
  const status = (settingsRow?.subscription_status || 'active').toUpperCase();
  const currency = globalState.preferences.currency || 'KES';

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Billing & subscriptions</h2>
      <span class="badge badge-teal">${status}</span>
    </div>
    <div style="padding: 24px;">
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:24px;">
        <div class="kpi-card" style="border-color: var(--teal-500); background: var(--teal-50);">
          <div class="kpi-header">
            <span class="kpi-label">Current Plan</span>
            <i data-lucide="award" class="text-teal"></i>
          </div>
          <div class="kpi-value">${plan}</div>
          <div class="kpi-meta">Multi-terminal POS & Cloud Backoffice</div>
        </div>

        <div class="kpi-card">
          <div class="kpi-header">
            <span class="kpi-label">Active Modules</span>
            <i data-lucide="layers" class="text-teal"></i>
          </div>
          <div class="kpi-value">${Object.values(globalState.features).filter(Boolean).length} / 13</div>
          <div class="kpi-meta">Enabled system features</div>
        </div>
      </div>

      <h3 style="font-size:0.95rem; margin-bottom:12px;">Available Subscription Tiers</h3>
      <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap:16px;">
        <div class="kpi-card">
          <strong>Starter Shop</strong>
          <div style="font-size:1.25rem; font-weight:700; margin:8px 0;">Free / 0 ${currency}</div>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:14px;">1 Store Branch, Basic POS, Sales Summary & Receipt Printing.</p>
          <button class="btn btn-outline btn-sm" disabled>${plan === 'STARTER' ? 'Current Tier' : 'Select'}</button>
        </div>
        <div class="kpi-card" style="border-color: var(--teal-600);">
          <strong>Pro Retail & Hospitality</strong>
          <div style="font-size:1.25rem; font-weight:700; margin:8px 0; color:var(--teal-600);">2,500 ${currency} <span style="font-size:0.75rem; font-weight:400;">/mo</span></div>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:14px;">Unlimited POS Terminals, Shift Management, Time Clock, KOT & Multi-currency.</p>
          <button class="btn btn-teal-primary btn-sm" id="btn-upgrade-pro">${plan === 'PRO' ? 'Active Plan' : 'Upgrade via Paystack'}</button>
        </div>
      </div>
    </div>
  `;

  const upgBtn = target.querySelector('#btn-upgrade-pro');
  if (upgBtn) {
    upgBtn.onclick = () => Toast.info('Subscription checkout initialized. Contact billing or connect Paystack key.');
  }
}

// =========================================================================
// 3. TAXES / CHARGES
// =========================================================================
export async function renderTaxesPane(target) {
  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Taxes / charges</h2>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Configure VAT, catering levies, and service charges applied at checkout.</p>
      </div>
      <button class="btn btn-teal-primary btn-sm" id="btn-add-tax">
        <i data-lucide="plus"></i> Add Tax / Charge
      </button>
    </div>
    <div id="settings-taxes-table"></div>
  `;

  async function loadTaxes() {
    let query = supabase.from('store_taxes').select('*').order('created_at');
    query = scoped(query);
    const { data, error } = await query;

    if (error) {
      document.getElementById('settings-taxes-table').innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'settings-taxes-table',
      columns: [
        { label: 'Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Type', key: 'tax_type', render: (t) => `<span class="badge">${(t || 'tax').toUpperCase()}</span>` },
        { label: 'Rate (%)', key: 'rate', render: (r) => `${Number(r).toFixed(2)}%` },
        {
          label: 'Receipt Mode',
          key: 'application_mode',
          render: (m) => {
            const labels = { included: 'Included in price', excluded: 'Added to price', attached: 'Attached to total' };
            return labels[m] || m;
          },
        },
        {
          label: 'Status',
          key: 'is_active',
          render: (act) => (act ? '<span class="badge badge-teal">ACTIVE</span>' : '<span class="badge">INACTIVE</span>'),
        },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((x) => x.id === id);
        if (item) openTaxModal(item, loadTaxes);
      },
    });
  }

  target.querySelector('#btn-add-tax').onclick = () => openTaxModal(null, loadTaxes);
  await loadTaxes();
}

function openTaxModal(item, onSaved) {
  const isEdit = !!item;
  Modal.open({
    title: isEdit ? `Edit: ${item.name}` : 'Add Tax or Charge',
    content: `
      <form id="form-tax-save">
        <div class="form-group">
          <label>Tax / Charge Name</label>
          <input type="text" name="name" required value="${item?.name || ''}" placeholder="e.g. VAT 16% or Service Charge" />
        </div>
        <div class="form-row" style="display:flex; gap:12px;">
          <div class="form-group" style="flex:1;">
            <label>Category</label>
            <select name="tax_type">
              <option value="tax" ${item?.tax_type === 'tax' ? 'selected' : ''}>Tax (VAT / Levy)</option>
              <option value="charge" ${item?.tax_type === 'charge' ? 'selected' : ''}>Service / Packaging Charge</option>
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>Percentage Rate (%)</label>
            <input type="number" step="0.01" name="rate" required value="${item?.rate ?? 16}" />
          </div>
        </div>
        <div class="form-group">
          <label>Calculation Option</label>
          <select name="application_mode">
            <option value="included" ${item?.application_mode === 'included' ? 'selected' : ''}>Include in item price</option>
            <option value="excluded" ${item?.application_mode === 'excluded' ? 'selected' : ''}>Exclude (Add on top of item price)</option>
            <option value="attached" ${item?.application_mode === 'attached' ? 'selected' : ''}>Attach to receipt subtotal</option>
          </select>
        </div>
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" name="is_active" ${item?.is_active !== false ? 'checked' : ''} />
            Active on POS Checkout
          </label>
        </div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="btn btn-teal-primary" style="flex:1;">${isEdit ? 'Update' : 'Save'}</button>
          ${isEdit ? `<button type="button" id="btn-del-tax" class="btn btn-outline text-danger">Delete</button>` : ''}
        </div>
      </form>
    `,
    onSubmit: async (fd) => {
      const payload = {
        shop_id: globalState.activeShopId,
        name: fd.name,
        tax_type: fd.tax_type,
        rate: parseFloat(fd.rate) || 0,
        application_mode: fd.application_mode,
        is_active: fd.is_active === 'on',
      };
      const { error } = isEdit
        ? await supabase.from('store_taxes').update(payload).eq('id', item.id)
        : await supabase.from('store_taxes').insert([payload]);

      if (error) Toast.error(error.message);
      else {
        Toast.success('Tax configuration saved.');
        await onSaved();
      }
    },
  });

  if (isEdit) {
    setTimeout(() => {
      const delBtn = document.getElementById('btn-del-tax');
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm(`Delete "${item.name}"?`)) return;
          const { error } = await supabase.from('store_taxes').delete().eq('id', item.id);
          if (error) Toast.error(error.message);
          else {
            Toast.success('Tax deleted.');
            Modal.close();
            await onSaved();
          }
        };
      }
    }, 50);
  }
}

// =========================================================================
// 4. SOFTWARE SETUP
// =========================================================================
export async function renderSoftwareSetupPane(target, settingsRow) {
  const cfg = {
    auto_print_receipt: false,
    sound_effects: true,
    low_stock_alert_threshold: 5,
    offline_sync_interval_sec: 30,
    require_pin_per_sale: false,
    ...(settingsRow?.software_setup || {}),
  };

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Software setup</h2>
    </div>
    <form id="form-software-setup" style="padding:24px; max-width:560px;">
      <div class="form-group">
        <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
          <span>Auto-print receipt immediately after payment</span>
          <input type="checkbox" name="auto_print_receipt" ${cfg.auto_print_receipt ? 'checked' : ''} />
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
          <span>Enable POS register button & barcode scan sounds</span>
          <input type="checkbox" name="sound_effects" ${cfg.sound_effects ? 'checked' : ''} />
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; justify-content:space-between; cursor:pointer;">
          <span>Require Cashier PIN before completing every sale</span>
          <input type="checkbox" name="require_pin_per_sale" ${cfg.require_pin_per_sale ? 'checked' : ''} />
        </label>
      </div>
      <div class="form-row" style="display:flex; gap:12px;">
        <div class="form-group" style="flex:1;">
          <label>Default Low Stock Alert Threshold</label>
          <input type="number" name="low_stock_alert_threshold" min="0" value="${cfg.low_stock_alert_threshold}" />
        </div>
        <div class="form-group" style="flex:1;">
          <label>Offline PWA Background Sync (sec)</label>
          <input type="number" name="offline_sync_interval_sec" min="10" max="600" value="${cfg.offline_sync_interval_sec}" />
        </div>
      </div>
      <button type="submit" class="btn btn-teal-primary">Save Software Setup</button>
    </form>
  `;

  target.querySelector('#form-software-setup').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const software_setup = {
      auto_print_receipt: fd.get('auto_print_receipt') === 'on',
      sound_effects: fd.get('sound_effects') === 'on',
      require_pin_per_sale: fd.get('require_pin_per_sale') === 'on',
      low_stock_alert_threshold: parseInt(fd.get('low_stock_alert_threshold')) || 5,
      offline_sync_interval_sec: parseInt(fd.get('offline_sync_interval_sec')) || 30,
    };

    const { error } = await supabase
      .from('store_settings')
      .upsert([{ shop_id: globalState.activeShopId, software_setup, updated_at: new Date().toISOString() }], { onConflict: 'shop_id' });

    if (error) Toast.error(error.message);
    else Toast.success('Software setup preferences saved.');
  };
}

// =========================================================================
// 5. ADDON APPS
// =========================================================================
const DEFAULT_ADDONS = [
  { addon_key: 'kra_etims', name: 'KRA eTIMS Fiscal Integration', description: 'Automatically transmit tax invoices and sign receipts with KRA eTIMS.' },
  { addon_key: 'mpesa_daraja', name: 'M-PESA Daraja STK Push', description: 'Trigger instant M-PESA Express payment prompts directly on customer phones.' },
  { addon_key: 'paystack_checkout', name: 'Paystack Card & Mobile Money', description: 'Accept Visa, Mastercard, and mobile money payments via Paystack.' },
  { addon_key: 'whatsapp_receipts', name: 'WhatsApp Digital Receipts', description: 'Send itemized PDF/text receipts directly to customer WhatsApp numbers.' },
  { addon_key: 'woocommerce_sync', name: 'Ecommerce & Web Catalog Sync', description: 'Two-way inventory and order sync with your online storefront.' },
];

export async function renderAddonAppsPane(target) {
  let installedMap = {};
  if (globalState.activeShopId) {
    const { data } = await supabase.from('store_addons').select('*').eq('shop_id', globalState.activeShopId);
    (data || []).forEach((row) => { installedMap[row.addon_key] = row.is_installed; });
  }

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Addon apps</h2>
      <p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Connect payment gateways, tax compliance modules, and customer messaging.</p>
    </div>
    <div style="padding:24px; display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:16px;">
      ${DEFAULT_ADDONS.map((addon) => {
        const active = !!installedMap[addon.addon_key];
        return `
          <div class="kpi-card" style="justify-content:space-between;">
            <div>
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                <strong style="font-size:0.95rem;">${addon.name}</strong>
                <span class="badge ${active ? 'badge-teal' : ''}">${active ? 'CONNECTED' : 'AVAILABLE'}</span>
              </div>
              <p style="font-size:0.8rem; color:var(--text-muted); line-height:1.45; margin-bottom:16px;">${addon.description}</p>
            </div>
            <button class="btn ${active ? 'btn-outline' : 'btn-teal-primary'} btn-sm" data-addon-toggle="${addon.addon_key}">
              ${active ? 'Disable Addon' : 'Connect Addon'}
            </button>
          </div>
        `;
      }).join('')}
    </div>
  `;

  target.querySelectorAll('[data-addon-toggle]').forEach((btn) => {
    btn.onclick = async () => {
      const key = btn.dataset.addonToggle;
      const meta = DEFAULT_ADDONS.find((a) => a.addon_key === key);
      const nextVal = !installedMap[key];

      const { error } = await supabase.from('store_addons').upsert(
        [
          {
            shop_id: globalState.activeShopId,
            addon_key: key,
            name: meta.name,
            description: meta.description,
            is_installed: nextVal,
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: 'shop_id, addon_key' }
      );

      if (error) Toast.error(error.message);
      else {
        Toast.success(`${meta.name} ${nextVal ? 'connected' : 'disabled'}.`);
        await renderAddonAppsPane(target);
      }
    };
  });
}

// =========================================================================
// 6. CONDITIONAL FEATURE SUB-PANES (Order Types, Service Areas, Currency, Email)
// =========================================================================
export async function renderOrderTypesPane(target) {
  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Order types</h2>
        <p style="font-size:0.8rem; color:var(--text-muted);">Define Dining, Take Away, Delivery, or Pickup options.</p>
      </div>
      <button class="btn btn-teal-primary btn-sm" id="btn-add-ordertype">+ Add Order Type</button>
    </div>
    <div id="settings-ordertypes-table"></div>
  `;

  async function load() {
    let q = supabase.from('store_order_types').select('*').order('created_at');
    q = scoped(q);
    const { data } = await q;
    renderDataTable({
      targetId: 'settings-ordertypes-table',
      columns: [
        { label: 'Order Type', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Code', key: 'code', render: (c) => `<code>${c || '-'}</code>` },
        { label: 'Default', key: 'is_default', render: (d) => (d ? '<span class="badge badge-teal">DEFAULT</span>' : '-') },
        { label: 'Status', key: 'is_active', render: (a) => (a ? 'Active' : 'Disabled') },
      ],
      data: data || [],
      onAction: (_, id) => {
        const row = data.find((x) => x.id === id);
        if (row) openOrderTypeModal(row, load);
      },
    });
  }

  target.querySelector('#btn-add-ordertype').onclick = () => openOrderTypeModal(null, load);
  await load();
}

function openOrderTypeModal(row, onSaved) {
  const isEdit = !!row;
  Modal.open({
    title: isEdit ? `Edit: ${row.name}` : 'New Order Type',
    content: `
      <form id="form-ot">
        <div class="form-group">
          <label>Order Type Name</label>
          <input type="text" name="name" required value="${row?.name || ''}" placeholder="e.g. Dine In, Take Away, Delivery" />
        </div>
        <div class="form-group">
          <label>Short Code</label>
          <input type="text" name="code" value="${row?.code || ''}" placeholder="DINE" />
        </div>
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" name="is_default" ${row?.is_default ? 'checked' : ''} /> Set as default order type
          </label>
        </div>
        <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update' : 'Save'}</button>
      </form>
    `,
    onSubmit: async (fd) => {
      const payload = {
        shop_id: globalState.activeShopId,
        name: fd.name,
        code: fd.code || fd.name.slice(0, 4).toUpperCase(),
        is_default: fd.is_default === 'on',
      };
      const { error } = isEdit
        ? await supabase.from('store_order_types').update(payload).eq('id', row.id)
        : await supabase.from('store_order_types').insert([payload]);
      if (error) Toast.error(error.message);
      else {
        Toast.success('Order type saved.');
        await onSaved();
      }
    },
  });
}

export async function renderServiceAreasPane(target) {
  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Service areas</h2>
        <p style="font-size:0.8rem; color:var(--text-muted);">Predefined tables, rooms, or counters for open order tracking.</p>
      </div>
      <button class="btn btn-teal-primary btn-sm" id="btn-add-area">+ Add Table / Area</button>
    </div>
    <div id="settings-areas-table"></div>
  `;

  async function load() {
    let q = supabase.from('store_service_areas').select('*').order('name');
    q = scoped(q);
    const { data } = await q;
    renderDataTable({
      targetId: 'settings-areas-table',
      columns: [
        { label: 'Table / Room Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Zone / Floor', key: 'area_group' },
        { label: 'Seats / Capacity', key: 'capacity' },
        { label: 'Status', key: 'is_active', render: (a) => (a ? '<span class="badge badge-teal">ACTIVE</span>' : 'Inactive') },
      ],
      data: data || [],
      onAction: (_, id) => {
        const row = data.find((x) => x.id === id);
        if (row) openServiceAreaModal(row, load);
      },
    });
  }

  target.querySelector('#btn-add-area').onclick = () => openServiceAreaModal(null, load);
  await load();
}

function openServiceAreaModal(row, onSaved) {
  const isEdit = !!row;
  Modal.open({
    title: isEdit ? `Edit: ${row.name}` : 'Add Service Area / Table',
    content: `
      <form id="form-sa">
        <div class="form-group">
          <label>Table / Room Label</label>
          <input type="text" name="name" required value="${row?.name || ''}" placeholder="e.g. Table 01, VIP Booth A" />
        </div>
        <div class="form-row" style="display:flex; gap:12px;">
          <div class="form-group" style="flex:1;">
            <label>Section / Floor</label>
            <input type="text" name="area_group" value="${row?.area_group || 'Main Floor'}" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Capacity</label>
            <input type="number" name="capacity" value="${row?.capacity || 4}" />
          </div>
        </div>
        <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update' : 'Save'}</button>
      </form>
    `,
    onSubmit: async (fd) => {
      const payload = {
        shop_id: globalState.activeShopId,
        name: fd.name,
        area_group: fd.area_group || 'Main Floor',
        capacity: parseInt(fd.capacity) || 4,
      };
      const { error } = isEdit
        ? await supabase.from('store_service_areas').update(payload).eq('id', row.id)
        : await supabase.from('store_service_areas').insert([payload]);
      if (error) Toast.error(error.message);
      else {
        Toast.success('Service area saved.');
        await onSaved();
      }
    },
  });
}

export async function renderCurrencyPane(target) {
  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Manage currency</h2>
        <p style="font-size:0.8rem; color:var(--text-muted);">Configure exchange rates to accept payments in foreign currencies.</p>
      </div>
      <button class="btn btn-teal-primary btn-sm" id="btn-add-curr">+ Add Currency</button>
    </div>
    <div id="settings-curr-table"></div>
  `;

  async function load() {
    let q = supabase.from('store_currencies').select('*').order('created_at');
    q = scoped(q);
    const { data } = await q;
    renderDataTable({
      targetId: 'settings-curr-table',
      columns: [
        { label: 'Currency Code', key: 'currency_code', render: (v) => `<strong>${v}</strong>` },
        { label: 'Symbol', key: 'symbol' },
        { label: 'Exchange Rate (to Base)', key: 'exchange_rate', render: (r) => Number(r).toFixed(4) },
        { label: 'Type', key: 'is_base', render: (b) => (b ? '<span class="badge badge-teal">BASE</span>' : 'Secondary') },
      ],
      data: data || [],
      onAction: (_, id) => {
        const row = data.find((x) => x.id === id);
        if (row) openCurrencyModal(row, load);
      },
    });
  }

  target.querySelector('#btn-add-curr').onclick = () => openCurrencyModal(null, load);
  await load();
}

function openCurrencyModal(row, onSaved) {
  const isEdit = !!row;
  Modal.open({
    title: isEdit ? `Edit: ${row.currency_code}` : 'Add Accepted Currency',
    content: `
      <form id="form-curr">
        <div class="form-row" style="display:flex; gap:12px;">
          <div class="form-group" style="flex:1;">
            <label>ISO Code</label>
            <input type="text" name="currency_code" required value="${row?.currency_code || ''}" placeholder="USD" maxlength="5" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>Symbol</label>
            <input type="text" name="symbol" required value="${row?.symbol || ''}" placeholder="$" maxlength="5" />
          </div>
        </div>
        <div class="form-group">
          <label>Exchange Rate (1 Unit = X Base Currency)</label>
          <input type="number" step="0.0001" name="exchange_rate" required value="${row?.exchange_rate || 130.0}" />
        </div>
        <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update' : 'Save Currency'}</button>
      </form>
    `,
    onSubmit: async (fd) => {
      const payload = {
        shop_id: globalState.activeShopId,
        currency_code: fd.currency_code.toUpperCase(),
        symbol: fd.symbol,
        exchange_rate: parseFloat(fd.exchange_rate) || 1,
      };
      const { error } = isEdit
        ? await supabase.from('store_currencies').update(payload).eq('id', row.id)
        : await supabase.from('store_currencies').insert([payload]);
      if (error) Toast.error(error.message);
      else {
        Toast.success('Currency saved.');
        await onSaved();
      }
    },
  });
}

export async function renderEmailNotificationsPane(target, settingsRow) {
  const cfg = {
    daily_sales_summary: false,
    user_login_logout: false,
    low_stock_alerts: false,
    recipient_email: globalState.user?.email || '',
    ...(settingsRow?.email_notifications_config || {}),
  };

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Email notification settings</h2>
    </div>
    <form id="form-email-notifs" style="padding:24px; max-width:540px;">
      <div class="form-group">
        <label>Alert Recipient Email</label>
        <input type="email" name="recipient_email" required value="${cfg.recipient_email}" placeholder="owner@store.com" />
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <input type="checkbox" name="daily_sales_summary" ${cfg.daily_sales_summary ? 'checked' : ''} />
          Send Daily End-of-Day Sales Summary
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <input type="checkbox" name="user_login_logout" ${cfg.user_login_logout ? 'checked' : ''} />
          Alert on Cashier Shift Login / Logout
        </label>
      </div>
      <div class="form-group">
        <label style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <input type="checkbox" name="low_stock_alerts" ${cfg.low_stock_alerts ? 'checked' : ''} />
          Send Low Inventory Threshold Alerts
        </label>
      </div>
      <button type="submit" class="btn btn-teal-primary">Save Notification Rules</button>
    </form>
  `;

  target.querySelector('#form-email-notifs').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const email_notifications_config = {
      recipient_email: fd.get('recipient_email'),
      daily_sales_summary: fd.get('daily_sales_summary') === 'on',
      user_login_logout: fd.get('user_login_logout') === 'on',
      low_stock_alerts: fd.get('low_stock_alerts') === 'on',
    };
    const { error } = await supabase
      .from('store_settings')
      .upsert([{ shop_id: globalState.activeShopId, email_notifications_config, updated_at: new Date().toISOString() }], { onConflict: 'shop_id' });
    if (error) Toast.error(error.message);
    else Toast.success('Email notification rules saved.');
  };
}
