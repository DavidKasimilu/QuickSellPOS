import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'suppliers'; // 'suppliers' | 'settlements'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Supplier Credit Management</h3>
      </div>
      <div id="supplier-credit-actions"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-credit-tab="suppliers">Supplier Balances</button>
      <button class="date-chip" data-credit-tab="settlements">Settlement Logs</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="supplier-credit-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-credit-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-credit-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.creditTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('supplier-credit-actions');
    const tableArea = document.getElementById('supplier-credit-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    if (activeTab === 'suppliers') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-pay-supplier">
          <i data-lucide="wallet" style="width:16px; height:16px; margin-right:6px;"></i> Post Supplier Payment
        </button>
      `;
      document.getElementById('btn-pay-supplier').onclick = () => openSupplierSettlementModal();
      await renderSupplierBalancesTable(tableArea);
    } else {
      actionArea.innerHTML = ``;
      await renderSettlementLogsTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Supplier Balances
  // =========================================================================
  async function renderSupplierBalancesTable(target) {
    let query = supabase
      .from('suppliers')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: suppliers, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'supplier-credit-table-content',
      columns: [
        { label: 'Supplier Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Phone', key: 'phone', render: (p) => p || '-' },
        { label: 'Email', key: 'email', render: (e) => e || '-' },
        { 
          label: 'Outstanding Credit Balance', 
          key: 'balance', 
          render: (v) => {
            const bal = Number(v || 0);
            const isOwed = bal > 0;
            return `<strong style="color:${isOwed ? 'var(--color-danger)' : 'var(--teal-600)'}; font-size:0.95rem;">
              ${bal.toLocaleString()} ${currency}
            </strong>`;
          } 
        },
      ],
      data: suppliers || [],
      onAction: (action, id) => {
        const item = suppliers.find((s) => s.id === id);
        if (item) openSupplierSettlementModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Settlement Logs Table
  // =========================================================================
  async function renderSettlementLogsTable(target) {
    let query = supabase
      .from('supplier_credit_settlements')
      .select('*, suppliers(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: settlements, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'supplier-credit-table-content',
      columns: [
        { label: 'Supplier', key: 'suppliers', render: (s) => `<strong>${s?.name || 'Supplier'}</strong>` },
        { label: 'Amount Paid', key: 'amount_paid', render: (v) => `<span style="font-weight:700; color:var(--teal-600);">${Number(v).toLocaleString()} ${currency}</span>` },
        { label: 'Payment Channel', key: 'payment_method', render: (m) => `<span class="badge">${(m || 'bank_transfer').toUpperCase()}</span>` },
        { label: 'Reference Code', key: 'reference_no', render: (ref) => ref ? `<code>${ref}</code>` : '-' },
        { label: 'Notes', key: 'notes', render: (n) => n || '-' },
        { label: 'Paid By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Date Paid', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: settlements || [],
    });
  }

  // =========================================================================
  // Supplier Payment Settlement Modal
  // =========================================================================
  async function openSupplierSettlementModal(targetSupplier = null) {
    let suppliersList = [];
    if (!targetSupplier) {
      let query = supabase.from('suppliers').select('id, name, balance').is('deleted_at', null).order('name');
      if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);
      const { data } = await query;
      suppliersList = data || [];
      if (!suppliersList.length) {
        Toast.error('No suppliers registered in this branch.');
        return;
      }
    }

    const supplierOpts = targetSupplier
      ? `<option value="${targetSupplier.id}">${targetSupplier.name} (Owed: ${Number(targetSupplier.balance || 0).toLocaleString()} ${currency})</option>`
      : suppliersList.map((s) => `<option value="${s.id}">${s.name} (Owed: ${Number(s.balance || 0).toLocaleString()} ${currency})</option>`).join('');

    const initialAmount = targetSupplier ? (targetSupplier.balance || 0) : (suppliersList[0]?.balance || 0);

    Modal.open({
      title: 'Post Supplier Credit Payment',
      content: `
        <form id="form-supplier-settlement" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Supplier</label>
            <select name="supplier_id" required>${supplierOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Amount Being Paid (${currency})</label>
              <input type="number" step="0.01" min="1" name="amount_paid" value="${initialAmount}" required />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Payment Channel</label>
              <select name="payment_method">
                <option value="bank_transfer">Bank Transfer</option>
                <option value="mpesa">M-PESA Paybill</option>
                <option value="cheque">Cheque</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Transaction Reference #</label>
            <input type="text" name="reference_no" placeholder="e.g. Ref / Cheque No." />
          </div>

          <div class="form-group">
            <label>Settlement Remarks / Notes</label>
            <input type="text" name="notes" placeholder="e.g. Partial payment for PO-202611-001" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Confirm & Deduct Supplier Balance</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payAmount = parseFloat(fd.amount_paid) || 0;
        const nowIso = new Date().toISOString();

        // 1. Insert settlement log
        const { error: settErr } = await supabase.from('supplier_credit_settlements').insert([{
          shop_id: globalState.activeShopId,
          supplier_id: fd.supplier_id,
          amount_paid: payAmount,
          payment_method: fd.payment_method,
          reference_no: fd.reference_no || null,
          notes: fd.notes || null,
          created_by: globalState.user?.id,
          created_at: nowIso,
        }]);

        if (settErr) {
          Toast.error(settErr.message);
          return;
        }

        // 2. Reduce supplier balance
        const { data: sup } = await supabase
          .from('suppliers')
          .select('balance')
          .eq('id', fd.supplier_id)
          .single();

        if (sup) {
          const currentBal = parseFloat(sup.balance) || 0;
          await supabase
            .from('suppliers')
            .update({ balance: Math.max(0, currentBal - payAmount) })
            .eq('id', fd.supplier_id);
        }

        Toast.success('Supplier payment recorded successfully.');
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}