import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let activeTab = 'employees'; // 'employees' | 'access-rights' | 'other-staff' | 'commissions' | 'access-logs'

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">

      <div id="employees-action-container"></div>
    </div>

    <!-- Group 6 Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-emp-tab="employees">Employees</button>
      <button class="date-chip" data-emp-tab="access-rights">Access Rights</button>
      <button class="date-chip" data-emp-tab="other-staff">Other Staff</button>
      <button class="date-chip" data-emp-tab="commissions">Staff Commissions</button>
      <button class="date-chip" data-emp-tab="access-logs">Access Logs</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="emp-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-emp-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-emp-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.empTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('employees-action-container');
    const tableArea = document.getElementById('emp-table-content');
    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} records...</p>`;

    switch (activeTab) {
      case 'employees':
        actionArea.innerHTML = ``;
        await renderEmployeesTable(tableArea);
        break;

      case 'access-rights':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-sync-roles">
            <i data-lucide="shield" style="width:16px; height:16px; margin-right:6px;"></i> Configure Matrix
          </button>
        `;
        document.getElementById('btn-sync-roles').onclick = () => openRoleMatrixModal();
        await renderAccessRightsTable(tableArea);
        break;

      case 'other-staff':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-aux">
            <i data-lucide="user-plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Auxiliary Staff
          </button>
        `;
        document.getElementById('btn-add-aux').onclick = () => openAuxiliaryStaffModal();
        await renderOtherStaffTable(tableArea);
        break;

      case 'commissions':
        actionArea.innerHTML = ``;
        await renderCommissionsReport(tableArea);
        break;

      case 'access-logs':
        actionArea.innerHTML = ``;
        await renderAccessLogsTable(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Employees Tab
  // =========================================================================
  async function renderEmployeesTable(target) {
    let query = supabase.from('profiles').select('*, shops(name)').order('role');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: staff, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'emp-table-content',
      columns: [
        { label: 'Employee Name', key: 'full_name', render: (val, row) => `<strong>${val || row.email}</strong>` },
        { label: 'Login Email', key: 'email' },
        { 
          label: 'Role', 
          key: 'role', 
          render: (r) => `<span class="badge ${r === 'admin' ? 'badge-teal' : ''}">${r.toUpperCase()}</span>` 
        },
        { label: 'Assigned Shop', key: 'shops', render: (s) => s?.name || 'All Locations' },
        { label: 'Commission Rate', key: 'commission_rate', render: (c) => `${c || 0}%` },
        { label: 'Status', key: 'is_active', render: (act) => act ? 'Active' : 'Suspended' },
      ],
      data: staff || [],
      onAction: (action, id) => {
        const member = staff.find((m) => m.id === id);
        if (member) openEmployeeModal(member);
      },
    });
  }

  // =========================================================================
  // 2. Access Rights Matrix Tab
  // =========================================================================
  async function renderAccessRightsTable(target) {
    let query = supabase.from('role_permissions').select('*').order('role');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    // Default template fallbacks if not yet initialized in database
    const rolesList = data?.length ? data : [
      { id: '1', role: 'admin', can_void_receipts: true, can_apply_manual_discounts: true, can_view_cost_prices: true, can_adjust_inventory: true },
      { id: '2', role: 'manager', can_void_receipts: true, can_apply_manual_discounts: true, can_view_cost_prices: true, can_adjust_inventory: true },
      { id: '3', role: 'cashier', can_void_receipts: false, can_apply_manual_discounts: false, can_view_cost_prices: false, can_adjust_inventory: false },
      { id: '4', role: 'staff', can_void_receipts: false, can_apply_manual_discounts: false, can_view_cost_prices: false, can_adjust_inventory: false },
    ];

    renderDataTable({
      targetId: 'emp-table-content',
      columns: [
        { label: 'Role Tier', key: 'role', render: (r) => `<strong>${r.toUpperCase()}</strong>` },
        { label: 'Void Receipts', key: 'can_void_receipts', render: (v) => v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked' },
        { label: 'Manual Discounts', key: 'can_apply_manual_discounts', render: (v) => v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked' },
        { label: 'View COGS / Costs', key: 'can_view_cost_prices', render: (v) => v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked' },
        { label: 'Adjust Inventory', key: 'can_adjust_inventory', render: (v) => v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked' },
      ],
      data: rolesList,
      onAction: (action, id) => {
        const item = rolesList.find((r) => r.id === id);
        if (item) openRoleMatrixModal(item);
      },
    });
  }

  // =========================================================================
  // 3. Other Staff Directory Tab
  // =========================================================================
  async function renderOtherStaffTable(target) {
    let query = supabase.from('auxiliary_staff').select('*').order('full_name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'emp-table-content',
      columns: [
        { label: 'Full Name', key: 'full_name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Role / Designation', key: 'role_title', render: (r) => `<span class="badge">${r}</span>` },
        { label: 'Phone', key: 'phone' },
        { label: 'National ID', key: 'national_id', render: (id) => id || '-' },
        { label: 'Daily Compensation', key: 'daily_wage', render: (w) => `${Number(w).toLocaleString()} ${currency}` },
        { label: 'Status', key: 'is_active', render: (act) => act ? 'Active' : 'Inactive' },
      ],
      data: data || [],
      onAction: (action, id) => {
        const item = data.find((a) => a.id === id);
        if (item) openAuxiliaryStaffModal(item);
      },
    });
  }

  // =========================================================================
  // 4. Staff Commissions Report
  // =========================================================================
  async function renderCommissionsReport(target) {
    const { data: staff } = await supabase.from('profiles').select('id, full_name, email, commission_rate');
    const { data: orders } = await supabase.from('orders').select('cashier_id, total').eq('order_status', 'completed');

    const report = (staff || []).map((member) => {
      const sales = (orders || [])
        .filter((o) => o.cashier_id === member.id)
        .reduce((sum, o) => sum + Number(o.total || 0), 0);
      const rate = Number(member.commission_rate || 0);
      const earned = Math.round((sales * (rate / 100)) * 100) / 100;

      return {
        id: member.id,
        name: member.full_name || member.email,
        totalSales: sales,
        rate: `${rate}%`,
        earnedCommission: earned,
      };
    });

    renderDataTable({
      targetId: 'emp-table-content',
      columns: [
        { label: 'Employee', key: 'name', render: (n) => `<strong>${n}</strong>` },
        { label: 'Total Sales Generated', key: 'totalSales', render: (v) => `${Number(v).toLocaleString()} ${currency}` },
        { label: 'Agreed Rate', key: 'rate' },
        { 
          label: 'Commission Accrued', 
          key: 'earnedCommission', 
          render: (v) => `<strong style="color:var(--teal-600);">${Number(v).toLocaleString()} ${currency}</strong>` 
        },
      ],
      data: report,
    });
  }

  // =========================================================================
  // 5. Access Logs Tab
  // =========================================================================
  async function renderAccessLogsTable(target) {
    let query = supabase.from('access_logs').select('*').order('created_at', { ascending: false }).limit(50);
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'emp-table-content',
      columns: [
        { label: 'Account Email', key: 'user_email', render: (e) => `<strong>${e}</strong>` },
        { 
          label: 'Event Type', 
          key: 'event_type', 
          render: (ev) => `<span class="badge ${ev === 'login' ? 'badge-teal' : ''}">${ev.toUpperCase()}</span>` 
        },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
        { label: 'Details', key: 'details', render: (det) => det ? JSON.stringify(det) : '-' },
      ],
      data: data || [],
    });
  }

  // =========================================================================
  // Modals & Action Workflows
  // =========================================================================

  // Employee Edit Modal
  async function openEmployeeModal(member) {
    const { data: shops } = await supabase.from('shops').select('id, name');
    const shopOpts = `<option value="">-- All Locations / Global --</option>` + (shops || []).map((s) => 
      `<option value="${s.id}" ${member.shop_id === s.id ? 'selected' : ''}>${s.name}</option>`
    ).join('');

    Modal.open({
      title: `Employee: ${member.full_name || member.email}`,
      content: `
        <form id="form-employee-edit">
          <div class="form-group">
            <label>Assigned System Role</label>
            <select name="role">
              <option value="cashier" ${member.role === 'cashier' ? 'selected' : ''}>Cashier</option>
              <option value="staff" ${member.role === 'staff' ? 'selected' : ''}>Staff</option>
              <option value="manager" ${member.role === 'manager' ? 'selected' : ''}>Manager</option>
              <option value="admin" ${member.role === 'admin' ? 'selected' : ''}>Admin</option>
            </select>
          </div>
          <div class="form-group">
            <label>Assigned Store Branch</label>
            <select name="shop_id">${shopOpts}</select>
          </div>
          <div class="form-group">
            <label>Sales Commission Rate (%)</label>
            <input type="number" step="0.1" name="commission_rate" value="${member.commission_rate || 0}" />
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:normal;">
              <input type="checkbox" name="is_active" ${member.is_active !== false ? 'checked' : ''} />
              Account Active
            </label>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Commit Employee Rights</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const { error } = await supabase
          .from('profiles')
          .update({
            role: formData.role,
            shop_id: formData.shop_id || null,
            commission_rate: parseFloat(formData.commission_rate) || 0,
            is_active: formData.is_active === 'on',
          })
          .eq('id', member.id);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Employee credentials updated.');
          await loadActiveTab();
        }
      },
    });
  }

  // Granular Access Rights Matrix Modal
  function openRoleMatrixModal(tier = null) {
    const roleTarget = tier?.role || 'cashier';
    Modal.open({
      title: `Role Matrix: ${roleTarget.toUpperCase()}`,
      content: `
        <form id="form-role-matrix-save">
          <input type="hidden" name="role" value="${roleTarget}" />
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
              <input type="checkbox" name="can_void_receipts" ${tier?.can_void_receipts ? 'checked' : ''} />
              Allow Voiding & Deleting Receipts
            </label>
            <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
              <input type="checkbox" name="can_apply_manual_discounts" ${tier?.can_apply_manual_discounts ? 'checked' : ''} />
              Allow Overriding / Manual Register Discounts
            </label>
            <label style="display:flex; align-items:center; gap:8px; margin-bottom:8px; cursor:pointer;">
              <input type="checkbox" name="can_view_cost_prices" ${tier?.can_view_cost_prices ? 'checked' : ''} />
              Allow Viewing Unit COGS / Cost Margins
            </label>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="can_adjust_inventory" ${tier?.can_adjust_inventory ? 'checked' : ''} />
              Allow Manual Stock Count Adjustments
            </label>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Save Permission Matrix</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          shop_id: globalState.activeShopId,
          role: formData.role,
          can_void_receipts: formData.can_void_receipts === 'on',
          can_apply_manual_discounts: formData.can_apply_manual_discounts === 'on',
          can_view_cost_prices: formData.can_view_cost_prices === 'on',
          can_adjust_inventory: formData.can_adjust_inventory === 'on',
        };

        const { error } = await supabase
          .from('role_permissions')
          .upsert([payload], { onConflict: 'shop_id, role' });

        if (error) Toast.error(error.message);
        else {
          Toast.success('Permissions matrix saved.');
          await loadActiveTab();
        }
      },
    });
  }

  // Other Staff Add / Edit Modal
  function openAuxiliaryStaffModal(staffItem = null) {
    const isEdit = !!staffItem;
    Modal.open({
      title: isEdit ? `Edit: ${staffItem.full_name}` : 'New Auxiliary Staff',
      content: `
        <form id="form-aux-save">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" name="full_name" required value="${staffItem?.full_name || ''}" placeholder="Staff member name" />
          </div>
          <div class="form-group">
            <label>Designation / Role Title</label>
            <input type="text" name="role_title" required value="${staffItem?.role_title || ''}" placeholder="e.g. Delivery Rider, Inventory Sorter" />
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Phone Contact</label>
              <input type="text" name="phone" value="${staffItem?.phone || ''}" placeholder="+254 7..." />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Daily Wage (${currency})</label>
              <input type="number" step="0.01" name="daily_wage" value="${staffItem?.daily_wage || 0}" />
            </div>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Details' : 'Save Staff'}</button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          shop_id: globalState.activeShopId,
          full_name: formData.full_name,
          role_title: formData.role_title,
          phone: formData.phone,
          daily_wage: parseFloat(formData.daily_wage) || 0,
        };

        const { error } = isEdit
          ? await supabase.from('auxiliary_staff').update(payload).eq('id', staffItem.id)
          : await supabase.from('auxiliary_staff').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Staff record updated.');
          await loadActiveTab();
        }
      },
    });
  }

  await loadActiveTab();
  return () => {};
}