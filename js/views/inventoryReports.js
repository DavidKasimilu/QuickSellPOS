import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'valuation'; // 'valuation' | 'reorder' | 'movements'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Inventory Reports & Analytics</h3>
      </div>
      <div>
        <button class="btn btn-outline" id="btn-export-inv-report">
          <i data-lucide="download" style="width:16px; height:16px; margin-right:6px;"></i> Print / Export Report
        </button>
      </div>
    </div>

    <!-- Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-report-tab="valuation">Valuation Summary</button>
      <button class="date-chip" data-report-tab="reorder">Low Stock Alerts</button>
      <button class="date-chip" data-report-tab="movements">Stock Movement Log</button>
    </div>

    <!-- Summary KPI Cards -->
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; margin-bottom:20px;">
      <div class="stat-card" style="padding:16px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px;">
        <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Total Retail Value</span>
        <strong id="kpi-total-retail" style="font-size:1.25rem; color:var(--teal-600);">0 ${currency}</strong>
      </div>
      <div class="stat-card" style="padding:16px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px;">
        <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Total Asset Cost</span>
        <strong id="kpi-total-cost" style="font-size:1.25rem;">0 ${currency}</strong>
      </div>
      <div class="stat-card" style="padding:16px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px;">
        <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-bottom:4px;">Projected Margin</span>
        <strong id="kpi-total-margin" style="font-size:1.25rem; color:#10b981;">0 ${currency}</strong>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="inventory-report-table-content"></div>
    </div>
  `;

  // Bind export button
  document.getElementById('btn-export-inv-report').onclick = () => window.print();

  // Bind tab switching
  container.querySelectorAll('[data-report-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-report-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.reportTab;
      loadActiveReportTab();
    };
  });

  async function loadActiveReportTab() {
    const tableArea = document.getElementById('inventory-report-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Calculating ${activeTab} data...</p>`;

    if (activeTab === 'valuation') {
      await renderValuationReport(tableArea);
    } else if (activeTab === 'reorder') {
      await renderReorderReport(tableArea);
    } else if (activeTab === 'movements') {
      await renderMovementsReport(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Valuation Report
  // =========================================================================
  async function renderValuationReport(target) {
    let query = supabase
      .from('inventory')
      .select('quantity_on_hand, min_stock_level, products(id, name, barcode, retail_price, cost_price, categories(name))')
      .eq('shop_id', globalState.activeShopId);

    const { data: items, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    let grandRetail = 0;
    let grandCost = 0;

    const reportData = (items || []).map((i) => {
      const qty = Number(i.quantity_on_hand || 0);
      const retailPrice = Number(i.products?.retail_price || 0);
      const costPrice = Number(i.products?.cost_price || 0);

      const totalRetail = qty * retailPrice;
      const totalCost = qty * costPrice;

      grandRetail += totalRetail;
      grandCost += totalCost;

      return {
        product_name: i.products?.name || 'Item',
        category: i.products?.categories?.name || 'General',
        qty: qty,
        retail_price: retailPrice,
        cost_price: costPrice,
        total_retail: totalRetail,
        total_cost: totalCost,
        potential_profit: totalRetail - totalCost,
      };
    });

    // Update KPI Header Cards
    const kpiRetail = document.getElementById('kpi-total-retail');
    const kpiCost = document.getElementById('kpi-total-cost');
    const kpiMargin = document.getElementById('kpi-total-margin');

    if (kpiRetail) kpiRetail.textContent = `${grandRetail.toLocaleString()} ${currency}`;
    if (kpiCost) kpiCost.textContent = `${grandCost.toLocaleString()} ${currency}`;
    if (kpiMargin) kpiMargin.textContent = `${(grandRetail - grandCost).toLocaleString()} ${currency}`;

    renderDataTable({
      targetId: 'inventory-report-table-content',
      columns: [
        { label: 'Product Name', key: 'product_name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Category', key: 'category' },
        { label: 'Stock On Hand', key: 'qty', render: (q) => `<strong>${q}</strong>` },
        { label: 'Unit Retail Price', key: 'retail_price', render: (v) => `${v.toLocaleString()} ${currency}` },
        { label: 'Unit Cost Price', key: 'cost_price', render: (v) => `${v.toLocaleString()} ${currency}` },
        { label: 'Total Asset Cost', key: 'total_cost', render: (v) => `<strong>${v.toLocaleString()} ${currency}</strong>` },
        { label: 'Total Sales Value', key: 'total_retail', render: (v) => `<strong style="color:var(--teal-600);">${v.toLocaleString()} ${currency}</strong>` },
      ],
      data: reportData,
    });
  }

  // =========================================================================
  // 2. Low Stock Alerts & Reorder Report
  // =========================================================================
  async function renderReorderReport(target) {
    let query = supabase
      .from('inventory')
      .select('quantity_on_hand, min_stock_level, products(name, barcode, cost_price, suppliers(name))')
      .eq('shop_id', globalState.activeShopId);

    const { data: items, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const reorderData = (items || [])
      .filter((i) => Number(i.quantity_on_hand || 0) <= Number(i.min_stock_level || 5))
      .map((i) => {
        const qty = Number(i.quantity_on_hand || 0);
        const minLevel = Number(i.min_stock_level || 5);
        const reorderQty = Math.max(10, minLevel * 2 - qty);

        return {
          product_name: i.products?.name || 'Item',
          supplier: i.products?.suppliers?.name || 'General Supplier',
          qty: qty,
          min_level: minLevel,
          suggested_reorder: reorderQty,
          est_reorder_cost: reorderQty * Number(i.products?.cost_price || 0),
        };
      });

    renderDataTable({
      targetId: 'inventory-report-table-content',
      columns: [
        { label: 'Low Stock Item', key: 'product_name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Supplier', key: 'supplier' },
        { 
          label: 'Current Stock', 
          key: 'qty', 
          render: (q) => `<span class="badge text-danger" style="font-weight:bold;">${q} units</span>` 
        },
        { label: 'Threshold Level', key: 'min_level', render: (m) => `${m} units` },
        { label: 'Suggested Order Qty', key: 'suggested_reorder', render: (r) => `<strong style="color:var(--teal-600);">+${r} units</strong>` },
        { label: 'Est. Order Cost', key: 'est_reorder_cost', render: (c) => `<strong>${c.toLocaleString()} ${currency}</strong>` },
      ],
      data: reorderData,
    });
  }

  // =========================================================================
  // 3. Stock Movement Logs
  // =========================================================================
  async function renderMovementsReport(target) {
    let query = supabase
      .from('stock_adjustments')
      .select('*, products(name, barcode), profiles(full_name)')
      .eq('shop_id', globalState.activeShopId)
      .order('created_at', { ascending: false });

    const { data: movements, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'inventory-report-table-content',
      columns: [
        { label: 'Product Item', key: 'products', render: (p) => `<strong>${p?.name || 'Product'}</strong>` },
        { label: 'Movement Type', key: 'adjustment_type', render: (t) => `<span class="badge">${(t || 'Adjustment').toUpperCase()}</span>` },
        { 
          label: 'Quantity Change', 
          key: 'quantity_delta', 
          render: (delta) => {
            const val = Number(delta || 0);
            const color = val >= 0 ? 'var(--teal-600)' : 'var(--color-danger)';
            return `<strong style="color:${color};">${val > 0 ? `+${val}` : val}</strong>`;
          } 
        },
        { label: 'Reason / Remarks', key: 'reason', render: (r) => r || '-' },
        { label: 'Logged By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: movements || [],
    });
  }

  await loadActiveReportTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}