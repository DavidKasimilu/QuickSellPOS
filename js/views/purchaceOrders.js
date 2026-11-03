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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Purchase Orders (PO)</h3>
        <span class="badge badge-teal" id="po-count-badge">0 orders</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-create-po">
          <i data-lucide="plus-circle" style="width:16px; height:16px; margin-right:6px;"></i> Create Purchase Order
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="po-table-content"></div>
    </div>
  `;

  document.getElementById('btn-create-po').onclick = () => openPurchaseOrderModal();

  async function loadPurchaseOrders() {
    const tableArea = document.getElementById('po-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading purchase orders...</p>`;

    let query = supabase
      .from('purchase_orders')
      .select('*, suppliers(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: pos, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('po-count-badge');
    if (countBadge) countBadge.textContent = `${pos?.length || 0} orders`;

    renderDataTable({
      targetId: 'po-table-content',
      columns: [
        { label: 'PO Reference', key: 'po_number', render: (val) => `<strong>${val}</strong>` },
        { label: 'Supplier', key: 'suppliers', render: (sup) => sup?.name || 'General Supplier' },
        { 
          label: 'Status', 
          key: 'status', 
          render: (st) => {
            const status = (st || 'draft').toLowerCase();
            let badgeClass = 'badge';
            if (status === 'received' || status === 'completed') badgeClass = 'badge badge-teal';
            else if (status === 'cancelled') badgeClass = 'badge text-danger';
            return `<span class="${badgeClass}">${status.toUpperCase()}</span>`;
          } 
        },
        { 
          label: 'Total Amount', 
          key: 'total_amount', 
          render: (v) => `<strong>${Number(v || 0).toLocaleString()} ${currency}</strong>` 
        },
        { label: 'Created By', key: 'profiles', render: (p) => p?.full_name || 'System' },
        { label: 'Order Date', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: pos || [],
      onAction: (action, id) => {
        const item = pos.find((p) => p.id === id);
        if (action === 'edit' && item) openPOItemsModal(item);
        else if (action === 'delete' && item) deletePurchaseOrder(item.id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete Purchase Order
  async function deletePurchaseOrder(poId) {
    if (!confirm('Are you sure you want to delete this purchase order?')) return;

    // Delete PO items first
    await supabase.from('purchase_order_items').delete().eq('po_id', poId);
    
    const { error } = await supabase.from('purchase_orders').delete().eq('id', poId);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('Purchase order deleted.');
      await loadPurchaseOrders();
    }
  }

  // Create PO Modal
  async function openPurchaseOrderModal() {
    const [{ data: suppliers }, { data: products }] = await Promise.all([
      supabase.from('suppliers').select('id, name').order('name'),
      supabase.from('products').select('id, name, cost_price').eq('is_active', true).order('name')
    ]);

    if (!suppliers || !suppliers.length) {
      Toast.error('Please create at least one supplier before issuing a purchase order.');
      return;
    }

    const supplierOpts = suppliers.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    const poNumber = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    Modal.open({
      title: 'Create Purchase Order (PO)',
      content: `
        <form id="form-create-po" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>PO Number</label>
              <input type="text" name="po_number" value="${poNumber}" readonly class="input-disabled" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Select Supplier</label>
              <select name="supplier_id" required>${supplierOpts}</select>
            </div>
          </div>

          <div class="form-group">
            <label>Order Notes / Terms</label>
            <input type="text" name="notes" placeholder="e.g. Expected delivery within 5 business days" />
          </div>

          <hr style="margin:8px 0; border:0; border-top:1px solid var(--border-subtle);" />
          <h4 style="margin:0; font-size:0.9rem;">Order Line Items</h4>

          <div id="po-items-container" style="display:flex; flex-direction:column; gap:8px;">
            <div class="po-item-row" style="display:flex; gap:8px; align-items:center;">
              <select class="po-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="po-qty-input" placeholder="Qty" min="1" value="1" required style="flex:1;" />
              <input type="number" step="0.01" class="po-cost-input" placeholder="Unit Cost" value="${products[0]?.cost_price || 0}" required style="flex:1;" />
            </div>
          </div>

          <button type="button" class="btn btn-outline btn-sm" id="btn-add-po-row" style="align-self:flex-start;">+ Add Another Item</button>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:12px;">Save & Issue Purchase Order</button>
        </form>
      `,
      onOpen: () => {
        const rowContainer = document.getElementById('po-items-container');
        const addRowBtn = document.getElementById('btn-add-po-row');

        if (addRowBtn && rowContainer) {
          addRowBtn.onclick = () => {
            const newRow = document.createElement('div');
            newRow.className = 'po-item-row';
            newRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:6px;';
            newRow.innerHTML = `
              <select class="po-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}" data-cost="${p.cost_price}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="po-qty-input" placeholder="Qty" min="1" value="1" required style="flex:1;" />
              <input type="number" step="0.01" class="po-cost-input" placeholder="Unit Cost" value="${products[0]?.cost_price || 0}" required style="flex:1;" />
              <button type="button" class="btn btn-outline btn-sm text-danger btn-remove-row" style="padding:4px 8px;">&times;</button>
            `;
            
            newRow.querySelector('.btn-remove-row').onclick = () => newRow.remove();
            rowContainer.appendChild(newRow);
          };
        }
      },
      onSubmit: async (fd) => {
        const rows = document.querySelectorAll('.po-item-row');
        let totalAmount = 0;
        const lineItems = [];

        rows.forEach((r) => {
          const prodId = r.querySelector('.po-prod-select').value;
          const qty = parseFloat(r.querySelector('.po-qty-input').value) || 0;
          const unitCost = parseFloat(r.querySelector('.po-cost-input').value) || 0;
          const totalCost = qty * unitCost;

          totalAmount += totalCost;
          lineItems.push({
            product_id: prodId,
            quantity_ordered: qty,
            unit_cost: unitCost,
            total_cost: totalCost,
          });
        });

        const poPayload = {
          shop_id: globalState.activeShopId,
          po_number: fd.po_number,
          supplier_id: fd.supplier_id,
          notes: fd.notes || null,
          total_amount: totalAmount,
          status: 'draft',
          created_by: globalState.user?.id,
          created_at: new Date().toISOString(),
        };

        const { data: poRes, error: poErr } = await supabase
          .from('purchase_orders')
          .insert([poPayload])
          .select()
          .single();

        if (poErr) {
          Toast.error(poErr.message);
          return;
        }

        if (lineItems.length > 0 && poRes) {
          const itemsPayload = lineItems.map((item) => ({
            ...item,
            po_id: poRes.id,
          }));

          await supabase.from('purchase_order_items').insert(itemsPayload);
        }

        Toast.success('Purchase order created successfully.');
        await loadPurchaseOrders();
      },
    });
  }

  // View / Edit PO Details Modal
  async function openPOItemsModal(po) {
    const { data: items } = await supabase
      .from('purchase_order_items')
      .select('*, products(name)')
      .eq('po_id', po.id);

    const itemsListHtml = (items || []).map((i) => `
      <tr>
        <td><strong>${i.products?.name || 'Product'}</strong></td>
        <td>${i.quantity_ordered}</td>
        <td>${Number(i.unit_cost).toLocaleString()} ${currency}</td>
        <td style="text-align:right;"><strong>${Number(i.total_cost).toLocaleString()} ${currency}</strong></td>
      </tr>
    `).join('');

    Modal.open({
      title: `Purchase Order details: ${po.po_number}`,
      content: `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.875rem;">
            <span>Supplier: <strong>${po.suppliers?.name || 'Supplier'}</strong></span>
            <span>Status: <strong style="text-transform:uppercase;">${po.status}</strong></span>
          </div>

          <table class="data-table" style="width:100%; font-size:0.85rem; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Product</th>
                <th>Qty Ordered</th>
                <th>Unit Cost</th>
                <th style="text-align:right;">Total</th>
              </tr>
            </thead>
            <tbody>${itemsListHtml || '<tr><td colspan="4">No line items</td></tr>'}</tbody>
          </table>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span>Total Value: <strong>${Number(po.total_amount).toLocaleString()} ${currency}</strong></span>
            
            <select id="po-status-update" class="form-select-sm">
              <option value="draft" ${po.status === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="pending" ${po.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="received" ${po.status === 'received' ? 'selected' : ''}>Received</option>
              <option value="cancelled" ${po.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
          
          <button type="button" class="btn btn-teal-primary btn-block" id="btn-save-po-status">Update Status</button>
        </div>
      `,
      onOpen: () => {
        document.getElementById('btn-save-po-status').onclick = async () => {
          const newStatus = document.getElementById('po-status-update').value;
          const { error } = await supabase
            .from('purchase_orders')
            .update({ status: newStatus, updated_at: new Date().toISOString() })
            .eq('id', po.id);

          if (error) {
            Toast.error(error.message);
          } else {
            Toast.success('PO status updated.');
            Modal.close();
            await loadPurchaseOrders();
          }
        };
      },
      onSubmit: () => {},
    });
  }

  await loadPurchaseOrders();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}