import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let unsubs = [];
  let eventListenersCleanup = [];

  // Show date controls bar on top nav specifically for Dashboard
  const topDateControls = document.getElementById('dashboard-date-controls');
  if (topDateControls) {
    topDateControls.style.display = 'flex';
  }

  container.innerHTML = `
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Gross Sales</span>
          <i data-lucide="trending-up" class="kpi-icon text-teal"></i>
        </div>
        <div class="kpi-value" id="val-gross-sales">Loading...</div>
        <span class="kpi-meta">Total billed transactions</span>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Net Sales</span>
          <i data-lucide="wallet" class="kpi-icon text-teal"></i>
        </div>
        <div class="kpi-value" id="val-net-sales">Loading...</div>
        <span class="kpi-meta">Gross minus taxes & deductions</span>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Cost of Sales (COGS)</span>
          <i data-lucide="arrow-down-right" class="kpi-icon text-muted"></i>
        </div>
        <div class="kpi-value" id="val-cogs">Loading...</div>
        <span class="kpi-meta">Stock purchase costs</span>
      </div>

      <div class="kpi-card">
        <div class="kpi-header">
          <span class="kpi-label">Gross Profit</span>
          <i data-lucide="dollar-sign" class="kpi-icon text-accent"></i>
        </div>
        <div class="kpi-value text-accent-bold" id="val-gross-profit">Loading...</div>
        <span class="kpi-meta">Net sales minus cost</span>
      </div>

      <div class="kpi-card combined-card">
        <div class="kpi-header">
          <span class="kpi-label">Discounts & Cash Refunds</span>
          <i data-lucide="percent" class="kpi-icon text-danger"></i>
        </div>
        <div class="kpi-split-values">
          <div>
            <span class="sub-label">Discounts</span>
            <div class="kpi-sub-value" id="val-discounts">0.00 ${currency}</div>
          </div>
          <div class="separator-v"></div>
          <div>
            <span class="sub-label">Cash Refunds</span>
            <div class="kpi-sub-value" id="val-refunds">0.00 ${currency}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="dashboard-charts-grid">
      <div class="chart-box">
        <div class="chart-header">
          <h3 id="chart-title-period">Sales Summary</h3>
          <span class="chart-legend"><i class="legend-indicator teal-bg"></i> Volume Trend</span>
        </div>
        <div class="chart-canvas-container" id="sales-chart-body">
          <div class="chart-placeholder">
            <i data-lucide="line-chart"></i>
            <p>Aggregating daily receipts...</p>
          </div>
        </div>
      </div>

      <div class="chart-box">
        <div class="chart-header">
          <h3>Sales Deductions</h3>
          <span class="chart-legend"><i class="legend-indicator accent-bg"></i> Tax & Void Allocations</span>
        </div>
        <div class="chart-canvas-container" id="deductions-chart-body">
          <div class="chart-placeholder">
            <i data-lucide="pie-chart"></i>
            <p>Computing tax deductions...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  // Determine target ISO start and end timestamps based on user date selections
  function getDateBounds() {
    const period = globalState.datePeriod || 'today';
    const now = new Date();
    let startDate = new Date();
    let endDate = new Date();
    let label = 'Today';

    if (period === 'today') {
      label = 'Today';
    } else if (period === 'yesterday') {
      startDate.setDate(now.getDate() - 1);
      endDate.setDate(now.getDate() - 1);
      label = 'Yesterday';
    } else if (period === 'this-month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      label = 'This Month';
    } else if (period === 'last-month') {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      label = 'Last Month';
    } else if (period === 'range' && globalState.startDate && globalState.endDate) {
      startDate = new Date(globalState.startDate);
      endDate = new Date(globalState.endDate);
      label = `${globalState.startDate} to ${globalState.endDate}`;
    } else if (period === 'calendar' && globalState.filterDate) {
      startDate = new Date(globalState.filterDate);
      endDate = new Date(globalState.filterDate);
      label = globalState.filterDate;
    }

    const startISO = `${startDate.toISOString().split('T')[0]}T00:00:00.000Z`;
    const endISO = `${endDate.toISOString().split('T')[0]}T23:59:59.999Z`;

    return { startISO, endISO, label };
  }

  // Bind top navbar date filter controls
  function bindTopDateControls() {
    const dateChips = document.querySelectorAll('#dashboard-date-controls .date-chip');
    const monthSelect = document.getElementById('month-filter-select');
    const startDateInput = document.getElementById('stats-start-date');
    const endDateInput = document.getElementById('stats-end-date');
    const calendarInput = document.getElementById('stats-calendar-filter');

    // Handle Today / Yesterday chips
    dateChips.forEach((chip) => {
      const handler = (e) => {
        dateChips.forEach((c) => c.classList.remove('active'));
        e.target.classList.add('active');

        if (monthSelect) monthSelect.value = '';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        if (calendarInput) calendarInput.value = '';

        globalState.datePeriod = e.target.dataset.period;
        loadMetrics();
      };
      chip.addEventListener('click', handler);
      eventListenersCleanup.push(() => chip.removeEventListener('click', handler));
    });

    // Handle Month Select
    if (monthSelect) {
      const monthHandler = (e) => {
        if (!e.target.value) return;
        dateChips.forEach((c) => c.classList.remove('active'));
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';
        if (calendarInput) calendarInput.value = '';

        globalState.datePeriod = e.target.value;
        loadMetrics();
      };
      monthSelect.addEventListener('change', monthHandler);
      eventListenersCleanup.push(() => monthSelect.removeEventListener('change', monthHandler));
    }

    // Handle Start & End Date Inputs
    const rangeHandler = () => {
      if (startDateInput?.value && endDateInput?.value) {
        dateChips.forEach((c) => c.classList.remove('active'));
        if (monthSelect) monthSelect.value = '';
        if (calendarInput) calendarInput.value = '';

        globalState.datePeriod = 'range';
        globalState.startDate = startDateInput.value;
        globalState.endDate = endDateInput.value;
        loadMetrics();
      }
    };

    if (startDateInput && endDateInput) {
      startDateInput.addEventListener('change', rangeHandler);
      endDateInput.addEventListener('change', rangeHandler);
      eventListenersCleanup.push(
        () => startDateInput.removeEventListener('change', rangeHandler),
        () => endDateInput.removeEventListener('change', rangeHandler)
      );
    }

    // Handle Calendar Picker
    if (calendarInput) {
      const calendarHandler = (e) => {
        if (!e.target.value) return;
        dateChips.forEach((c) => c.classList.remove('active'));
        if (monthSelect) monthSelect.value = '';
        if (startDateInput) startDateInput.value = '';
        if (endDateInput) endDateInput.value = '';

        globalState.datePeriod = 'calendar';
        globalState.filterDate = e.target.value;
        loadMetrics();
      };
      calendarInput.addEventListener('change', calendarHandler);
      eventListenersCleanup.push(() => calendarInput.removeEventListener('change', calendarHandler));
    }
  }

  // Fetch sales metrics from Supabase with shop-isolation and date filtering
  async function loadMetrics() {
    const { startISO, endISO, label } = getDateBounds();

    const chartTitle = document.getElementById('chart-title-period');
    if (chartTitle) chartTitle.textContent = `Sales Summary (${label})`;

    let query = supabase
      .from('orders')
      .select(`
        id, subtotal, discount_amount, tax_amount, total, order_status, created_at,
        order_items ( cost_price, quantity )
      `)
      .gte('created_at', startISO)
      .lte('created_at', endISO);

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: orders, error } = await query;

    if (error) {
      console.error('Failed to load dashboard metrics:', error);
      return;
    }

    let gross = 0;
    let net = 0;
    let discounts = 0;
    let cogs = 0;
    let refunds = 0;

    orders?.forEach((order) => {
      if (order.order_status === 'refunded') {
        refunds += Number(order.total || 0);
      } else if (order.order_status === 'completed') {
        gross += Number(order.total || 0);
        discounts += Number(order.discount_amount || 0);
        net += Number(order.subtotal || 0);

        order.order_items?.forEach((item) => {
          cogs += Number(item.cost_price || 0) * Number(item.quantity || 1);
        });
      }
    });

    const profit = net - cogs;
    const fmt = (num) => `${Number(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

    const grossEl = document.getElementById('val-gross-sales');
    const netEl = document.getElementById('val-net-sales');
    const cogsEl = document.getElementById('val-cogs');
    const profitEl = document.getElementById('val-gross-profit');
    const discEl = document.getElementById('val-discounts');
    const refEl = document.getElementById('val-refunds');

    if (grossEl) grossEl.textContent = fmt(gross);
    if (netEl) netEl.textContent = fmt(net);
    if (cogsEl) cogsEl.textContent = fmt(cogs);
    if (profitEl) profitEl.textContent = fmt(profit);
    if (discEl) discEl.textContent = fmt(discounts);
    if (refEl) refEl.textContent = fmt(refunds);

    renderTrendVisualization(orders || [], label);
  }

  function renderTrendVisualization(orders, label) {
    const container = document.getElementById('sales-chart-body');
    if (!container) return;

    if (!orders.length) {
      container.innerHTML = `<div class="chart-placeholder"><p>No orders recorded for ${label}</p></div>`;
      return;
    }

    container.innerHTML = `
      <div style="width:100%; display:flex; flex-direction:column; justify-content:center; gap:8px;">
        <div style="display:flex; justify-content:space-between; font-size:0.875rem;">
          <span>Transactions Processed (${label})</span>
          <strong>${orders.length}</strong>
        </div>
        <div style="height:8px; width:100%; background:var(--teal-50); border-radius:4px; overflow:hidden;">
          <div style="height:100%; width:100%; background:var(--teal-600);"></div>
        </div>
      </div>
    `;
  }

  // Reactive listener for state changes
  unsubs.push(
    globalState.subscribeKey('orders', () => loadMetrics()),
    globalState.subscribeKey('datePeriod', () => loadMetrics())
  );

  bindTopDateControls();
  await loadMetrics();

  if (window.lucide) {
    window.lucide.createIcons({ root: container });
  }

  return () => {
    // Hide top-bar date controls when navigating away from dashboard
    if (topDateControls) {
      topDateControls.style.display = 'none';
    }
    unsubs.forEach((unsub) => unsub && unsub());
    eventListenersCleanup.forEach((cleanup) => cleanup && cleanup());
  };
}
