import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Stock Adjustments (SA)</h3>
        <span class="badge badge-teal" id="sa-count-badge">0 records</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-create-sa">
          <i data-lucide="sliders" style="width:16px; height:16px; margin-right:6px;"></i> Post Stock Adjustment
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="sa-table-content"></div>
    </div>
  `;

  document.getElementById('btn-create-sa').onclick = () => openStockAdjustmentModal();

  async function loadStockAdjustments() {
    const tableArea = document.getElementById('sa-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading Stock Adjustments log...</p>`;

    let query = supabase
      .from('stock_adjustments')
      .select('*, products(name, barcode), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: adjustments, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('sa-count-badge');
    if (countBadge) countBadge.textContent = `${adjustments?.length || 0} records`;

    renderDataTable({
      targetId: 'sa-table-content',
      columns: [
        { label: 'Product Item', key: 'products', render: (p) => `<strong>${p?.name || 'Product'}</strong> <div style="font-size:0.75rem; color:var(--text-muted);">${p?.barcode || ''}</div>` },
        { 
          label: 'Adjustment Type', 
          key: 'adjustment_type', 
          render: (type) => {
            const t = (type || 'addition').toLowerCase();
            let badgeClass = 'badge badge-teal';
            if (t.includes('damage') || t.includes('loss') || t.includes('deduction')) badgeClass = 'badge text-danger';
            return `<span class="${badgeClass}">${t.toUpperCase()}</span>`;
          } 
        },
        { 
          label: 'Stock Delta', 
          key: 'quantity_delta', 
          render: (delta) => {
            const val = Number(delta || 0);
            const color = val >= 0 ? 'var(--teal-600)' : 'var(--color-danger)';
            return `<strong style="color:${color};">${val > 0 ? `+${val}` : val}</strong>`;
          } 
        },
        { label: 'Reason / Remarks', key: 'reason', render: (r) => r || 'Manual Adjustment' },
        { label: 'Adjusted By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: adjustments || [],
      onAction: (action, id) => {
        if (action === 'delete') deleteStockAdjustment(id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete Stock Adjustment Record
  async function deleteStockAdjustment(id) {
    if (!confirm('Are you sure you want to delete this adjustment record? Note: Stock levels will not be reverted automatically.')) return;

    const { error } = await supabase.from('stock_adjustments').delete().eq('id', id);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('Stock adjustment log deleted.');
      await loadStockAdjustments();
    }
  }

  // Post Stock Adjustment Modal
  async function openStockAdjustmentModal() {
    let query = supabase.from('products').select('id, name, barcode').eq('is_active', true).is('deleted_at', null).order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: products } = await query;

    if (!products || !products.length) {
      Toast.error('No products found in the catalog to perform adjustments.');
      return;
    }

    const productOpts = products.map((p) => `<option value="${p.id}">${p.name} (${p.barcode || 'No Barcode'})</option>`).join('');

    Modal.open({
      title: 'Post Stock Adjustment (SA)',
      content: `
        <form id="form-create-sa" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Product</label>
            <select name="product_id" id="sa-prod-select" required>${productOpts}</select>
          </div>

          <div id="sa-current-stock-info" style="font-size:0.85rem; color:var(--text-muted); background:var(--teal-50); padding:8px 12px; border-radius:4px;">
            Current Stock on Hand: <strong id="sa-stock-qty-val">Loading...</strong>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Adjustment Type</label>
              <select name="adjustment_type" id="sa-type-select" required>
                <option value="Addition">Addition (+) Stock Received / Found</option>
                <option value="Deduction">Deduction (-) Stock Discrepancy</option>
                <option value="Damage">Damage (-) Broken / Expired Goods</option>
                <option value="Loss">Loss / Theft (-)</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Quantity Delta</label>
              <input type="number" step="0.01" min="0.01" name="quantity_val" placeholder="e.g. 5" required />
            </div>
          </div>

          <div class="form-group">
            <label>Adjustment Reason</label>
            <input type="text" name="reason" placeholder="e.g. Broken packaging during transit" required />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Apply & Update Inventory</button>
        </form>
      `,
      onOpen: async () => {
        const prodSelect = document.getElementById('sa-prod-select');
        const stockValEl = document.getElementById('sa-stock-qty-val');

        async function updateCurrentStock() {
          if (!prodSelect || !stockValEl) return;
          const selectedId = prodSelect.value;
          
          const { data: inv } = await supabase
            .from('inventory')
            .select('quantity_on_hand')
            .eq('shop_id', globalState.activeShopId)
            .eq('product_id', selectedId)
            .maybeSingle();

          stockValEl.textContent = `${inv?.quantity_on_hand || 0} units`;
        }

        if (prodSelect) {
          prodSelect.onchange = () => updateCurrentStock();
          await updateCurrentStock();
        }
      },
      onSubmit: async (fd) => {
        const prodId = fd.product_id;
        const adjType = fd.adjustment_type;
        const rawQty = parseFloat(fd.quantity_val) || 0;

        // Determine + or - sign for quantity delta
        const isNegative = adjType === 'Deduction' || adjType === 'Damage' || adjType === 'Loss';
        const qtyDelta = isNegative ? -Math.abs(rawQty) : Math.abs(rawQty);

        const saPayload = {
          shop_id: globalState.activeShopId,
          product_id: prodId,
          adjustment_type: adjType,
          quantity_delta: qtyDelta,
          reason: fd.reason,
          adjusted_by: globalState.user?.id,
          created_at: new Date().toISOString(),
        };

        // 1. Insert Stock Adjustment Log
        const { error: saErr } = await supabase.from('stock_adjustments').insert([saPayload]);

        if (saErr) {
          Toast.error(saErr.message);
          return;
        }

        // 2. Update Product Inventory Table
        const { data: inv } = await supabase
          .from('inventory')
          .select('id, quantity_on_hand')
          .eq('shop_id', globalState.activeShopId)
          .eq('product_id', prodId)
          .maybeSingle();

        if (inv) {
          const newQty = Math.max(0, Number(inv.quantity_on_hand || 0) + qtyDelta);
          await supabase
            .from('inventory')
            .update({ quantity_on_hand: newQty, updated_at: new Date().toISOString() })
            .eq('id', inv.id);
        } else {
          await supabase.from('inventory').insert([{
            shop_id: globalState.activeShopId,
            product_id: prodId,
            quantity_on_hand: Math.max(0, qtyDelta),
            updated_at: new Date().toISOString(),
          }]);
        }

        Toast.success('Stock adjustment applied and inventory updated.');
        await loadStockAdjustments();
      },
    });
  }

  await loadStockAdjustments();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}