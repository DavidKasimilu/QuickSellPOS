import { supabase } from '../../supabaseClient.js';
import { globalState } from '../../state.js';
import { Modal } from '../../components/Modal.js';
import { renderDataTable } from '../../components/DataTable.js';
import { Toast } from '../../components/Toast.js';
import { DeviceTracker } from '../../components/DeviceTracker.js';

// =========================================================================
// 1. SHOPS (Store Branches)
// =========================================================================
export async function renderShopsPane(target, onShopSwitched) {
  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Shops</h2>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Manage store outlets and switch the active backoffice branch.</p>
      </div>
      <button class="btn btn-teal-primary btn-sm" id="btn-add-shop">
        <i data-lucide="plus"></i> Add Shop
      </button>
    </div>
    <div id="settings-shops-table"></div>
  `;

  async function loadShops() {
    const { data: shops, error } = await supabase.from('shops').select('*').order('created_at');
    if (error) {
      document.getElementById('settings-shops-table').innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'settings-shops-table',
      columns: [
        {
          label: 'Shop Name',
          key: 'name',
          render: (val, row) =>
            `<strong>${val}</strong> ${globalState.activeShopId === row.id ? '<span class="badge badge-teal" style="margin-left:6px;">ACTIVE</span>' : ''}`,
        },
        { label: 'Code', key: 'branch_code', render: (c) => `<code>${c || '-'}</code>` },
        { label: 'Country', key: 'country', render: (c) => c || 'Kenya' },
        { label: 'Phone', key: 'phone', render: (p) => p || '-' },
        { label: 'Currency', key: 'currency', render: (c) => c || 'KES' },
        { label: 'Address', key: 'address', render: (a) => a || '-' },
      ],
      data: shops || [],
      onAction: (action, id) => {
        const item = shops.find((s) => s.id === id);
        if (item) openShopModal(item, loadShops, onShopSwitched);
      },
    });
  }

  target.querySelector('#btn-add-shop').onclick = () => openShopModal(null, loadShops, onShopSwitched);
  await loadShops();
}

function openShopModal(shop, onSaved, onShopSwitched) {
  const isEdit = !!shop;
  Modal.open({
    title: isEdit ? `Manage Shop: ${shop.name}` : 'Register New Shop',
    content: `
      <form id="form-shop-save">
        <div class="form-group">
          <label>Shop / Branch Name</label>
          <input type="text" name="name" required value="${shop?.name || ''}" placeholder="e.g. QuickSell Main Outlet" />
        </div>
        <div class="form-group">
          <label>Branch Code</label>
          <input type="text" name="branch_code" required value="${shop?.branch_code || ''}" placeholder="BRN-01" />
        </div>
        <div class="form-row" style="display:flex; gap:12px;">
          <div class="form-group" style="flex:1;">
            <label>Country</label>
            <select name="country">
              <option value="Kenya" ${shop?.country === 'Kenya' ? 'selected' : ''}>Kenya</option>
              <option value="Tanzania" ${shop?.country === 'Tanzania' ? 'selected' : ''}>Tanzania</option>
              <option value="Uganda" ${shop?.country === 'Uganda' ? 'selected' : ''}>Uganda</option>
              <option value="Rwanda" ${shop?.country === 'Rwanda' ? 'selected' : ''}>Rwanda</option>
              <option value="Nigeria" ${shop?.country === 'Nigeria' ? 'selected' : ''}>Nigeria</option>
              <option value="South Africa" ${shop?.country === 'South Africa' ? 'selected' : ''}>South Africa</option>
              <option value="Other" ${shop?.country === 'Other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>Base Currency</label>
            <select name="currency">
              <option value="KES" ${shop?.currency === 'KES' ? 'selected' : ''}>KES</option>
              <option value="TZS" ${shop?.currency === 'TZS' ? 'selected' : ''}>TZS</option>
              <option value="UGX" ${shop?.currency === 'UGX' ? 'selected' : ''}>UGX</option>
              <option value="RWF" ${shop?.currency === 'RWF' ? 'selected' : ''}>RWF</option>
              <option value="NGN" ${shop?.currency === 'NGN' ? 'selected' : ''}>NGN</option>
              <option value="ZAR" ${shop?.currency === 'ZAR' ? 'selected' : ''}>ZAR</option>
              <option value="USD" ${shop?.currency === 'USD' ? 'selected' : ''}>USD</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Phone Contact</label>
          <input type="text" name="phone" value="${shop?.phone || ''}" placeholder="+254 7..." />
        </div>
        <div class="form-group">
          <label>Address / Location</label>
          <input type="text" name="address" value="${shop?.address || ''}" placeholder="Township center" />
        </div>
        <div style="display:flex; gap:10px; margin-top:8px;">
          <button type="submit" class="btn btn-teal-primary" style="flex:1;">${isEdit ? 'Save Changes' : 'Create Shop'}</button>
          ${
            isEdit && globalState.activeShopId !== shop.id
              ? `<button type="button" id="btn-switch-this-shop" class="btn btn-outline">Switch Active</button>`
              : ''
          }
        </div>
      </form>
    `,
    onSubmit: async (formData) => {
      const { error } = isEdit
        ? await supabase.from('shops').update(formData).eq('id', shop.id)
        : await supabase.from('shops').insert([formData]);

      if (error) Toast.error(error.message);
      else {
        Toast.success(isEdit ? 'Shop updated.' : 'Store branch registered.');
        await onSaved();
      }
    },
  });

  if (isEdit) {
    setTimeout(() => {
      const swBtn = document.getElementById('btn-switch-this-shop');
      if (swBtn) {
        swBtn.onclick = () => {
          globalState.setActiveShop(shop);
          const badge = document.getElementById('badge-active-shop');
          if (badge) badge.textContent = shop.name;
          Toast.success(`Switched active store to: ${shop.name}`);
          Modal.close();
          if (typeof onShopSwitched === 'function') onShopSwitched();
        };
      }
    }, 50);
  }
}

// =========================================================================
// 2. POS DEVICES (Terminals, Registers & Hardware Printers)
// =========================================================================
export async function renderPosDevicesPane(target) {
  const myFingerprint = DeviceTracker.getFingerprint();

  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>POS devices</h2>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Manage connected POS terminals, registers, and thermal receipt printers.</p>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-outline btn-sm" id="btn-refresh-devices">
          <i data-lucide="refresh-cw"></i> Refresh
        </button>
        <button class="btn btn-teal-primary btn-sm" id="btn-add-printer">
          <i data-lucide="plus"></i> Add POS / Printer
        </button>
      </div>
    </div>

    <div style="padding:20px;">
      <h3 style="font-size:0.9rem; font-weight:700; margin-bottom:10px; color:var(--text-main);">Active POS Terminals & Sessions</h3>
      <div id="settings-sessions-table" style="margin-bottom:28px; border:1px solid var(--border-subtle); border-radius:8px; overflow:hidden;"></div>

      <h3 style="font-size:0.9rem; font-weight:700; margin-bottom:10px; color:var(--text-main);">Registered Hardware Printers</h3>
      <div id="settings-printers-table" style="border:1px solid var(--border-subtle); border-radius:8px; overflow:hidden;"></div>
    </div>
  `;

  async function loadAllDevices() {
    let sessQuery = supabase
      .from('pos_device_sessions')
      .select('*, profiles(full_name, email), shops(name)')
      .order('last_seen_at', { ascending: false });
    let devQuery = supabase.from('pos_devices').select('*').order('created_at');

    if (globalState.activeShopId) {
      sessQuery = sessQuery.eq('shop_id', globalState.activeShopId);
      devQuery = devQuery.eq('shop_id', globalState.activeShopId);
    }

    const [{ data: sessions }, { data: devices }] = await Promise.all([sessQuery, devQuery]);
    const now = Date.now();

    renderDataTable({
      targetId: 'settings-sessions-table',
      columns: [
        {
          label: 'Terminal Name',
          key: 'device_name',
          render: (val, row) => `
            <strong>${val || 'POS Terminal'}</strong>
            ${row.device_fingerprint === myFingerprint ? '<span class="badge badge-teal" style="margin-left:6px;">THIS DEVICE</span>' : ''}
          `,
        },
        { label: 'Cashier', key: 'profiles', render: (p) => p?.full_name || p?.email || 'Staff' },
        {
          label: 'Status',
          key: 'last_seen_at',
          render: (lastSeen, row) => {
            const diffMin = Math.round((now - new Date(lastSeen).getTime()) / 60000);
            if (!row.is_active) return `<span class="badge" style="background:#fee2e2; color:#ef4444;">REVOKED</span>`;
            if (diffMin <= 2) return `<span class="badge badge-teal">ONLINE</span>`;
            return `<span class="badge">Idle (${diffMin}m ago)</span>`;
          },
        },
      ],
      data: sessions || [],
      onAction: (_, id) => {
        const item = sessions.find((s) => s.id === id);
        if (item) toggleSession(item, loadAllDevices);
      },
    });

    const sessWrap = document.getElementById('settings-sessions-table');
    if (sessWrap) {
      sessWrap.querySelectorAll('button[data-row-id]').forEach((btn) => {
        const item = (sessions || []).find((s) => s.id === btn.dataset.rowId);
        if (item) {
          btn.textContent = item.is_active ? 'Revoke' : 'Reinstate';
          if (item.is_active) btn.classList.add('text-danger');
        }
      });
    }

    renderDataTable({
      targetId: 'settings-printers-table',
      columns: [
        { label: 'Device / Printer', key: 'device_name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Code', key: 'device_code', render: (c) => `<code>${c}</code>` },
        { label: 'Protocol', key: 'printer_type', render: (t) => (t || 'USB').toUpperCase() },
        { label: 'Paper', key: 'paper_width', render: (w) => `${w || 80}mm` },
        { label: 'IP / Host', key: 'printer_ip', render: (ip) => ip || 'Local' },
      ],
      data: devices || [],
      onAction: (_, id) => {
        const dev = devices.find((d) => d.id === id);
        if (dev) openHardwareModal(dev, loadAllDevices);
      },
    });
  }

  target.querySelector('#btn-refresh-devices').onclick = loadAllDevices;
  target.querySelector('#btn-add-printer').onclick = () => openHardwareModal(null, loadAllDevices);
  await loadAllDevices();
}

async function toggleSession(device, onDone) {
  const nextState = !device.is_active;
  if (!confirm(`${nextState ? 'Reinstate' : 'Revoke'} access for "${device.device_name}"?`)) return;
  const { error } = await supabase
    .from('pos_device_sessions')
    .update({ is_active: nextState, updated_at: new Date().toISOString() })
    .eq('id', device.id);
  if (error) Toast.error(error.message);
  else {
    Toast.success('Terminal access updated.');
    await onDone();
  }
}

function openHardwareModal(dev, onSaved) {
  const isEdit = !!dev;
  Modal.open({
    title: isEdit ? `Edit: ${dev.device_name}` : 'Add POS Device / Printer',
    content: `
      <form id="form-device-save">
        <div class="form-group">
          <label>Device / Printer Name</label>
          <input type="text" name="device_name" required value="${dev?.device_name || ''}" placeholder="Counter 1 Receipt Printer" />
        </div>
        <div class="form-group">
          <label>Identifier Code</label>
          <input type="text" name="device_code" required value="${dev?.device_code || `POS-${Date.now().toString().slice(-4)}`}" />
        </div>
        <div class="form-row" style="display:flex; gap:12px;">
          <div class="form-group" style="flex:1;">
            <label>Connection Type</label>
            <select name="printer_type">
              <option value="network" ${dev?.printer_type === 'network' ? 'selected' : ''}>Network (TCP/IP)</option>
              <option value="bluetooth" ${dev?.printer_type === 'bluetooth' ? 'selected' : ''}>Bluetooth</option>
              <option value="usb" ${dev?.printer_type === 'usb' ? 'selected' : ''}>Direct USB</option>
            </select>
          </div>
          <div class="form-group" style="flex:1;">
            <label>Paper Width</label>
            <select name="paper_width">
              <option value="80" ${dev?.paper_width === 80 ? 'selected' : ''}>80mm</option>
              <option value="58" ${dev?.paper_width === 58 ? 'selected' : ''}>58mm</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Network IP Address (Optional)</label>
          <input type="text" name="printer_ip" value="${dev?.printer_ip || ''}" placeholder="192.168.1.150" />
        </div>
        <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Device' : 'Save Device'}</button>
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
        Toast.success('POS device saved.');
        await onSaved();
      }
    },
  });
}
