import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { PrinterDriver } from '../components/PrinterDriver.js';
import { Exporter } from '../components/Exporter.js';
import { PieChart } from '../components/PieChart.js';

export async function mount(container, activeTab = 'sales-summary', queryParams = new URLSearchParams()) {
  const currency = globalState.preferences.currency || 'KES';
  let unsubs = [];

  // Filter State (Default: Current Month)
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  let dateStart = firstDayOfMonth;
  let dateEnd = lastDayOfMonth;
  let selectedCustomerId = 'ALL';
  let selectedCashierId = 'ALL';

  let customersList = [];
  let cashiersList = [];

  // Active Report Data Buffer for Exports
  let currentReportData = [];
  let currentReportColumns = [];
  let currentReportTitle = 'Sales Report';
  let currentSummaryMeta = null;

  // Fetch Customers & Cashiers for Filter Dropdowns
  try {
    let custQuery = supabase.from('customers').select('id, name, phone').order('name');
    let staffQuery = supabase.from('profiles').select('id, full_name, email').order('full_name');

    if (globalState.activeShopId) {
      custQuery = custQuery.eq('shop_id', globalState.activeShopId);
      staffQuery = staffQuery.eq('shop_id', globalState.activeShopId);
    }

    const [custRes, staffRes] = await Promise.all([custQuery, staffQuery]);
    customersList = custRes.data || [];
    cashiersList = staffRes.data || [];
  } catch (e) {
    console.warn('Failed to load filter options:', e);
  }

  // Render Page Layout with Filter Bar & Universal Export Bar
  container.innerHTML = `
    <!-- Top Filter Controls Bar -->
    <div class="card" style="padding: 16px; margin-bottom: 20px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px;">
      <div style="display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-end; justify-content: space-between;">
        
        <!-- Period & Date Range Controls -->
        <div style="display: flex; flex-wrap: wrap; gap: 10px; align-items: center;">
          <div>
            <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">PERIOD PRESET</label>
            <div class="date-controls">
              <button class="date-chip" data-preset="today">Today</button>
              <button class="date-chip" data-preset="yesterday">Yesterday</button>
              <button class="date-chip" data-preset="7days">7 Days</button>
              <button class="date-chip active" data-preset="month">This Month</button>
              <button class="date-chip" data-preset="last-month">Last Month</button>
            </div>
          </div>

          <div style="display: flex; align-items: center; gap: 6px;">
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">FROM</label>
              <input type="date" id="filter-date-start" value="${dateStart}" class="input-field" style="padding: 5px 8px; font-size: 0.8125rem;" />
            </div>
            <span style="margin-top: 18px; color: var(--text-muted);">-</span>
            <div>
              <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">TO</label>
              <input type="date" id="filter-date-end" value="${dateEnd}" class="input-field" style="padding: 5px 8px; font-size: 0.8125rem;" />
            </div>
          </div>
        </div>

        <!-- Customer & Staff Dropdown Selectors -->
        <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
          <div style="min-width: 180px;">
            <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">CUSTOMER</label>
            <select id="filter-customer-select" class="input-field" style="width: 100%; padding: 6px 10px; font-size: 0.8125rem;">
              <option value="ALL" selected>All Customers</option>
              ${customersList.map((c) => `<option value="${c.id}">${c.name || 'Unnamed'}</option>`).join('')}
            </select>
          </div>

          <div style="min-width: 180px;">
            <label style="display: block; font-size: 0.75rem; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">CASHIER / STAFF</label>
            <select id="filter-cashier-select" class="input-field" style="width: 100%; padding: 6px 10px; font-size: 0.8125rem;">
              <option value="ALL" selected>All Cashiers</option>
              ${cashiersList.map((s) => `<option value="${s.id}">${s.full_name || s.email}</option>`).join('')}
            </select>
          </div>

          <button id="btn-apply-sales-filter" class="btn btn-teal-primary" style="margin-top: 18px; padding: 6px 14px; font-size: 0.8125rem;">
            <i data-lucide="filter" style="width: 14px; height: 14px; margin-right: 4px;"></i> Apply Filter
          </button>
        </div>

      </div>
    </div>

    <!-- Export & Live Status Bar -->
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px;">
      <div>
        <span class="live-indicator" style="font-size: 0.75rem; color: var(--teal-600); display: inline-flex; align-items: center; gap: 4px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--teal-600);"></span>
          Live Sales Analytics
        </span>
      </div>
      
      <!-- Global Export Action Buttons -->
      <div style="display: flex; align-items: center; gap: 8px;">
        <button id="btn-export-csv" class="btn btn-outline" style="padding: 6px 12px; font-size: 0.8125rem;">
          <i data-lucide="file-spreadsheet" style="width: 14px; height: 14px; margin-right: 4px;"></i> Export CSV
        </button>
        <button id="btn-export-pdf" class="btn btn-outline" style="padding: 6px 12px; font-size: 0.8125rem;">
          <i data-lucide="printer" style="width: 14px; height: 14px; margin-right: 4px;"></i> Export / Print PDF
        </button>
        <div id="sales-action-container"></div>
      </div>
    </div>

    <!-- Interactive Visual Analytics (Pie / Donut Chart Container) -->
    <div id="sales-chart-container"></div>

    <!-- Main Table / Chart Data Target Area -->
    <div class="chart-box" style="padding: 0;">
      <div id="sales-table-content"></div>
    </div>
  `;

  // Bind Export Buttons
  container.querySelector('#btn-export-csv').onclick = () => {
    Exporter.exportToCSV(`${activeTab}_report.csv`, currentReportData, currentReportColumns);
    Toast.success('CSV Report exported successfully.');
  };

  container.querySelector('#btn-export-pdf').onclick = () => {
    Exporter.exportToPDF(currentReportTitle, currentReportData, currentReportColumns, currentSummaryMeta);
  };

  // Bind Filter Events
  const presetChips = container.querySelectorAll('[data-preset]');
  const startInput = container.querySelector('#filter-date-start');
  const endInput = container.querySelector('#filter-date-end');
  const custSelect = container.querySelector('#filter-customer-select');
  const cashierSelect = container.querySelector('#filter-cashier-select');

  presetChips.forEach((chip) => {
    chip.onclick = () => {
      presetChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');

      const preset = chip.dataset.preset;
      const today = new Date();

      if (preset === 'today') {
        dateStart = dateEnd = today.toISOString().split('T')[0];
      } else if (preset === 'yesterday') {
        const yest = new Date(today);
        yest.setDate(yest.getDate() - 1);
        dateStart = dateEnd = yest.toISOString().split('T')[0];
      } else if (preset === '7days') {
        const prev7 = new Date(today);
        prev7.setDate(prev7.getDate() - 7);
        dateStart = prev7.toISOString().split('T')[0];
        dateEnd = today.toISOString().split('T')[0];
      } else if (preset === 'month') {
        dateStart = firstDayOfMonth;
        dateEnd = lastDayOfMonth;
      } else if (preset === 'last-month') {
        const prevMStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevMEnd = new Date(today.getFullYear(), today.getMonth(), 0);
        dateStart = prevMStart.toISOString().split('T')[0];
        dateEnd = prevMEnd.toISOString().split('T')[0];
      }

      startInput.value = dateStart;
      endInput.value = dateEnd;
      loadView();
    };
  });

  container.querySelector('#btn-apply-sales-filter').onclick = () => {
    dateStart = startInput.value;
    dateEnd = endInput.value;
    selectedCustomerId = custSelect.value;
    selectedCashierId = cashierSelect.value;
    loadView();
  };

  unsubs.push(globalState.subscribeKey('orders', () => loadView()));

  function applyBaseOrderFilters(query) {
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);
    if (dateStart) query = query.gte('created_at', `${dateStart}T00:00:00.000Z`);
    if (dateEnd) query = query.lte('created_at', `${dateEnd}T23:59:59.999Z`);
    if (selectedCustomerId !== 'ALL') query = query.eq('customer_id', selectedCustomerId);
    if (selectedCashierId !== 'ALL') query = query.eq('cashier_id', selectedCashierId);
    return query;
  }

  async function loadView() {
    const tableArea = document.getElementById('sales-table-content');
    const chartArea = document.getElementById('sales-chart-container');
    const actionArea = document.getElementById('sales-action-container');
    if (!tableArea || !actionArea) return;

    actionArea.innerHTML = '';
    chartArea.innerHTML = '';
    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading ${activeTab.replace(/-/g, ' ')}...</p>`;

    switch (activeTab) {
      case 'sales-summary':
        currentReportTitle = 'Sales Summary Overview';
        await renderSalesSummary(tableArea, chartArea);
        break;

      case 'receipts':
        currentReportTitle = 'Completed Receipts';
        await renderReceipts(tableArea, chartArea);
        break;

      case 'refunds':
        currentReportTitle = 'Refunds & Credit Notes Log';
        await renderRefunds(tableArea, chartArea);
        break;

      case 'sales-by-product':
        currentReportTitle = 'Sales Distribution by Product';
        await renderSalesByProduct(tableArea, chartArea);
        break;

      case 'sales-by-category':
        currentReportTitle = 'Sales Distribution by Category';
        await renderSalesByCategory(tableArea, chartArea);
        break;

      case 'sales-by-discount':
        currentReportTitle = 'Discounts & Promotions Report';
        await renderSalesByDiscount(tableArea, chartArea);
        break;

      case 'sales-by-payment-type':
        currentReportTitle = 'Sales Volume by Payment Method';
        await renderSalesByPaymentType(tableArea, chartArea);
        break;

      case 'taxes':
        currentReportTitle = 'Tax Breakdown Report';
        await renderTaxesReport(tableArea, chartArea);
        break;

      case 'charges':
        currentReportTitle = 'Store Charges & Service Fees';
        await renderStoreChargesReport(tableArea, chartArea);
        break;

      case 'shifts':
        currentReportTitle = 'Cashier Shift Audit Log';
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-open-shift">
            <i data-lucide="key-round" style="width:16px; height:16px; margin-right:6px;"></i> Start / Close Shift
          </button>
        `;
        document.getElementById('btn-open-shift').onclick = () => openShiftModal();
        await renderShiftsReport(tableArea, chartArea);
        break;

      case 'product-wise-receipts':
        currentReportTitle = 'Product Wise Receipts';
        await renderProductWiseReceipts(tableArea, chartArea);
        break;

      case 'sales-by-trends':
        currentReportTitle = '24-Hour Trading Trends';
        await renderSalesByTrends(tableArea, chartArea);
        break;

      case 'deleted-receipts':
        currentReportTitle = 'Audit: Deleted & Voided Receipts';
        await renderDeletedReceipts(tableArea, chartArea);
        break;

      case 'order-type-wise-sales':
        currentReportTitle = 'Order Type Channel Distribution';
        await renderOrderTypeWiseSales(tableArea, chartArea);
        break;

      case 'product-wise-tax':
        currentReportTitle = 'Product Wise Tax Generated';
        await renderProductWiseTax(tableArea, chartArea);
        break;

      case 'manual-receipts':
        currentReportTitle = 'Manual & Offline Synced Receipts';
        await renderManualReceipts(tableArea, chartArea);
        break;

      case 'sales-by-orders':
      case 'product-wise-orders':
        currentReportTitle = 'Sales by Orders';
        await renderSalesByOrders(tableArea, chartArea);
        break;

      case 'sales-by-modifiers':
        currentReportTitle = 'Sales by Modifiers & Variants';
        await renderSalesByModifiers(tableArea, chartArea);
        break;

      case 'product-sales-by-other-staff':
        currentReportTitle = 'Auxiliary Staff Attributed Sales';
        await renderAuxiliaryStaffSales(tableArea, chartArea);
        break;

      case 'ecommerce-sales':
        currentReportTitle = 'E-Commerce & Delivery Sales';
        await renderEcommerceSales(tableArea, chartArea);
        break;

      case 'product-wise-deleted-receipts':
        currentReportTitle = 'Suspicious: Product Wise Deleted Line Items';
        await renderProductWiseDeletedReceipts(tableArea, chartArea);
        break;

      case 'refund-and-credit-notes':
        currentReportTitle = 'Suspicious: Debt Settlement & Credit Notes';
        await renderRefundAndCreditNotes(tableArea, chartArea);
        break;

      case 'deleted-products-in-open-orders':
        currentReportTitle = 'Suspicious: Discarded Cart Items';
        await renderDeletedProductsInOpenOrders(tableArea, chartArea);
        break;

      default:
        currentReportTitle = 'Sales Summary Overview';
        await renderSalesSummary(tableArea, chartArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // VIEW RENDERERS & PIE CHART INTEGRATION
  // =========================================================================

  async function renderSalesSummary(target, chartTarget) {
    let query = supabase.from('orders').select('subtotal, discount_amount, tax_amount, total, service_type').eq('is_deleted', false).eq('order_status', 'completed');
    query = applyBaseOrderFilters(query);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    let grossSales = 0, discounts = 0, taxes = 0, netSales = 0;
    const channelMap = {};

    orders?.forEach((o) => {
      grossSales += Number(o.subtotal || 0);
      discounts += Number(o.discount_amount || 0);
      taxes += Number(o.tax_amount || 0);
      netSales += Number(o.total || 0);

      const ch = (o.service_type || 'walk_in').toUpperCase();
      channelMap[ch] = (channelMap[ch] || 0) + Number(o.total || 0);
    });

    currentSummaryMeta = {
      'Gross Sales': `${grossSales.toLocaleString()} ${currency}`,
      'Discounts': `-${discounts.toLocaleString()} ${currency}`,
      'Taxes Billed': `${taxes.toLocaleString()} ${currency}`,
      'Net Revenue': `${netSales.toLocaleString()} ${currency}`,
    };

    const chartSeries = Object.entries(channelMap).map(([label, value]) => ({ label, value }));
    PieChart.render(chartTarget, chartSeries, { title: 'Revenue Share by Order Channel', currency });

    target.innerHTML = `
      <div style="padding:24px;">
        <div class="kpi-grid">
          <div class="card" style="padding:16px; background:#fff; border:1px solid var(--border-subtle); border-radius:8px;">
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Gross Revenue</span>
            <h3 style="font-size:1.4rem; font-weight:700; color:var(--text-main); margin-top:6px;">${grossSales.toLocaleString()} ${currency}</h3>
          </div>
          <div class="card" style="padding:16px; background:#fff; border:1px solid var(--border-subtle); border-radius:8px;">
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Total Discounts</span>
            <h3 style="font-size:1.4rem; font-weight:700; color:var(--color-danger); margin-top:6px;">-${discounts.toLocaleString()} ${currency}</h3>
          </div>
          <div class="card" style="padding:16px; background:#fff; border:1px solid var(--border-subtle); border-radius:8px;">
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Taxes Collected</span>
            <h3 style="font-size:1.4rem; font-weight:700; color:var(--teal-600); margin-top:6px;">${taxes.toLocaleString()} ${currency}</h3>
          </div>
          <div class="card" style="padding:16px; background:#fff; border:1px solid var(--border-subtle); border-radius:8px;">
            <span style="font-size:0.75rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">Net Billed Revenue</span>
            <h3 style="font-size:1.4rem; font-weight:700; color:var(--teal-700); margin-top:6px;">${netSales.toLocaleString()} ${currency}</h3>
          </div>
        </div>
      </div>
    `;
  }

  async function renderReceipts(target, chartTarget) {
    let query = supabase.from('orders').select('*, customers(name), profiles(full_name)').eq('is_deleted', false).order('created_at', { ascending: false });
    query = applyBaseOrderFilters(query);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = orders || [];
    currentReportColumns = [
      { label: 'Receipt #', key: 'receipt_no' },
      { label: 'Date', key: 'created_at' },
      { label: 'Customer', key: 'customers' },
      { label: 'Cashier', key: 'profiles' },
      { label: 'Total Billed', key: 'total' },
      { label: 'Status', key: 'order_status' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Receipt #', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
        { label: 'Customer', key: 'customers', render: (c) => c?.name || 'Walk-in' },
        { label: 'Cashier', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Total', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Status', key: 'order_status', render: (s) => `<span class="badge ${s === 'completed' ? 'badge-teal' : ''}">${s.toUpperCase()}</span>` },
      ],
      data: orders || [],
      onAction: (a, id) => {
        const order = orders.find((o) => o.id === id);
        if (order) viewReceiptModal(order);
      },
    });
  }

  async function renderRefunds(target, chartTarget) {
    let query = supabase.from('orders').select('*, customers(name), profiles(full_name)').eq('order_status', 'refunded').order('created_at', { ascending: false });
    query = applyBaseOrderFilters(query);

    const { data: refunds, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = refunds || [];
    currentReportColumns = [
      { label: 'Receipt #', key: 'receipt_no' },
      { label: 'Date', key: 'created_at' },
      { label: 'Customer', key: 'customers' },
      { label: 'Staff', key: 'profiles' },
      { label: 'Refund Total', key: 'total' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Refund Receipt', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
        { label: 'Customer', key: 'customers', render: (c) => c?.name || 'Walk-in' },
        { label: 'Issued By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Refund Amount', key: 'total', render: (v) => `<span style="color:var(--color-danger); font-weight:600;">-${Number(v).toLocaleString()} ${currency}</span>` },
      ],
      data: refunds || [],
      onAction: (a, id) => {
        const order = refunds.find((o) => o.id === id);
        if (order) viewReceiptModal(order);
      }
    });
  }

  async function renderSalesByProduct(target, chartTarget) {
    let query = supabase.from('order_items').select('product_name, quantity, total, orders!inner(shop_id, created_at, customer_id, cashier_id, is_deleted)').eq('orders.is_deleted', false);
    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);
    if (dateStart) query = query.gte('orders.created_at', `${dateStart}T00:00:00.000Z`);
    if (dateEnd) query = query.lte('orders.created_at', `${dateEnd}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const map = {};
    data?.forEach((i) => {
      if (!map[i.product_name]) map[i.product_name] = { name: i.product_name, qty: 0, revenue: 0 };
      map[i.product_name].qty += Number(i.quantity || 0);
      map[i.product_name].revenue += Number(i.total || 0);
    });

    const rows = Object.values(map);
    currentReportData = rows;
    currentReportColumns = [
      { label: 'Product Name', key: 'name' },
      { label: 'Units Sold', key: 'qty' },
      { label: 'Revenue', key: 'revenue' }
    ];

    const chartSeries = rows.sort((a, b) => b.revenue - a.revenue).slice(0, 6).map(r => ({ label: r.name, value: r.revenue }));
    PieChart.render(chartTarget, chartSeries, { title: 'Top Products Revenue Contribution', currency });

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Product Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Units Sold', key: 'qty' },
        { label: 'Total Revenue', key: 'revenue', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  async function renderSalesByCategory(target, chartTarget) {
    let query = supabase.from('order_items').select('quantity, total, products(categories(name)), orders!inner(shop_id, created_at, is_deleted)').eq('orders.is_deleted', false);
    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);
    if (dateStart) query = query.gte('orders.created_at', `${dateStart}T00:00:00.000Z`);
    if (dateEnd) query = query.lte('orders.created_at', `${dateEnd}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const map = {};
    data?.forEach((i) => {
      const cat = i.products?.categories?.name || 'Uncategorized';
      if (!map[cat]) map[cat] = { category: cat, qty: 0, revenue: 0 };
      map[cat].qty += Number(i.quantity || 0);
      map[cat].revenue += Number(i.total || 0);
    });

    const rows = Object.values(map);
    currentReportData = rows;
    currentReportColumns = [
      { label: 'Category', key: 'category' },
      { label: 'Units Sold', key: 'qty' },
      { label: 'Total Revenue', key: 'revenue' }
    ];

    const chartSeries = rows.map(r => ({ label: r.category, value: r.revenue }));
    PieChart.render(chartTarget, chartSeries, { title: 'Sales Volume by Category', currency });

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Category', key: 'category', render: (v) => `<strong>${v}</strong>` },
        { label: 'Units Sold', key: 'qty' },
        { label: 'Total Sales', key: 'revenue', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  async function renderSalesByDiscount(target, chartTarget) {
    let query = supabase.from('orders').select('receipt_no, subtotal, discount_amount, total, created_at').gt('discount_amount', 0).eq('is_deleted', false);
    query = applyBaseOrderFilters(query);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = orders || [];
    currentReportColumns = [
      { label: 'Receipt #', key: 'receipt_no' },
      { label: 'Original Subtotal', key: 'subtotal' },
      { label: 'Discount Amount', key: 'discount_amount' },
      { label: 'Billed Total', key: 'total' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Receipt #', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Original Subtotal', key: 'subtotal', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Discount Applied', key: 'discount_amount', render: (v) => `<span style="color:var(--color-danger); font-weight:600;">-${Number(v).toLocaleString()} ${currency}</span>` },
        { label: 'Final Total', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: orders || [],
    });
  }

  async function renderSalesByPaymentType(target, chartTarget) {
    let query = supabase.from('payments').select('amount, payment_method, orders!inner(shop_id, created_at, customer_id, cashier_id)').eq('orders.is_deleted', false);
    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);
    if (dateStart) query = query.gte('orders.created_at', `${dateStart}T00:00:00.000Z`);
    if (dateEnd) query = query.lte('orders.created_at', `${dateEnd}T23:59:59.999Z`);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const map = {};
    data?.forEach((p) => {
      const m = (p.payment_method || 'CASH').toUpperCase();
      map[m] = (map[m] || 0) + Number(p.amount || 0);
    });

    const rows = Object.entries(map).map(([m, val]) => ({ method: m, total: val }));
    currentReportData = rows;
    currentReportColumns = [
      { label: 'Payment Method', key: 'method' },
      { label: 'Total Volume', key: 'total' }
    ];

    const chartSeries = rows.map(r => ({ label: r.method, value: r.total }));
    PieChart.render(chartTarget, chartSeries, { title: 'Payment Channel Breakdown', currency });

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Payment Method', key: 'method', render: (v) => `<strong>${v}</strong>` },
        { label: 'Total Volume', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  async function renderTaxesReport(target, chartTarget) {
    let query = supabase.from('orders').select('receipt_no, subtotal, tax_amount, total, created_at').gt('tax_amount', 0).eq('is_deleted', false);
    query = applyBaseOrderFilters(query);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = orders || [];
    currentReportColumns = [
      { label: 'Receipt #', key: 'receipt_no' },
      { label: 'Taxable Amount', key: 'subtotal' },
      { label: 'Tax Collected', key: 'tax_amount' },
      { label: 'Grand Total', key: 'total' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Receipt #', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Taxable Amount', key: 'subtotal', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Tax Billed', key: 'tax_amount', render: (v) => `<span style="color:var(--teal-600); font-weight:600;">${Number(v).toLocaleString()} ${currency}</span>` },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: orders || [],
    });
  }

  async function renderStoreChargesReport(target, chartTarget) {
    let query = supabase.from('store_charges').select('*');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: charges, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = charges || [];
    currentReportColumns = [
      { label: 'Charge Name', key: 'name' },
      { label: 'Rate Type', key: 'rate_type' },
      { label: 'Amount/Rate', key: 'amount' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Charge Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Type', key: 'rate_type', render: (v) => v.toUpperCase() },
        { label: 'Value / Rate', key: 'amount', render: (v, r) => r.rate_type === 'percentage' ? `${v}%` : `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Active', key: 'is_active', render: (v) => v ? '<span class="badge badge-teal">ACTIVE</span>' : '<span class="badge">DISABLED</span>' },
      ],
      data: charges || [],
    });
  }

  async function renderShiftsReport(target, chartTarget) {
    let query = supabase.from('shifts').select('*, profiles(full_name)').order('opened_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: shifts, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = shifts || [];
    currentReportColumns = [
      { label: 'Cashier', key: 'profiles' },
      { label: 'Opened At', key: 'opened_at' },
      { label: 'Closed At', key: 'closed_at' },
      { label: 'Opening Float', key: 'opening_cash' },
      { label: 'Actual Cash', key: 'actual_cash' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Staff Member', key: 'profiles', render: (p) => `<strong>${p?.full_name || 'Staff'}</strong>` },
        { label: 'Opened At', key: 'opened_at', render: (d) => new Date(d).toLocaleString() },
        { label: 'Closed At', key: 'closed_at', render: (d) => d ? new Date(d).toLocaleString() : '<span class="badge badge-teal">OPEN</span>' },
        { label: 'Float', key: 'opening_cash', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Counted Cash', key: 'actual_cash', render: (v) => v !== null ? `${Number(v).toLocaleString()} ${currency}` : '-' },
      ],
      data: shifts || [],
    });
  }

  // ADVANCED SALES REPORTS
  async function renderProductWiseReceipts(target, chartTarget) {
    let query = supabase.from('order_items').select('product_name, quantity, unit_price, total, orders!inner(receipt_no, created_at)').order('id', { ascending: false });
    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Receipt #', key: 'orders' },
      { label: 'Product Name', key: 'product_name' },
      { label: 'Qty', key: 'quantity' },
      { label: 'Unit Price', key: 'unit_price' },
      { label: 'Line Total', key: 'total' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Receipt #', key: 'orders', render: (o) => `<strong>${o?.receipt_no}</strong>` },
        { label: 'Product Name', key: 'product_name' },
        { label: 'Qty', key: 'quantity' },
        { label: 'Unit Price', key: 'unit_price', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Line Total', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: data || [],
    });
  }

  async function renderSalesByTrends(target, chartTarget) {
    let query = supabase.from('orders').select('created_at, total').eq('order_status', 'completed');
    query = applyBaseOrderFilters(query);

    const { data: orders, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const hourly = new Array(24).fill(0);
    orders?.forEach((o) => {
      const h = new Date(o.created_at).getHours();
      hourly[h] += Number(o.total || 0);
    });

    const max = Math.max(...hourly, 1);
    const bars = hourly.map((v, h) => `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center;">
        <div style="height:120px; width:100%; background:var(--bg-canvas); display:flex; align-items:flex-end;">
          <div style="height:${Math.round((v / max) * 100)}%; width:100%; background:var(--teal-600); border-radius:4px;"></div>
        </div>
        <span style="font-size:0.65rem; color:var(--text-muted); margin-top:4px;">${h}:00</span>
      </div>
    `).join('');

    target.innerHTML = `<div style="padding:24px;"><h4 style="margin-bottom:16px;">Sales Trend Curve</h4><div style="display:flex; gap:6px;">${bars}</div></div>`;
  }

  async function renderDeletedReceipts(target, chartTarget) {
    let query = supabase.from('orders').select('*, profiles(full_name)').eq('is_deleted', true).order('deleted_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Voided Receipt #', key: 'receipt_no' },
      { label: 'Amount', key: 'total' },
      { label: 'Reason', key: 'deleted_reason' },
      { label: 'Deleted At', key: 'deleted_at' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Voided Receipt #', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Amount Voided', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Reason', key: 'deleted_reason' },
        { label: 'Deleted At', key: 'deleted_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
      onAction: (a, id) => {
        const order = data.find((o) => o.id === id);
        if (order) viewReceiptModal(order);
      }
    });
  }

  async function renderOrderTypeWiseSales(target, chartTarget) {
    let query = supabase.from('orders').select('service_type, total').eq('order_status', 'completed');
    query = applyBaseOrderFilters(query);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const map = {};
    data?.forEach((o) => {
      const type = (o.service_type || 'walk_in').toUpperCase();
      map[type] = (map[type] || 0) + Number(o.total || 0);
    });

    const rows = Object.entries(map).map(([type, total]) => ({ type, total }));
    currentReportData = rows;
    currentReportColumns = [
      { label: 'Order Type', key: 'type' },
      { label: 'Total Volume', key: 'total' }
    ];

    const chartSeries = rows.map(r => ({ label: r.type, value: r.total }));
    PieChart.render(chartTarget, chartSeries, { title: 'Order Channel Revenue Share', currency });

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Order Type Channel', key: 'type', render: (v) => `<strong>${v}</strong>` },
        { label: 'Total Sales Volume', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  async function renderProductWiseTax(target, chartTarget) {
    let query = supabase.from('order_items').select('product_name, tax_rate, total, orders!inner(shop_id, created_at, is_deleted)').eq('orders.is_deleted', false);
    if (globalState.activeShopId) query = query.eq('orders.shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const map = {};
    data?.forEach((i) => {
      const name = i.product_name;
      const taxBilled = (Number(i.total || 0) * Number(i.tax_rate || 0)) / 100;
      if (!map[name]) map[name] = { name, taxRate: i.tax_rate, totalTax: 0 };
      map[name].totalTax += taxBilled;
    });

    const rows = Object.values(map);
    currentReportData = rows;
    currentReportColumns = [
      { label: 'Product Name', key: 'name' },
      { label: 'Tax Rate', key: 'taxRate' },
      { label: 'Total Tax', key: 'totalTax' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Product Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Tax Rate', key: 'taxRate', render: (v) => `${v}%` },
        { label: 'Total Tax Generated', key: 'totalTax', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: rows,
    });
  }

  async function renderManualReceipts(target, chartTarget) {
    let query = supabase.from('orders').select('*').eq('synced_from_offline', true);
    query = applyBaseOrderFilters(query);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Receipt #', key: 'receipt_no' },
      { label: 'Total', key: 'total' },
      { label: 'Synced Date', key: 'created_at' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Manual Receipt #', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Total', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Synced At', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
      onAction: (a, id) => {
        const order = data.find((o) => o.id === id);
        if (order) viewReceiptModal(order);
      }
    });
  }

  async function renderSalesByOrders(target, chartTarget) {
    await renderReceipts(target, chartTarget);
  }

  async function renderSalesByModifiers(target, chartTarget) {
    target.innerHTML = `<p style="padding:24px; color:var(--text-muted);">No modifier item orders recorded in selected period.</p>`;
  }

  async function renderAuxiliaryStaffSales(target, chartTarget) {
    let query = supabase.from('orders').select('*, auxiliary_staff(full_name)').not('auxiliary_staff_id', 'is', null);
    query = applyBaseOrderFilters(query);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--text-muted);">No sales mapped to auxiliary staff for this range.</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Auxiliary Staff', key: 'auxiliary_staff' },
      { label: 'Receipt #', key: 'receipt_no' },
      { label: 'Billed Amount', key: 'total' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Auxiliary Staff', key: 'auxiliary_staff', render: (a) => `<strong>${a?.full_name || 'Staff'}</strong>` },
        { label: 'Receipt #', key: 'receipt_no' },
        { label: 'Amount Billed', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: data || [],
    });
  }

  async function renderEcommerceSales(target, chartTarget) {
    let query = supabase.from('orders').select('*').eq('service_type', 'delivery');
    query = applyBaseOrderFilters(query);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Order #', key: 'receipt_no' },
      { label: 'Total', key: 'total' },
      { label: 'Date', key: 'created_at' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Order #', key: 'receipt_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Total', key: 'total', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
      onAction: (a, id) => {
        const order = data.find((o) => o.id === id);
        if (order) viewReceiptModal(order);
      }
    });
  }

  // SUSPICIOUS AUDIT REPORTS
  async function renderProductWiseDeletedReceipts(target, chartTarget) {
    let query = supabase.from('deleted_order_items').select('*, profiles(full_name)').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Product Name', key: 'product_name' },
      { label: 'Qty', key: 'quantity' },
      { label: 'Staff', key: 'profiles' },
      { label: 'Reason', key: 'reason' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Deleted Item', key: 'product_name', render: (p) => `<strong style="color:var(--color-danger);">${p}</strong>` },
        { label: 'Qty', key: 'quantity' },
        { label: 'Removed By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Reason', key: 'reason' },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
    });
  }

  async function renderRefundAndCreditNotes(target, chartTarget) {
    let query = supabase.from('debtor_settlements').select('*, customers(name)').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Settlement #', key: 'settlement_no' },
      { label: 'Customer', key: 'customers' },
      { label: 'Credit Amount', key: 'amount' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Settlement #', key: 'settlement_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Customer', key: 'customers', render: (c) => c?.name || 'Customer' },
        { label: 'Credit Amount', key: 'amount', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
    });
  }

  async function renderDeletedProductsInOpenOrders(target, chartTarget) {
    let query = supabase.from('cart_discard_logs').select('*, profiles(full_name)').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    currentReportData = data || [];
    currentReportColumns = [
      { label: 'Discarded Item', key: 'product_name' },
      { label: 'Qty', key: 'quantity' },
      { label: 'Unit Retail', key: 'unit_price' },
      { label: 'Cashier', key: 'profiles' },
      { label: 'Reason', key: 'reason' }
    ];

    renderDataTable({
      targetId: 'sales-table-content',
      columns: [
        { label: 'Discarded Item', key: 'product_name', render: (p) => `<strong style="color:var(--color-danger);">${p}</strong>` },
        { label: 'Qty Dropped', key: 'quantity' },
        { label: 'Unit Retail', key: 'unit_price', render: (u) => `${Number(u).toLocaleString()} ${currency}` },
        { label: 'Cashier', key: 'profiles', render: (c) => c?.full_name || 'Staff' },
        { label: 'Reason', key: 'reason' },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
    });
  }

  // Modal Views
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
            <button id="btn-single-pdf" class="btn btn-outline" style="flex:1;">Export PDF</button>
            <button id="btn-print-usb" class="btn btn-outline" style="flex:1;">WebUSB Print</button>
            <button id="btn-print-bt" class="btn btn-outline" style="flex:1;">Bluetooth Print</button>
            <button id="btn-print-fallback" class="btn btn-teal-primary" style="flex:1;">Slip Preview</button>
          </div>
        </div>
      `,
    });

    const slipPayload = {
      shopName: globalState.activeShop?.name || 'QuickSell POS',
      receiptNo: order.receipt_no,
      items: (items || []).map((i) => ({ name: i.product_name, quantity: i.quantity, price: Number(i.unit_price) })),
      subtotal: Number(order.subtotal || 0),
      discount: Number(order.discount_amount || 0),
      tax: Number(order.tax_amount || 0),
      total: Number(order.total || 0),
      currency,
    };

    document.getElementById('btn-single-pdf').onclick = () => {
      const pdfCols = [
        { label: 'Item Name', key: 'product_name' },
        { label: 'Quantity', key: 'quantity' },
        { label: 'Unit Price', key: 'unit_price' },
        { label: 'Total', key: 'total' }
      ];
      Exporter.exportToPDF(`Receipt ${order.receipt_no}`, items || [], pdfCols, {
        'Receipt No': order.receipt_no,
        'Total Amount': `${Number(order.total).toLocaleString()} ${currency}`
      });
    };

    document.getElementById('btn-print-usb').onclick = () => PrinterDriver.printViaUSB(slipPayload);
    document.getElementById('btn-print-bt').onclick = () => PrinterDriver.printViaBluetooth(slipPayload);
    document.getElementById('btn-print-fallback').onclick = () => PrinterDriver.printFallbackSlip(slipPayload);
  }

  function openShiftModal() {
    Modal.open({
      title: 'Open Cash Drawer Shift',
      content: `
        <form id="form-shift">
          <div class="form-group">
            <label>Opening Float (${currency})</label>
            <input type="number" step="0.01" name="opening_cash" required placeholder="1000.00" class="input-field" />
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
        await loadView();
      },
    });
  }

  // Initial Load
  await loadView();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}