import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'tiers'; // 'tiers' | 'rules'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Pricing Plans & Wholesale Tiers</h3>
      </div>
      <div id="pricing-actions-container"></div>
    </div>

    <!-- Navigation Sub-tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-pricing-tab="tiers">Pricing Tier Lists</button>
      <button class="date-chip" data-pricing-tab="rules">Product Tier Rates</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="pricing-table-content"></div>
    </div>
  `;

  // Bind sub-tabs
  container.querySelectorAll('[data-pricing-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-pricing-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.pricingTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('pricing-actions-container');
    const tableArea = document.getElementById('pricing-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    if (activeTab === 'tiers') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-add-pricing-tier">
          <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Create Price Tier List
        </button>
      `;
      document.getElementById('btn-add-pricing-tier').onclick = () => openPricingTierModal();
      await renderPricingTiersTable(tableArea);
    } else {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-add-product-tier">
          <i data-lucide="tag" style="width:16px; height:16px; margin-right:6px;"></i> Assign Product Price
        </button>
      `;
      document.getElementById('btn-add-product-tier').onclick = () => openProductTierRateModal();
      await renderProductTierRatesTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Pricing Tier Lists
  // =========================================================================
  async function renderPricingTiersTable(target) {
    let query = supabase
      .from('pricing_tiers')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: tiers, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'pricing-table-content',
      columns: [
        { label: 'Tier Plan Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'System Code', key: 'code', render: (c) => `<code>${c || '-'}</code>` },
        { label: 'Description', key: 'description', render: (d) => d || '-' },
        { 
          label: 'Default Discount Offset', 
          key: 'default_discount_pct', 
          render: (pct) => `${pct || 0}%` 
        },
        { 
          label: 'Status', 
          key: 'is_active', 
          render: (act) => act ? '<span class="badge badge-teal">ACTIVE</span>' : '<span class="badge">INACTIVE</span>' 
        },
      ],
      data: tiers || [],
      onAction: (action, id) => {
        const item = tiers.find((t) => t.id === id);
        if (action === 'edit' && item) openPricingTierModal(item);
        else if (action === 'delete' && item) confirmSoftDeletePricingTier(item);
      },
    });
  }

  // =========================================================================
  // 2. Product Tier Rates Table
  // =========================================================================
  async function renderProductTierRatesTable(target) {
    let query = supabase
      .from('product_pricing_rates')
      .select('*, products(name, barcode, retail_price), pricing_tiers(name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: rates, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'pricing-table-content',
      columns: [
        { label: 'Product Item', key: 'products', render: (p) => `<strong>${p?.name || 'Product'}</strong>` },
        { label: 'Target Price Tier', key: 'pricing_tiers', render: (t) => `<span class="badge">${t?.name || 'Tier'}</span>` },
        { label: 'Standard Retail Price', key: 'products', render: (p) => `${Number(p?.retail_price || 0).toLocaleString()} ${currency}` },
        { 
          label: 'Special Tier Price', 
          key: 'tier_price', 
          render: (price) => `<strong style="color:var(--teal-600);">${Number(price || 0).toLocaleString()} ${currency}</strong>` 
        },
        { label: 'Min Wholesale Qty', key: 'min_quantity', render: (q) => `${q || 1} units` },
      ],
      data: rates || [],
      onAction: (action, id) => {
        const item = rates.find((r) => r.id === id);
        if (action === 'edit' && item) openProductTierRateModal(item);
        else if (action === 'delete' && item) deleteProductTierRate(item.id);
      },
    });
  }

  // =========================================================================
  // Modals
  // =========================================================================
  function openPricingTierModal(tier = null) {
    const isEdit = !!tier;

    Modal.open({
      title: isEdit ? `Edit Pricing Tier: ${tier.name}` : 'Create Pricing Tier',
      content: `
        <form id="form-pricing-tier-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Price Tier Name</label>
            <input type="text" name="name" required value="${tier?.name || ''}" placeholder="e.g. Wholesale Tier / VIP Member Rate" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Tier Code</label>
              <input type="text" name="code" value="${tier?.code || ''}" placeholder="WHOLESALE-01" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Default Discount Offset (%)</label>
              <input type="number" step="0.1" name="default_discount_pct" value="${tier?.default_discount_pct || 0}" placeholder="0" />
            </div>
          </div>

          <div class="form-group">
            <label>Description / Notes</label>
            <input type="text" name="description" value="${tier?.description || ''}" placeholder="Applies to bulk purchases over 50 units" />
          </div>

          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="is_active" ${tier?.is_active !== false ? 'checked' : ''} />
              Enable active pricing tier
            </label>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Tier' : 'Save Pricing Tier'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          code: fd.code ? fd.code.toUpperCase().trim() : null,
          default_discount_pct: parseFloat(fd.default_discount_pct) || 0,
          description: fd.description || null,
          is_active: fd.is_active === 'on',
          updated_at: new Date().toISOString(),
        };

        const { error } = isEdit
          ? await supabase.from('pricing_tiers').update(payload).eq('id', tier.id)
          : await supabase.from('pricing_tiers').insert([{ ...payload, created_at: new Date().toISOString() }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Pricing tier saved.');
          await loadActiveTab();
        }
      },
    });
  }

  async function openProductTierRateModal(rate = null) {
    const isEdit = !!rate;

    const [{ data: products }, { data: tiers }] = await Promise.all([
      supabase.from('products').select('id, name, retail_price').eq('is_active', true).is('deleted_at', null).order('name'),
      supabase.from('pricing_tiers').select('id, name').is('deleted_at', null).order('name'),
    ]);

    if (!products || !products.length) {
      Toast.error('No products available in catalog.');
      return;
    }
    if (!tiers || !tiers.length) {
      Toast.error('Please create at least one pricing tier first.');
      return;
    }

    const prodOpts = products.map((p) => 
      `<option value="${p.id}" ${rate?.product_id === p.id ? 'selected' : ''}>${p.name} (Std: ${Number(p.retail_price || 0).toLocaleString()} ${currency})</option>`
    ).join('');

    const tierOpts = tiers.map((t) => 
      `<option value="${t.id}" ${rate?.tier_id === t.id ? 'selected' : ''}>${t.name}</option>`
    ).join('');

    Modal.open({
      title: isEdit ? 'Edit Product Tier Rate' : 'Assign Special Product Rate',
      content: `
        <form id="form-product-rate-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Product</label>
            <select name="product_id" required>${prodOpts}</select>
          </div>

          <div class="form-group">
            <label>Target Pricing Tier</label>
            <select name="tier_id" required>${tierOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Special Tier Price (${currency})</label>
              <input type="number" step="0.01" min="0" name="tier_price" value="${rate?.tier_price || ''}" required placeholder="0.00" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Min Minimum Quantity</label>
              <input type="number" min="1" name="min_quantity" value="${rate?.min_quantity || 1}" required />
            </div>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Rate' : 'Save Product Rate'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          product_id: fd.product_id,
          tier_id: fd.tier_id,
          tier_price: parseFloat(fd.tier_price) || 0,
          min_quantity: parseInt(fd.min_quantity) || 1,
          updated_at: new Date().toISOString(),
        };

        const { error } = isEdit
          ? await supabase.from('product_pricing_rates').update(payload).eq('id', rate.id)
          : await supabase.from('product_pricing_rates').insert([{ ...payload, created_at: new Date().toISOString() }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Product tier rate saved.');
          await loadActiveTab();
        }
      },
    });
  }

  async function confirmSoftDeletePricingTier(tier) {
    if (!confirm(`Are you sure you want to delete pricing tier "${tier.name}"?`)) return;

    const { error } = await supabase
      .from('pricing_tiers')
      .update({ is_active: false, deleted_at: new Date().toISOString() })
      .eq('id', tier.id);

    if (error) Toast.error(error.message);
    else {
      Toast.success(`Pricing tier "${tier.name}" removed.`);
      await loadActiveTab();
    }
  }

  async function deleteProductTierRate(rateId) {
    if (!confirm('Are you sure you want to delete this special price rate?')) return;
    const { error } = await supabase.from('product_pricing_rates').delete().eq('id', rateId);

    if (error) Toast.error(error.message);
    else {
      Toast.success('Product price rate removed.');
      await loadActiveTab();
    }
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}