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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Productions & Manufacturing</h3>
        <span class="badge badge-teal" id="productions-count-badge">0 batches</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-record-production">
          <i data-lucide="factory" style="width:16px; height:16px; margin-right:6px;"></i> Record Production Batch
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="productions-table-content"></div>
    </div>
  `;

  document.getElementById('btn-record-production').onclick = () => openProductionModal();

  async function loadProductions() {
    const tableArea = document.getElementById('productions-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading production batch logs...</p>`;

    let query = supabase
      .from('productions')
      .select('*, products(name, barcode), profiles(full_name)')
      .order('production_date', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: batches, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('productions-count-badge');
    if (countBadge) countBadge.textContent = `${batches?.length || 0} batches`;

    renderDataTable({
      targetId: 'productions-table-content',
      columns: [
        { label: 'Batch #', key: 'batch_number', render: (val) => `<strong>${val}</strong>` },
        { 
          label: 'Produced Product', 
          key: 'products', 
          render: (p) => `<strong>${p?.name || 'Finished Good'}</strong> <div style="font-size:0.75rem; color:var(--text-muted);">${p?.barcode || ''}</div>` 
        },
        { 
          label: 'Quantity Output', 
          key: 'quantity_produced', 
          render: (qty) => `<span class="badge badge-teal" style="font-weight:700;">+${qty} units</span>` 
        },
        { label: 'Notes', key: 'notes', render: (n) => n || '-' },
        { label: 'Recorded By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Production Date', key: 'production_date', render: (d) => new Date(d).toLocaleString() },
      ],
      data: batches || [],
      onAction: (action, id) => {
        if (action === 'delete') deleteProductionBatch(id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete Production Record
  async function deleteProductionBatch(batchId) {
    if (!confirm('Are you sure you want to delete this production batch record? Note: Stock levels will not be reverted automatically.')) return;

    const { error } = await supabase.from('productions').delete().eq('id', batchId);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('Production batch log deleted.');
      await loadProductions();
    }
  }

  // Record Production Batch Modal
  async function openProductionModal() {
    let query = supabase.from('products').select('id, name, barcode').eq('is_active', true).is('deleted_at', null).order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: products } = await query;

    if (!products || !products.length) {
      Toast.error('No finished goods / products found in the catalog.');
      return;
    }

    const productOpts = products.map((p) => `<option value="${p.id}">${p.name} (${p.barcode || 'No Code'})</option>`).join('');
    const batchNumber = `BAT-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    Modal.open({
      title: 'Record Production Batch',
      content: `
        <form id="form-create-production" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Batch Reference #</label>
            <input type="text" name="batch_number" value="${batchNumber}" readonly class="input-disabled" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:2;">
              <label>Select Produced Good</label>
              <select name="product_id" required>${productOpts}</select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Quantity Yield</label>
              <input type="number" step="0.01" min="0.01" name="quantity_produced" placeholder="e.g. 50" required />
            </div>
          </div>

          <div class="form-group">
            <label>Batch Notes / Manufacturing Remarks</label>
            <input type="text" name="notes" placeholder="e.g. Morning bakery production run" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Save Batch & Increase Stock</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const prodId = fd.product_id;
        const qtyProduced = parseFloat(fd.quantity_produced) || 0;

        const batchPayload = {
          shop_id: globalState.activeShopId,
          batch_number: fd.batch_number,
          product_id: prodId,
          quantity_produced: qtyProduced,
          notes: fd.notes || null,
          created_by: globalState.user?.id,
          production_date: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        // 1. Insert Production Record
        const { error: batchErr } = await supabase.from('productions').insert([batchPayload]);

        if (batchErr) {
          Toast.error(batchErr.message);
          return;
        }

        // 2. Increase Inventory Stock for Produced Finished Product
        const { data: inv } = await supabase
          .from('inventory')
          .select('id, quantity_on_hand')
          .eq('shop_id', globalState.activeShopId)
          .eq('product_id', prodId)
          .maybeSingle();

        if (inv) {
          const currentQty = Number(inv.quantity_on_hand || 0);
          await supabase
            .from('inventory')
            .update({ quantity_on_hand: currentQty + qtyProduced, updated_at: new Date().toISOString() })
            .eq('id', inv.id);
        } else {
          await supabase.from('inventory').insert([{
            shop_id: globalState.activeShopId,
            product_id: prodId,
            quantity_on_hand: qtyProduced,
            updated_at: new Date().toISOString(),
          }]);
        }

        Toast.success('Production batch saved and finished product stock increased.');
        await loadProductions();
      },
    });
  }

  await loadProductions();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}