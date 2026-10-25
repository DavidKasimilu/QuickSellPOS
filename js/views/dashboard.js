import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  const filterDate = globalState.filterDate || new Date().toISOString().split('T')[0];
  let unsubs = [];

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
          <h3>Sales Summary (${filterDate})</h3>
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

  // Reactive listener: recalculates metrics immediately when mobile POS orders sync
  unsubs.push(
    globalState.subscribeKey('orders', () => {
      loadMetrics();
    })
  );

  async function loadMetrics() {
    const startOfDay = `${filterDate}T00:00:00.000Z`;
    const endOfDay = `${filterDate}T23:59:59.999Z`;

    let query = supabase
      .from('orders')
      .select(`
        id, subtotal, discount_amount, tax_amount, total, order_status,
        order_items ( cost_price, quantity )
      `)
      .gte('created_at', startOfDay)
      .lte('created_at', endOfDay);

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

    renderTrendVisualization(orders || []);
  }

  function renderTrendVisualization(orders) {
    const container = document.getElementById('sales-chart-body');
    if (!container) return;

    if (!orders.length) {
      container.innerHTML = `<div class="chart-placeholder"><p>No orders recorded for ${filterDate}</p></div>`;
      return;
    }

    container.innerHTML = `
      <div style="width:100%; display:flex; flex-direction:column; justify-content:center; gap:8px;">
        <div style="display:flex; justify-content:space-between; font-size:0.875rem;">
          <span>Transactions Processed</span>
          <strong>${orders.length}</strong>
        </div>
        <div style="height:8px; width:100%; background:var(--teal-50); border-radius:4px; overflow:hidden;">
          <div style="height:100%; width:100%; background:var(--teal-600);"></div>
        </div>
      </div>
    `;
  }

  await loadMetrics();

  if (window.lucide) {
    window.lucide.createIcons({ root: container });
  }

  // Clean unmount hook
  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}