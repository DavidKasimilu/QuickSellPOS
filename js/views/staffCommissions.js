import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'payouts'; // 'payouts' | 'rules' | 'logs'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Staff Commissions & Incentive Management</h3>
      </div>
      <div id="commission-actions-container"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-comm-tab="payouts">Staff Commission Balances</button>
      <button class="date-chip" data-comm-tab="rules">Commission Rate Rules</button>
      <button class="date-chip" data-comm-tab="logs">Earned Commission Logs</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="commission-table-content"></div>
    </div>
  `;

  // Bind sub-tabs
  container.querySelectorAll('[data-comm-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-comm-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.commTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('commission-actions-container');
    const tableArea = document.getElementById('commission-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} records...</p>`;

    if (activeTab === 'payouts') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-pay-commission">
          <i data-lucide="banknote" style="width:16px; height:16px; margin-right:6px;"></i> Post Commission Payout
        </button>
      `;
      document.getElementById('btn-pay-commission').onclick = () => openCommissionPayoutModal();
      await renderCommissionBalancesTable(tableArea);
    } else if (activeTab === 'rules') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-add-comm-rule">
          <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Commission Rule
        </button>
      `;
      document.getElementById('btn-add-comm-rule').onclick = () => openCommissionRuleModal();
      await renderCommissionRulesTable(tableArea);
    } else {
      actionArea.innerHTML = ``;
      await renderCommissionLogsTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Staff Commission Balances Table
  // =========================================================================
  async function renderCommissionBalancesTable(target) {
    let query = supabase
      .from('store_staff')
      .select('id, full_name, job_title, department, commission_balance')
      .is('deleted_at', null)
      .order('commission_balance', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: staff, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'commission-table-content',
      columns: [
        { label: 'Staff Member Name', key: 'full_name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Designation', key: 'job_title', render: (jt) => jt || 'Sales Rep' },
        { label: 'Department', key: 'department', render: (d) => `<span class="badge">${d || 'Sales'}</span>` },
        { 
          label: 'Unpaid Commission Balance', 
          key: 'commission_balance', 
          render: (bal) => {
            const val = Number(bal || 0);
            return `<strong style="color:${val > 0 ? 'var(--teal-600)' : 'var(--text-muted)'}; font-size:1rem;">
              ${val.toLocaleString()} ${currency}
            </strong>`;
          } 
        },
      ],
      data: staff || [],
      onAction: (action, id) => {
        const item = staff.find((s) => s.id === id);
        if (item) openCommissionPayoutModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Commission Rate Rules Table
  // =========================================================================
  async function renderCommissionRulesTable(target) {
    let query = supabase
      .from('commission_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: rules, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'commission-table-content',
      columns: [
        { label: 'Rule Title', key: 'rule_name', render: (val) => `<strong>${val}</strong>` },
        { 
          label: 'Commission Rate', 
          key: 'rate_type', 
          render: (type, row) => {
            const val = Number(row.rate_value || 0);
            return type === 'percentage' 
              ? `<span class="badge badge-teal">${val}% of Sale Total</span>`
              : `<span class="badge badge-teal">${val.toLocaleString()} ${currency} Fixed Per Sale</span>`;
          } 
        },
        { label: 'Target Category / Scope', key: 'scope', render: (s) => s || 'All Sales' },
        { label: 'Status', key: 'is_active', render: (act) => act !== false ? '<span class="badge badge-teal">ACTIVE</span>' : '<span class="badge">INACTIVE</span>' },
      ],
      data: rules || [],
      onAction: (action, id) => {
        const item = rules.find((r) => r.id === id);
        if (action === 'edit' && item) openCommissionRuleModal(item);
        else if (action === 'delete' && item) deleteCommissionRule(item.id);
      },
    });
  }

  // =========================================================================
  // 3. Earned Commission Logs Table
  // =========================================================================
  async function renderCommissionLogsTable(target) {
    let query = supabase
      .from('staff_commission_logs')
      .select('*, store_staff(full_name), orders(order_number), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: logs, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'commission-table-content',
      columns: [
        { label: 'Staff Member', key: 'store_staff', render: (s) => `<strong>${s?.full_name || 'Staff'}</strong>` },
        { label: 'Order #', key: 'orders', render: (o) => o?.order_number ? `<code>${o.order_number}</code>` : '-' },
        { label: 'Sale Value', key: 'sale_amount', render: (v) => `${Number(v || 0).toLocaleString()} ${currency}` },
        { label: 'Earned Commission', key: 'commission_amount', render: (v) => `<strong style="color:var(--teal-600);">${Number(v || 0).toLocaleString()} ${currency}</strong>` },
        { label: 'Log Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: logs || [],
    });
  }

  // =========================================================================
  // Modals
  // =========================================================================
  async function openCommissionPayoutModal(targetStaff = null) {
    let staffList = [];
    if (!targetStaff) {
      let query = supabase.from('store_staff').select('id, full_name, commission_balance').gt('commission_balance', 0).is('deleted_at', null).order('full_name');
      if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);
      const { data } = await query;
      staffList = data || [];
      if (!staffList.length) {
        Toast.error('No staff members found with accrued commission balances.');
        return;
      }
    }

    const staffOpts = targetStaff
      ? `<option value="${targetStaff.id}">${targetStaff.full_name} (Accrued: ${Number(targetStaff.commission_balance || 0).toLocaleString()} ${currency})</option>`
      : staffList.map((s) => `<option value="${s.id}">${s.full_name} (Accrued: ${Number(s.commission_balance || 0).toLocaleString()} ${currency})</option>`).join('');

    const initialAmount = targetStaff ? (targetStaff.commission_balance || 0) : (staffList[0]?.commission_balance || 0);

    Modal.open({
      title: 'Post Staff Commission Payout',
      content: `
        <form id="form-commission-payout" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Personnel</label>
            <select name="staff_id" required>${staffOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Payout Amount (${currency})</label>
              <input type="number" step="0.01" min="1" name="payout_amount" value="${initialAmount}" required />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Payment Channel</label>
              <select name="payment_method">
                <option value="mpesa">M-PESA / Mobile Money</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cash">Cash</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label>Reference Code / Notes</label>
            <input type="text" name="reference_no" placeholder="e.g. M-PESA Ref / Monthly Payout" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Confirm & Deduct Commission Balance</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payAmount = parseFloat(fd.payout_amount) || 0;
        const nowIso = new Date().toISOString();

        // 1. Log payout record
        const { error: logErr } = await supabase.from('staff_commission_payouts').insert([{
          shop_id: globalState.activeShopId,
          staff_id: fd.staff_id,
          amount: payAmount,
          payment_method: fd.payment_method,
          reference_no: fd.reference_no || null,
          processed_by: globalState.user?.id,
          created_at: nowIso,
        }]);

        if (logErr) {
          Toast.error(logErr.message);
          return;
        }

        // 2. Reduce staff member's accrued balance
        const { data: st } = await supabase.from('store_staff').select('commission_balance').eq('id', fd.staff_id).single();
        if (st) {
          const currentBal = parseFloat(st.commission_balance) || 0;
          await supabase.from('store_staff').update({ commission_balance: Math.max(0, currentBal - payAmount) }).eq('id', fd.staff_id);
        }

        Toast.success('Commission payout recorded successfully.');
        await loadActiveTab();
      },
    });
  }

  function openCommissionRuleModal(rule = null) {
    const isEdit = !!rule;
    Modal.open({
      title: isEdit ? `Edit Rule: ${rule.rule_name}` : 'Create Commission Rule',
      content: `
        <form id="form-comm-rule-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Rule Program Name</label>
            <input type="text" name="rule_name" required value="${rule?.rule_name || ''}" placeholder="Standard Sales Representative Rate" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Calculation Method</label>
              <select name="rate_type" required>
                <option value="percentage" ${rule?.rate_type === 'percentage' ? 'selected' : ''}>Percentage of Sale (%)</option>
                <option value="fixed" ${rule?.rate_type === 'fixed' ? 'selected' : ''}>Fixed Amount Per Order (${currency})</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Rate Value</label>
              <input type="number" step="0.01" min="0.01" name="rate_value" required value="${rule?.rate_value || ''}" placeholder="e.g. 5" />
            </div>
          </div>

          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="is_active" ${rule?.is_active !== false ? 'checked' : ''} />
              Enable Active Commission Incentive
            </label>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Rule' : 'Save Rule'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          rule_name: fd.rule_name,
          rate_type: fd.rate_type,
          rate_value: parseFloat(fd.rate_value) || 0,
          is_active: fd.is_active === 'on',
          updated_at: new Date().toISOString(),
        };

        const { error } = isEdit
          ? await supabase.from('commission_rules').update(payload).eq('id', rule.id)
          : await supabase.from('commission_rules').insert([{ ...payload, created_at: new Date().toISOString() }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Commission rule saved.');
          await loadActiveTab();
        }
      },
    });
  }

  async function deleteCommissionRule(ruleId) {
    if (!confirm('Are you sure you want to delete this commission rule?')) return;
    const { error } = await supabase.from('commission_rules').delete().eq('id', ruleId);
    if (error) Toast.error(error.message);
    else {
      Toast.success('Commission rule removed.');
      await loadActiveTab();
    }
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}