import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { DeviceTracker } from '../components/DeviceTracker.js';

export async function mount(container) {
  let activeTab = 'sessions'; // 'sessions' | 'shops' | 'hardware' | 'receipt' | 'payments' | 'integrations'
  const myFingerprint = DeviceTracker.getFingerprint();

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
      </div>
      <div id="settings-action-container"></div>
    </div>

    <!-- Group 7 Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-set-tab="sessions">Active POS Terminals</button>
      <button class="date-chip" data-set-tab="shops">Store Branches</button>
      <button class="date-chip" data-set-tab="hardware">Hardware Printers</button>
      <button class="date-chip" data-set-tab="receipt">Design Receipt</button>
      <button class="date-chip" data-set-tab="payments">Payment Channels</button>
      <button class="date-chip" data-set-tab="integrations">API & Webhooks</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="settings-table-content"></div>
    </div>
  `;

  // Bind sub-tabs
  container.querySelectorAll('[data-set-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-set-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.setTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('settings-action-container');
    const tableArea = document.getElementById('settings-table-content');
    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    switch (activeTab) {
      case 'sessions':
        actionArea.innerHTML = `
          <button class="btn btn-outline" id="btn-refresh-sessions">
            <i data-lucide="refresh-cw" style="width:16px; height:16px; margin-right:6px;"></i> Refresh Status
          </button>
        `;
        document.getElementById('btn-refresh-sessions').onclick = () => loadActiveTab();
        await renderDeviceSessionsTable(tableArea);
        break;

      case 'shops':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-shop">
            <i data-lucide="store" style="width:16px; height:16px; margin-right:6px;"></i> Add Store Branch
          </button>
        `;
        document.getElementById('btn-add-shop').onclick = () => openShopModal();
        await renderShopsTable(tableArea);
        break;

      case 'hardware':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-device">
            <i data-lucide="tablet" style="width:16px; height:16px; margin-right:6px;"></i> Register Printer
          </button>
        `;
        document.getElementById('btn-add-device').onclick = () => openDeviceModal();
        await renderHardwareDevicesTable(tableArea);
        break;

      case 'receipt':
        actionArea.innerHTML = ``;
        await renderReceiptDesigner(tableArea);
        break;

      case 'payments':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-payment-method">
            <i data-lucide="credit-card" style="width:16px; height:16px; margin-right:6px;"></i> Add Channel
          </button>
        `;
        document.getElementById('btn-add-payment-method').onclick = () => openPaymentMethodModal();
        await renderPaymentMethodsTable(tableArea);
        break;

      case 'integrations':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-gen-api-key">
            <i data-lucide="key" style="width:16px; height:16px; margin-right:6px;"></i> Generate API Key
          </button>
        `;
        document.getElementById('btn-gen-api-key').onclick = () => openApiKeyModal();
        await renderIntegrationsView(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Connected Device Sessions (Phones, Tablets & Web Registers)
  // =========================================================================
  async function renderDeviceSessionsTable(target) {
    let query = supabase
      .from('pos_device_sessions')
      .select('*, profiles(full_name, email), shops(name)')
      .order('last_seen_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: sessions, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const now = new Date().getTime();

    renderDataTable({
      targetId: 'settings-table-content',
      columns: [
        {
          label: 'Device Profile',
          key: 'device_name',
          render: (val, row) => {
            const isCurrent = row.device_fingerprint === myFingerprint;
            return `
              <div>
                <strong>${val || 'Handheld Register'}</strong>
                ${isCurrent ? '<span class="badge badge-teal" style="margin-left:6px;">THIS DEVICE</span>' : ''}
                <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">
                  ID: ${row.device_fingerprint.slice(0, 16)}...
                </div>
              </div>
            `;
          },
        },
        {
          label: 'Operator / Cashier',
          key: 'profiles',
          render: (p) => p?.full_name || p?.email || 'Authenticated User',
        },
        {
          label: 'Store Branch',
          key: 'shops',
          render: (s) => s?.name || 'Main Branch',
        },
        {
          label: 'Connection State',
          key: 'last_seen_at',
          render: (lastSeen, row) => {
            const diffMin = Math.round((now - new Date(lastSeen).getTime()) / 60000);
            const isLive = diffMin <= 2 && row.is_active;

            if (isLive) {
              return `<span class="badge badge-teal" style="font-weight:700;">🟢 ONLINE NOW</span>`;
            } else if (!row.is_active) {
              return `<span class="badge" style="background:#fee2e2; color:#ef4444;">REVOKED</span>`;
            } else {
              return `<span class="badge">Idle (${diffMin}m ago)</span>`;
            }
          },
        },
        {
          label: 'First Registered',
          key: 'created_at',
          render: (d) => new Date(d).toLocaleDateString(),
        },
      ],
      data: sessions || [],
      onAction: (action, id) => {
        const item = sessions.find((s) => s.id === id);
        if (item) toggleDeviceAccess(item);
      },
    });

    // Replace the default "manage" text on the action buttons with "Revoke/Allow"
    target.querySelectorAll('button[data-row-id]').forEach((btn) => {
      const item = sessions.find((s) => s.id === btn.dataset.rowId);
      if (item) {
        btn.textContent = item.is_active ? 'Revoke' : 'Reinstate';
        if (item.is_active) btn.classList.add('text-danger');
      }
    });
  }

  async function toggleDeviceAccess(device) {
    const nextState = !device.is_active;
    const confirmMsg = nextState
      ? `Reinstate device authorization for "${device.device_name}"?`
      : `Revoke terminal access for "${device.device_name}"? The device will be disconnected.`;

    if (!confirm(confirmMsg)) return;

    const { error } = await supabase
      .from('pos_device_sessions')
      .update({ is_active: nextState })
      .eq('id', device.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Device status updated.`);
      await loadActiveTab();
    }
  }

  // =========================================================================
  // 2. Store Branches Tab
  // =========================================================================
  async function renderShopsTable(target) {
    const { data: shops, error } = await supabase.from('shops').select('*').order('created_at');
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'settings-table-content',
      columns: [
        { 
          label: 'Branch Name', 
          key: 'name', 
          render: (val, row) => `<strong>${val}</strong> ${globalState.activeShopId === row.id ? '<span class="badge badge-teal">ACTIVE</span>' : ''}` 
        },
        { label: 'Branch Code', key: 'branch_code', render: (code) => `<code>${code || '-'}</code>` },
        { label: 'Phone', key: 'phone' },
        { label: 'Base Currency', key: 'currency' },
        { label: 'Location Address', key: 'address' },
      ],
      data: shops || [],
      onAction: (action, id) => {
        const item = shops.find((s) => s.id === id);
        if (item) {
          globalState.setActiveShop(item);
          Toast.success(`Active store switched to: ${item.name}`);
          loadActiveTab();
        }
      },
    });
  }

  // =========================================================================
  // 3. Hardware Printers & Peripherals Tab
  // =========================================================================
  async function renderHardwareDevicesTable(target) {
    let query = supabase.from('pos_devices').select('*').order('created_at');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: devices, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'settings-table-content',
      columns: [
        { label: 'Printer Model', key: 'device_name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Identifier Code', key: 'device_code', render: (c) => `<code>${c}</code>` },
        { label: 'Interface', key: 'printer_type', render: (t) => t.toUpperCase() },
        { label: 'Paper Width', key: 'paper_width', render: (w) => `${w}mm` },
        { label: 'Printer IP / Host', key: 'printer_ip', render: (ip) => ip || 'Local host' },
        { label: 'Status', key: 'is_active', render: (act) => act ? '<span class="badge badge-teal">ONLINE</span>' : '<span class="badge">OFFLINE</span>' },
      ],
      data: devices || [],
      onAction: (action, id) => {
        const dev = devices.find((d) => d.id === id);
        if (dev) openDeviceModal(dev);
      },
    });
  }

  // =========================================================================
  // 4. Receipt Template Designer
  // =========================================================================
  async function renderReceiptDesigner(target) {
    let { data: template } = await supabase
      .from('receipt_templates')
      .select('*')
      .eq('shop_id', globalState.activeShopId)
      .maybeSingle();

    if (!template) {
      template = {
        business_name: 'QuickSell POS Store',
        tax_pin: 'P051000000X',
        header_text: 'Thank you for shopping with us!',
        footer_text: 'Goods once sold are not returnable without a valid receipt.',
        show_tax_breakdown: true,
        show_cashier_name: true,
      };
    }

    target.innerHTML = `
      <div style="display:flex; gap:24px; padding:24px; flex-wrap:wrap;">
        <div style="flex:1; min-width:320px;">
          <form id="form-save-receipt">
            <div class="form-group">
              <label>Business Name on Slip</label>
              <input type="text" name="business_name" required value="${template.business_name}" />
            </div>
            <div class="form-group">
              <label>Tax PIN / VAT Registration #</label>
              <input type="text" name="tax_pin" value="${template.tax_pin || ''}" placeholder="e.g. KRA PIN" />
            </div>
            <div class="form-group">
              <label>Header Greeting Note</label>
              <input type="text" name="header_text" value="${template.header_text || ''}" />
            </div>
            <div class="form-group">
              <label>Footer Policy Notice</label>
              <textarea name="footer_text" rows="3">${template.footer_text || ''}</textarea>
            </div>
            <div class="form-group">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" name="show_tax_breakdown" ${template.show_tax_breakdown ? 'checked' : ''} />
                Print itemized tax calculations
              </label>
            </div>
            <div class="form-group">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" name="show_cashier_name" ${template.show_cashier_name ? 'checked' : ''} />
                Display Serving Cashier's Name
              </label>
            </div>
            <button type="submit" class="btn btn-teal-primary btn-block">Save Receipt Layout</button>
          </form>
        </div>

        <div style="width:280px; background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:20px; font-family:monospace; font-size:0.75rem; box-shadow:0 4px 12px rgba(0,0,0,0.05); height:fit-content;">
          <div style="text-align:center; border-bottom:1px dashed #94a3b8; padding-bottom:10px; margin-bottom:10px;">
            <strong style="font-size:0.95rem; display:block;">${template.business_name}</strong>
            <span>PIN: ${template.tax_pin || 'P000000000X'}</span><br/>
            <span>${template.header_text || ''}</span>
          </div>
          <div style="margin-bottom:8px;">
            <div>RCPT: #SAMPLE-1001</div>
            <div>DATE: 20/10/2026 15:30</div>
            <div>CASHIER: Cashier Counter 1</div>
          </div>
          <div style="border-top:1px dashed #94a3b8; border-bottom:1px dashed #94a3b8; padding:8px 0; margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between;">
              <span>Sample Item 1</span><span>150.00</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span>Sample Item 2 (x2)</span><span>300.00</span>
            </div>
          </div>
          <div style="text-align:right; margin-bottom:12px;">
            <div style="font-size:0.9rem; font-weight:bold;">TOTAL: 450.00 KES</div>
            <div>CASH TENDERED: 500.00</div>
            <div>CHANGE: 50.00</div>
          </div>
          <div style="text-align:center; border-top:1px dashed #94a3b8; padding-top:8px; font-size:0.7rem; color:#64748b;">
            ${template.footer_text || ''}
          </div>
        </div>
      </div>
    `;

    document.getElementById('form-save-receipt').onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = {
        shop_id: globalState.activeShopId,
        business_name: fd.get('business_name'),
        tax_pin: fd.get('tax_pin'),
        header_text: fd.get('header_text'),
        footer_text: fd.get('footer_text'),
        show_tax_breakdown: fd.get('show_tax_breakdown') === 'on',
        show_cashier_name: fd.get('show_cashier_name') === 'on',
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from('receipt_templates')
        .upsert([payload], { onConflict: 'shop_id' });

      if (error) Toast.error(error.message);
      else {
        Toast.success('Receipt template updated.');
        await loadActiveTab();
      }
    };
  }

  // =========================================================================
  // 5. Payment Methods
  // =========================================================================
  async function renderPaymentMethodsTable(target) {
    let query = supabase.from('store_payment_methods').select('*').order('created_at');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: methods, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'settings-table-content',
      columns: [
        { label: 'Channel Name', key: 'display_name', render: (v) => `<strong>${v}</strong>` },
        { label: 'System Key', key: 'method_key', render: (k) => `<code>${k}</code>` },
        { label: 'Till / Account Number', key: 'account_number', render: (acc) => acc || 'N/A' },
        { label: 'Status', key: 'is_enabled', render: (en) => en ? '<span class="badge badge-teal">ENABLED</span>' : '<span class="badge">DISABLED</span>' },
      ],
      data: methods || [],
      onAction: (action, id) => {
        const item = methods.find((m) => m.id === id);
        if (item) openPaymentMethodModal(item);
      },
    });
  }

  // =========================================================================
  // 6. Developer Integrations
  // =========================================================================
  async function renderIntegrationsView(target) {
    const { data: keys } = await supabase.from('developer_api_keys').select('*').order('created_at');
    const { data: hooks } = await supabase.from('webhook_endpoints').select('*').order('created_at');

    target.innerHTML = `
      <div style="padding:20px;">
        <h3 style="font-size:1rem; margin-bottom:12px;">Active API Keys</h3>
        <div id="api-keys-table-wrap" style="margin-bottom:24px;"></div>

        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h3 style="font-size:1rem;">Webhook Endpoints</h3>
          <button class="btn btn-outline btn-sm" id="btn-add-webhook">+ Add Webhook</button>
        </div>
        <div id="webhooks-table-wrap"></div>
      </div>
    `;

    renderDataTable({
      targetId: 'api-keys-table-wrap',
      columns: [
        { label: 'Key Identifier', key: 'label', render: (l) => `<strong>${l}</strong>` },
        { label: 'Token Key', key: 'api_key', render: (k) => `<code>${k.slice(0, 10)}...${k.slice(-4)}</code>` },
        { label: 'Created At', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: keys || [],
    });

    renderDataTable({
      targetId: 'webhooks-table-wrap',
      columns: [
        { label: 'Destination URL', key: 'target_url', render: (u) => `<code>${u}</code>` },
        { label: 'Events Handled', key: 'events', render: (ev) => (ev || []).join(', ') },
        { label: 'Status', key: 'is_active', render: (act) => act ? '<span class="badge badge-teal">LISTENING</span>' : 'PAUSED' },
      ],
      data: hooks || [],
    });

    document.getElementById('btn-add-webhook').onclick = () => openWebhookModal();
  }

  // Modals
  function openShopModal() {
    Modal.open({
      title: 'Register Store Branch',
      content: `
        <form id="form-shop-create">
          <div class="form-group">
            <label>Branch Name</label>
            <input type="text" name="name" required placeholder="e.g. QuickSell Mariwenyi Outlet" />
          </div>
          <div class="form-group">
            <label>Branch Code</label>
            <input type="text" name="branch_code" required placeholder="MRW-01" />
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Phone Contact</label>
              <input type="text" name="phone" placeholder="+254 7..." />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Base Currency</label>
              <input type="text" name="currency" value="KES" required />
            </div>
          </div>
          <div class="form-group">
            <label>Address / Location</label>
            <input type="text" name="address" placeholder="Township center" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Create Store</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const { error } = await supabase.from('shops').insert([formData]);
        if (error) Toast.error(error.message);
        else {
          Toast.success('Store branch registered.');
          await loadActiveTab();
        }
      },
    });
  }

  function openDeviceModal(dev = null) {
    const isEdit = !!dev;
    Modal.open({
      title: isEdit ? `Edit: ${dev.device_name}` : 'Connect Hardware Printer',
      content: `
        <form id="form-device-save">
          <div class="form-group">
            <label>Hardware Printer Name</label>
            <input type="text" name="device_name" required value="${dev?.device_name || ''}" placeholder="Receipt Printer 01" />
          </div>
          <div class="form-group">
            <label>Printer Serial Code</label>
            <input type="text" name="device_code" required value="${dev?.device_code || `PRN-${Date.now().toString().slice(-4)}`}" />
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Printer Protocol</label>
              <select name="printer_type">
                <option value="network" ${dev?.printer_type === 'network' ? 'selected' : ''}>Network (TCP/IP)</option>
                <option value="bluetooth" ${dev?.printer_type === 'bluetooth' ? 'selected' : ''}>Bluetooth</option>
                <option value="usb" ${dev?.printer_type === 'usb' ? 'selected' : ''}>Direct USB</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Paper Width (mm)</label>
              <select name="paper_width">
                <option value="80" ${dev?.paper_width === 80 ? 'selected' : ''}>80mm (Standard)</option>
                <option value="58" ${dev?.paper_width === 58 ? 'selected' : ''}>58mm (Compact)</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Printer IP Address (if Network)</label>
            <input type="text" name="printer_ip" value="${dev?.printer_ip || ''}" placeholder="192.168.1.150" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Printer' : 'Register Printer'}</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          shop_id: globalState.activeShopId,
          device_name: formData.device_name,
          device_code: formData.device_code,
          printer_type: formData.printer_type,
          paper_width: parseInt(formData.paper_width),
          printer_ip: formData.printer_ip || null,
        };

        const { error } = isEdit
          ? await supabase.from('pos_devices').update(payload).eq('id', dev.id)
          : await supabase.from('pos_devices').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Hardware printer saved.');
          await loadActiveTab();
        }
      },
    });
  }

  function openPaymentMethodModal(item = null) {
    const isEdit = !!item;
    Modal.open({
      title: isEdit ? `Edit: ${item.display_name}` : 'Add Payment Method',
      content: `
        <form id="form-paymethod-save">
          <div class="form-group">
            <label>Payment Channel Display Name</label>
            <input type="text" name="display_name" required value="${item?.display_name || ''}" placeholder="M-PESA Till" />
          </div>
          <div class="form-group">
            <label>Internal System Key</label>
            <input type="text" name="method_key" required value="${item?.method_key || ''}" placeholder="mpesa_till" />
          </div>
          <div class="form-group">
            <label>Till / Paybill / Account #</label>
            <input type="text" name="account_number" value="${item?.account_number || ''}" placeholder="e.g. 522522" />
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="is_enabled" ${item?.is_enabled !== false ? 'checked' : ''} />
              Enable on Cashier Registers
            </label>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Channel' : 'Save Channel'}</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          shop_id: globalState.activeShopId,
          display_name: formData.display_name,
          method_key: formData.method_key,
          account_number: formData.account_number || null,
          is_enabled: formData.is_enabled === 'on',
        };

        const { error } = isEdit
          ? await supabase.from('store_payment_methods').update(payload).eq('id', item.id)
          : await supabase.from('store_payment_methods').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Payment method updated.');
          await loadActiveTab();
        }
      },
    });
  }

  function openApiKeyModal() {
    const generatedKey = `qs_live_${Array.from(crypto.getRandomValues(new Uint8Array(18))).map((b) => b.toString(16).padStart(2, '0')).join('')}`;
    Modal.open({
      title: 'Generate Developer API Key',
      content: `
        <form id="form-gen-key">
          <div class="form-group">
            <label>Key Identifier</label>
            <input type="text" name="label" required placeholder="e.g. Mobile Sync Terminal" />
          </div>
          <div class="form-group">
            <label>API Key Token</label>
            <input type="text" name="api_key" readonly value="${generatedKey}" class="input-disabled" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Create API Key</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const { error } = await supabase.from('developer_api_keys').insert([{
          shop_id: globalState.activeShopId,
          label: formData.label,
          api_key: formData.api_key,
          created_by: globalState.user?.id,
        }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('API key created.');
          await loadActiveTab();
        }
      },
    });
  }

  function openWebhookModal() {
    Modal.open({
      title: 'Add Webhook Endpoint',
      content: `
        <form id="form-add-webhook">
          <div class="form-group">
            <label>Destination Webhook URL</label>
            <input type="url" name="target_url" required placeholder="https://api.yourdomain.com/pos-events" />
          </div>
          <div class="form-group">
            <label>Secret Signing Key</label>
            <input type="text" name="secret_token" required value="whsec_${Date.now().toString(36)}" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Register Webhook</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const { error } = await supabase.from('webhook_endpoints').insert([{
          shop_id: globalState.activeShopId,
          target_url: formData.target_url,
          secret_token: formData.secret_token,
          events: ['order.completed', 'inventory.low_stock'],
        }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Webhook registered.');
          await loadActiveTab();
        }
      },
    });
  }

  await loadActiveTab();
  return () => {
    // Teardown logic
  };
}