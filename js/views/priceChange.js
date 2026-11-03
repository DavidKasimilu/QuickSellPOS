import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'audit'; // 'audit' | 'bulk'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Price Change & Revision Logs</h3>
      </div>
      <div id="price-change-actions"></div>
    </div>

    <!-- Navigation Sub-tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-price-tab="audit">Price Revision History</button>
      <button class="date-chip" data-price-tab="bulk">Bulk Price Adjustment</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="price-change-table-content"></div>
    </div>
  `;

  // Bind tab navigation
  container.querySelectorAll('[data-price-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-price-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.priceTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('price-change-actions');
    const tableArea = document.getElementById('price-change-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    if (activeTab === 'audit') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-update-single-price">
          <i data-lucide="edit-3" style="width:16px; height:16px; margin-right:6px;"></i> Update Item Price
        </button>
      `;
      document.getElementById('btn-update-single-price').onclick = () => openSinglePriceUpdateModal();
      await renderPriceAuditTable(tableArea);
    } else {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-apply-bulk-price">
          <i data-lucide="percent" style="width:16px; height:16px; margin-right:6px;"></i> Apply Bulk Price Change
        </button>
      `;
      document.getElementById('btn-apply-bulk-price').onclick = () => openBulkPriceChangeModal();
      await renderBulkChangeOverview(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Price Revision Audit History Table
  // =========================================================================
  async function renderPriceAuditTable(target) {
    let query = supabase
      .from('price_change_logs')
      .select('*, products(name, barcode), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: logs, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'price-change-table-content',
      columns: [
        { label: 'Product Item', key: 'products', render: (p) => `<strong>${p?.name || 'Product'}</strong> <div style="font-size:0.75rem; color:var(--text-muted);">${p?.barcode || ''}</div>` },
        { label: 'Price Field', key: 'price_type', render: (t) => `<span class="badge">${(t || 'retail_price').toUpperCase()}</span>` },
        { label: 'Old Price', key: 'old_price', render: (v) => `${Number(v || 0).toLocaleString()} ${currency}` },
        { label: 'New Price', key: 'new_price', render: (v) => `<strong style="color:var(--teal-600);">${Number(v || 0).toLocaleString()} ${currency}</strong>` },
        { label: 'Reason / Batch', key: 'reason', render: (r) => r || 'Manual Price Adjustment' },
        { label: 'Updated By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: logs || [],
    });
  }

  // =========================================================================
  // 2. Bulk Price Change Overview
  // =========================================================================
  async function renderBulkChangeOverview(target) {
    let query = supabase
      .from('products')
      .select('id, name, retail_price, cost_price, categories(name)')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: products, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'price-change-table-content',
      columns: [
        { label: 'Product Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Category', key: 'categories', render: (c) => c?.name || 'General' },
        { label: 'Cost Price', key: 'cost_price', render: (v) => `${Number(v || 0).toLocaleString()} ${currency}` },
        { label: 'Current Retail Price', key: 'retail_price', render: (v) => `<strong>${Number(v || 0).toLocaleString()} ${currency}</strong>` },
      ],
      data: products || [],
    });
  }

  // =========================================================================
  // Modals
  // =========================================================================
  async function openSinglePriceUpdateModal() {
    let query = supabase.from('products').select('id, name, retail_price, cost_price').eq('is_active', true).is('deleted_at', null).order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: products } = await query;

    if (!products || !products.length) {
      Toast.error('No active products found in catalog.');
      return;
    }

    const prodOpts = products.map((p) => 
      `<option value="${p.id}" data-retail="${p.retail_price}" data-cost="${p.cost_price}">${p.name} (Current: ${Number(p.retail_price || 0).toLocaleString()} ${currency})</option>`
    ).join('');

    Modal.open({
      title: 'Update Product Price',
      content: `
        <form id="form-single-price-update" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Product</label>
            <select name="product_id" id="select-prod-price-update" required>${prodOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Retail Price (${currency})</label>
              <input type="number" step="0.01" min="0" name="retail_price" id="input-new-retail" required />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Cost Price (${currency})</label>
              <input type="number" step="0.01" min="0" name="cost_price" id="input-new-cost" required />
            </div>
          </div>

          <div class="form-group">
            <label>Reason for Price Change</label>
            <input type="text" name="reason" placeholder="e.g. Inflation / Supplier cost increase" required />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Apply New Price & Log Change</button>
        </form>
      `,
      onOpen: () => {
        const select = document.getElementById('select-prod-price-update');
        const retailInput = document.getElementById('input-new-retail');
        const costInput = document.getElementById('input-new-cost');

        function setInitialValues() {
          const opt = select.options[select.selectedIndex];
          if (opt && retailInput && costInput) {
            retailInput.value = opt.dataset.retail || 0;
            costInput.value = opt.dataset.cost || 0;
          }
        }

        if (select) {
          select.onchange = setInitialValues;
          setInitialValues();
        }
      },
      onSubmit: async (fd) => {
        const prodId = fd.product_id;
        const newRetail = parseFloat(fd.retail_price) || 0;
        const newCost = parseFloat(fd.cost_price) || 0;

        const prod = products.find((p) => p.id === prodId);
        const oldRetail = parseFloat(prod?.retail_price) || 0;
        const nowIso = new Date().toISOString();

        // 1. Log price change
        const { error: logErr } = await supabase.from('price_change_logs').insert([{
          shop_id: globalState.activeShopId,
          product_id: prodId,
          price_type: 'retail_price',
          old_price: oldRetail,
          new_price: newRetail,
          reason: fd.reason,
          created_by: globalState.user?.id,
          created_at: nowIso,
        }]);

        if (logErr) {
          Toast.error(logErr.message);
          return;
        }

        // 2. Update product row
        const { error: prodErr } = await supabase
          .from('products')
          .update({
            retail_price: newRetail,
            cost_price: newCost,
            updated_at: nowIso,
          })
          .eq('id', prodId);

        if (prodErr) {
          Toast.error(prodErr.message);
          return;
        }

        Toast.success('Product price updated and audit log recorded.');
        await loadActiveTab();
      },
    });
  }

  async function openBulkPriceChangeModal() {
    const { data: categories } = await supabase.from('categories').select('id, name').is('deleted_at', null).order('name');
    const catOpts = `<option value="ALL">-- All Categories --</option>` + (categories || []).map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    Modal.open({
      title: 'Apply Bulk Price Adjustment',
      content: `
        <form id="form-bulk-price-change" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Filter Target Category</label>
            <select name="category_id">${catOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Adjustment Mode</label>
              <select name="adjustment_mode" required>
                <option value="percentage_increase">Percentage Increase (+%)</option>
                <option value="percentage_decrease">Percentage Decrease (-%)</option>
                <option value="flat_increase">Flat Amount Increase (+${currency})</option>
                <option value="flat_decrease">Flat Amount Decrease (-${currency})</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Adjustment Rate / Value</label>
              <input type="number" step="0.01" min="0.01" name="adjustment_value" placeholder="e.g. 10" required />
            </div>
          </div>

          <div class="form-group">
            <label>Bulk Change Reason</label>
            <input type="text" name="reason" placeholder="e.g. Storewide price increase" required />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Execute Bulk Price Adjustment</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const catId = fd.category_id;
        const mode = fd.adjustment_mode;
        const adjVal = parseFloat(fd.adjustment_value) || 0;

        let query = supabase.from('products').select('id, retail_price').eq('is_active', true).is('deleted_at', null);
        if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);
        if (catId !== 'ALL') query = query.eq('category_id', catId);

        const { data: prodsToUpdate, error: fetchErr } = await query;
        if (fetchErr || !prodsToUpdate || !prodsToUpdate.length) {
          Toast.error('No matching products found for bulk adjustment.');
          return;
        }

        const nowIso = new Date().toISOString();
        const logsPayload = [];

        for (const p of prodsToUpdate) {
          const oldRetail = parseFloat(p.retail_price) || 0;
          let newRetail = oldRetail;

          if (mode === 'percentage_increase') newRetail = oldRetail * (1 + adjVal / 100);
          else if (mode === 'percentage_decrease') newRetail = Math.max(0, oldRetail * (1 - adjVal / 100));
          else if (mode === 'flat_increase') newRetail = oldRetail + adjVal;
          else if (mode === 'flat_decrease') newRetail = Math.max(0, oldRetail - adjVal);

          newRetail = Math.round(newRetail * 100) / 100;

          await supabase.from('products').update({ retail_price: newRetail, updated_at: nowIso }).eq('id', p.id);

          logsPayload.push({
            shop_id: globalState.activeShopId,
            product_id: p.id,
            price_type: 'retail_price',
            old_price: oldRetail,
            new_price: newRetail,
            reason: `Bulk: ${fd.reason}`,
            created_by: globalState.user?.id,
            created_at: nowIso,
          });
        }

        if (logsPayload.length > 0) {
          await supabase.from('price_change_logs').insert(logsPayload);
        }

        Toast.success(`Bulk price update applied to ${prodsToUpdate.length} products.`);
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}