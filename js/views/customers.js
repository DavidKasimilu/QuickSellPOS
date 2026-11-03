import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container, activeTabParam = 'customers') {
  const currency = globalState.preferences?.currency || 'KES';
  let activeTab = activeTabParam || 'customers';
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <span class="live-indicator" style="font-size:0.75rem; color:var(--teal-600); display:inline-flex; align-items:center; gap:4px;">
          <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:var(--teal-600);"></span>
          Live Customer CRM Active
        </span>
      </div>
      <div id="crm-action-container"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip ${activeTab === 'customers' ? 'active' : ''}" data-crm-tab="customers">Customers Directory</button>
      <button class="date-chip ${activeTab === 'debtors' ? 'active' : ''}" data-crm-tab="debtors">Debtor Accounts</button>
      <button class="date-chip ${activeTab === 'settlements' ? 'active' : ''}" data-crm-tab="settlements">Credit Settlements</button>
      <button class="date-chip ${activeTab === 'loyalty' ? 'active' : ''}" data-crm-tab="loyalty">Loyalty Rewards</button>
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

  // Reactive state listener for real-time customer updates
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
  // 1. Customer Base Table Rendering
  // =========================================================================
  async function renderCustomersTable(target) {
    let query = supabase.from('customers').select('*').order('created_at', { ascending: false });
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'crm-table-content',
      columns: [
        { label: 'Customer Code', key: 'customer_code', render: (c) => `<code>${c || '-'}</code>` },
        { 
          label: 'Customer Name', 
          key: 'name', 
          render: (val, row) => `<strong>${row.first_name && row.last_name ? `${row.first_name} ${row.last_name}` : val}</strong>` 
        },
        { label: 'Phone', key: 'phone', render: (p) => p || '-' },
        { label: 'Email', key: 'email', render: (e) => e || '-' },
        { label: 'Country', key: 'country', render: (c) => c || 'Kenya' },
        { 
          label: 'Credit Limit', 
          key: 'credit_limit', 
          render: (v, row) => row.is_credit_customer ? `${Number(v).toLocaleString()} ${currency}` : '<span class="text-muted">Disabled</span>' 
        },
        { 
          label: 'Loyalty Points', 
          key: 'loyalty_points', 
          render: (pts, row) => row.is_loyalty ? `<span class="badge badge-teal">${pts || 0} pts (${row.loyalty_tier || 'Bronze'})</span>` : '<span class="text-muted">N/A</span>' 
        },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((c) => c.id === id);
        if (action === 'edit' && item) openCustomerModal(item);
        else if (action === 'delete' && item) deleteCustomer(item.id);
      },
    });
  }

  // Delete Customer Handler
  async function deleteCustomer(id) {
    if (!confirm('Are you sure you want to remove this customer profile?')) return;
    const { error } = await supabase.from('customers').delete().eq('id', id);
    if (error) Toast.error(error.message);
    else {
      Toast.success('Customer deleted successfully.');
      await loadActiveTab();
    }
  }

  // =========================================================================
  // 2. Debtor Accounts Table
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
        { label: 'Debtor Name', key: 'name', render: (val, row) => `<strong>${row.first_name ? `${row.first_name} ${row.last_name}` : val}</strong>` },
        { label: 'Phone', key: 'phone', render: (p) => p || '-' },
        {
          label: 'Outstanding Debt',
          key: 'outstanding_balance',
          render: (v) => `<strong style="color:var(--color-danger); font-size:0.95rem;">${Number(v).toLocaleString()} ${currency}</strong>`,
        },
        { label: 'Credit Limit', key: 'credit_limit', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Payment Terms', key: 'payment_terms_days', render: (t) => `${t || 30} Days` },
      ],
      data: debtors || [],
      onAction: (action, id) => {
        const debtor = debtors.find((d) => d.id === id);
        if (debtor) openSettlementModal(debtor);
      },
    });
  }

  // =========================================================================
  // 3. Credit Settlements Log Table
  // =========================================================================
  async function renderSettlementsTable(target) {
    let query = supabase
      .from('debtor_settlements')
      .select('*, customers(name, first_name, last_name), profiles(full_name)')
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
        { 
          label: 'Debtor', 
          key: 'customers', 
          render: (c) => c?.first_name ? `${c.first_name} ${c.last_name}` : (c?.name || 'Customer') 
        },
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
  // 4. Loyalty Program Log Table
  // =========================================================================
  async function renderLoyaltyTable(target) {
    let query = supabase
      .from('loyalty_logs')
      .select('*, customers(name, first_name, last_name)')
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
        { label: 'Customer', key: 'customers', render: (c) => `<strong>${c?.first_name ? `${c.first_name} ${c.last_name}` : (c?.name || 'Client')}</strong>` },
        { label: 'Activity Type', key: 'action_type', render: (act) => (act || '').toUpperCase() },
        { 
          label: 'Points Delta', 
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
  // Customer Creation & Editing Modal with Conditional Feature Checkboxes
  // =========================================================================
  async function openCustomerModal(cust = null) {
    const isEdit = !!cust;

    // Fetch Shops for Shop Attachment option
    const { data: shops } = await supabase.from('shops').select('id, name');
    const shopOptions = (shops || []).map((s) => 
      `<option value="${s.id}" ${cust?.shop_id === s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    Modal.open({
      title: isEdit ? `Edit Customer: ${cust.first_name || cust.name}` : 'Create New Customer',
      content: `
        <form id="form-customer-save">
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>First Name</label>
              <input type="text" name="first_name" required value="${cust?.first_name || cust?.name || ''}" placeholder="First name" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Last Name</label>
              <input type="text" name="last_name" value="${cust?.last_name || ''}" placeholder="Last name" />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Email Address</label>
              <input type="email" name="email" value="${cust?.email || ''}" placeholder="client@email.com" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Phone Number</label>
              <input type="text" name="phone" value="${cust?.phone || ''}" placeholder="+254 7..." />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Country</label>
              <select name="country">
                <option value="Kenya" ${cust?.country === 'Kenya' || !cust ? 'selected' : ''}>Kenya</option>
                <option value="Tanzania" ${cust?.country === 'Tanzania' ? 'selected' : ''}>Tanzania</option>
                <option value="Uganda" ${cust?.country === 'Uganda' ? 'selected' : ''}>Uganda</option>
                <option value="Rwanda" ${cust?.country === 'Rwanda' ? 'selected' : ''}>Rwanda</option>
                <option value="Other" ${cust?.country === 'Other' ? 'selected' : ''}>Other</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Date of Birth</label>
              <input type="date" name="dob" value="${cust?.dob || ''}" />
            </div>
          </div>

          <div class="form-group">
            <label>Street Address</label>
            <input type="text" name="address" value="${cust?.address || ''}" placeholder="P.O Box or Physical Address" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>City</label>
              <input type="text" name="city" value="${cust?.city || ''}" placeholder="Nairobi / Voi" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Region / County</label>
              <input type="text" name="region" value="${cust?.region || ''}" placeholder="Coast / Central" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Postal Code</label>
              <input type="text" name="postal_code" value="${cust?.postal_code || ''}" placeholder="80100" />
            </div>
          </div>

          <hr style="margin:16px 0; border:0; border-top:1px solid var(--border-subtle);" />

          <h4 style="margin-bottom:12px; font-size:0.9rem; color:var(--text-main);">Additional Feature Profiles</h4>

          <!-- Feature 1: Loyalty Program -->
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="chk-loyalty" name="is_loyalty" ${cust?.is_loyalty ? 'checked' : ''} />
              <span>Enable Loyalty Program</span>
            </label>
            <div id="fieldset-loyalty" class="${cust?.is_loyalty ? '' : 'hidden'}" style="margin-top:8px; padding:12px; background:var(--teal-50); border-radius:6px; display:flex; gap:12px;">
              <div style="flex:1;">
                <label style="font-size:0.8rem;">Loyalty Tier</label>
                <select name="loyalty_tier">
                  <option value="Bronze" ${cust?.loyalty_tier === 'Bronze' ? 'selected' : ''}>Bronze</option>
                  <option value="Silver" ${cust?.loyalty_tier === 'Silver' ? 'selected' : ''}>Silver</option>
                  <option value="Gold" ${cust?.loyalty_tier === 'Gold' ? 'selected' : ''}>Gold</option>
                  <option value="Platinum" ${cust?.loyalty_tier === 'Platinum' ? 'selected' : ''}>Platinum</option>
                </select>
              </div>
              <div style="flex:1;">
                <label style="font-size:0.8rem;">Starting Points</label>
                <input type="number" name="loyalty_points" value="${cust?.loyalty_points || 0}" />
              </div>
            </div>
          </div>

          <!-- Feature 2: Membership -->
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="chk-membership" name="is_member" ${cust?.is_member ? 'checked' : ''} />
              <span>Assign Membership Plan</span>
            </label>
            <div id="fieldset-membership" class="${cust?.is_member ? '' : 'hidden'}" style="margin-top:8px; padding:12px; background:var(--teal-50); border-radius:6px; display:flex; gap:12px;">
              <div style="flex:1;">
                <label style="font-size:0.8rem;">Membership Plan</label>
                <input type="text" name="membership_plan" value="${cust?.membership_plan || 'Standard'}" placeholder="e.g. VIP VIP Pass" />
              </div>
              <div style="flex:1;">
                <label style="font-size:0.8rem;">Membership Expiry</label>
                <input type="date" name="membership_expiry" value="${cust?.membership_expiry || ''}" />
              </div>
            </div>
          </div>

          <!-- Feature 3: Attach to Shop -->
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="chk-attached-shop" name="is_attached_shop" ${cust?.is_attached_shop ? 'checked' : ''} />
              <span>Attach Customer to Dedicated Shop Branch</span>
            </label>
            <div id="fieldset-shop" class="${cust?.is_attached_shop ? '' : 'hidden'}" style="margin-top:8px; padding:12px; background:var(--teal-50); border-radius:6px;">
              <label style="font-size:0.8rem;">Assigned Store Branch</label>
              <select name="shop_id">${shopOptions}</select>
            </div>
          </div>

          <!-- Feature 4: Credit Customer -->
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="chk-credit" name="is_credit_customer" ${cust?.is_credit_customer ? 'checked' : ''} />
              <span>Enable Debtor / Credit Account</span>
            </label>
            <div id="fieldset-credit" class="${cust?.is_credit_customer ? '' : 'hidden'}" style="margin-top:8px; padding:12px; background:var(--teal-50); border-radius:6px; display:flex; gap:12px;">
              <div style="flex:1;">
                <label style="font-size:0.8rem;">Credit Limit Ceiling (${currency})</label>
                <input type="number" step="0.01" name="credit_limit" value="${cust?.credit_limit || 0}" />
              </div>
              <div style="flex:1;">
                <label style="font-size:0.8rem;">Payment Terms (Days)</label>
                <input type="number" name="payment_terms_days" value="${cust?.payment_terms_days || 30}" />
              </div>
            </div>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:16px;">
            ${isEdit ? 'Update Customer Profile' : 'Save & Register Customer'}
          </button>
        </form>
      `,
      onOpen: () => {
        // Toggle Loyalty Fieldset Visibility
        const chkLoyalty = document.getElementById('chk-loyalty');
        const fsLoyalty = document.getElementById('fieldset-loyalty');
        if (chkLoyalty && fsLoyalty) {
          chkLoyalty.onchange = () => fsLoyalty.classList.toggle('hidden', !chkLoyalty.checked);
        }

        // Toggle Membership Fieldset Visibility
        const chkMember = document.getElementById('chk-membership');
        const fsMember = document.getElementById('fieldset-membership');
        if (chkMember && fsMember) {
          chkMember.onchange = () => fsMember.classList.toggle('hidden', !chkMember.checked);
        }

        // Toggle Shop Attachment Visibility
        const chkShop = document.getElementById('chk-attached-shop');
        const fsShop = document.getElementById('fieldset-shop');
        if (chkShop && fsShop) {
          chkShop.onchange = () => fsShop.classList.toggle('hidden', !chkShop.checked);
        }

        // Toggle Credit Customer Visibility
        const chkCredit = document.getElementById('chk-credit');
        const fsCredit = document.getElementById('fieldset-credit');
        if (chkCredit && fsCredit) {
          chkCredit.onchange = () => fsCredit.classList.toggle('hidden', !chkCredit.checked);
        }
      },
      onSubmit: async (formData) => {
        const nowIso = new Date().toISOString();
        const firstName = formData.first_name || '';
        const lastName = formData.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim();

        const payload = {
          shop_id: formData.is_attached_shop && formData.shop_id ? formData.shop_id : globalState.activeShopId,
          name: fullName || firstName,
          first_name: firstName,
          last_name: lastName,
          email: formData.email || null,
          phone: formData.phone || null,
          country: formData.country || 'Kenya',
          address: formData.address || null,
          city: formData.city || null,
          region: formData.region || null,
          postal_code: formData.postal_code || null,
          dob: formData.dob || null,

          is_loyalty: formData.is_loyalty === 'on' || formData.is_loyalty === true,
          loyalty_tier: formData.loyalty_tier || 'Bronze',
          loyalty_points: parseFloat(formData.loyalty_points) || 0,

          is_member: formData.is_member === 'on' || formData.is_member === true,
          membership_plan: formData.membership_plan || null,
          membership_expiry: formData.membership_expiry || null,

          is_attached_shop: formData.is_attached_shop === 'on' || formData.is_attached_shop === true,

          is_credit_customer: formData.is_credit_customer === 'on' || formData.is_credit_customer === true,
          credit_limit: parseFloat(formData.credit_limit) || 0,
          payment_terms_days: parseInt(formData.payment_terms_days) || 30,

          updated_at: nowIso,
        };

        if (!isEdit) {
          payload.created_at = nowIso;
        }

        const { error } = isEdit
          ? await supabase.from('customers').update(payload).eq('id', cust.id)
          : await supabase.from('customers').insert([payload]);

        if (error) {
          Toast.error(error.message);
        } else {
          Toast.success('Customer profile saved successfully.');
          await loadActiveTab();
        }
      },
    });
  }

  // Credit Settlement Payment Modal
  async function openSettlementModal(targetDebtor = null) {
    let debtorsList = [];
    if (!targetDebtor) {
      let dQuery = supabase.from('customers').select('id, name, first_name, last_name, outstanding_balance').gt('outstanding_balance', 0);
      if (globalState.activeShopId) dQuery = dQuery.eq('shop_id', globalState.activeShopId);
      const { data } = await dQuery;
      debtorsList = data || [];
      if (!debtorsList.length) {
        Toast.error('No customers currently have outstanding debt.');
        return;
      }
    }

    const debtorOpts = targetDebtor
      ? `<option value="${targetDebtor.id}">${targetDebtor.first_name ? `${targetDebtor.first_name} ${targetDebtor.last_name}` : targetDebtor.name} (Debt: ${Number(targetDebtor.outstanding_balance).toLocaleString()} ${currency})</option>`
      : debtorsList.map((d) => `<option value="${d.id}">${d.first_name ? `${d.first_name} ${d.last_name}` : d.name} (Debt: ${Number(d.outstanding_balance).toLocaleString()} ${currency})</option>`).join('');

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