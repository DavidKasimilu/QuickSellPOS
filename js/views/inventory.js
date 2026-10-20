import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let activeTab = 'stock'; // 'stock' | 'valuation' | 'expiry' | 'audits' | 'assemblies' | 'po' | 'grn' | 'prn'

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        </div>
      <div id="inv-action-container"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-inv-tab="stock">Available Stock</button>
      <button class="date-chip" data-inv-tab="valuation">Inventory Valuation</button>
      <button class="date-chip" data-inv-tab="expiry">Expiry Tracking</button>
      <button class="date-chip" data-inv-tab="audits">Physical Stocktake</button>
      <button class="date-chip" data-inv-tab="assemblies">Recipe / BOM Assemblies</button>
      <button class="date-chip" data-inv-tab="po">Purchase Orders (PO)</button>
      <button class="date-chip" data-inv-tab="grn">Goods Received (GRN)</button>
      <button class="date-chip" data-inv-tab="prn">Returns (PRN)</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="inv-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-inv-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-inv-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.invTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('inv-action-container');
    const tableArea = document.getElementById('inv-table-content');
    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} records...</p>`;

    switch (activeTab) {
      case 'stock':
        actionArea.innerHTML = `
          <button class="btn btn-outline" id="btn-quick-adjust">
            <i data-lucide="sliders" style="width:16px; height:16px; margin-right:6px;"></i> Stock Adjustment
          </button>
        `;
        document.getElementById('btn-quick-adjust').onclick = () => openStockAdjustmentModal();
        await renderStockTable(tableArea);
        break;

      case 'valuation':
        actionArea.innerHTML = `
          <button class="btn btn-outline" id="btn-export-val">
            <i data-lucide="file-spreadsheet" style="width:16px; height:16px; margin-right:6px;"></i> Print Valuation
          </button>
        `;
        document.getElementById('btn-export-val').onclick = () => window.print();
        await renderValuationReport(tableArea);
        break;

      case 'expiry':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-log-batch">
            <i data-lucide="calendar-plus" style="width:16px; height:16px; margin-right:6px;"></i> Register Perishable Batch
          </button>
        `;
        document.getElementById('btn-log-batch').onclick = () => openBatchModal();
        await renderExpiryTrackingTable(tableArea);
        break;

      case 'audits':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-new-stocktake">
            <i data-lucide="clipboard-check" style="width:16px; height:16px; margin-right:6px;"></i> Launch Stocktake Session
          </button>
        `;
        document.getElementById('btn-new-stocktake').onclick = () => openStocktakeSessionModal();
        await renderAuditsTable(tableArea);
        break;

      case 'assemblies':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-new-recipe">
            <i data-lucide="layers" style="width:16px; height:16px; margin-right:6px;"></i> Configure Recipe (BOM)
          </button>
        `;
        document.getElementById('btn-new-recipe').onclick = () => openRecipeBuilderModal();
        await renderBOMTable(tableArea);
        break;

      case 'po':
        actionArea.innerHTML = ``;
        await renderPOTable(tableArea);
        break;

      case 'grn':
        actionArea.innerHTML = ``;
        await renderGRNTable(tableArea);
        break;

      case 'prn':
        actionArea.innerHTML = ``;
        await renderPRNTable(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Available Stock Table
  // =========================================================================
  async function renderStockTable(target) {
    let query = supabase.from('inventory').select('*, products(id, name, sku, retail_price, cost_price)').order('quantity_on_hand');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'Item Name', key: 'products', render: (p) => `<strong>${p?.name || 'Item'}</strong>` },
        { label: 'SKU', key: 'products', render: (p) => p?.sku || '-' },
        {
          label: 'Quantity On Hand',
          key: 'quantity_on_hand',
          render: (qty, row) => {
            const isLow = Number(qty) <= Number(row.min_stock_level);
            return `<span style="font-weight:700; color:${isLow ? 'var(--color-danger)' : 'var(--text-main)'};">
              ${qty} ${isLow ? '(Low)' : ''}
            </span>`;
          },
        },
        { label: 'Min Level', key: 'min_stock_level' },
        { label: 'Unit Cost', key: 'products', render: (p) => `${Number(p?.cost_price || 0).toLocaleString()} ${currency}` },
        { label: 'Last Count', key: 'updated_at', render: (v) => new Date(v).toLocaleDateString() },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((r) => r.id === id);
        if (item) openStockAdjustmentModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Inventory Valuation & Backdate Reports
  // =========================================================================
  async function renderValuationReport(target) {
    let query = supabase.from('inventory').select('quantity_on_hand, products(id, name, cost_price, retail_price)');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: items, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    let totalCostVal = 0;
    let totalRetailVal = 0;

    const rows = (items || []).map((item) => {
      const qty = Number(item.quantity_on_hand || 0);
      const cost = Number(item.products?.cost_price || 0);
      const retail = Number(item.products?.retail_price || 0);
      const costSub = qty * cost;
      const retailSub = qty * retail;

      totalCostVal += costSub;
      totalRetailVal += retailSub;

      return {
        id: item.products?.id,
        name: item.products?.name,
        qty,
        cost,
        retail,
        costSub,
        retailSub,
        potentialMargin: retailSub - costSub,
      };
    });

    target.innerHTML = `
      <div style="padding:20px; border-bottom:1px solid var(--border-subtle); display:flex; gap:20px; flex-wrap:wrap; background:var(--bg-canvas);">
        <div class="kpi-card" style="flex:1; min-width:200px;">
          <div class="kpi-label">Total Cost Valuation (Asset Basis)</div>
          <div class="kpi-value">${totalCostVal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}</div>
        </div>
        <div class="kpi-card" style="flex:1; min-width:200px;">
          <div class="kpi-label">Total Retail Valuation (Projected)</div>
          <div class="kpi-value" style="color:var(--teal-600);">${totalRetailVal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}</div>
        </div>
        <div class="kpi-card" style="flex:1; min-width:200px;">
          <div class="kpi-label">Projected Gross Margin</div>
          <div class="kpi-value text-accent-bold">${(totalRetailVal - totalCostVal).toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}</div>
        </div>
      </div>
      <div id="valuation-table-container"></div>
    `;

    renderDataTable({
      targetId: 'valuation-table-container',
      columns: [
        { label: 'Item Name', key: 'name', render: (n) => `<strong>${n}</strong>` },
        { label: 'Stock On Hand', key: 'qty' },
        { label: 'Unit Cost', key: 'cost', render: (c) => `${Number(c).toLocaleString()} ${currency}` },
        { label: 'Total Cost Value', key: 'costSub', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Retail Price', key: 'retail', render: (r) => `${Number(r).toLocaleString()} ${currency}` },
        { label: 'Total Retail Value', key: 'retailSub', render: (v) => `<strong>${Number(v).toLocaleString()} ${currency}</strong>` },
      ],
      data: rows,
    });
  }

  // =========================================================================
  // 3. Inventory Expiry Tracking & Perishable Batches
  // =========================================================================
  async function renderExpiryTrackingTable(target) {
    let query = supabase.from('inventory_batches').select('*, products(name), suppliers(name)').order('expiry_date');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: batches, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'Product Name', key: 'products', render: (p) => `<strong>${p?.name || 'Batch'}</strong>` },
        { label: 'Batch #', key: 'batch_number', render: (b) => `<code>${b}</code>` },
        { label: 'Supplier', key: 'suppliers', render: (s) => s?.name || '-' },
        { label: 'Remaining Units', key: 'quantity_remaining' },
        {
          label: 'Expiry Date',
          key: 'expiry_date',
          render: (exp) => {
            const expDate = new Date(exp);
            const daysLeft = Math.ceil((expDate - today) / (1000 * 60 * 60 * 24));

            if (daysLeft < 0) {
              return `<span class="badge" style="background:#fee2e2; color:#ef4444; border-color:#fca5a5;">EXPIRED (${Math.abs(daysLeft)}d ago)</span>`;
            } else if (daysLeft <= 7) {
              return `<span class="badge" style="background:#fef3c7; color:#d97706; border-color:#fcd34d;">URGENT: ${daysLeft}d left (${exp})</span>`;
            }
            return `<span>${exp} (${daysLeft}d)</span>`;
          },
        },
      ],
      data: batches || [],
    });
  }

  function openBatchModal() {
    supabase.from('products').select('id, name').then(({ data: prods }) => {
      supabase.from('suppliers').select('id, name').then(({ data: supps }) => {
        const prodOpts = (prods || []).map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
        const suppOpts = `<option value="">-- Optional Supplier --</option>` + (supps || []).map((s) => `<option value="${s.id}">${s.name}</option>`).join('');

        Modal.open({
          title: 'Register Perishable Inventory Batch',
          content: `
            <form id="form-batch-save">
              <div class="form-group">
                <label>Target Product</label>
                <select name="product_id" required>${prodOpts}</select>
              </div>
              <div class="form-row" style="display:flex; gap:12px;">
                <div class="form-group" style="flex:1;">
                  <label>Batch / Lot #</label>
                  <input type="text" name="batch_number" required value="BATCH-${Date.now().toString().slice(-5)}" />
                </div>
                <div class="form-group" style="flex:1;">
                  <label>Quantity Received</label>
                  <input type="number" step="1" min="1" name="quantity_received" value="10" required />
                </div>
              </div>
              <div class="form-row" style="display:flex; gap:12px;">
                <div class="form-group" style="flex:1;">
                  <label>Perishable Expiry Date</label>
                  <input type="date" name="expiry_date" required />
                </div>
                <div class="form-group" style="flex:1;">
                  <label>Supplier Vendor</label>
                  <select name="supplier_id">${suppOpts}</select>
                </div>
              </div>
              <button type="submit" class="btn btn-teal-primary btn-block">Log Batch</button>
            </form>
          `,
          onSubmit: async (fd) => {
            const { error } = await supabase.from('inventory_batches').insert([{
              shop_id: globalState.activeShopId,
              product_id: fd.product_id,
              batch_number: fd.batch_number,
              quantity_received: parseFloat(fd.quantity_received),
              quantity_remaining: parseFloat(fd.quantity_received),
              expiry_date: fd.expiry_date,
              supplier_id: fd.supplier_id || null,
            }]);

            if (error) Toast.error(error.message);
            else {
              Toast.success('Perishable batch logged.');
              await loadActiveTab();
            }
          },
        });
      });
    });
  }

  // =========================================================================
  // 4. Physical Stocktake Session Workflow
  // =========================================================================
  async function renderAuditsTable(target) {
    let query = supabase.from('inventory_audits').select('*, profiles(full_name)').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: audits, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'Audit #', key: 'audit_number', render: (v) => `<strong>${v}</strong>` },
        { label: 'Auditor', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Notes', key: 'notes', render: (n) => n || '-' },
        { label: 'Status', key: 'status', render: (st) => `<span class="badge ${st === 'completed' ? 'badge-teal' : ''}">${st.toUpperCase()}</span>` },
        { label: 'Date Completed', key: 'completed_at', render: (d) => d ? new Date(d).toLocaleDateString() : 'In Progress' },
      ],
      data: audits || [],
      onAction: (action, id) => {
        const audit = audits.find((a) => a.id === id);
        if (audit) viewAuditBreakdownModal(audit);
      },
    });
  }

  async function openStocktakeSessionModal() {
    let invQuery = supabase.from('inventory').select('product_id, quantity_on_hand, products(name)');
    if (globalState.activeShopId) invQuery = invQuery.eq('shop_id', globalState.activeShopId);

    const { data: stockItems } = await invQuery;
    if (!stockItems?.length) {
      Toast.error('No inventory items to audit.');
      return;
    }

    const auditNum = `STK-${Date.now().toString().slice(-6)}`;
    const itemsRows = stockItems.map((item, idx) => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:8px 0;">
          <strong>${item.products?.name}</strong>
          <input type="hidden" name="prod_id_${idx}" value="${item.product_id}" />
          <input type="hidden" name="sys_qty_${idx}" value="${item.quantity_on_hand}" />
        </td>
        <td style="text-align:right;">${item.quantity_on_hand}</td>
        <td style="text-align:right; width:120px;">
          <input type="number" step="1" name="counted_${idx}" value="${item.quantity_on_hand}" style="text-align:right; padding:4px;" required />
        </td>
      </tr>
    `).join('');

    Modal.open({
      title: `Physical Stocktake Count Sheet (${auditNum})`,
      content: `
        <form id="form-stocktake-sheet">
          <input type="hidden" name="count_size" value="${stockItems.length}" />
          <div class="form-group">
            <label>Session Notes / Scope</label>
            <input type="text" name="notes" placeholder="Full monthly physical count" />
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:0.875rem; margin-bottom:16px;">
            <thead>
              <tr style="text-align:left; border-bottom:1px solid var(--border-subtle); color:var(--text-muted);">
                <th>Product</th><th style="text-align:right;">Expected (System)</th><th style="text-align:right;">Counted (Physical)</th>
              </tr>
            </thead>
            <tbody>${itemsRows}</tbody>
          </table>
          <button type="submit" class="btn btn-teal-primary btn-block">Commit Stocktake & Adjust Inventory</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const countSize = parseInt(fd.count_size, 10);

        const { data: audit, error: auditErr } = await supabase
          .from('inventory_audits')
          .insert([{
            audit_number: auditNum,
            shop_id: globalState.activeShopId,
            initiated_by: globalState.user?.id,
            status: 'completed',
            notes: fd.notes,
            completed_at: new Date().toISOString(),
          }])
          .select()
          .single();

        if (auditErr) {
          Toast.error(auditErr.message);
          return;
        }

        for (let i = 0; i < countSize; i++) {
          const prodId = fd[`prod_id_${i}`];
          const sysQty = parseFloat(fd[`sys_qty_${i}`]);
          const countedQty = parseFloat(fd[`counted_${i}`]);
          const discrepancy = countedQty - sysQty;

          await supabase.from('inventory_audit_items').insert([{
            audit_id: audit.id,
            product_id: prodId,
            system_qty: sysQty,
            counted_qty: countedQty,
            discrepancy: discrepancy,
          }]);

          if (discrepancy !== 0) {
            await supabase.from('inventory').update({
              quantity_on_hand: countedQty,
              updated_at: new Date().toISOString(),
            }).eq('shop_id', globalState.activeShopId).eq('product_id', prodId);
          }
        }

        Toast.success('Stocktake committed and inventory reconciliations updated.');
        await loadActiveTab();
      },
    });
  }

  async function viewAuditBreakdownModal(audit) {
    const { data: items } = await supabase.from('inventory_audit_items').select('*, products(name)').eq('audit_id', audit.id);
    const rows = (items || []).map((i) => `
      <tr style="border-bottom:1px solid var(--border-subtle);">
        <td style="padding:6px 0;">${i.products?.name}</td>
        <td style="text-align:right;">${i.system_qty}</td>
        <td style="text-align:right;">${i.counted_qty}</td>
        <td style="text-align:right; font-weight:700; color:${i.discrepancy < 0 ? 'var(--color-danger)' : 'var(--teal-600)'};">
          ${i.discrepancy > 0 ? '+' : ''}${i.discrepancy}
        </td>
      </tr>
    `).join('');

    Modal.open({
      title: `Stocktake Result: ${audit.audit_number}`,
      content: `
        <div>
          <p style="font-size:0.85rem; margin-bottom:12px; color:var(--text-muted);">Auditor notes: <strong>${audit.notes || 'None'}</strong></p>
          <table style="width:100%; border-collapse:collapse; font-size:0.875rem;">
            <thead>
              <tr style="border-bottom:1px solid var(--border-subtle); color:var(--text-muted);">
                <th>Product</th><th style="text-align:right;">System</th><th style="text-align:right;">Counted</th><th style="text-align:right;">Variance</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `,
    });
  }

  // =========================================================================
  // 5. Productions / Recipe Assemblies (BOM UI)
  // =========================================================================
  async function renderBOMTable(target) {
    const { data: boms, error } = await supabase
      .from('product_assemblies')
      .select('*, parent:products!product_assemblies_parent_product_id_fkey(name), raw:products!product_assemblies_raw_material_id_fkey(name)');

    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'Finished Product (Sold)', key: 'parent', render: (p) => `<strong>${p?.name || 'Item'}</strong>` },
        { label: 'Raw Ingredient / Material', key: 'raw', render: (r) => r?.name || 'Raw Material' },
        { label: 'Units Deducted per Sale', key: 'quantity_required', render: (q) => `<code>${q} units</code>` },
      ],
      data: boms || [],
    });
  }

  async function openRecipeBuilderModal() {
    const { data: prods } = await supabase.from('products').select('id, name');
    if ((prods || []).length < 2) {
      Toast.error('At least 2 products are required to link recipes.');
      return;
    }

    const prodOpts = prods.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');

    Modal.open({
      title: 'Recipe & Assembly Formulation (BOM)',
      content: `
        <form id="form-recipe-save">
          <div class="form-group">
            <label>Finished Product (Item Being Sold)</label>
            <select name="parent_product_id" required>${prodOpts}</select>
          </div>
          <div class="form-group">
            <label>Raw Ingredient to Deduct</label>
            <select name="raw_material_id" required>${prodOpts}</select>
          </div>
          <div class="form-group">
            <label>Deduction Quantity per Unit Sold</label>
            <input type="number" step="0.001" min="0.001" name="quantity_required" value="1.0" required />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Commit Recipe Link</button>
        </form>
      `,
      onSubmit: async (fd) => {
        if (fd.parent_product_id === fd.raw_material_id) {
          Toast.error('Parent item and raw material cannot be the same item.');
          return;
        }

        const { error } = await supabase.from('product_assemblies').upsert([{
          parent_product_id: fd.parent_product_id,
          raw_material_id: fd.raw_material_id,
          quantity_required: parseFloat(fd.quantity_required),
        }], { onConflict: 'parent_product_id, raw_material_id' });

        if (error) Toast.error(error.message);
        else {
          Toast.success('Recipe link established.');
          await loadActiveTab();
        }
      },
    });
  }

  // =========================================================================
  // Standard Stubs for PO, GRN, PRN & Quick Stock Adjust
  // =========================================================================
  async function renderPOTable(t) {
    const { data } = await supabase.from('purchase_orders').select('*, suppliers(name)').order('created_at', { ascending: false });
    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'PO #', key: 'po_number', render: (v) => `<strong>${v}</strong>` },
        { label: 'Supplier', key: 'suppliers', render: (s) => s?.name || '-' },
        { label: 'Status', key: 'status', render: (st) => `<span class="badge">${st.toUpperCase()}</span>` },
      ],
      data: data || [],
    });
  }

  async function renderGRNTable(t) {
    const { data } = await supabase.from('goods_received_notes').select('*, suppliers(name)').order('received_at', { ascending: false });
    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'GRN #', key: 'grn_number', render: (v) => `<strong>${v}</strong>` },
        { label: 'Supplier', key: 'suppliers', render: (s) => s?.name || '-' },
        { label: 'Delivery Note', key: 'delivery_note_no' },
      ],
      data: data || [],
    });
  }

  async function renderPRNTable(t) {
    const { data } = await supabase.from('purchase_return_notes').select('*, suppliers(name)').order('created_at', { ascending: false });
    renderDataTable({
      targetId: 'inv-table-content',
      columns: [
        { label: 'PRN #', key: 'prn_number', render: (v) => `<strong>${v}</strong>` },
        { label: 'Supplier', key: 'suppliers', render: (s) => s?.name || '-' },
        { label: 'Status', key: 'status', render: (st) => `<span class="badge">${st.toUpperCase()}</span>` },
      ],
      data: data || [],
    });
  }

  function openStockAdjustmentModal(target = null) {
    Modal.open({
      title: 'Manual Stock Discrepancy Adjustment',
      content: `
        <form id="form-stock-adj">
          <div class="form-group">
            <label>Adjustment Units (+/-)</label>
            <input type="number" step="1" name="delta" required placeholder="e.g. -2 or 5" />
          </div>
          <div class="form-group">
            <label>Audit Reason</label>
            <input type="text" name="reason" placeholder="Damaged / Found inventory" required />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Commit Adjustment</button>
        </form>
      `,
      onSubmit: async (fd) => {
        if (target) {
          const delta = parseFloat(fd.delta);
          await supabase.from('inventory').update({
            quantity_on_hand: Number(target.quantity_on_hand) + delta,
            updated_at: new Date().toISOString(),
          }).eq('id', target.id);
          Toast.success('Inventory balance updated.');
          await loadActiveTab();
        }
      },
    });
  }

  await loadActiveTab();
  return () => {};
}