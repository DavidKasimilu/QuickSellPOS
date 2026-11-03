import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'customer_settlements'; // 'customer_settlements' | 'supplier_settlements'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Credit Settlements Hub</h3>
      </div>
      <div id="credit-settlement-actions"></div>
    </div>

    <!-- Navigation Sub-tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-settlement-tab="customer_settlements">Customer / Debtor Settlements</button>
      <button class="date-chip" data-settlement-tab="supplier_settlements">Supplier / Vendor Settlements</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="credit-settlement-table-content"></div>
    </div>
  `;

  // Bind tab navigation
  container.querySelectorAll('[data-settlement-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-settlement-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.settlementTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('credit-settlement-actions');
    const tableArea = document.getElementById('credit-settlement-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab.replace('_', ' ')} records...</p>`;

    if (activeTab === 'customer_settlements') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-post-cust-settlement">
          <i data-lucide="hand-coins" style="width:16px; height:16px; margin-right:6px;"></i> Post Customer Payment
        </button>
      `;
      document.getElementById('btn-post-cust-settlement').onclick = () => openCustomerSettlementModal();
      await renderCustomerSettlementsTable(tableArea);
    } else {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-post-sup-settlement">
          <i data-lucide="wallet" style="width:16px; height:16px; margin-right:6px;"></i> Post Supplier Payment
        </button>
      `;
      document.getElementById('btn-post-sup-settlement').onclick = () => openSupplierSettlementModal();
      await renderSupplierSettlementsTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Customer Settlements Table
  // =========================================================================
  async function renderCustomerSettlementsTable(target) {
    let query = supabase
      .from('debtor_settlements')
      .select('*, customers(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: settlements, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'credit-settlement-table-content',
      columns: [
        { label: 'Customer / Debtor', key: 'customers', render: (c) => `<strong>${c?.name || 'Customer'}</strong>` },
        { label: 'Amount Received', key: 'amount_paid', render: (v) => `<span style="font-weight:700; color:var(--teal-600);">${Number(v).toLocaleString()} ${currency}</span>` },
        { label: 'Payment Channel', key: 'payment_method', render: (m) => `<span class="badge">${(m || 'cash').toUpperCase()}</span>` },
        { label: 'Reference Code', key: 'reference_no', render: (ref) => ref ? `<code>${ref}</code>` : '-' },
        { label: 'Notes', key: 'notes', render: (n) => n || '-' },
        { label: 'Processed By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Date Paid', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: settlements || [],
    });
  }

  // =========================================================================
  // 2. Supplier Settlements Table
  // =========================================================================
  async function renderSupplierSettlementsTable(target) {
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
      targetId: 'credit-settlement-table-content',
      columns: [
        { label: 'Supplier / Vendor', key: 'suppliers', render: (s) => `<strong>${s?.name || 'Supplier'}</strong>` },
        { label: 'Amount Paid Out', key: 'amount_paid', render: (v) => `<span style="font-weight:700; color:var(--color-danger);">${Number(v).toLocaleString()} ${currency}</span>` },
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
  // Modals
  // =========================================================================
  async function openCustomerSettlementModal() {
    let query = supabase.from('customers').select('id, name, credit_balance').gt('credit_balance', 0).is('deleted_at', null).order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: debtors } = await query;

    if (!debtors || !debtors.length) {
      Toast.error('No customer debtor accounts with outstanding balances found.');
      return;
    }

    const debtorOpts = debtors.map((d) => 
      `<option value="${d.id}">${d.name} (Owes: ${Number(d.credit_balance || 0).toLocaleString()} ${currency})</option>`
    ).join('');

    Modal.open({
      title: 'Post Customer Credit Settlement',
      content: `
        <form id="form-cust-settle" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Customer</label>
            <select name="customer_id" required>${debtorOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Amount Paid (${currency})</label>
              <input type="number" step="0.01" min="1" name="amount_paid" value="${debtors[0]?.credit_balance || 0}" required />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Payment Channel</label>
              <select name="payment_method">
                <option value="cash">Cash</option>
                <option value="mpesa">M-PESA</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Transaction Reference #</label>
            <input type="text" name="reference_no" placeholder="e.g. M-PESA Code / Cheque No." />
          </div>

          <div class="form-group">
            <label>Settlement Remarks / Notes</label>
            <input type="text" name="notes" placeholder="e.g. Cleared credit balance" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Confirm & Reduce Customer Debt</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payAmount = parseFloat(fd.amount_paid) || 0;
        const nowIso = new Date().toISOString();

        // 1. Insert settlement log
        const { error: settErr } = await supabase.from('debtor_settlements').insert([{
          shop_id: globalState.activeShopId,
          customer_id: fd.customer_id,
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

        // 2. Reduce customer balance
        const { data: cust } = await supabase.from('customers').select('credit_balance').eq('id', fd.customer_id).single();
        if (cust) {
          const currentBal = parseFloat(cust.credit_balance) || 0;
          await supabase.from('customers').update({ credit_balance: Math.max(0, currentBal - payAmount) }).eq('id', fd.customer_id);
        }

        Toast.success('Customer payment settled.');
        await loadActiveTab();
      },
    });
  }

  async function openSupplierSettlementModal() {
    let query = supabase.from('suppliers').select('id, name, balance').is('deleted_at', null).order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: suppliers } = await query;

    if (!suppliers || !suppliers.length) {
      Toast.error('No suppliers found in directory.');
      return;
    }

    const supplierOpts = suppliers.map((s) => 
      `<option value="${s.id}">${s.name} (Owed: ${Number(s.balance || 0).toLocaleString()} ${currency})</option>`
    ).join('');

    Modal.open({
      title: 'Post Supplier Credit Payment',
      content: `
        <form id="form-sup-settle" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Supplier</label>
            <select name="supplier_id" required>${supplierOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Amount Being Paid (${currency})</label>
              <input type="number" step="0.01" min="1" name="amount_paid" value="${suppliers[0]?.balance || 0}" required />
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
            <input type="text" name="reference_no" placeholder="e.g. Bank Ref / Cheque No." />
          </div>

          <div class="form-group">
            <label>Settlement Remarks / Notes</label>
            <input type="text" name="notes" placeholder="e.g. Supplier invoice payment" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Confirm & Reduce Supplier Debt</button>
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
        const { data: sup } = await supabase.from('suppliers').select('balance').eq('id', fd.supplier_id).single();
        if (sup) {
          const currentBal = parseFloat(sup.balance) || 0;
          await supabase.from('suppliers').update({ balance: Math.max(0, currentBal - payAmount) }).eq('id', fd.supplier_id);
        }

        Toast.success('Supplier payment settled.');
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}