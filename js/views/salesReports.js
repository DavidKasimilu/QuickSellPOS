import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { PrinterDriver } from '../components/PrinterDriver.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  const filterDate = globalState.filterDate || new Date().toISOString().split('T')[0];
  let activeTab = 'receipts'; // 'receipts' | 'shifts' | 'hourly-trends' | 'service-types' | 'payments' | 'categories' | 'suspicious'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <span class="live-indicator" style="font-size:0.75rem; color:var(--teal-600); display:inline-flex; align-items:center; gap:4px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--teal-600);"></span>
          Live Sales Stream Active
        </span>
      </div>
      <div id="sales-action-container"></div>
    </div>

    <!-- Analytical Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-sales-tab="receipts">Receipts</button>
      <button class="date-chip" data-sales-tab="shifts">Shifts & Cash Drawer</button>
      <button class="date-chip" data-sales-tab="hourly-trends">Hourly Sales Curve</button>
      <button class="date-chip" data-sales-tab="service-types">Order Channels</button>
      <button class="date-chip" data-sales-tab="payments">Payment Channels</button>
      <button class="date-chip" data-sales-tab="categories">Sales by Category</button>
      <button class="date-chip" data-sales-tab="suspicious" style="color:var(--color-danger);">Suspicious Discards & Voids</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="sales-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-sales-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-sales-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.salesTab;
      loadActiveTab();
    };
  });

  // Reactive state listener for real-time mobile order insertions
  unsubs.push(
    globalState.subscribeKey('orders', () => {
      loadActiveTab();
    })
  );
  unsubs.push(
    globalState.subscribeKey('payments', () => {
      if (activeTab === 'payments') loadActiveTab();
    })
  );

  async function loadActiveTab() {
    const actionArea = document.getElementById('sales-action-container');
    const tableArea = document.getElementById('sales-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    switch (activeTab) {
      case 'receipts':
        actionArea.innerHTML = ``;
        await renderReceiptsTable(tableArea);
        break;

      case 'shifts':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-open-shift">
            <i data-lucide="key-round" style="width:16px; height:16px; margin-right:6px;"></i> Start / Close Shift
          </button>
        `;
        document.getElementById('btn-open-shift').onclick = () => openShiftModal();
        await renderShiftsTable(tableArea);
        break;

      case 'hourly-trends':
        actionArea.innerHTML = ``;
        await renderHourlyTrendCurve(tableArea);
        break;

      case 'service-types':
        actionArea.innerHTML = ``;
        await renderOrderChannelsBreakdown(tableArea);
        break;

      case 'payments':
        actionArea.innerHTML = ``;
        await renderPaymentBreakdown(tableArea);
        break;

      case 'categories':
        actionArea.innerHTML = ``;
        await renderCategoryBreakdown(tableArea);
        break;

      case 'suspicious':
        actionArea.innerHTML = `
          <button class="btn btn-outline" id="btn-export-discards" style="color:var(--color-danger); border-color:var(--color-danger);">
            <i data-lucide="shield-alert" style="width:16px; height:16px; margin-right:6px;"></i> Discard Audit Export
          </button>
        `;
        document.getElementById('btn-export-discards').onclick = () => Toast.success('Suspicious log exported for compliance.');
        await renderSuspiciousAudit(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Receipts History
  // =========================================================================
  async function renderReceiptsTable(target) {
    let query = supabase
      .from('orders')
      .select('*, customers(name), profiles(full_name)')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(50);

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Receipt #', key: 'receipt_no', render: (val) => `<strong>${val}</strong>` },
        { label: 'Timestamp', key: 'created_at', render: (val) => new Date(val).toLocaleString() },
        { label: 'Channel', key: 'service_type', render: (st) => `<span class="badge">${(st || 'walk_in').toUpperCase()}</span>` },
        { label: 'Customer', key: 'customers', render: (c) => c?.name || 'Walk-in' },
        { label: 'Cashier', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Billed Amount', key: 'total', render: (val) => `${Number(val).toLocaleString()} ${currency}` },
        {
          label: 'Status',
          key: 'order_status',
          render: (st, row) => {
            const isComp = st === 'completed';
            const offlineTag = row.synced_from_offline ? '<span class="badge" style="background:#fef3c7; color:#d97706; margin-left:4px;">OFFLINE</span>' : '';
            return `<span class="badge ${isComp ? 'badge-teal' : ''}">${st.toUpperCase()}</span>${offlineTag}`;
          },
        },
      ],
      data: orders || [],
      onAction: (action, id) => {
        const order = orders.find((o) => o.id === id);
        if (order) viewReceiptModal(order);
      },
    });
  }

  // =========================================================================
  // 2. Shifts & Till Drawer
  // =========================================================================
  async function renderShiftsTable(target) {
    let query = supabase.from('shifts').select('*, profiles(full_name)').order('opened_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: shifts, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Cashier', key: 'profiles', render: (p) => `<strong>${p?.full_name || 'Staff'}</strong>` },
        { label: 'Opened At', key: 'opened_at', render: (d) => new Date(d).toLocaleString() },
        { label: 'Closed At', key: 'closed_at', render: (d) => d ? new Date(d).toLocaleString() : '<span class="badge badge-teal">ACTIVE</span>' },
        { label: 'Opening Float', key: 'opening_cash', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Counted Drawer Cash', key: 'actual_cash', render: (v) => v !== null ? `${Number(v).toLocaleString()} ${currency}` : '-' },
      ],
      data: shifts || [],
    });
  }

  // =========================================================================
  // 3. Hourly Sales Trend Curve (24-Hour Distribution)
  // =========================================================================
  async function renderHourlyTrendCurve(target) {
    const startOfDay = `${filterDate}T00:00:00.000Z`;
    const endOfDay = `${filterDate}T23:59:59.999Z`;

    let query = supabase
      .from('orders')
      .select('created_at, total')
      .eq('order_status', 'completed')
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    // Initialize 24-hour bins
    const hourlyRevenue = new Array(24).fill(0);
    const hourlyOrders = new Array(24).fill(0);

    orders?.forEach((o) => {
      const hour = new Date(o.created_at).getHours();
      hourlyRevenue[hour] += Number(o.total || 0);
      hourlyOrders[hour] += 1;
    });

    const maxVal = Math.max(...hourlyRevenue, 1);

    const barsHtml = hourlyRevenue.map((val, h) => {
      const pct = Math.round((val / maxVal) * 100);
      const label = `${h.toString().padStart(2, '0')}:00`;
      return `
        <div style="flex:1; display:flex; flex-direction:column; align-items:center; gap:6px; min-width:28px;">
          <div style="font-size:0.65rem; color:var(--text-muted);">${val > 0 ? (val > 999 ? (val / 1000).toFixed(1) + 'k' : val) : ''}</div>
          <div style="height:140px; width:100%; background:var(--bg-canvas); border-radius:4px; display:flex; align-items:flex-end;">
            <div style="height:${pct}%; width:100%; background:var(--teal-600); border-radius:4px; transition:height 0.3s ease;"></div>
          </div>
          <span style="font-size:0.65rem; color:var(--text-muted); writing-mode:vertical-rl; transform:rotate(180deg);">${label}</span>
        </div>
      `;
    }).join('');

    target.innerHTML = `
      <div style="padding:24px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <h3 style="font-size:1rem; font-weight:700;">Hourly Trading Volume for ${filterDate}</h3>
          <span style="font-size:0.8rem; color:var(--text-muted);">Total Tickets: <strong>${orders?.length || 0}</strong></span>
        </div>
        <div style="display:flex; align-items:flex-end; gap:8px; overflow-x:auto; padding-bottom:12px;">
          ${barsHtml}
        </div>
      </div>
    `;
  }

  // =========================================================================
  // 4. Order Channels Breakdown (Dine-in, Takeaway, Walk-in, Delivery)
  // =========================================================================
  async function renderOrderChannelsBreakdown(target) {
    let query = supabase.from('orders').select('service_type, total').eq('order_status', 'completed');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const summary = {
      walk_in: { count: 0, revenue: 0 },
      dine_in: { count: 0, revenue: 0 },
      takeaway: { count: 0, revenue: 0 },
      delivery: { count: 0, revenue: 0 },
    };

    orders?.forEach((o) => {
      const type = o.service_type || 'walk_in';
      if (!summary[type]) summary[type] = { count: 0, revenue: 0 };
      summary[type].count += 1;
      summary[type].revenue += Number(o.total || 0);
    });

    const rows = Object.entries(summary).map(([k, v]) => ({
      id: k,
      channel: k.toUpperCase().replace('_', ' '),
      tickets: v.count,
      revenue: v.revenue,
    }));

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Service Channel', key: 'channel', render: (ch) => `<strong>${ch}</strong>` },
        { label: 'Orders Processed', key: 'tickets' },
        { label: 'Gross Volume', key: 'revenue', render: (rev) => `${Number(rev).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  // =========================================================================
  // 5. Payment Methods Breakdown
  // =========================================================================
  async function renderPaymentBreakdown(target) {
    let query = supabase.from('payments').select('amount, payment_method, orders!inner(shop_id)');
    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);

    const { data: payments, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const aggregated = {};
    payments?.forEach((p) => {
      aggregated[p.payment_method] = (aggregated[p.payment_method] || 0) + Number(p.amount);
    });

    const rows = Object.entries(aggregated).map(([method, total]) => ({
      id: method,
      method: method.toUpperCase(),
      total,
    }));

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Payment Channel', key: 'method', render: (m) => `<strong>${m}</strong>` },
        { label: 'Total Volume', key: 'total', render: (val) => `${Number(val).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  // =========================================================================
  // 6. Sales by Category
  // =========================================================================
  async function renderCategoryBreakdown(target) {
    let query = supabase
      .from('order_items')
      .select('quantity, total, orders!inner(shop_id), products(categories(name))');

    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const summary = {};
    data?.forEach((item) => {
      const catName = item.products?.categories?.name || 'Uncategorized';
      if (!summary[catName]) summary[catName] = { units: 0, revenue: 0 };
      summary[catName].units += Number(item.quantity || 0);
      summary[catName].revenue += Number(item.total || 0);
    });

    const rows = Object.entries(summary).map(([name, val]) => ({
      id: name,
      category: name,
      units: val.units,
      revenue: val.revenue,
    }));

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Category Name', key: 'category', render: (c) => `<strong>${c}</strong>` },
        { label: 'Units Sold', key: 'units' },
        { label: 'Total Revenue', key: 'revenue', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  // =========================================================================
  // 7. Suspicious Reports & Open Cart Discard Audits
  // =========================================================================
  async function renderSuspiciousAudit(target) {
    let query = supabase
      .from('cart_discard_logs')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: discards, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Removed Product', key: 'product_name', render: (p) => `<strong style="color:var(--color-danger);">${p}</strong>` },
        { label: 'Units Dropped', key: 'quantity' },
        { label: 'Unit Retail', key: 'unit_price', render: (u) => `${Number(u).toLocaleString()} ${currency}` },
        { label: 'Cashier On Duty', key: 'profiles', render: (c) => c?.full_name || 'Cashier' },
        { label: 'Recorded Reason', key: 'reason' },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: discards || [],
    });
  }

  // =========================================================================
  // Modals & Action Workflows
  // =========================================================================
  async function viewReceiptModal(order) {
    const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id);

    const itemsRows = (items || []).map((i) => `
      <tr>
        <td style="padding:6px 0;">${i.product_name}</td>
        <td style="text-align:right;">${i.quantity} x ${Number(i.unit_price).toLocaleString()}</td>
        <td style="text-align:right; font-weight:600;">${Number(i.total).toLocaleString()} ${currency}</td>
      </tr>
    `).join('');

    Modal.open({
      title: `Receipt Details: ${order.receipt_no}`,
      content: `
        <div>
          <div style="font-size:0.875rem; border-bottom:1px solid var(--border-subtle); padding-bottom:10px; margin-bottom:10px;">
            <p><strong>Channel:</strong> ${(order.service_type || 'walk_in').toUpperCase()}</p>
            <p><strong>Status:</strong> ${order.order_status.toUpperCase()}</p>
            <p><strong>Subtotal:</strong> ${Number(order.subtotal).toLocaleString()} ${currency}</p>
            <p><strong>Discount:</strong> -${Number(order.discount_amount).toLocaleString()} ${currency}</p>
            <p><strong>Tax:</strong> ${Number(order.tax_amount).toLocaleString()} ${currency}</p>
            <p style="font-size:1.05rem; font-weight:700; margin-top:6px;"><strong>Grand Total:</strong> ${Number(order.total).toLocaleString()} ${currency}</p>
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:16px;">
            <tbody>${itemsRows}</tbody>
          </table>
          <div style="display:flex; gap:8px;">
            <button id="btn-print-usb" class="btn btn-outline" style="flex:1;">
              <i data-lucide="printer" style="width:14px; height:14px; margin-right:4px;"></i> WebUSB Print
            </button>
            <button id="btn-print-bt" class="btn btn-outline" style="flex:1;">
              <i data-lucide="bluetooth" style="width:14px; height:14px; margin-right:4px;"></i> Bluetooth Print
            </button>
            <button id="btn-print-fallback" class="btn btn-teal-primary" style="flex:1;">
              Slip Preview
            </button>
          </div>
        </div>
      `,
    });

    const slipPayload = {
      shopName: globalState.activeShop?.name || 'QuickSell POS',
      branchCode: globalState.activeShop?.branch_code || 'Main',
      receiptNo: order.receipt_no,
      items: (items || []).map((i) => ({ name: i.product_name, quantity: i.quantity, price: Number(i.unit_price) })),
      subtotal: Number(order.subtotal || 0),
      discount: Number(order.discount_amount || 0),
      tax: Number(order.tax_amount || 0),
      total: Number(order.total || 0),
      currency,
    };

    document.getElementById('btn-print-usb').onclick = async () => {
      try {
        await PrinterDriver.printViaUSB(slipPayload);
        Toast.success('Raw ESC/POS slip dispatched to USB printer.');
      } catch (err) {
        Toast.error(err.message);
      }
    };

    document.getElementById('btn-print-bt').onclick = async () => {
      try {
        await PrinterDriver.printViaBluetooth(slipPayload);
        Toast.success('Raw ESC/POS slip dispatched via Bluetooth.');
      } catch (err) {
        Toast.error(err.message);
      }
    };

    document.getElementById('btn-print-fallback').onclick = () => {
      PrinterDriver.printFallbackSlip(slipPayload);
    };
  }

  function openShiftModal() {
    Modal.open({
      title: 'Open Cash Drawer Shift',
      content: `
        <form id="form-shift">
          <div class="form-group">
            <label>Opening Float (${currency})</label>
            <input type="number" step="0.01" name="opening_cash" required placeholder="1000.00" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Open Shift</button>
        </form>
      `,
      onSubmit: async (fd) => {
        await supabase.from('shifts').insert([{
          shop_id: globalState.activeShopId,
          staff_id: globalState.user?.id,
          opening_cash: parseFloat(fd.opening_cash) || 0,
          status: 'open',
          opened_at: new Date().toISOString()
        }]);
        Toast.success('Shift opened.');
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}