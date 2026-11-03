import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let activeTab = 'roles'; // 'roles' | 'staff'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Access Control & User Roles</h3>
      </div>
      <div id="access-actions-container"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-access-tab="roles">System Roles & Permissions</button>
      <button class="date-chip" data-access-tab="staff">Staff Access Assignments</button>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="access-table-content"></div>
    </div>
  `;

  // Bind tab navigation
  container.querySelectorAll('[data-access-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-access-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.accessTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('access-actions-container');
    const tableArea = document.getElementById('access-table-content');
    if (!actionArea || !tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    if (activeTab === 'roles') {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-add-role">
          <i data-lucide="shield-plus" style="width:16px; height:16px; margin-right:6px;"></i> Create System Role
        </button>
      `;
      document.getElementById('btn-add-role').onclick = () => openRoleModal();
      await renderRolesTable(tableArea);
    } else {
      actionArea.innerHTML = `
        <button class="btn btn-teal-primary" id="btn-invite-staff">
          <i data-lucide="user-plus" style="width:16px; height:16px; margin-right:6px;"></i> Assign Staff Role
        </button>
      `;
      document.getElementById('btn-invite-staff').onclick = () => openStaffAssignmentModal();
      await renderStaffTable(tableArea);
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. System Roles & Permissions Matrix
  // =========================================================================
  async function renderRolesTable(target) {
    let query = supabase
      .from('user_roles')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: roles, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'access-table-content',
      columns: [
        { label: 'Role Title', key: 'role_name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Role Code', key: 'role_key', render: (k) => `<code>${k}</code>` },
        { label: 'Description', key: 'description', render: (d) => d || '-' },
        { 
          label: 'Granted Modules', 
          key: 'permissions', 
          render: (perms) => {
            const list = Array.isArray(perms) ? perms : [];
            return list.length 
              ? list.map((p) => `<span class="badge" style="margin-right:4px;">${p}</span>`).join('')
              : '<span class="badge">Full Access</span>';
          } 
        },
      ],
      data: roles || [],
      onAction: (action, id) => {
        const item = roles.find((r) => r.id === id);
        if (action === 'edit' && item) openRoleModal(item);
        else if (action === 'delete' && item) confirmDeleteRole(item);
      },
    });
  }

  // =========================================================================
  // 2. Staff Access Assignments Table
  // =========================================================================
  async function renderStaffTable(target) {
    let query = supabase
      .from('user_shop_roles')
      .select('*, profiles(full_name, email), user_roles(role_name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: staffList, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'access-table-content',
      columns: [
        { label: 'Staff Name', key: 'profiles', render: (p) => `<strong>${p?.full_name || 'Staff Member'}</strong>` },
        { label: 'Email Address', key: 'profiles', render: (p) => p?.email || '-' },
        { label: 'Assigned Role', key: 'user_roles', render: (r) => `<span class="badge badge-teal">${r?.role_name || 'Cashier'}</span>` },
        { label: 'Access Status', key: 'is_active', render: (act) => act !== false ? '<span class="badge badge-teal">ENABLED</span>' : '<span class="badge text-danger">SUSPENDED</span>' },
      ],
      data: staffList || [],
      onAction: (action, id) => {
        const item = staffList.find((s) => s.id === id);
        if (item) toggleStaffStatus(item);
      },
    });

    target.querySelectorAll('button[data-row-id]').forEach((btn) => {
      const item = staffList.find((s) => s.id === btn.dataset.rowId);
      if (item) {
        btn.textContent = item.is_active !== false ? 'Suspend' : 'Activate';
        if (item.is_active !== false) btn.classList.add('text-danger');
      }
    });
  }

  // =========================================================================
  // Modals
  // =========================================================================
  function openRoleModal(role = null) {
    const isEdit = !!role;
    const moduleOptions = [
      'pos_register',
      'inventory_management',
      'sales_reports',
      'customer_directory',
      'suppliers_purchases',
      'loyalty_rewards',
      'settings_system'
    ];

    const currentPerms = Array.isArray(role?.permissions) ? role.permissions : [];
    const checkboxesHtml = moduleOptions.map((mod) => `
      <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:0.85rem;">
        <input type="checkbox" name="permissions" value="${mod}" ${currentPerms.includes(mod) ? 'checked' : ''} />
        ${mod.replace('_', ' ').toUpperCase()}
      </label>
    `).join('');

    Modal.open({
      title: isEdit ? `Edit Role: ${role.role_name}` : 'Create User Role',
      content: `
        <form id="form-role-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Role Name</label>
            <input type="text" name="role_name" required value="${role?.role_name || ''}" placeholder="e.g. Store Manager" />
          </div>

          <div class="form-group">
            <label>Role Key (Identifier)</label>
            <input type="text" name="role_key" required value="${role?.role_key || ''}" placeholder="e.g. store_manager" />
          </div>

          <div class="form-group">
            <label>Description</label>
            <input type="text" name="description" value="${role?.description || ''}" placeholder="Handles inventory and cashier oversight" />
          </div>

          <div class="form-group">
            <label style="font-weight:600; margin-bottom:8px; display:block;">Module Permissions</label>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; background:var(--bg-surface); padding:12px; border-radius:6px; border:1px solid var(--border-subtle);">
              ${checkboxesHtml}
            </div>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Role' : 'Save Role'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const selectedPerms = Array.from(document.querySelectorAll('input[name="permissions"]:checked')).map((c) => c.value);

        const payload = {
          shop_id: globalState.activeShopId,
          role_name: fd.role_name,
          role_key: fd.role_key.toLowerCase().trim(),
          description: fd.description || null,
          permissions: selectedPerms,
          updated_at: new Date().toISOString(),
        };

        const { error } = isEdit
          ? await supabase.from('user_roles').update(payload).eq('id', role.id)
          : await supabase.from('user_roles').insert([{ ...payload, created_at: new Date().toISOString() }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Role permissions updated.');
          await loadActiveTab();
        }
      },
    });
  }

  async function openStaffAssignmentModal() {
    const [{ data: profiles }, { data: roles }] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').order('full_name'),
      supabase.from('user_roles').select('id, role_name').is('deleted_at', null).order('role_name'),
    ]);

    if (!profiles || !profiles.length) {
      Toast.error('No staff profiles registered in the system.');
      return;
    }
    if (!roles || !roles.length) {
      Toast.error('Please create at least one system role first.');
      return;
    }

    const profileOpts = profiles.map((p) => `<option value="${p.id}">${p.full_name || p.email}</option>`).join('');
    const roleOpts = roles.map((r) => `<option value="${r.id}">${r.role_name}</option>`).join('');

    Modal.open({
      title: 'Assign Staff System Role',
      content: `
        <form id="form-staff-role-assign" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Select Staff Member Profile</label>
            <select name="user_id" required>${profileOpts}</select>
          </div>

          <div class="form-group">
            <label>Assign System Role</label>
            <select name="role_id" required>${roleOpts}</select>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">Confirm Role Assignment</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          user_id: fd.user_id,
          role_id: fd.role_id,
          is_active: true,
          created_at: new Date().toISOString(),
        };

        const { error } = await supabase.from('user_shop_roles').upsert([payload], { onConflict: 'user_id,shop_id' });

        if (error) Toast.error(error.message);
        else {
          Toast.success('Staff role assigned.');
          await loadActiveTab();
        }
      },
    });
  }

  async function confirmDeleteRole(role) {
    if (!confirm(`Are you sure you want to delete role "${role.role_name}"?`)) return;

    const { error } = await supabase
      .from('user_roles')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', role.id);

    if (error) Toast.error(error.message);
    else {
      Toast.success(`Role "${role.role_name}" removed.`);
      await loadActiveTab();
    }
  }

  async function toggleStaffStatus(item) {
    const nextState = !(item.is_active !== false);
    const { error } = await supabase
      .from('user_shop_roles')
      .update({ is_active: nextState })
      .eq('id', item.id);

    if (error) Toast.error(error.message);
    else {
      Toast.success('Staff access status updated.');
      await loadActiveTab();
    }
  }

  await loadActiveTab();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}