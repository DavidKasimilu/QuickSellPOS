import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { scoped } from '../tenant.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let activeTab = 'employees'; // 'employees' | 'access-rights' | 'other-staff' | 'commissions' | 'access-logs'

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
        <span style="font-size:0.8125rem; color:var(--text-muted);">Manage staff accounts, roles, POS PINs, and commissions</span>
      </div>
      <div id="employees-action-container"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
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
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} records...</p>`;

    switch (activeTab) {
      case 'employees':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-employee">
            <i data-lucide="user-plus" style="width:16px; height:16px;"></i> Add Employee
          </button>
        `;
        document.getElementById('btn-add-employee').onclick = () => openEmployeeModal(null);
        await renderEmployeesTable(tableArea);
        break;

      case 'access-rights':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-sync-roles">
            <i data-lucide="shield" style="width:16px; height:16px;"></i> Configure Matrix
          </button>
        `;
        document.getElementById('btn-sync-roles').onclick = () => openRoleMatrixModal();
        await renderAccessRightsTable(tableArea);
        break;

      case 'other-staff':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-aux">
            <i data-lucide="user-plus" style="width:16px; height:16px;"></i> Add Auxiliary Staff
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
  // 1. Employees Tab (Add, Edit, Delete)
  // =========================================================================
  async function renderEmployeesTable(target) {
    let query = supabase.from('profiles').select('*, shops(name)').order('full_name');
    query = scoped(query);

    const { data: staff, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    if (!staff || staff.length === 0) {
      target.innerHTML = `
        <div style="padding: 48px 24px; text-align: center; color: var(--text-subtle);">
          <p style="font-size: 0.9rem; margin-bottom: 8px;">No employees registered for this store yet.</p>
          <button class="btn btn-teal-primary btn-sm" id="btn-empty-add-emp">+ Add First Employee</button>
        </div>
      `;
      const emptyBtn = target.querySelector('#btn-empty-add-emp');
      if (emptyBtn) emptyBtn.onclick = () => openEmployeeModal(null);
      return;
    }

    target.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Employee Name</th>
            <th>Email / Phone</th>
            <th>Role</th>
            <th>Assigned Shop</th>
            <th>POS PIN</th>
            <th>Commission</th>
            <th>Status</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${staff
            .map((member) => {
              const isSelf = member.id === globalState.user?.id;
              return `
                <tr>
                  <td>
                    <strong>${member.full_name || 'Unnamed Staff'}</strong>
                    ${isSelf ? '<span class="badge badge-teal" style="margin-left:6px;">YOU</span>' : ''}
                  </td>
                  <td>
                    <div>${member.email || '-'}</div>
                    ${member.phone ? `<div style="font-size:0.75rem; color:var(--text-muted);">${member.phone}</div>` : ''}
                  </td>
                  <td>
                    <span class="badge ${member.role === 'admin' ? 'badge-teal' : ''}">${(member.role || 'staff').toUpperCase()}</span>
                  </td>
                  <td>${member.shops?.name || 'All Locations'}</td>
                  <td><code>${member.pos_pin ? '••••' : 'Not set'}</code></td>
                  <td>${member.commission_rate || 0}%</td>
                  <td>
                    ${
                      member.is_active !== false
                        ? '<span class="badge badge-teal">Active</span>'
                        : '<span class="badge" style="background:#fee2e2; color:#ef4444;">Suspended</span>'
                    }
                  </td>
                  <td style="text-align:right; white-space:nowrap;">
                    <button class="btn btn-outline btn-sm" data-emp-edit="${member.id}" style="margin-right:6px;">
                      Edit
                    </button>
                    <button class="btn btn-outline btn-sm" data-emp-reset="${member.id}" style="margin-right:6px;" ${isSelf ? 'disabled title="Use your profile to change your own password"' : ''}>
                      Reset password
                    </button>
                    <button class="btn btn-outline btn-sm text-danger" data-emp-delete="${member.id}" ${isSelf ? 'disabled title="Cannot delete your own account"' : ''}>
                      Delete
                    </button>
                  </td>
                </tr>
              `;
            })
            .join('')}
        </tbody>
      </table>
    `;

    target.querySelectorAll('[data-emp-edit]').forEach((btn) => {
      btn.onclick = () => {
        const member = staff.find((m) => m.id === btn.dataset.empEdit);
        if (member) openEmployeeModal(member);
      };
    });

    target.querySelectorAll('[data-emp-reset]').forEach((btn) => {
      btn.onclick = () => {
        const member = staff.find((m) => m.id === btn.dataset.empReset);
        if (member) resetEmployeePassword(member);
      };
    });

    target.querySelectorAll('[data-emp-delete]').forEach((btn) => {
      btn.onclick = () => {
        const member = staff.find((m) => m.id === btn.dataset.empDelete);
        if (member) confirmDeleteEmployee(member);
      };
    });
  }

  // Shows a one-time temporary password with a Copy button (avoids typing mistakes)
  function showCredentialsModal(title, fullName, email, password) {
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    Modal.open({
      title,
      content: `
        <p style="margin-bottom:10px;">Share these sign-in details with <strong>${esc(fullName)}</strong>. The password is shown <strong>only once</strong>.</p>
        <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:12px; font-family:monospace; user-select:all;">
          Email: ${esc(email)}<br/>
          Temporary password: <strong>${esc(password)}</strong>
        </div>
        <button type="button" id="btn-copy-credentials" class="btn btn-outline btn-sm" style="margin-top:10px;">Copy details</button>
        <p style="margin-top:10px; font-size:0.8rem; color:var(--text-muted);">Passwords are case-sensitive. Ask them to change it from their profile after the first sign-in.</p>
      `,
    });
    setTimeout(() => {
      const copyBtn = document.getElementById('btn-copy-credentials');
      if (!copyBtn) return;
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(`Email: ${email}\nPassword: ${password}`);
          Toast.success('Copied to clipboard.');
        } catch (e) {
          Toast.error('Could not copy. Select the text and copy it manually.');
        }
      };
    }, 50);
  }

  // Generates a new temporary password for an employee (server-side, same company only)
  async function resetEmployeePassword(member) {
    if (member.id === globalState.user?.id) return;
    if (!window.confirm(`Create a new temporary password for ${member.full_name || member.email}? Their current password will stop working.`)) return;
    const { data, error } = await supabase.functions.invoke('staff-admin', {
      body: { action: 'reset_password', id: member.id },
    });
    if (error || data?.error) {
      Toast.error(data?.error || error.message || 'Could not reset the password.');
      return;
    }
    showCredentialsModal('New temporary password', member.full_name || member.email, member.email, data.temp_password);
  }

  // Delete Employee Workflow
  function confirmDeleteEmployee(member) {
    if (member.id === globalState.user?.id) {
      Toast.error('You cannot delete your currently signed-in administrator profile.');
      return;
    }

    Modal.open({
      title: 'Delete Employee Account',
      content: `
        <form id="form-employee-delete">
          <p style="font-size:0.875rem; color:var(--text-main); margin-bottom:12px;">
            Are you sure you want to remove <strong>${member.full_name || member.email}</strong> from your store team?
          </p>
          <p style="font-size:0.8rem; color:var(--text-muted); background:var(--color-danger-bg); border:1px solid #fecaca; padding:10px 12px; border-radius:6px; margin-bottom:18px;">
            This will revoke their POS and Backoffice access immediately. Past sales receipts recorded under this employee will remain intact for audit accuracy.
          </p>
          <div style="display:flex; gap:10px; justify-content:flex-end;">
            <button type="button" class="btn btn-outline" id="btn-cancel-emp-del">Cancel</button>
            <button type="submit" class="btn" style="background:var(--color-danger); color:#fff;">Delete Employee</button>
          </div>
        </form>
      `,
      onSubmit: async () => {
        const { data, error } = await supabase.functions.invoke('staff-admin', {
          body: { action: 'remove', id: member.id },
        });
        if (error || data?.error) {
          Toast.error(data?.error || error.message || 'Could not remove this employee.');
          return;
        }
        if (data?.mode === 'deactivated') {
          Toast.info('Employee has sales history, so the account was deactivated and sign-in disabled.');
        } else {
          Toast.success(`Employee "${member.full_name || member.email}" deleted.`);
        }
        await loadActiveTab();
      },
    });

    setTimeout(() => {
      const cancelBtn = document.getElementById('btn-cancel-emp-del');
      if (cancelBtn) cancelBtn.onclick = () => Modal.close();
    }, 30);
  }

  // Add / Edit Employee Modal
  async function openEmployeeModal(member = null) {
    const isEdit = !!member;
    const { data: shops } = await supabase.from('shops').select('id, name');
    const defaultShopId = isEdit ? member.shop_id : globalState.activeShopId;

    const shopOpts =
      `<option value="">-- All Locations / Global --</option>` +
      (shops || [])
        .map((s) => `<option value="${s.id}" ${defaultShopId === s.id ? 'selected' : ''}>${s.name}</option>`)
        .join('');

    Modal.open({
      title: isEdit ? `Edit Employee: ${member.full_name || member.email}` : 'Add New Employee',
      content: `
        <form id="form-employee-save">
          <div class="form-group">
            <label>Full Name</label>
            <input type="text" name="full_name" required value="${member?.full_name || ''}" placeholder="e.g. Jane Wanjiku" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Email Address</label>
              <input type="email" name="email" required value="${member?.email || ''}" placeholder="cashier@store.com" ${isEdit ? 'readonly' : ''} />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Phone Number</label>
              <input type="text" name="phone" value="${member?.phone || ''}" placeholder="+254 7..." />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Assigned System Role</label>
              <select name="role">
                <option value="cashier" ${member?.role === 'cashier' ? 'selected' : ''}>Cashier</option>
                <option value="staff" ${member?.role === 'staff' ? 'selected' : ''}>Staff</option>
                <option value="manager" ${member?.role === 'manager' ? 'selected' : ''}>Manager</option>
                <option value="admin" ${member?.role === 'admin' ? 'selected' : ''}>Admin</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>POS Quick-Login PIN (4 Digits)</label>
              <input type="text" name="pos_pin" maxlength="6" pattern="[0-9]{4,6}" inputmode="numeric" value="${member?.pos_pin || ''}" placeholder="e.g. 1234" />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Assigned Store Branch</label>
              <select name="shop_id">${shopOpts}</select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Sales Commission Rate (%)</label>
              <input type="number" step="0.1" min="0" max="100" name="commission_rate" value="${member?.commission_rate ?? 0}" />
            </div>
          </div>

          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-weight:normal;">
              <input type="checkbox" name="is_active" ${member?.is_active !== false ? 'checked' : ''} />
              Account Active (Can sign in to POS & Backoffice)
            </label>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">
            ${isEdit ? 'Save Employee Changes' : 'Create Employee'}
          </button>
        </form>
      `,
      onSubmit: async (formData) => {
        const payload = {
          full_name: formData.full_name.trim(),
          email: formData.email.trim().toLowerCase(),
          phone: formData.phone?.trim() || null,
          role: formData.role,
          pos_pin: formData.pos_pin?.trim() || null,
          shop_id: formData.shop_id || null,
          commission_rate: parseFloat(formData.commission_rate) || 0,
          is_active: formData.is_active === 'on',
        };

        if (payload.role !== 'admin' && !payload.shop_id) {
          Toast.error('Choose a store branch for this employee (only admins can be company-wide).');
          return false;
        }

        if (isEdit) {
          const { email, ...editable } = payload; // login email is not editable here
          const { error } = await supabase
            .from('profiles')
            .update({ ...editable, updated_at: new Date().toISOString() })
            .eq('id', member.id);
          if (error) {
            Toast.error(error.message);
            return false;
          }
          Toast.success('Employee details updated.');
        } else {
          // The login account AND the profile are created together on the server
          const { data, error } = await supabase.functions.invoke('staff-admin', {
            body: { action: 'create', ...payload },
          });
          if (error || data?.error) {
            Toast.error(data?.error || error.message || 'Could not create the employee.');
            return false;
          }
          Toast.success(`Employee "${payload.full_name}" added.`);

          // Show the one-time temporary password after this modal closes
          setTimeout(() => showCredentialsModal('Employee created', payload.full_name, payload.email, data.temp_password), 200);
        }

        await loadActiveTab();
      },
    });
  }

  // =========================================================================
  // 2. Access Rights Matrix Tab
  // =========================================================================
  async function renderAccessRightsTable(target) {
    let query = supabase.from('role_permissions').select('*').order('role');
    query = scoped(query);

    const { data, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const rolesList = data?.length
      ? data
      : [
          { id: '1', role: 'admin', can_void_receipts: true, can_apply_manual_discounts: true, can_view_cost_prices: true, can_adjust_inventory: true },
          { id: '2', role: 'manager', can_void_receipts: true, can_apply_manual_discounts: true, can_view_cost_prices: true, can_adjust_inventory: true },
          { id: '3', role: 'cashier', can_void_receipts: false, can_apply_manual_discounts: false, can_view_cost_prices: false, can_adjust_inventory: false },
          { id: '4', role: 'staff', can_void_receipts: false, can_apply_manual_discounts: false, can_view_cost_prices: false, can_adjust_inventory: false },
        ];

    renderDataTable({
      targetId: 'emp-table-content',
      columns: [
        { label: 'Role Tier', key: 'role', render: (r) => `<strong>${(r || '').toUpperCase()}</strong>` },
        { label: 'Void Receipts', key: 'can_void_receipts', render: (v) => (v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked') },
        { label: 'Manual Discounts', key: 'can_apply_manual_discounts', render: (v) => (v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked') },
        { label: 'View COGS / Costs', key: 'can_view_cost_prices', render: (v) => (v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked') },
        { label: 'Adjust Inventory', key: 'can_adjust_inventory', render: (v) => (v ? '<span class="badge badge-teal">Allowed</span>' : 'Locked') },
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
    query = scoped(query);

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
        { label: 'Status', key: 'is_active', render: (act) => (act ? 'Active' : 'Inactive') },
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
    let profQuery = supabase.from('profiles').select('id, full_name, email, commission_rate');
    let ordQuery = supabase.from('orders').select('cashier_id, total').eq('order_status', 'completed');

    profQuery = scoped(profQuery);
    ordQuery = scoped(ordQuery);

    const [{ data: staff }, { data: orders }] = await Promise.all([profQuery, ordQuery]);

    const report = (staff || []).map((member) => {
      const sales = (orders || [])
        .filter((o) => o.cashier_id === member.id)
        .reduce((sum, o) => sum + Number(o.total || 0), 0);
      const rate = Number(member.commission_rate || 0);
      const earned = Math.round(sales * (rate / 100) * 100) / 100;

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
          render: (v) => `<strong style="color:var(--teal-600);">${Number(v).toLocaleString()} ${currency}</strong>`,
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
    query = scoped(query);

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
          render: (ev) => `<span class="badge ${ev === 'login' ? 'badge-teal' : ''}">${(ev || '').toUpperCase()}</span>`,
        },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
        { label: 'Details', key: 'details', render: (det) => (det ? JSON.stringify(det) : '-') },
      ],
      data: data || [],
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
          updated_at: new Date().toISOString(),
        };

        const { error } = await supabase.from('role_permissions').upsert([payload], { onConflict: 'shop_id, role' });

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
