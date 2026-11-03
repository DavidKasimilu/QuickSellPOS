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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Inventory Counts & Physical Audits</h3>
        <span class="badge badge-teal" id="counts-count-badge">0 audits</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-start-count">
          <i data-lucide="clipboard-check" style="width:16px; height:16px; margin-right:6px;"></i> Start New Inventory Count
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="counts-table-content"></div>
    </div>
  `;

  document.getElementById('btn-start-count').onclick = () => openInventoryCountModal();

  async function loadInventoryAudits() {
    const tableArea = document.getElementById('counts-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading Inventory Audits...</p>`;

    let query = supabase
      .from('inventory_audits')
      .select('*, profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: audits, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('counts-count-badge');
    if (countBadge) countBadge.textContent = `${audits?.length || 0} audits`;

    renderDataTable({
      targetId: 'counts-table-content',
      columns: [
        { label: 'Audit Reference', key: 'audit_number', render: (val) => `<strong>${val}</strong>` },
        { 
          label: 'Status', 
          key: 'status', 
          render: (st) => {
            const status = (st || 'in_progress').toLowerCase();
            let badgeClass = 'badge';
            if (status === 'completed') badgeClass = 'badge badge-teal';
            else if (status === 'cancelled') badgeClass = 'badge text-danger';
            return `<span class="${badgeClass}">${status.replace('_', ' ').toUpperCase()}</span>`;
          } 
        },
        { label: 'Audit Notes', key: 'notes', render: (n) => n || '-' },
        { label: 'Initiated By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: audits || [],
      onAction: (action, id) => {
        const item = audits.find((a) => a.id === id);
        if (action === 'edit' && item) openAuditDetailsModal(item);
        else if (action === 'delete' && item) deleteAudit(item.id);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Delete Audit Record
  async function deleteAudit(auditId) {
    if (!confirm('Are you sure you want to delete this physical inventory audit record?')) return;

    await supabase.from('inventory_audit_items').delete().eq('audit_id', auditId);
    
    const { error } = await supabase.from('inventory_audits').delete().eq('id', auditId);
    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('Inventory audit record deleted.');
      await loadInventoryAudits();
    }
  }

  // Start New Count Modal
  async function openInventoryCountModal() {
    let query = supabase
      .from('inventory')
      .select('product_id, quantity_on_hand, products(id, name, barcode)')
      .eq('shop_id', globalState.activeShopId);

    const { data: inventoryData } = await query;

    if (!inventoryData || !inventoryData.length) {
      Toast.error('No inventory items found to count in this store branch.');
      return;
    }

    const auditNo = `AUD-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const rowsHtml = inventoryData.map((item) => `
      <tr class="audit-count-row" data-prod-id="${item.product_id}" data-system-qty="${item.quantity_on_hand || 0}">
        <td>
          <strong>${item.products?.name || 'Product'}</strong>
          <div style="font-size:0.75rem; color:var(--text-muted);">${item.products?.barcode || ''}</div>
        </td>
        <td><strong class="sys-qty-cell">${item.quantity_on_hand || 0}</strong></td>
        <td>
          <input type="number" step="0.01" class="form-input-sm audit-counted-input" value="${item.quantity_on_hand || 0}" style="width:90px;" />
        </td>
        <td><span class="audit-discrepancy-tag" style="font-weight:bold; color:var(--text-muted);">0</span></td>
      </tr>
    `).join('');

    Modal.open({
      title: 'Start Physical Inventory Count',
      content: `
        <form id="form-create-audit" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Audit Number</label>
            <input type="text" name="audit_number" value="${auditNo}" readonly class="input-disabled" />
          </div>

          <div class="form-group">
            <label>Audit Session Remarks</label>
            <input type="text" name="notes" placeholder="e.g. Monthly end of month stock count" required />
          </div>

          <hr style="margin:8px 0; border:0; border-top:1px solid var(--border-subtle);" />
          <h4 style="margin:0; font-size:0.9rem;">Physical Item Counting Sheet</h4>

          <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px;">
            <table class="data-table" style="width:100%; font-size:0.85rem; border-collapse:collapse;">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>System Stock</th>
                  <th>Counted Stock</th>
                  <th>Discrepancy</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:12px;">Submit Audit & Reconcile Stock</button>
        </form>
      `,
      onOpen: () => {
        // Calculate discrepancy in real-time
        document.querySelectorAll('.audit-count-row').forEach((row) => {
          const input = row.querySelector('.audit-counted-input');
          const discTag = row.querySelector('.audit-discrepancy-tag');
          const sysQty = parseFloat(row.dataset.systemQty) || 0;

          if (input && discTag) {
            input.oninput = () => {
              const countedQty = parseFloat(input.value) || 0;
              const diff = countedQty - sysQty;
              
              discTag.textContent = diff > 0 ? `+${diff}` : `${diff}`;
              if (diff === 0) discTag.style.color = 'var(--text-muted)';
              else if (diff > 0) discTag.style.color = 'var(--teal-600)';
              else discTag.style.color = 'var(--color-danger)';
            };
          }
        });
      },
      onSubmit: async (fd) => {
        const rows = document.querySelectorAll('.audit-count-row');
        const lineItems = [];

        rows.forEach((r) => {
          const prodId = r.dataset.prodId;
          const sysQty = parseFloat(r.dataset.systemQty) || 0;
          const countedQty = parseFloat(r.querySelector('.audit-counted-input').value) || 0;
          const discrepancy = countedQty - sysQty;

          lineItems.push({
            product_id: prodId,
            system_qty: sysQty,
            counted_qty: countedQty,
            discrepancy: discrepancy,
          });
        });

        const auditPayload = {
          shop_id: globalState.activeShopId,
          audit_number: fd.audit_number,
          notes: fd.notes || null,
          status: 'completed',
          initiated_by: globalState.user?.id,
          completed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        };

        const { data: auditRes, error: auditErr } = await supabase
          .from('inventory_audits')
          .insert([auditPayload])
          .select()
          .single();

        if (auditErr) {
          Toast.error(auditErr.message);
          return;
        }

        if (lineItems.length > 0 && auditRes) {
          const itemsPayload = lineItems.map((item) => ({
            ...item,
            audit_id: auditRes.id,
          }));

          await supabase.from('inventory_audit_items').insert(itemsPayload);

          // Update actual inventory levels to match counted quantity
          for (const item of lineItems) {
            await supabase
              .from('inventory')
              .update({
                quantity_on_hand: item.counted_qty,
                updated_at: new Date().toISOString(),
              })
              .eq('shop_id', globalState.activeShopId)
              .eq('product_id', item.product_id);
          }
        }

        Toast.success('Inventory audit submitted and stock quantities updated.');
        await loadInventoryAudits();
      },
    });
  }

  // View Audit Details Modal
  async function openAuditDetailsModal(audit) {
    const { data: items } = await supabase
      .from('inventory_audit_items')
      .select('*, products(name)')
      .eq('audit_id', audit.id);

    const itemsListHtml = (items || []).map((i) => {
      const diff = Number(i.discrepancy || 0);
      const diffColor = diff === 0 ? 'var(--text-muted)' : (diff > 0 ? 'var(--teal-600)' : 'var(--color-danger)');
      return `
        <tr>
          <td><strong>${i.products?.name || 'Product'}</strong></td>
          <td>${i.system_qty}</td>
          <td>${i.counted_qty}</td>
          <td><strong style="color:${diffColor};">${diff > 0 ? `+${diff}` : diff}</strong></td>
        </tr>
      `;
    }).join('');

    Modal.open({
      title: `Audit Summary: ${audit.audit_number}`,
      content: `
        <div style="display:flex; flex-direction:column; gap:12px;">
          <div style="font-size:0.875rem;">Remarks: <strong>${audit.notes || 'N/A'}</strong></div>

          <table class="data-table" style="width:100%; font-size:0.85rem; border-collapse:collapse;">
            <thead>
              <tr>
                <th>Product</th>
                <th>System Stock</th>
                <th>Counted Stock</th>
                <th>Discrepancy</th>
              </tr>
            </thead>
            <tbody>${itemsListHtml || '<tr><td colspan="4">No line items</td></tr>'}</tbody>
          </table>
        </div>
      `,
      onSubmit: () => {},
    });
  }

  await loadInventoryAudits();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}