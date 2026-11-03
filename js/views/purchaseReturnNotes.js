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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Purchase Return Notes (PRN)</h3>
        <span class="badge badge-teal" id="prn-count-badge">0 notes</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-create-prn">
          <i data-lucide="plus-circle" style="width:16px; height:16px; margin-right:6px;"></i> Issue Return Note
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="prn-table-content"></div>
    </div>
  `;

  document.getElementById('btn-create-prn').onclick = () => openPRNModal();

  async function loadPurchaseReturnNotes() {
    const tableArea = document.getElementById('prn-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading Purchase Return Notes...</p>`;

    let query = supabase
      .from('purchase_return_notes')
      .select('*, suppliers(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: prns, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('prn-count-badge');
    if (countBadge) countBadge.textContent = `${prns?.length || 0} notes`;

    renderDataTable({
      targetId: 'prn-table-content',
      columns: [
        { label: 'PRN Reference', key: 'prn_number', render: (val) => `<strong>${val}</strong>` },
        { label: 'Supplier', key: 'suppliers', render: (sup) => sup?.name || 'General Supplier' },
        { 
          label: 'Status', 
          key: 'status', 
          render: (st) => {
            const status = (st || 'draft').toLowerCase();
            let badgeClass = 'badge';
            if (status === 'dispatched' || status === 'completed') badgeClass = 'badge badge-teal';
            else if (status === 'cancelled') badgeClass = 'badge text-danger';
            return `<span class="${badgeClass}">${status.toUpperCase()}</span>`;
          } 
        },
        { label: 'Return Reason', key: 'return_reason', render: (r) => r || '-' },
        { label: 'Issued By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Created Date', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: prns || [],
      onAction: (action, id) => {
        const item = prns.find((p) => p.id === id);
        if (action === 'edit' && item) openPRNDetailsModal(item);
        else if (action === 'delete' && item) deletePRN(item.id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete PRN
  async function deletePRN(prnId) {
    if (!confirm('Are you sure you want to delete this Purchase Return Note? Associated line items will be removed.')) return;

    await supabase.from('prn_items').delete().eq('prn_id', prnId);
    
    const { error } = await supabase.from('purchase_return_notes').delete().eq('id', prnId);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('PRN record deleted.');
      await loadPurchaseReturnNotes();
    }
  }

  // Create PRN Modal
  async function openPRNModal() {
    const [{ data: suppliers }, { data: products }] = await Promise.all([
      supabase.from('suppliers').select('id, name').order('name'),
      supabase.from('products').select('id, name, cost_price').eq('is_active', true).order('name')
    ]);

    if (!suppliers || !suppliers.length) {
      Toast.error('Please add at least one supplier before issuing a return note.');
      return;
    }

    const supplierOpts = suppliers.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    const prnNumber = `PRN-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    Modal.open({
      title: 'Issue Purchase Return Note (PRN)',
      content: `
        <form id="form-create-prn" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>PRN Number</label>
              <input type="text" name="prn_number" value="${prnNumber}" readonly class="input-disabled" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Target Supplier</label>
              <select name="supplier_id" required>${supplierOpts}</select>
            </div>
          </div>

          <div class="form-group">
            <label>Reason for Return</label>
            <input type="text" name="return_reason" placeholder="e.g. Damaged goods / Expired items / Incorrect specification" required />
          </div>

          <hr style="margin:8px 0; border:0; border-top:1px solid var(--border-subtle);" />
          <h4 style="margin:0; font-size:0.9rem;">Returned Line Items</h4>

          <div id="prn-items-container" style="display:flex; flex-direction:column; gap:8px;">
            <div class="prn-item-row" style="display:flex; gap:8px; align-items:center;">
              <select class="prn-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="prn-qty-input" placeholder="Qty Returned" min="1" value="1" required style="flex:1;" />
              <input type="number" step="0.01" class="prn-cost-input" placeholder="Unit Cost" value="${products[0]?.cost_price || 0}" required style="flex:1;" />
            </div>
          </div>

          <button type="button" class="btn btn-outline btn-sm" id="btn-add-prn-row" style="align-self:flex-start;">+ Add Another Item</button>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:12px;">Confirm Return & Deduct Stock</button>
        </form>
      `,
      onOpen: () => {
        const rowContainer = document.getElementById('prn-items-container');
        const addRowBtn = document.getElementById('btn-add-prn-row');

        if (addRowBtn && rowContainer) {
          addRowBtn.onclick = () => {
            const newRow = document.createElement('div');
            newRow.className = 'prn-item-row';
            newRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:6px;';
            newRow.innerHTML = `
              <select class="prn-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="prn-qty-input" placeholder="Qty Returned" min="1" value="1" required style="flex:1;" />
              <input type="number" step="0.01" class="prn-cost-input" placeholder="Unit Cost" value="${products[0]?.cost_price || 0}" required style="flex:1;" />
              <button type="button" class="btn btn-outline btn-sm text-danger btn-remove-row" style="padding:4px 8px;">&times;</button>
            `;
            
            newRow.querySelector('.btn-remove-row').onclick = () => newRow.remove();
            rowContainer.appendChild(newRow);
          };
        }
      },
      onSubmit: async (fd) => {
        const rows = document.querySelectorAll('.prn-item-row');
        const lineItems = [];

        rows.forEach((r) => {
          const prodId = r.querySelector('.prn-prod-select').value;
          const qty = parseFloat(r.querySelector('.prn-qty-input').value) || 0;
          const unitCost = parseFloat(r.querySelector('.prn-cost-input').value) || 0;

          lineItems.push({
            product_id: prodId,
            quantity: qty,
            unit_cost: unitCost,
          });
        });

        const prnPayload = {
          shop_id: globalState.activeShopId,
          prn_number: fd.prn_number,
          supplier_id: fd.supplier_id,
          return_reason: fd.return_reason || null,
          status: 'draft',
          created_by: globalState.user?.id,
          created_at: new Date().toISOString(),
        };

        const { data: prnRes, error: prnErr } = await supabase
          .from('purchase_return_notes')
          .insert([prnPayload])
          .select()
          .single();

        if (prnErr) {
          Toast.error(prnErr.message);
          return;
        }

        if (lineItems.length > 0 && prnRes) {
          const itemsPayload = lineItems.map((item) => ({
            ...item,
            prn_id: prnRes.id,
          }));

          await supabase.from('prn_items').insert(itemsPayload);

          // Deduct returned items from available inventory
          for (const item of lineItems) {
            const { data: inv } = await supabase
              .from('inventory')
              .select('id, quantity_on_hand')
              .eq('shop_id', globalState.activeShopId)
              .eq('product_id', item.product_id)
              .maybeSingle();

            if (inv) {
              const currentQty = Number(inv.quantity_on_hand || 0);
              await supabase
                .from('inventory')
                .update({
                  quantity_on_hand: Math.max(0, currentQty - item.quantity),
                  updated_at: new Date().toISOString()
                })
                .eq('id', inv.id);
            }
          }
        }

        Toast.success('Purchase Return Note issued and stock adjusted.');
        await loadPurchaseReturnNotes();
      },
    });
  }

  // View PRN Line Items Modal
  async function openPRNDetailsModal(prn) {
    const { data: items } = await supabase
      .from('prn_items')
      .select('*, products(name)')
      .eq('prn_id', prn.id);

    const itemsListHtml = (items || []).map((i) => `
      <tr>
        <td><strong>${i.products?.name || 'Product'}</strong></td>
        <td>${i.quantity}</td>
        <td>${Number(i.unit_cost).toLocaleString()} ${currency}</td>
        <td style="text-align:right;"><strong>${(Number(i.quantity) * Number(i.unit_cost)).toLocaleString()} ${currency}</strong></td>
      </tr>
    `).join('');

    Modal.open({
      title: `Purchase Return Note: ${prn.prn_number}`,
      content: `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.875rem;">
            <span>Supplier: <strong>${prn.suppliers?.name || 'Supplier'}</strong></span>
            <span>Reason: <strong>${prn.return_reason || 'N/A'}</strong></span>
          </div>

          <table class="data-table" style="width:100%; font-size:0.85rem; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty Returned</th>
                <th>Unit Cost</th>
                <th style="text-align:right;">Total Refund Value</th>
              </tr>
            </thead>
            <tbody>${itemsListHtml || '<tr><td colspan="4">No line items</td></tr>'}</tbody>
          </table>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span>Current Status: <strong style="text-transform:uppercase;">${prn.status}</strong></span>
            <select id="prn-status-update" class="form-select-sm">
              <option value="draft" ${prn.status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="dispatched" ${prn.status === 'dispatched' ? 'selected' : ''}>Dispatched</option>
              <option value="completed" ${prn.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="cancelled" ${prn.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>

          <button type="button" class="btn btn-teal-primary btn-block" id="btn-save-prn-status">Update Return Status</button>
        </div>
      `,
      onOpen: () => {
        document.getElementById('btn-save-prn-status').onclick = async () => {
          const newStatus = document.getElementById('prn-status-update').value;
          const { error } = await supabase
            .from('purchase_return_notes')
            .update({ status: newStatus, dispatched_at: newStatus === 'dispatched' ? new Date().toISOString() : null })
            .eq('id', prn.id);

          if (error) {
            Toast.error(error.message);
          } else {
            Toast.success('PRN status updated.');
            Modal.close();
            await loadPurchaseReturnNotes();
          }
        };
      },
      onSubmit: () => {},
    });
  }

  await loadPurchaseReturnNotes();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}