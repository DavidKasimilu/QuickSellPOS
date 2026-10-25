import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let activeTab = 'customers'; // 'customers' | 'debtors' | 'settlements' | 'loyalty'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <span class="live-indicator" style="font-size:0.75rem; color:var(--teal-600); display:inline-flex; align-items:center; gap:4px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--teal-600);"></span>
          Live CRM Stream Active
        </span>
      </div>
      <div id="crm-action-container"></div>
    </div>

    <!-- Group 4 Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-crm-tab="customers">Customer Base</button>
      <button class="date-chip" data-crm-tab="debtors">Debtor Accounts</button>
      <button class="date-chip" data-crm-tab="settlements">Credit Settlements</button>
      <button class="date-chip" data-crm-tab="loyalty">Loyalty Rewards</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="crm-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-crm-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-crm-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.crmTab;
      loadActiveTab();
    };
  });

  // Reactive state listener for real-time mobile customer additions
  unsubs.push(
    globalState.subscribeKey('customers', () => {
      if (activeTab === 'customers' || activeTab === 'debtors') {
        loadActiveTab();
      }
    })
  );

  async function loadActiveTab() {
    const actionArea = document.getElementById('crm-action-container');
    const tableArea = document.getElementById('crm-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    switch (activeTab) {
      case 'customers':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-customer">
            <i data-lucide="user-plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Customer
          </button>
        `;
        document.getElementById('btn-add-customer').onclick = () => openCustomerModal();
        await renderCustomersTable(tableArea);
        break;

      case 'debtors':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-record-settlement-quick">
            <i data-lucide="receipt" style="width:16px; height:16px; margin-right:6px;"></i> Receive Settlement
          </button>
        `;
        document.getElementById('btn-record-settlement-quick').onclick = () => openSettlementModal();
        await renderDebtorsTable(tableArea);
        break;

      case 'settlements':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-new-settlement">
            <i data-lucide="wallet" style="width:16px; height:16px; margin-right:6px;"></i> Post Payment
          </button>
        `;
        document.getElementById('btn-new-settlement').onclick = () => openSettlementModal();
        await renderSettlementsTable(tableArea);
        break;

      case 'loyalty':
        actionArea.innerHTML = ``;
        await renderLoyaltyTable(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Customer Base
  // =========================================================================
  async function renderCustomersTable(target) {
    let query = supabase.from('customers').select('*').order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'crm-table-content',
      columns: [
        { label: 'Customer Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Code', key: 'customer_code', render: (c) => `<code>${c || '-'}</code>` },
        { label: 'Phone', key: 'phone', render: (p) => p || '-' },
        { label: 'Email', key: 'email', render: (e) => e || '-' },
        { label: 'Credit Limit', key: 'credit_limit', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Loyalty Points', key: 'loyalty_points', render: (pts) => `<span class="badge badge-teal">${pts || 0} pts</span>` },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((c) => c.id === id);
        if (item) openCustomerModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Debtor Accounts (Customers with active balance > 0)
  // =========================================================================
  async function renderDebtorsTable(target) {
    let query = supabase
      .from('customers')
      .select('*')
      .gt('outstanding_balance', 0)
      .order('outstanding_balance', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: debtors, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'crm-table-content',
      columns: [
        { label: 'Debtor Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Phone', key: 'phone', render: (p) => p || '-' },
        {
          label: 'Outstanding Debt',
          key: 'outstanding_balance',
          render: (v) => `<strong style="color:var(--color-danger); font-size:0.95rem;">${Number(v).toLocaleString()} ${currency}</strong>`,
        },
        { label: 'Credit Ceiling', key: 'credit_limit', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
      ],
      data: debtors || [],
      onAction: (action, id) => {
        const debtor = debtors.find((d) => d.id === id);
        if (debtor) openSettlementModal(debtor);
      },
    });
  }

  // =========================================================================
  // 3. Credit Settlements Log
  // =========================================================================
  async function renderSettlementsTable(target) {
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
      targetId: 'crm-table-content',
      columns: [
        { label: 'Settlement #', key: 'settlement_no', render: (v) => `<strong>${v}</strong>` },
        { label: 'Debtor', key: 'customers', render: (c) => c?.name || 'Customer' },
        { label: 'Payment Channel', key: 'payment_method', render: (m) => `<span class="badge">${(m || 'cash').toUpperCase()}</span>` },
        { label: 'Reference Code', key: 'reference_no', render: (ref) => ref ? `<code>${ref}</code>` : '-' },
        { label: 'Amount Paid', key: 'amount', render: (v) => `<span style="font-weight:700; color:var(--teal-600);">${Number(v).toLocaleString()} ${currency}</span>` },
        { label: 'Received By', key: 'profiles', render: (p) => p?.full_name || 'Staff' },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: settlements || [],
    });
  }

  // =========================================================================
  // 4. Loyalty Program Log
  // =========================================================================
  async function renderLoyaltyTable(target) {
    let query = supabase
      .from('loyalty_logs')
      .select('*, customers(name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: logs, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'crm-table-content',
      columns: [
        { label: 'Customer', key: 'customers', render: (c) => `<strong>${c?.name || 'Client'}</strong>` },
        { label: 'Activity Type', key: 'action_type', render: (act) => (act || '').toUpperCase() },
        { 
          label: 'Points Earned/Deducted', 
          key: 'points_delta', 
          render: (p) => {
            const isPos = Number(p) >= 0;
            return `<span style="font-weight:700; color:${isPos ? 'var(--teal-600)' : 'var(--color-danger)'};">
              ${isPos ? '+' : ''}${p} pts
            </span>`;
          } 
        },
        { label: 'Date Recorded', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: logs || [],
    });
  }

  // =========================================================================
  // Modals & Action Workflows
  // =========================================================================

  // Customer Add / Edit Modal
  function openCustomerModal(cust = null) {
    const isEdit = !!cust;
    Modal.open({
      title: isEdit ? `Edit Customer: ${cust.name}` : 'Register New Customer',
      content: `
        <form id="form-customer-save">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" name="name" required value="${cust?.name || ''}" placeholder="Customer name" />
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Phone Contact</label>
              <input type="text" name="phone" value="${cust?.phone || ''}" placeholder="+254 7..." />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Email Address</label>
              <input type="email" name="email" value="${cust?.email || ''}" placeholder="client@email.com" />
            </div>
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Credit Limit Ceiling (${currency})</label>
              <input type="number" step="0.01" name="credit_limit" value="${cust?.credit_limit || 0}" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Opening / Manual Debt Balance (${currency})</label>
              <input type="number" step="0.01" name="outstanding_balance" value="${cust?.outstanding_balance || 0}" />
            </div>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Details' : 'Save Customer'}</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const nowIso = new Date().toISOString();
        const payload = {
          shop_id: globalState.activeShopId,
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          credit_limit: parseFloat(formData.credit_limit) || 0,
          outstanding_balance: parseFloat(formData.outstanding_balance) || 0,
          updated_at: nowIso,
        };

        if (!isEdit) {
          payload.customer_code = `CUST-${Math.floor(1000 + Math.random() * 9000)}`;
          payload.created_at = nowIso;
        }

        const { error } = isEdit
          ? await supabase.from('customers').update(payload).eq('id', cust.id)
          : await supabase.from('customers').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Customer profile saved.');
          await loadActiveTab();
        }
      },
    });
  }

  // Credit Settlement Payment Modal
  async function openSettlementModal(targetDebtor = null) {
    let debtorsList = [];
    if (!targetDebtor) {
      let dQuery = supabase.from('customers').select('id, name, outstanding_balance').gt('outstanding_balance', 0);
      if (globalState.activeShopId) dQuery = dQuery.eq('shop_id', globalState.activeShopId);
      const { data } = await dQuery;
      debtorsList = data || [];
      if (!debtorsList.length) {
        Toast.error('No customers currently have outstanding debt.');
        return;
      }
    }

    const debtorOpts = targetDebtor
      ? `<option value="${targetDebtor.id}">${targetDebtor.name} (Debt: ${Number(targetDebtor.outstanding_balance).toLocaleString()} ${currency})</option>`
      : debtorsList.map((d) => `<option value="${d.id}">${d.name} (Debt: ${Number(d.outstanding_balance).toLocaleString()} ${currency})</option>`).join('');

    const initialAmount = targetDebtor ? targetDebtor.outstanding_balance : (debtorsList[0]?.outstanding_balance || 0);
    const settNo = `STL-${Date.now().toString().slice(-6)}`;

    Modal.open({
      title: `Receive Debtor Settlement (${settNo})`,
      content: `
        <form id="form-post-settlement">
          <input type="hidden" name="settlement_no" value="${settNo}" />
          <div class="form-group">
            <label>Select Debtor</label>
            <select name="customer_id" required>${debtorOpts}</select>
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Amount Being Paid (${currency})</label>
              <input type="number" step="0.01" min="1" name="amount" value="${initialAmount}" required />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Payment Method</label>
              <select name="payment_method">
                <option value="cash">Cash</option>
                <option value="mpesa">M-PESA</option>
                <option value="card">Card</option>
              </select>
            </div>
          </div>
          <div class="form-group">
            <label>Transaction / Reference # (e.g. M-PESA Code)</label>
            <input type="text" name="reference_no" placeholder="e.g. QK8910293" />
          </div>
          <div class="form-group">
            <label>Settlement Note</label>
            <input type="text" name="notes" placeholder="Partial or full settlement receipt" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Confirm Settlement & Deduct Debt</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payAmount = parseFloat(formData.amount);
        const nowIso = new Date().toISOString();

        // 1. Insert settlement record
        const { error } = await supabase.from('debtor_settlements').insert([{
          settlement_no: formData.settlement_no,
          shop_id: globalState.activeShopId,
          customer_id: formData.customer_id,
          amount: payAmount,
          payment_method: formData.payment_method,
          reference_no: formData.reference_no || null,
          notes: formData.notes || null,
          received_by: globalState.user?.id,
          created_at: nowIso,
        }]);

        if (error) {
          Toast.error(error.message);
          return;
        }

        // 2. Reduce debtor outstanding balance
        const { data: custRecord } = await supabase
          .from('customers')
          .select('outstanding_balance')
          .eq('id', formData.customer_id)
          .single();

        if (custRecord) {
          const currentBal = parseFloat(custRecord.outstanding_balance) || 0;
          await supabase
            .from('customers')
            .update({
              outstanding_balance: Math.max(0, currentBal - payAmount),
              updated_at: nowIso,
            })
            .eq('id', formData.customer_id);
        }

        Toast.success('Settlement committed. Debtor balance updated.');
        await loadActiveTab();
      },
    });
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}