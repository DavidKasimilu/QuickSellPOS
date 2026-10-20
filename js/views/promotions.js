import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let activeTab = 'discounts'; // 'discounts' | 'pricing-plans' | 'price-change'

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        </div>
      <div id="promotions-action-container"></div>
    </div>

    <!-- Group 5 Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-promo-tab="discounts">Discount Plans</button>
      <button class="date-chip" data-promo-tab="pricing-plans">Pricing Plans</button>
      <button class="date-chip" data-promo-tab="price-change">Price Change Utility</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="promo-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-promo-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-promo-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.promoTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('promotions-action-container');
    const tableArea = document.getElementById('promo-table-content');
    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    switch (activeTab) {
      case 'discounts':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-discount">
            <i data-lucide="tag" style="width:16px; height:16px; margin-right:6px;"></i> Add Discount Plan
          </button>
        `;
        document.getElementById('btn-add-discount').onclick = () => openDiscountModal();
        await renderDiscountsTable(tableArea);
        break;

      case 'pricing-plans':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-pricing-plan">
            <i data-lucide="layers" style="width:16px; height:16px; margin-right:6px;"></i> Add Pricing Plan
          </button>
        `;
        document.getElementById('btn-add-pricing-plan').onclick = () => openPricingPlanModal();
        await renderPricingPlansTable(tableArea);
        break;

      case 'price-change':
        actionArea.innerHTML = `
          <button class="btn btn-accent" id="btn-bulk-price-change">
            <i data-lucide="arrow-up-down" style="width:16px; height:16px; margin-right:6px;"></i> Apply Bulk Change
          </button>
        `;
        document.getElementById('btn-bulk-price-change').onclick = () => openBulkPriceChangeModal();
        await renderPriceChangeLogsTable(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Discount Plans Tab
  // =========================================================================
  async function renderDiscountsTable(target) {
    let query = supabase.from('discount_plans').select('*').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'promo-table-content',
      columns: [
        { label: 'Plan Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { 
          label: 'Type', 
          key: 'discount_type', 
          render: (type) => type === 'percentage' ? 'Percentage (%)' : `Fixed (${currency})` 
        },
        { 
          label: 'Rate / Deduction', 
          key: 'value', 
          render: (val, row) => row.discount_type === 'percentage' ? `${val}%` : `${Number(val).toLocaleString()} ${currency}` 
        },
        { 
          label: 'Min Order Spend', 
          key: 'min_order_amount', 
          render: (v) => `${Number(v).toLocaleString()} ${currency}` 
        },
        { 
          label: 'Status', 
          key: 'is_active', 
          render: (act) => act ? `<span class="badge badge-teal">ACTIVE</span>` : `<span class="badge">DISABLED</span>` 
        },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((d) => d.id === id);
        if (item) openDiscountModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Pricing Plans Tab (Tiers)
  // =========================================================================
  async function renderPricingPlansTable(target) {
    let query = supabase.from('pricing_plans').select('*').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'promo-table-content',
      columns: [
        { label: 'Plan / Tier', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Markup Adjustment', key: 'markup_percentage', render: (m) => `${m > 0 ? '+' : ''}${m}%` },
        { label: 'Description', key: 'description', render: (d) => d || '-' },
        { 
          label: 'Status', 
          key: 'is_active', 
          render: (act) => act ? `<span class="badge badge-teal">ACTIVE</span>` : `<span class="badge">DISABLED</span>` 
        },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((p) => p.id === id);
        if (item) openPricingPlanModal(item);
      },
    });
  }

  // =========================================================================
  // 3. Price Change Utility Log
  // =========================================================================
  async function renderPriceChangeLogsTable(target) {
    let query = supabase
      .from('price_change_logs')
      .select('*, categories(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'promo-table-content',
      columns: [
        { label: 'Category Adjusted', key: 'categories', render: (c) => `<strong>${c?.name || 'All Categories'}</strong>` },
        { 
          label: 'Adjustment Applied', 
          key: 'percentage', 
          render: (p, row) => `<span style="font-weight:700; color:${row.change_type === 'increase' ? 'var(--teal-600)' : 'var(--color-danger)'};">
            ${row.change_type === 'increase' ? '+' : '-'}${p}%
          </span>`
        },
        { label: 'Items Updated', key: 'items_affected', render: (cnt) => `${cnt || 0} items` },
        { label: 'Executed By', key: 'profiles', render: (p) => p?.full_name || 'Admin' },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: data || [],
    });
  }

  // =========================================================================
  // Modals & Action Workflows
  // =========================================================================

  // Discount Plan Modal
  function openDiscountModal(plan = null) {
    const isEdit = !!plan;
    Modal.open({
      title: isEdit ? `Edit: ${plan.name}` : 'Create Discount Plan',
      content: `
        <form id="form-discount-save">
          <div class="form-group">
            <label>Discount Title</label>
            <input type="text" name="name" required value="${plan?.name || ''}" placeholder="e.g. VIP Member 10%" />
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Discount Type</label>
              <select name="discount_type">
                <option value="percentage" ${plan?.discount_type === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
                <option value="fixed" ${plan?.discount_type === 'fixed' ? 'selected' : ''}>Fixed Amount (${currency})</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Deduction Value</label>
              <input type="number" step="0.01" name="value" required value="${plan?.value || 0}" />
            </div>
          </div>
          <div class="form-group">
            <label>Minimum Order Spend Trigger (${currency})</label>
            <input type="number" step="0.01" name="min_order_amount" value="${plan?.min_order_amount || 0}" />
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:normal;">
              <input type="checkbox" name="is_active" ${plan?.is_active !== false ? 'checked' : ''} />
              Enable this discount plan on registers
            </label>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Discount' : 'Save Discount Plan'}</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: formData.name,
          discount_type: formData.discount_type,
          value: parseFloat(formData.value) || 0,
          min_order_amount: parseFloat(formData.min_order_amount) || 0,
          is_active: formData.is_active === 'on',
        };

        const { error } = isEdit
          ? await supabase.from('discount_plans').update(payload).eq('id', plan.id)
          : await supabase.from('discount_plans').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Discount plan saved.');
          await loadActiveTab();
        }
      },
    });
  }

  // Pricing Plan Modal
  function openPricingPlanModal(tier = null) {
    const isEdit = !!tier;
    Modal.open({
      title: isEdit ? `Edit Tier: ${tier.name}` : 'New Pricing Plan',
      content: `
        <form id="form-pricing-tier-save">
          <div class="form-group">
            <label>Pricing Tier Name</label>
            <input type="text" name="name" required value="${tier?.name || ''}" placeholder="e.g. Wholesale Tier B" />
          </div>
          <div class="form-group">
            <label>Markup Rate Adjustment (%)</label>
            <input type="number" step="0.01" name="markup_percentage" value="${tier?.markup_percentage || 0}" required />
          </div>
          <div class="form-group">
            <label>Description / Rules</label>
            <input type="text" name="description" value="${tier?.description || ''}" placeholder="Targeted at bulk buyers" />
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:normal;">
              <input type="checkbox" name="is_active" ${tier?.is_active !== false ? 'checked' : ''} />
              Tier Active
            </label>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Tier' : 'Save Pricing Plan'}</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: formData.name,
          markup_percentage: parseFloat(formData.markup_percentage) || 0,
          description: formData.description,
          is_active: formData.is_active === 'on',
        };

        const { error } = isEdit
          ? await supabase.from('pricing_plans').update(payload).eq('id', tier.id)
          : await supabase.from('pricing_plans').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Pricing plan saved.');
          await loadActiveTab();
        }
      },
    });
  }

  // Bulk Price Change Modal
  async function openBulkPriceChangeModal() {
    const { data: categories } = await supabase.from('categories').select('id, name');
    const catOpts = `<option value="">-- Apply to All Catalog Items --</option>` + (categories || []).map((c) => `<option value="${c.id}">${c.name}</option>`).join('');

    Modal.open({
      title: 'Batch Catalog Price Adjustment',
      content: `
        <form id="form-bulk-price-change">
          <div class="form-group">
            <label>Target Category</label>
            <select name="category_id">${catOpts}</select>
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Adjustment Direction</label>
              <select name="change_type">
                <option value="increase">Price Increase (+)</option>
                <option value="decrease">Price Reduction (-)</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Percentage Rate (%)</label>
              <input type="number" step="0.1" min="0.1" max="100" name="percentage" required placeholder="5.0" />
            </div>
          </div>
          <p style="font-size:0.775rem; color:var(--text-muted); margin-bottom:16px;">
            This operation will recalculate retail prices across matching items.
          </p>
          <button type="submit" class="btn btn-accent btn-block">Confirm & Execute Price Change</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const pct = parseFloat(formData.percentage) / 100;
        const multiplier = formData.change_type === 'increase' ? (1 + pct) : (1 - pct);

        let query = supabase.from('products').select('id, retail_price');
        if (formData.category_id) query = query.eq('category_id', formData.category_id);
        if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

        const { data: productsToUpdate, error: fetchErr } = await query;
        if (fetchErr || !productsToUpdate?.length) {
          Toast.error('No matching items found to update.');
          return;
        }

        let updatedCount = 0;
        for (const prod of productsToUpdate) {
          const newPrice = Math.round((Number(prod.retail_price) * multiplier) * 100) / 100;
          const { error: updErr } = await supabase
            .from('products')
            .update({ retail_price: newPrice, updated_at: new Date().toISOString() })
            .eq('id', prod.id);

          if (!updErr) updatedCount++;
        }

        await supabase.from('price_change_logs').insert([{
          shop_id: globalState.activeShopId,
          adjusted_by: globalState.user?.id,
          category_id: formData.category_id || null,
          change_type: formData.change_type,
          percentage: parseFloat(formData.percentage),
          items_affected: updatedCount,
        }]);

        Toast.success(`Updated retail pricing on ${updatedCount} items.`);
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();
  return () => {};
}