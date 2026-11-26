import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { scoped } from '../tenant.js';
import { mountDateRangeFilter, startOfDayISO, endOfDayISO } from '../components/DateRangeFilter.js';

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

  // Today by default; the calendar button lets the person pick a single day or a range.
  let dateRange = null;   // {start,end,label,startISO,endISO} - set once the control mounts, below

  function getDateBounds() {
    return { startISO: dateRange.startISO, endISO: dateRange.endISO, label: dateRange.label };
  }

  function bindTopDateControls() {
    const el = document.getElementById('dashboard-date-controls');
    if (!el) return;
    mountDateRangeFilter(el, {
      onChange: (range) => { dateRange = range; loadMetrics(); },
    });
    dateRange = {
      start: new Date().toISOString().slice(0, 10), // placeholder; mountDateRangeFilter sets the real local-day values below
    };
    // mountDateRangeFilter defaults to "today" internally and does not fire onChange on mount,
    // so read its current range once to get the first load's bounds.
    const todayLocal = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayYmd = `${todayLocal.getFullYear()}-${pad(todayLocal.getMonth() + 1)}-${pad(todayLocal.getDate())}`;
    dateRange = { start: todayYmd, end: todayYmd, label: 'Today', startISO: startOfDayISO(todayYmd), endISO: endOfDayISO(todayYmd) };
  }

  // Fetch sales metrics from Supabase with shop-isolation and date filtering  // Fetch sales metrics from Supabase with shop-isolation and date filtering
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

    query = scoped(query);

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
