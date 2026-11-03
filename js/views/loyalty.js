import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = 'members'; // 'members' | 'rules' | 'logs'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Customer Loyalty & Rewards</h3>
      </div>
      <div id="loyalty-actions-container"></div>
    </div>

    <!-- Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-loyalty-tab="members">Member Balances</button>
      <button class="date-chip" data-loyalty-tab="rules">Earning & Redemption Rules</button>
      <button class="date-chip" data-loyalty-tab="logs">Points Activity Log</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="loyalty-table-content"></div>
    </div>
  `;

  // Bind tab navigation
  container.querySelectorAll('[data-loyalty-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-loyalty-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.loyaltyTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('loyalty-actions-container');
    const tableArea = document.getElementById('loyalty-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    if (activeTab === 'members') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-adjust-points">
          <i data-lucide="plus-circle" style="width:16px; height:16px; margin-right:6px;"></i> Issue / Redeem Points
        </button>
      `;
      document.getElementById('btn-adjust-points').onclick = () => openAdjustPointsModal();
      await renderMembersTable(tableArea);
    } else if (activeTab === 'rules') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-add-rule">
          <i data-lucide="settings" style="width:16px; height:16px; margin-right:6px;"></i> Add Loyalty Rule
        </button>
      `;
      document.getElementById('btn-add-rule').onclick = () => openRuleModal();
      await renderRulesTable(tableArea);
    } else {
      actionArea.innerHTML = ``;
      await renderActivityLogsTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Loyalty Members & Points Balances
  // =========================================================================
  async function renderMembersTable(target) {
    let query = supabase
      .from('customers')
      .select('id, name, phone, email, loyalty_points, loyalty_tier')
      .is('deleted_at', null)
      .order('loyalty_points', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: customers, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'loyalty-table-content',
      columns: [
        { label: 'Customer Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Phone Number', key: 'phone', render: (p) => p || '-' },
        { 
          label: 'Tier Status', 
          key: 'loyalty_tier', 
          render: (tier) => {
            const t = (tier || 'bronze').toLowerCase();
            let badgeClass = 'badge';
            if (t === 'gold') badgeClass = 'badge badge-teal';
            else if (t === 'silver') badgeClass = 'badge';
            return `<span class="${badgeClass}">${t.toUpperCase()}</span>`;
          } 
        },
        { 
          label: 'Available Points', 
          key: 'loyalty_points', 
          render: (pts) => `<strong style="color:var(--teal-600); font-size:1rem;">${Number(pts || 0).toLocaleString()} pts</strong>` 
        },
      ],
      data: customers || [],
      onAction: (action, id) => {
        const item = customers.find((c) => c.id === id);
        if (item) openAdjustPointsModal(item);
      },
    });
  }

  // =========================================================================
  // 2. Loyalty Rules
  // =========================================================================
  async function renderRulesTable(target) {
    let query = supabase
      .from('loyalty_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: rules, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'loyalty-table-content',
      columns: [
        { label: 'Rule Name', key: 'rule_name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Earn Rate', key: 'spend_amount_per_point', render: (v) => `1 Pt per ${Number(v || 100).toLocaleString()} ${currency} spent` },
        { label: 'Point Redemption Value', key: 'point_redemption_value', render: (v) => `1 Pt = ${Number(v || 1).toLocaleString()} ${currency}` },
        { label: 'Status', key: 'is_active', render: (act) => act ? '<span class="badge badge-teal">ACTIVE</span>' : '<span class="badge">INACTIVE</span>' },
      ],
      data: rules || [],
      onAction: (action, id) => {
        const item = rules.find((r) => r.id === id);
        if (action === 'edit' && item) openRuleModal(item);
        else if (action === 'delete' && item) deleteRule(item.id);
      },
    });
  }

  // =========================================================================
  // 3. Activity Logs Table
  // =========================================================================
  async function renderActivityLogsTable(target) {
    let query = supabase
      .from('loyalty_point_logs')
      .select('*, customers(name), profiles(full_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: logs, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'loyalty-table-content',
      columns: [
        { label: 'Customer', key: 'customers', render: (c) => `<strong>${c?.name || 'Customer'}</strong>` },
        { 
          label: 'Type', 
          key: 'transaction_type', 
          render: (t) => {
            const isEarn = t === 'earned';
            return `<span class="badge ${isEarn ? 'badge-teal' : 'text-danger'}">${(t || 'earned').toUpperCase()}</span>`;
          } 
        },
        { 
          label: 'Points Delta', 
          key: 'points', 
          render: (pts, row) => {
            const val = Number(pts || 0);
            const isEarn = row.transaction_type === 'earned';
            return `<strong style="color:${isEarn ? 'var(--teal-600)' : 'var(--color-danger)'};">${isEarn ? `+${val}` : `-${val}`} pts</strong>`;
          } 
        },
        { label: 'Description', key: 'description', render: (d) => d || '-' },
        { label: 'Processed By', key: 'profiles', render: (p) => p?.full_name || 'System' },
        { label: 'Date', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: logs || [],
    });
  }

  // =========================================================================
  // Modals
  // =========================================================================
  async function openAdjustPointsModal(targetCustomer = null) {
    let customerList = [];
    if (!targetCustomer) {
      let query = supabase.from('customers').select('id, name, loyalty_points').is('deleted_at', null).order('name');
      if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);
      const { data } = await query;
      customerList = data || [];
      if (!customerList.length) {
        Toast.error('No customers found in directory.');
        return;
      }
    }

    const customerOpts = targetCustomer
      ? `<option value="${targetCustomer.id}">${targetCustomer.name} (Current: ${targetCustomer.loyalty_points || 0} pts)</option>`
      : customerList.map((c) => `<option value="${c.id}">${c.name} (Current: ${c.loyalty_points || 0} pts)</option>`).join('');

    Modal.open({
      title: 'Issue / Redeem Loyalty Points',
      content: `
        <form id="form-adjust-points" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Customer</label>
            <select name="customer_id" required>${customerOpts}</select>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Action Type</label>
              <select name="transaction_type" required>
                <option value="earned">Issue Points (+)</option>
                <option value="redeemed">Redeem Points (-)</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Points Quantity</label>
              <input type="number" min="1" name="points" placeholder="e.g. 50" required />
            </div>
          </div>

          <div class="form-group">
            <label>Reason / Note</label>
            <input type="text" name="description" placeholder="e.g. Promotional bonus / Checkout redemption" required />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">Process Points Update</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const ptsVal = parseInt(fd.points) || 0;
        const isEarn = fd.transaction_type === 'earned';

        // 1. Log transaction
        const { error: logErr } = await supabase.from('loyalty_point_logs').insert([{
          shop_id: globalState.activeShopId,
          customer_id: fd.customer_id,
          transaction_type: fd.transaction_type,
          points: ptsVal,
          description: fd.description,
          created_by: globalState.user?.id,
          created_at: new Date().toISOString(),
        }]);

        if (logErr) {
          Toast.error(logErr.message);
          return;
        }

        // 2. Update customer balance
        const { data: cust } = await supabase.from('customers').select('loyalty_points').eq('id', fd.customer_id).single();
        if (cust) {
          const currentPts = parseInt(cust.loyalty_points || 0);
          const newPts = isEarn ? currentPts + ptsVal : Math.max(0, currentPts - ptsVal);

          await supabase.from('customers').update({ loyalty_points: newPts }).eq('id', fd.customer_id);
        }

        Toast.success('Loyalty points updated.');
        await loadActiveTab();
      },
    });
  }

  function openRuleModal(rule = null) {
    const isEdit = !!rule;
    Modal.open({
      title: isEdit ? `Edit Rule: ${rule.rule_name}` : 'Add Loyalty Rule',
      content: `
        <form id="form-rule-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Rule Program Name</label>
            <input type="text" name="rule_name" required value="${rule?.rule_name || ''}" placeholder="Standard Purchase Rewards" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Spend Amount Per 1 Point (${currency})</label>
              <input type="number" step="0.01" name="spend_amount_per_point" required value="${rule?.spend_amount_per_point || 100}" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>1 Point Cash Value (${currency})</label>
              <input type="number" step="0.01" name="point_redemption_value" required value="${rule?.point_redemption_value || 1}" />
            </div>
          </div>

          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="is_active" ${rule?.is_active !== false ? 'checked' : ''} />
              Enable Rule
            </label>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Rule' : 'Save Rule'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          rule_name: fd.rule_name,
          spend_amount_per_point: parseFloat(fd.spend_amount_per_point) || 100,
          point_redemption_value: parseFloat(fd.point_redemption_value) || 1,
          is_active: fd.is_active === 'on',
        };

        const { error } = isEdit
          ? await supabase.from('loyalty_rules').update(payload).eq('id', rule.id)
          : await supabase.from('loyalty_rules').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Loyalty rule saved.');
          await loadActiveTab();
        }
      },
    });
  }

  async function deleteRule(ruleId) {
    if (!confirm('Are you sure you want to delete this rule?')) return;
    const { error } = await supabase.from('loyalty_rules').delete().eq('id', ruleId);
    if (error) Toast.error(error.message);
    else {
      Toast.success('Rule removed.');
      await loadActiveTab();
    }
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}