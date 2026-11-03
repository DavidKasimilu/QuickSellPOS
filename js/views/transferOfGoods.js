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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Transfer of Goods (TOG)</h3>
        <span class="badge badge-teal" id="tog-count-badge">0 transfers</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-create-tog">
          <i data-lucide="arrow-right-left" style="width:16px; height:16px; margin-right:6px;"></i> Initiate Goods Transfer
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="tog-table-content"></div>
    </div>
  `;

  document.getElementById('btn-create-tog').onclick = () => openStockTransferModal();

  async function loadStockTransfers() {
    const tableArea = document.getElementById('tog-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading Stock Transfers log...</p>`;

    let query = supabase
      .from('stock_transfers')
      .select('*, source_shop:shops!source_shop_id(name), target_shop:shops!target_shop_id(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.or(`source_shop_id.eq.${globalState.activeShopId},target_shop_id.eq.${globalState.activeShopId}`);
    }

    const { data: transfers, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('tog-count-badge');
    if (countBadge) countBadge.textContent = `${transfers?.length || 0} transfers`;

    renderDataTable({
      targetId: 'tog-table-content',
      columns: [
        { label: 'Transfer #', key: 'transfer_number', render: (val) => `<strong>${val}</strong>` },
        { label: 'Origin Branch', key: 'source_shop', render: (s) => s?.name || 'Main Branch' },
        { label: 'Destination Branch', key: 'target_shop', render: (s) => s?.name || 'Branch Store' },
        { 
          label: 'Status', 
          key: 'status', 
          render: (st) => {
            const status = (st || 'pending').toLowerCase();
            let badgeClass = 'badge';
            if (status === 'completed') badgeClass = 'badge badge-teal';
            else if (status === 'cancelled') badgeClass = 'badge text-danger';
            return `<span class="${badgeClass}">${status.toUpperCase()}</span>`;
          } 
        },
        { label: 'Initiated By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Created Date', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: transfers || [],
      onAction: (action, id) => {
        const item = transfers.find((t) => t.id === id);
        if (action === 'edit' && item) openTransferDetailsModal(item);
        else if (action === 'delete' && item) deleteTransfer(item.id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete Transfer
  async function deleteTransfer(transferId) {
    if (!confirm('Are you sure you want to delete this stock transfer record?')) return;

    await supabase.from('stock_transfer_items').delete().eq('transfer_id', transferId);
    
    const { error } = await supabase.from('stock_transfers').delete().eq('id', transferId);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('Stock transfer record deleted.');
      await loadStockTransfers();
    }
  }

  // Initiate Transfer Modal
  async function openStockTransferModal() {
    const [{ data: shops }, { data: products }] = await Promise.all([
      supabase.from('shops').select('id, name').order('name'),
      supabase.from('products').select('id, name').eq('is_active', true).is('deleted_at', null).order('name')
    ]);

    if (!shops || shops.length < 2) {
      Toast.error('You need at least two store branches registered to initiate stock transfers.');
      return;
    }

    const sourceShopOpts = shops.map((s) => 
      `<option value="${s.id}" ${globalState.activeShopId === s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const targetShopOpts = shops.map((s) => 
      `<option value="${s.id}" ${globalState.activeShopId !== s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    const transferNo = `TOG-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    Modal.open({
      title: 'Initiate Goods Transfer (TOG)',
      content: `
        <form id="form-create-tog" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Transfer Reference #</label>
            <input type="text" name="transfer_number" value="${transferNo}" readonly class="input-disabled" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Source Branch (From)</label>
              <select name="source_shop_id" required>${sourceShopOpts}</select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Target Branch (To)</label>
              <select name="target_shop_id" required>${targetShopOpts}</select>
            </div>
          </div>

          <hr style="margin:8px 0; border:0; border-top:1px solid var(--border-subtle);" />
          <h4 style="margin:0; font-size:0.9rem;">Transfer Items</h4>

          <div id="tog-items-container" style="display:flex; flex-direction:column; gap:8px;">
            <div class="tog-item-row" style="display:flex; gap:8px; align-items:center;">
              <select class="tog-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="tog-qty-input" placeholder="Quantity" min="1" value="1" required style="flex:1;" />
            </div>
          </div>

          <button type="button" class="btn btn-outline btn-sm" id="btn-add-tog-row" style="align-self:flex-start;">+ Add Another Item</button>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:12px;">Submit Transfer</button>
        </form>
      `,
      onOpen: () => {
        const rowContainer = document.getElementById('tog-items-container');
        const addRowBtn = document.getElementById('btn-add-tog-row');

        if (addRowBtn && rowContainer) {
          addRowBtn.onclick = () => {
            const newRow = document.createElement('div');
            newRow.className = 'tog-item-row';
            newRow.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:6px;';
            newRow.innerHTML = `
              <select class="tog-prod-select" required style="flex:2;">
                ${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
              </select>
              <input type="number" class="tog-qty-input" placeholder="Quantity" min="1" value="1" required style="flex:1;" />
              <button type="button" class="btn btn-outline btn-sm text-danger btn-remove-row" style="padding:4px 8px;">&times;</button>
            `;
            
            newRow.querySelector('.btn-remove-row').onclick = () => newRow.remove();
            rowContainer.appendChild(newRow);
          };
        }
      },
      onSubmit: async (fd) => {
        if (fd.source_shop_id === fd.target_shop_id) {
          Toast.error('Source and Target branches cannot be the same.');
          return;
        }

        const rows = document.querySelectorAll('.tog-item-row');
        const lineItems = [];

        rows.forEach((r) => {
          const prodId = r.querySelector('.tog-prod-select').value;
          const qty = parseFloat(r.querySelector('.tog-qty-input').value) || 0;
          lineItems.push({ product_id: prodId, quantity: qty });
        });

        const togPayload = {
          transfer_number: fd.transfer_number,
          source_shop_id: fd.source_shop_id,
          target_shop_id: fd.target_shop_id,
          status: 'pending',
          initiated_by: globalState.user?.id,
          created_at: new Date().toISOString(),
        };

        const { data: togRes, error: togErr } = await supabase
          .from('stock_transfers')
          .insert([togPayload])
          .select()
          .single();

        if (togErr) {
          Toast.error(togErr.message);
          return;
        }

        if (lineItems.length > 0 && togRes) {
          const itemsPayload = lineItems.map((item) => ({
            ...item,
            transfer_id: togRes.id,
          }));

          await supabase.from('stock_transfer_items').insert(itemsPayload);
        }

        Toast.success('Stock transfer initiated.');
        await loadStockTransfers();
      },
    });
  }

  // View & Complete Transfer Modal
  async function openTransferDetailsModal(transfer) {
    const { data: items } = await supabase
      .from('stock_transfer_items')
      .select('*, products(name)')
      .eq('transfer_id', transfer.id);

    const itemsListHtml = (items || []).map((i) => `
      <tr>
        <td><strong>${i.products?.name || 'Product'}</strong></td>
        <td>${i.quantity} units</td>
      </tr>
    `).join('');

    Modal.open({
      title: `Transfer details: ${transfer.transfer_number}`,
      content: `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.875rem;">
            <span>From: <strong>${transfer.source_shop?.name || 'Source Branch'}</strong></span>
            <span>To: <strong>${transfer.target_shop?.name || 'Target Branch'}</strong></span>
          </div>

          <table class="data-table" style="width:100%; font-size:0.85rem; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Product Item</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>${itemsListHtml || '<tr><td colspan="2">No items listed</td></tr>'}</tbody>
          </table>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
            <span>Current Status: <strong style="text-transform:uppercase;">${transfer.status}</strong></span>
            <select id="tog-status-update" class="form-select-sm">
              <option value="pending" ${transfer.status === 'pending' ? 'selected' : ''}>Pending</option>
              <option value="in_transit" ${transfer.status === 'in_transit' ? 'selected' : ''}>In Transit</option>
              <option value="completed" ${transfer.status === 'completed' ? 'selected' : ''}>Completed</option>
              <option value="cancelled" ${transfer.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>

          <button type="button" class="btn btn-teal-primary btn-block" id="btn-save-tog-status">Update Transfer Status</button>
        </div>
      `,
      onOpen: () => {
        document.getElementById('btn-save-tog-status').onclick = async () => {
          const newStatus = document.getElementById('tog-status-update').value;
          
          const { error } = await supabase
            .from('stock_transfers')
            .update({
              status: newStatus,
              completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
            })
            .eq('id', transfer.id);

          if (error) {
            Toast.error(error.message);
            return;
          }

          // Automatically transfer stock if marked as Completed
          if (newStatus === 'completed' && items && items.length > 0) {
            for (const item of items) {
              // Deduct from Source
              const { data: sourceInv } = await supabase
                .from('inventory')
                .select('id, quantity_on_hand')
                .eq('shop_id', transfer.source_shop_id)
                .eq('product_id', item.product_id)
                .maybeSingle();

              if (sourceInv) {
                await supabase
                  .from('inventory')
                  .update({ quantity_on_hand: Math.max(0, Number(sourceInv.quantity_on_hand || 0) - item.quantity) })
                  .eq('id', sourceInv.id);
              }

              // Add to Target
              const { data: targetInv } = await supabase
                .from('inventory')
                .select('id, quantity_on_hand')
                .eq('shop_id', transfer.target_shop_id)
                .eq('product_id', item.product_id)
                .maybeSingle();

              if (targetInv) {
                await supabase
                  .from('inventory')
                  .update({ quantity_on_hand: Number(targetInv.quantity_on_hand || 0) + item.quantity })
                  .eq('id', targetInv.id);
              } else {
                await supabase.from('inventory').insert([{
                  shop_id: transfer.target_shop_id,
                  product_id: item.product_id,
                  quantity_on_hand: item.quantity,
                  updated_at: new Date().toISOString()
                }]);
              }
            }
          }

          Toast.success('Transfer status updated.');
          Modal.close();
          await loadStockTransfers();
        };
      },
      onSubmit: () => {},
    });
  }

  await loadStockTransfers();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}