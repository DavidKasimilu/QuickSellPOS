import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Goods Received Notes (GRN)</h3>
        <span class="badge badge-teal" id="grn-count-badge">0 notes</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-create-grn">
          <i data-lucide="plus-circle" style="width:16px; height:16px; margin-right:6px;"></i> Create GRN
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="grn-table-content"></div>
    </div>
  `;

  document.getElementById('btn-create-grn').onclick = () => openGRNModal();

  async function loadGoodsReceivedNotes() {
    const tableArea = document.getElementById('grn-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading Goods Received Notes...</p>`;

    let query = supabase
      .from('goods_received_notes')
      .select('*, purchase_orders(po_number), suppliers(name), profiles(full_name)')
      .order('received_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: grns, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('grn-count-badge');
    if (countBadge) countBadge.textContent = `${grns?.length || 0} notes`;

    renderDataTable({
      targetId: 'grn-table-content',
      columns: [
        { label: 'GRN Number', key: 'grn_number', render: (val) => `<strong>${val}</strong>` },
        { label: 'PO Reference', key: 'purchase_orders', render: (po) => po?.po_number ? `<code>${po.po_number}</code>` : '-' },
        { label: 'Supplier', key: 'suppliers', render: (sup) => sup?.name || 'General Supplier' },
        { label: 'Delivery Note #', key: 'delivery_note_no', render: (dn) => dn || '-' },
        { label: 'Received By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Received Date', key: 'received_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: grns || [],
      onAction: (action, id) => {
        const item = grns.find((g) => g.id === id);
        if (action === 'edit' && item) openGRNDetailsModal(item);
        else if (action === 'delete' && item) deleteGRN(item.id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete GRN
  async function deleteGRN(grnId) {
    if (!confirm('Are you sure you want to delete this Goods Received Note? Associated items will also be removed.')) return;

    await supabase.from('grn_items').delete().eq('grn_id', grnId);
    
    const { error } = await supabase.from('goods_received_notes').delete().eq('id', grnId);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('GRN record deleted.');
      await loadGoodsReceivedNotes();
    }
  }

  // Create GRN Modal
  async function openGRNModal() {
    const [{ data: pos }, { data: suppliers }, { data: products }] = await Promise.all([
      supabase.from('purchase_orders').select('id, po_number, supplier_id').eq('shop_id', globalState.activeShopId),
      supabase.from('suppliers').select('id, name').order('name'),
      supabase.from('products').select('id, name, cost_price').eq('is_active', true).order('name')
    ]);

    const poOpts = `<option value="">-- Direct Receipt (No PO) --</option>` + 
      (pos || []).map((po) => `<option value="${po.id}">${po.po_number}</option>`).join('');

    const supplierOpts = (suppliers || []).map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    const grnNumber = `GRN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    Modal.open({
      title: 'Issue Goods Received Note (GRN)',
      content: `
        <form id="form-create-grn" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>GRN Number</label>
              <input type="text" name="grn_number" value="${grnNumber}" readonly class="input-disabled" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Purchase Order (Optional)</label>
              <select name="po_id">${poOpts}</select>
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Supplier</label>
              <select name="supplier_id" required>${supplierOpts}</select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Delivery Note #</label>
              <input type="text" name="delivery_note_no" placeholder="e.g. DN-9011" />
            </div>
          </div>

          <div class="form-group">
            <label>Inspection Notes</label>
            <input type="text" name="notes" placeholder="e.g. Goods inspected and confirmed intact" />
          </div>

          <hr style="margin:8px 0; border:0; border-top:1px solid var(--border-subtle);" />
          <h4 style="margin:0; font-size:0.9rem;">Received Items</h4>

          <div id="grn-items-container" style="display:flex; flex-direction:column; gap:8px;">
            <div class="grn-item-row" style="display:flex; gap:8px; align-items:center;">
              <select class="grn-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="grn-qty-input" placeholder="Qty Received" min="1" value="1" required style="flex:1;" />
              <input type="number" step="0.01" class="grn-cost-input" placeholder="Unit Cost" value="${products[0]?.cost_price || 0}" required style="flex:1;" />
            </div>
          </div>

          <button type="button" class="btn btn-outline btn-sm" id="btn-add-grn-row" style="align-self:flex-start;">+ Add Another Item</button>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:12px;">Confirm & Stock Up Inventory</button>
        </form>
      `,
      onOpen: () => {
        const rowContainer = document.getElementById('grn-items-container');
        const addRowBtn = document.getElementById('btn-add-grn-row');

        if (addRowBtn && rowContainer) {
          addRowBtn.onclick = () => {
            const newRow = document.createElement('div');
            newRow.className = 'grn-item-row';
            newRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:6px;';
            newRow.innerHTML = `
              <select class="grn-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="grn-qty-input" placeholder="Qty Received" min="1" value="1" required style="flex:1;" />
              <input type="number" step="0.01" class="grn-cost-input" placeholder="Unit Cost" value="${products[0]?.cost_price || 0}" required style="flex:1;" />
              <button type="button" class="btn btn-outline btn-sm text-danger btn-remove-row" style="padding:4px 8px;">&times;</button>
            `;
            
            newRow.querySelector('.btn-remove-row').onclick = () => newRow.remove();
            rowContainer.appendChild(newRow);
          };
        }
      },
      onSubmit: async (fd) => {
        const rows = document.querySelectorAll('.grn-item-row');
        const lineItems = [];

        rows.forEach((r) => {
          const prodId = r.querySelector('.grn-prod-select').value;
          const qty = parseFloat(r.querySelector('.grn-qty-input').value) || 0;
          const unitCost = parseFloat(r.querySelector('.grn-cost-input').value) || 0;

          lineItems.push({
            product_id: prodId,
            quantity_received: qty,
            unit_cost: unitCost,
          });
        });

        const grnPayload = {
          shop_id: globalState.activeShopId,
          grn_number: fd.grn_number,
          po_id: fd.po_id || null,
          supplier_id: fd.supplier_id,
          delivery_note_no: fd.delivery_note_no || null,
          notes: fd.notes || null,
          received_by: globalState.user?.id,
          received_at: new Date().toISOString(),
        };

        const { data: grnRes, error: grnErr } = await supabase
          .from('goods_received_notes')
          .insert([grnPayload])
          .select()
          .single();

        if (grnErr) {
          Toast.error(grnErr.message);
          return;
        }

        if (lineItems.length > 0 && grnRes) {
          const itemsPayload = lineItems.map((item) => ({
            ...item,
            grn_id: grnRes.id,
          }));

          await supabase.from('grn_items').insert(itemsPayload);

          // Update product stock levels automatically
          for (const item of lineItems) {
            const { data: inv } = await supabase
              .from('inventory')
              .select('id, quantity_on_hand')
              .eq('shop_id', globalState.activeShopId)
              .eq('product_id', item.product_id)
              .maybeSingle();

            if (inv) {
              await supabase
                .from('inventory')
                .update({
                  quantity_on_hand: Number(inv.quantity_on_hand || 0) + item.quantity_received,
                  updated_at: new Date().toISOString()
                })
                .eq('id', inv.id);
            }
          }
        }

        Toast.success('GRN recorded and inventory stocked up.');
        await loadGoodsReceivedNotes();
      },
    });
  }

  // View GRN Line Items Modal
  async function openGRNDetailsModal(grn) {
    const { data: items } = await supabase
      .from('grn_items')
      .select('*, products(name)')
      .eq('grn_id', grn.id);

    const itemsListHtml = (items || []).map((i) => `
      <tr>
        <td><strong>${i.products?.name || 'Product'}</strong></td>
        <td>${i.quantity_received}</td>
        <td>${Number(i.unit_cost).toLocaleString()} ${currency}</td>
        <td style="text-align:right;"><strong>${(Number(i.quantity_received) * Number(i.unit_cost)).toLocaleString()} ${currency}</strong></td>
      </tr>
    `).join('');

    Modal.open({
      title: `Goods Received Note: ${grn.grn_number}`,
      content: `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.875rem;">
            <span>Supplier: <strong>${grn.suppliers?.name || 'Supplier'}</strong></span>
            <span>Delivery Note #: <strong>${grn.delivery_note_no || 'N/A'}</strong></span>
          </div>

          <table class="data-table" style="width:100%; font-size:0.85rem; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty Received</th>
                <th>Unit Cost</th>
                <th style="text-align:right;">Total Cost</th>
              </tr>
            </thead>
            <tbody>${itemsListHtml || '<tr><td colspan="4">No line items</td></tr>'}</tbody>
          </table>
        </div>
      `,
      onSubmit: () => {},
    });
  }

  await loadGoodsReceivedNotes();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}