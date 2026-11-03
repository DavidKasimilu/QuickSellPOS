import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'debtors'; // 'debtors' | 'settlements'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Debtor & Customer Credit Management</h3>
      </div>
      <div id="debtor-actions-container"></div>
    </div>

    <!-- Navigation Sub-tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-debtor-tab="debtors">Debtor Accounts & Balances</button>
      <button class="date-chip" data-debtor-tab="settlements">Debt Settlement History</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="debtor-table-content"></div>
    </div>
  `;

  // Bind tab navigation
  container.querySelectorAll('[data-debtor-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-debtor-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.debtorTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('debtor-actions-container');
    const tableArea = document.getElementById('debtor-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} records...</p>`;

    if (activeTab === 'debtors') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-record-debt-payment">
          <i data-lucide="hand-coins" style="width:16px; height:16px; margin-right:6px;"></i> Post Customer Settlement
        </button>
      `;
      document.getElementById('btn-record-debt-payment').onclick = () => openDebtSettlementModal();
      await renderDebtorAccountsTable(tableArea);
    } else {
      actionArea.innerHTML = ``;
      await renderSettlementHistoryTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Debtor Accounts Table
  // =========================================================================
  async function renderDebtorAccountsTable(target) {
    let query = supabase
      .from('customers')
      .select('id, name, phone, email, credit_balance, credit_limit')
      .is('deleted_at', null)
      .gt('credit_balance', 0)
      .order('credit_balance', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: debtors, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    if (!debtors || debtors.length === 0) {
      target.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="check-circle-2" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5; color:var(--teal-600);"></i>
          <p>No active debtor accounts with outstanding balances found.</p>
        </div>
      `;
      return;
    }

    renderDataTable({
      targetId: 'debtor-table-content',
      columns: [
        { label: 'Debtor Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Phone Contact', key: 'phone', render: (p) => p || '-' },
        { label: 'Email Address', key: 'email', render: (e) => e || '-' },
        { label: 'Credit Limit', key: 'credit_limit', render: (lim) => `${Number(lim || 0).toLocaleString()} ${currency}` },
        { 
          label: 'Owed Amount', 
          key: 'credit_balance', 
          render: (bal) => `<strong style="color:var(--color-danger); font-size:1rem;">${Number(bal || 0).toLocaleString()} ${currency}</strong>` 
        },
      ],
      data: debtors || [],
      onAction: (action, id) => {
        const item = debtors.find((d) => d.id === id);
        if (item) openDebtSettlementModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Settlement History Table
  // =========================================================================
  async function renderSettlementHistoryTable(target) {
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
      targetId: 'debtor-table-content',
      columns: [
        { label: 'Customer / Debtor', key: 'customers', render: (c) => `<strong>${c?.name || 'Customer'}</strong>` },
        { label: 'Amount Received', key: 'amount_paid', render: (v) => `<span style="font-weight:700; color:var(--teal-600);">${Number(v).toLocaleString()} ${currency}</span>` },
        { label: 'Payment Channel', key: 'payment_method', render: (m) => `<span class="badge">${(m || 'cash').toUpperCase()}</span>` },
        { label: 'Reference #', key: 'reference_no', render: (ref) => ref ? `<code>${ref}</code>` : '-' },
        { label: 'Remarks', key: 'notes', render: (n) => n || '-' },
        { label: 'Processed By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Date Paid', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: settlements || [],
    });
  }

  // =========================================================================
  // Post Customer Settlement Modal
  // =========================================================================
  async function openDebtSettlementModal(targetDebtor = null) {
    let debtorsList = [];
    if (!targetDebtor) {
      let query = supabase.from('customers').select('id, name, credit_balance').gt('credit_balance', 0).is('deleted_at', null).order('name');
      if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);
      const { data } = await query;
      debtorsList = data || [];
      if (!debtorsList.length) {
        Toast.error('No debtors with outstanding balances found.');
        return;
      }
    }

    const debtorOpts = targetDebtor
      ? `<option value="${targetDebtor.id}">${targetDebtor.name} (Owes: ${Number(targetDebtor.credit_balance || 0).toLocaleString()} ${currency})</option>`
      : debtorsList.map((d) => `<option value="${d.id}">${d.name} (Owes: ${Number(d.credit_balance || 0).toLocaleString()} ${currency})</option>`).join('');

    const initialAmount = targetDebtor ? (targetDebtor.credit_balance || 0) : (debtorsList[0]?.credit_balance || 0);

    Modal.open({
      title: 'Post Customer Debt Settlement',
      content: `
        <form id="form-debtor-settlement" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Debtor Customer</label>
            <select name="customer_id" required>${debtorOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Amount Paid (${currency})</label>
              <input type="number" step="0.01" min="1" name="amount_paid" value="${initialAmount}" required />
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
            <input type="text" name="notes" placeholder="e.g. Cleared pending invoice balance" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Confirm & Reduce Debtor Balance</button>
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

        // 2. Reduce customer debtor balance
        const { data: cust } = await supabase
          .from('customers')
          .select('credit_balance')
          .eq('id', fd.customer_id)
          .single();

        if (cust) {
          const currentBal = parseFloat(cust.credit_balance) || 0;
          await supabase
            .from('customers')
            .update({ credit_balance: Math.max(0, currentBal - payAmount) })
            .eq('id', fd.customer_id);
        }

        Toast.success('Customer debt settlement processed.');
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}