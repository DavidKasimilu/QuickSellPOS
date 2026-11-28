import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';
import { scoped } from '../tenant.js';
import { hasRight, isAdmin } from '../components/permissions.js';
import { fetchAccessRoles } from '../components/rights.js';
import { pinBoxesHtml, bindPinBoxes, isWeakPin, PIN_HELP, ensureOwnPin } from '../components/PinInput.js';

// ---------------------------------------------------------------------------
// Employees
//   #employees              the list
//   #employees?new=1        create an employee
//   #employees?edit=<id>    edit an employee
// Roles live on their own page (Employees > Roles & permissions).
// ---------------------------------------------------------------------------

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TIER_LABEL = { admin: 'Administrator', owner: 'Administrator', manager: 'Manager', cashier: 'Cashier', staff: 'Cashier' };
const TIER_ROLE_KEY = { admin: 'administrator', owner: 'administrator', manager: 'manager', cashier: 'cashier', staff: 'cashier' };

// Used until the roles migration has been run: the old fixed roles
const LEGACY_ROLES = [
  { id: 'tier:cashier', name: 'Cashier', role_key: 'cashier', base_role: 'cashier', pos_access: true, backoffice_access: false, legacy: true },
  { id: 'tier:manager', name: 'Manager', role_key: 'manager', base_role: 'manager', pos_access: true, backoffice_access: true, legacy: true },
  { id: 'tier:admin', name: 'Administrator', role_key: 'administrator', base_role: 'admin', pos_access: true, backoffice_access: true, legacy: true },
];

function setTitle(text) {
  const el = document.getElementById('current-view-title');
  if (el) el.textContent = text;
}

async function loadRoles() {
  const { roles } = await fetchAccessRoles();
  return roles.length ? { roles, legacy: false } : { roles: LEGACY_ROLES, legacy: true };
}

function roleForMember(member, roles) {
  if (!member) return null;
  return (
    roles.find((r) => r.id === member.role_id) ||
    roles.find((r) => r.id === `tier:${member.role}`) ||
    roles.find((r) => r.is_system && r.role_key === TIER_ROLE_KEY[member.role]) ||
    roles.find((r) => r.role_key === TIER_ROLE_KEY[member.role]) ||
    null
  );
}

export async function mount(container, _tab, query) {
  const editId = query?.get('edit') || null;
  const isNew = query?.get('new') === '1';
  if (isNew || editId) return mountForm(container, editId);
  return mountList(container);
}

// ===========================================================================
// Shared: one-time credentials dialog, password reset, delete
// ===========================================================================
function showCredentialsModal(title, fullName, email, password) {
  Modal.open({
    title,
    content: `
      <p style="margin-bottom:10px;">Share these sign-in details with <strong>${esc(fullName)}</strong>. The password is shown <strong>only once</strong>.</p>
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:6px; padding:12px; font-family:monospace; user-select:all;">
        Email: ${esc(email)}<br/>
        Temporary password: <strong>${esc(password)}</strong>
      </div>
      <button type="button" id="btn-copy-credentials" class="btn btn-outline btn-sm" style="margin-top:10px;">Copy details</button>
      <p style="margin-top:10px; font-size:0.8rem; color:var(--text-muted);">This password is for the back office. On the POS they sign in with their 4-digit PIN. Passwords are case-sensitive; ask them to change it from their profile after the first sign-in.</p>
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

function confirmDeleteEmployee(member, onDone) {
  if (member.id === globalState.user?.id) {
    Toast.error('You cannot delete your currently signed-in account.');
    return;
  }

  Modal.open({
    title: 'Delete employee',
    content: `
      <form id="form-employee-delete">
        <p style="font-size:0.875rem; color:var(--text-main); margin-bottom:12px;">
          Are you sure you want to remove <strong>${esc(member.full_name || member.email)}</strong> from your team?
        </p>
        <p style="font-size:0.8rem; color:var(--text-muted); background:var(--color-danger-bg); border:1px solid #fecaca; padding:10px 12px; border-radius:6px; margin-bottom:18px;">
          This revokes their POS and back office access immediately. Past sales recorded under this employee stay intact for audit accuracy.
        </p>
        <div style="display:flex; gap:10px; justify-content:flex-end;">
          <button type="button" class="btn btn-outline" id="btn-cancel-emp-del">Cancel</button>
          <button type="submit" class="btn" style="background:var(--color-danger); color:#fff;">Delete employee</button>
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
        Toast.info('This employee has sales history, so the account was deactivated and sign-in disabled.');
      } else {
        Toast.success(`Employee "${member.full_name || member.email}" deleted.`);
      }
      if (onDone) onDone();
    },
  });

  setTimeout(() => {
    const cancelBtn = document.getElementById('btn-cancel-emp-del');
    if (cancelBtn) cancelBtn.onclick = () => Modal.close();
  }, 30);
}

// ===========================================================================
// LIST
// ===========================================================================
async function mountList(container) {
  setTitle('Employees');
  const canManage = hasRight('employees.manage');

  const COLUMNS = [
    { key: 'name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'role', label: 'Role' },
    { key: 'shop', label: 'Shop' },
    { key: 'pin', label: 'POS PIN' },
    { key: 'commission', label: 'Commission' },
    { key: 'status', label: 'Status' },
  ];
  const visible = new Set(['name', 'email', 'phone', 'role', 'shop', 'pin', 'status']);

  let rows = [];
  let roles = [];
  let pinSet = null; // null = unknown (migration not applied)
  let search = '';
  let page = 1;
  let perPage = 10;

  container.innerHTML = `
    <div class="chart-box" style="padding:0;">
      <div class="page-toolbar">
        <div>
          ${canManage ? '<button class="btn btn-teal-primary" id="btn-create-employee">Create employee</button>' : ''}
        </div>
        <div class="toolbar-icons">
          <input type="search" class="toolbar-search hidden" id="emp-search" placeholder="Search employees" />
          <button type="button" class="toolbar-icon-btn" id="emp-search-toggle" title="Search"><i data-lucide="search"></i></button>
          <button type="button" class="toolbar-icon-btn" id="emp-refresh" title="Refresh"><i data-lucide="refresh-cw"></i></button>
          <button type="button" class="toolbar-icon-btn" id="emp-columns" title="Columns"><i data-lucide="columns-3"></i></button>
          <div class="column-menu hidden" id="emp-column-menu">
            ${COLUMNS.map(
              (c) => `<label><input type="checkbox" data-col="${c.key}" ${visible.has(c.key) ? 'checked' : ''} /> ${c.label}</label>`
            ).join('')}
          </div>
        </div>
      </div>
      <div id="emp-table" style="overflow-x:auto;"></div>
      <div class="table-footer" id="emp-footer"></div>
    </div>
  `;
  if (window.lucide) window.lucide.createIcons({ root: container });

  const tableEl = container.querySelector('#emp-table');
  const footerEl = container.querySelector('#emp-footer');
  const searchEl = container.querySelector('#emp-search');
  const menuEl = container.querySelector('#emp-column-menu');

  // ---- toolbar -------------------------------------------------------------
  const createBtn = container.querySelector('#btn-create-employee');
  if (createBtn) {
    createBtn.onclick = async () => {
      // First time: everyone who adds employees needs a PIN of their own first
      if (!(await ensureOwnPin())) return;
      window.location.hash = '#employees?new=1';
    };
  }

  container.querySelector('#emp-search-toggle').onclick = () => {
    searchEl.classList.toggle('hidden');
    if (!searchEl.classList.contains('hidden')) searchEl.focus();
    else { search = ''; searchEl.value = ''; page = 1; render(); }
  };
  searchEl.oninput = () => { search = searchEl.value.trim().toLowerCase(); page = 1; render(); };
  container.querySelector('#emp-refresh').onclick = () => load();

  container.querySelector('#emp-columns').onclick = (e) => {
    e.stopPropagation();
    menuEl.classList.toggle('hidden');
  };
  menuEl.onclick = (e) => e.stopPropagation();
  menuEl.querySelectorAll('[data-col]').forEach((cb) => {
    cb.onchange = () => {
      if (cb.checked) visible.add(cb.dataset.col);
      else visible.delete(cb.dataset.col);
      if (!visible.size) { visible.add('name'); cb.checked = cb.dataset.col === 'name'; }
      render();
    };
  });
  const closeMenu = () => menuEl.classList.add('hidden');
  document.addEventListener('click', closeMenu);

  // ---- data ----------------------------------------------------------------
  async function load() {
    tableEl.innerHTML = '<p style="padding:24px; color:var(--text-muted);">Loading employees...</p>';

    let q = supabase.from('profiles').select('*, shops(name)').order('full_name');
    if (!isAdmin()) q = scoped(q); // administrators see the whole company, everyone else their own shop

    const [staffRes, rolesRes, pinRes] = await Promise.all([q, loadRoles(), supabase.rpc('staff_pin_status')]);

    if (staffRes.error) {
      tableEl.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${esc(staffRes.error.message)}</p>`;
      footerEl.innerHTML = '';
      return;
    }
    rows = staffRes.data || [];
    roles = rolesRes.roles;
    pinSet = pinRes.error ? null : new Set(pinRes.data || []);
    render();
  }

  // ---- table ---------------------------------------------------------------
  function render() {
    const filtered = rows.filter((m) => {
      if (!search) return true;
      const roleName = roleForMember(m, roles)?.name || '';
      return [m.full_name, m.email, m.phone, roleName].some((v) => String(v || '').toLowerCase().includes(search));
    });

    if (!filtered.length) {
      tableEl.innerHTML = `
        <div style="padding:48px 24px; text-align:center; color:var(--text-subtle);">
          <p style="font-size:0.9rem; margin-bottom:8px;">${search ? 'No employees match your search.' : 'No employees yet.'}</p>
          ${!search && canManage ? '<button class="btn btn-teal-primary btn-sm" id="btn-empty-add">Create the first employee</button>' : ''}
        </div>`;
      footerEl.innerHTML = '';
      const emptyBtn = tableEl.querySelector('#btn-empty-add');
      if (emptyBtn) emptyBtn.onclick = () => createBtn && createBtn.click();
      return;
    }

    const pages = Math.max(1, Math.ceil(filtered.length / perPage));
    page = Math.min(page, pages);
    const slice = filtered.slice((page - 1) * perPage, page * perPage);
    const cols = COLUMNS.filter((c) => visible.has(c.key));

    const cell = (m, key) => {
      const role = roleForMember(m, roles);
      const isSelf = m.id === globalState.user?.id;
      switch (key) {
        case 'name':
          return `<strong>${esc(m.full_name || 'Unnamed')}</strong>${isSelf ? ' <span class="badge badge-teal" style="margin-left:6px;">YOU</span>' : ''}`;
        case 'email':
          return esc(m.email || '-');
        case 'phone':
          return esc(m.phone || '-');
        case 'role':
          return esc(role?.name || TIER_LABEL[m.role] || m.role || '-');
        case 'shop':
          return esc(m.shops?.name || 'All shops');
        case 'pin': {
          if (role && role.pos_access === false) return '<span style="color:var(--text-subtle);">Not used</span>';
          if (pinSet === null) return '<span style="color:var(--text-subtle);">-</span>';
          return pinSet.has(m.id)
            ? '<span class="badge badge-teal">PIN set</span>'
            : '<span class="badge" style="background:#fef3c7; color:#b45309; border-color:#fde68a;">No PIN</span>';
        }
        case 'commission':
          return `${Number(m.commission_rate || 0)}%`;
        case 'status':
          return `<label class="switch" title="${m.is_active !== false ? 'Active' : 'Inactive'}">
                    <input type="checkbox" data-toggle="${m.id}" ${m.is_active !== false ? 'checked' : ''} ${isSelf || !canManage ? 'disabled' : ''} />
                    <span class="switch-slider"></span>
                  </label>`;
        default:
          return '';
      }
    };

    tableEl.innerHTML = `
      <table class="data-table">
        <thead><tr>${cols.map((c) => `<th>${c.label}</th>`).join('')}</tr></thead>
        <tbody>
          ${slice
            .map(
              (m) => `<tr class="${canManage ? 'row-clickable' : ''}" data-row="${m.id}">
                ${cols.map((c) => `<td>${cell(m, c.key)}</td>`).join('')}
              </tr>`
            )
            .join('')}
        </tbody>
      </table>`;

    footerEl.innerHTML = `
      <span>Per page
        <select id="emp-per-page">
          ${[10, 25, 50].map((n) => `<option value="${n}" ${n === perPage ? 'selected' : ''}>${n}</option>`).join('')}
        </select>
      </span>
      <span>Page ${page} of ${pages}</span>
      <span>
        <button class="pager-btn" id="emp-prev" ${page <= 1 ? 'disabled' : ''} title="Previous page"><i data-lucide="chevron-left"></i></button>
        <button class="pager-btn" id="emp-next" ${page >= pages ? 'disabled' : ''} title="Next page"><i data-lucide="chevron-right"></i></button>
      </span>`;

    footerEl.querySelector('#emp-per-page').onchange = (e) => { perPage = Number(e.target.value); page = 1; render(); };
    footerEl.querySelector('#emp-prev').onclick = () => { page -= 1; render(); };
    footerEl.querySelector('#emp-next').onclick = () => { page += 1; render(); };

    tableEl.querySelectorAll('[data-toggle]').forEach((cb) => {
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => toggleActive(cb.dataset.toggle, cb);
    });
    tableEl.querySelectorAll('label.switch').forEach((l) => { l.onclick = (e) => e.stopPropagation(); });

    if (canManage) {
      tableEl.querySelectorAll('tr[data-row]').forEach((tr) => {
        tr.onclick = () => { window.location.hash = `#employees?edit=${tr.dataset.row}`; };
      });
    }
    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  async function toggleActive(id, checkbox) {
    const next = checkbox.checked;
    const { data, error } = await supabase.functions.invoke('staff-admin', {
      body: { action: 'update', id, is_active: next },
    });
    if (error || data?.error) {
      checkbox.checked = !next;
      Toast.error(data?.error || error?.message || 'Could not change the status.');
      return;
    }
    const row = rows.find((r) => r.id === id);
    if (row) row.is_active = next;
    Toast.success(next ? 'Employee activated.' : 'Employee deactivated. They can no longer sign in.');
  }

  await load();
  return () => document.removeEventListener('click', closeMenu);
}

// ===========================================================================
// CREATE / EDIT
// ===========================================================================
async function mountForm(container, editId) {
  const isEdit = !!editId;
  setTitle(isEdit ? 'Edit employee' : 'Create employee');

  if (!hasRight('employees.manage')) {
    container.innerHTML = `
      <div class="form-card form-page"><h3>No access</h3>
        <p style="color:var(--text-muted); font-size:0.875rem;">Your role does not include the right to manage employees.</p></div>`;
    return;
  }

  container.innerHTML = '<p style="padding:24px; color:var(--text-muted);">Loading...</p>';

  const [rolesRes, shopsRes, memberRes, pinRes] = await Promise.all([
    loadRoles(),
    supabase.from('shops').select('id, name').order('name'),
    isEdit ? supabase.from('profiles').select('*').eq('id', editId).maybeSingle() : Promise.resolve(null),
    isEdit ? supabase.rpc('staff_pin_status') : Promise.resolve(null),
  ]);

  const { roles, legacy } = rolesRes;
  const shops = shopsRes.data || [];
  const member = memberRes?.data || null;

  if (isEdit && !member) {
    container.innerHTML = `
      <div class="form-card form-page"><h3>Employee not found</h3>
        <button class="btn btn-outline" onclick="window.location.hash='#employees'">Back to employees</button></div>`;
    return;
  }

  const isSelf = isEdit && member.id === globalState.user?.id;
  const hasPin = isEdit && pinRes && !pinRes.error ? new Set(pinRes.data || []).has(member.id) : null;
  const actorIsAdmin = isAdmin();
  const canCreateRole = hasRight('roles.manage') && !legacy;

  // Managers may only hand out cashier-level roles
  const assignable = actorIsAdmin ? roles : roles.filter((r) => r.base_role === 'cashier');
  const currentRole = isEdit ? roleForMember(member, roles) : null;
  if (currentRole && !assignable.find((r) => r.id === currentRole.id)) assignable.unshift(currentRole);

  const st = {
    roleId: currentRole?.id || '',
    shopId: isEdit ? member.shop_id || '' : globalState.activeShopId || '',
  };
  const roleById = (id) => roles.find((r) => r.id === id) || null;

  // A manager adds people to his own shop only
  const shopLocked = isSelf || !actorIsAdmin;

  container.innerHTML = `
    <form id="employee-form" class="form-page" novalidate>
      <div class="form-card">
        <h3>${isEdit ? 'Edit employee' : 'Create employee'}</h3>

        <div class="form-group">
          <label>Name</label>
          <input type="text" id="emp-name" maxlength="120" value="${esc(member?.full_name || '')}" placeholder="e.g. Jane Wanjiku" autocomplete="off" />
        </div>

        <div class="form-group">
          <label>User role</label>
          <div class="select-search" id="role-picker">
            <button type="button" class="select-search-btn" id="role-btn" ${isSelf ? 'disabled' : ''}>
              <i data-lucide="users-round"></i>
              <span class="label" id="role-label"></span>
              <i data-lucide="chevron-down"></i>
            </button>
            <div class="select-search-panel hidden" id="role-panel">
              <input type="text" class="select-search-input" id="role-search" placeholder="Search" autocomplete="off" />
              <div class="select-search-list" id="role-list"></div>
            </div>
          </div>
          ${isSelf ? '<p class="hint">You cannot change your own role.</p>' : ''}
        </div>

        <div class="form-group hidden" id="pin-block">
          <label>POS login PIN</label>
          ${pinBoxesHtml('emp-pin')}
          <p class="hint" id="pin-hint"></p>
        </div>

        <div class="form-group">
          <label>Email</label>
          <input type="email" id="emp-email" value="${esc(member?.email || '')}" placeholder="name@store.com" autocomplete="off" ${isEdit ? 'readonly style="background:var(--bg-canvas);"' : ''} />
          ${isEdit ? '<p class="hint">The sign-in email cannot be changed.</p>' : ''}
        </div>

        <div class="form-group">
          <label>Phone</label>
          <input type="tel" id="emp-phone" value="${esc(member?.phone || '')}" placeholder="+254 7..." autocomplete="off" />
        </div>

        ${isEdit ? '' : `
        <div class="form-group hidden" id="pw-block">
          <label>Back office password (optional)</label>
          <input type="password" id="emp-password" minlength="8" maxlength="72" autocomplete="new-password" placeholder="Leave empty to generate a temporary password" />
          <p class="hint">This role can open the back office with email and password. At least 8 characters.</p>
        </div>`}
      </div>

      <div class="form-card">
        <h3>Shop information</h3>
        <div class="form-group">
          <label>Shop</label>
          <select id="emp-shop" ${shopLocked ? 'disabled' : ''}></select>
          <p class="hint hidden" id="shop-hint">Administrators can work in all shops.</p>
        </div>
        <div class="form-group">
          <label>Sales commission (%)</label>
          <input type="number" id="emp-commission" step="0.1" min="0" max="100" value="${Number(member?.commission_rate ?? 0)}" ${isSelf ? 'disabled' : ''} />
        </div>
        ${isEdit ? `
        <div class="access-toggle-row" style="padding-bottom:0;">
          <div><strong style="font-size:0.9375rem;">Account active</strong><span>Inactive employees cannot sign in to the POS or the back office.</span></div>
          <label class="switch"><input type="checkbox" id="emp-active" ${member.is_active !== false ? 'checked' : ''} ${isSelf ? 'disabled' : ''} /><span class="switch-slider"></span></label>
        </div>` : ''}
      </div>

      <div class="form-card">
        <div class="form-footer">
          ${isEdit && !isSelf ? `
          <div class="footer-left">
            <button type="button" class="btn btn-outline text-danger" id="btn-delete">Delete</button>
            <button type="button" class="btn btn-outline" id="btn-reset-pw">Reset password</button>
          </div>` : ''}
          <button type="button" class="btn btn-outline" id="btn-cancel">Cancel</button>
          <button type="submit" class="btn btn-teal-primary" id="btn-save">${isEdit ? 'Save' : 'Create'}</button>
        </div>
      </div>
    </form>
  `;
  if (window.lucide) window.lucide.createIcons({ root: container });

  const $ = (sel) => container.querySelector(sel);
  const pin = bindPinBoxes(container, 'emp-pin');

  // ---- role picker ---------------------------------------------------------
  const picker = $('#role-picker');
  const panel = $('#role-panel');
  const searchInput = $('#role-search');
  const listEl = $('#role-list');

  function updateRoleLabel() {
    const role = roleById(st.roleId);
    const label = $('#role-label');
    label.textContent = role ? role.name : 'Select user role';
    label.className = role ? 'label' : 'label placeholder';
  }

  function renderRoleList(filter = '') {
    const f = filter.trim().toLowerCase();
    const items = assignable.filter((r) => r.name.toLowerCase().includes(f));
    listEl.innerHTML =
      (canCreateRole
        ? '<button type="button" class="select-search-option create-link" data-create-role><span>Create user role</span><i data-lucide="plus"></i></button>'
        : '') +
      (items.length
        ? items
            .map((r) => `<button type="button" class="select-search-option ${r.id === st.roleId ? 'selected' : ''}" data-role-id="${r.id}"><span>${esc(r.name)}</span></button>`)
            .join('')
        : '<div class="select-search-empty">No roles found.</div>');
    if (window.lucide) window.lucide.createIcons({ root: listEl });

    listEl.querySelectorAll('[data-role-id]').forEach((b) => {
      b.onclick = () => {
        st.roleId = b.dataset.roleId;
        closePanel();
        updateRoleLabel();
        applyRole();
      };
    });
    const createLink = listEl.querySelector('[data-create-role]');
    if (createLink) {
      createLink.onclick = () => {
        window.location.hash = `#access-rights?new=1&back=${encodeURIComponent('employees?new=1')}`;
      };
    }
  }

  function openPanel() {
    panel.classList.remove('hidden');
    picker.classList.add('open');
    searchInput.value = '';
    renderRoleList();
    searchInput.focus();
  }
  function closePanel() {
    panel.classList.add('hidden');
    picker.classList.remove('open');
  }
  $('#role-btn').onclick = (e) => {
    e.stopPropagation();
    if (panel.classList.contains('hidden')) openPanel();
    else closePanel();
  };
  panel.onclick = (e) => e.stopPropagation();
  searchInput.oninput = () => renderRoleList(searchInput.value);
  const outsideClick = () => closePanel();
  document.addEventListener('click', outsideClick);

  // ---- what the chosen role shows ------------------------------------------
  function renderShopOptions() {
    const role = roleById(st.roleId);
    const allShops = actorIsAdmin && role?.base_role === 'admin';
    const select = $('#emp-shop');
    select.innerHTML =
      (allShops
        ? '<option value="">All shops</option>'
        : '<option value="" disabled>Select a shop</option>') +
      shops.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    if (!allShops && st.shopId === '' && shops.length === 1) st.shopId = shops[0].id;
    if (!allShops && !shops.find((s) => s.id === st.shopId)) st.shopId = '';
    select.value = st.shopId;
    $('#shop-hint').classList.toggle('hidden', !allShops);
  }

  function applyRole() {
    const role = roleById(st.roleId);
    $('#pin-block').classList.toggle('hidden', !(role && role.pos_access));
    const pw = $('#pw-block');
    if (pw) pw.classList.toggle('hidden', !(role && role.backoffice_access));

    const hint = $('#pin-hint');
    if (isEdit) {
      hint.textContent =
        hasPin === false
          ? 'This employee has no PIN yet. Enter one so they can sign in to the POS.'
          : hasPin === true
            ? 'A PIN is set. Leave empty to keep it, or enter 4 new digits to change it.'
            : 'Enter 4 new digits to change the PIN, or leave empty to keep it.';
    } else {
      hint.textContent = 'Four digits the employee types on the POS lock screen. Easy PINs like 1234 or 0000 are refused.';
    }
    renderShopOptions();
  }

  $('#emp-shop').onchange = (e) => { st.shopId = e.target.value; };

  updateRoleLabel();
  applyRole();

  // ---- cancel / delete / reset --------------------------------------------
  $('#btn-cancel').onclick = () => { window.location.hash = '#employees'; };
  const delBtn = $('#btn-delete');
  if (delBtn) delBtn.onclick = () => confirmDeleteEmployee(member, () => { window.location.hash = '#employees'; });
  const resetBtn = $('#btn-reset-pw');
  if (resetBtn) resetBtn.onclick = () => resetEmployeePassword(member);

  // ---- save ----------------------------------------------------------------
  const form = $('#employee-form');
  form.onsubmit = async (e) => {
    e.preventDefault();

    const role = roleById(st.roleId);
    const fullName = $('#emp-name').value.trim();
    const email = $('#emp-email').value.trim().toLowerCase();
    const phone = $('#emp-phone').value.trim();
    const commission = parseFloat($('#emp-commission').value) || 0;
    const pinValue = pin ? pin.value : '';
    const password = isEdit ? '' : ($('#emp-password')?.value || '');
    const shopId = $('#emp-shop').value || st.shopId || '';

    const problem = (msg, field) => {
      Toast.error(msg);
      if (field) field.focus();
      return false;
    };

    if (!fullName) return problem('Enter the employee name.', $('#emp-name'));
    if (!role) return problem('Choose a user role.');
    if (!isEdit && !EMAIL_RE.test(email)) return problem('Enter a valid email address.', $('#emp-email'));

    if (role.pos_access) {
      if (!isEdit && pinValue.length !== 4) {
        pin?.setInvalid(true);
        return problem('Enter a 4-digit POS PIN. Every employee who can use the POS needs one.');
      }
      if (pinValue && pinValue.length !== 4) {
        pin?.setInvalid(true);
        return problem('The PIN must be exactly 4 digits.');
      }
      if (pinValue && isWeakPin(pinValue)) {
        pin?.setInvalid(true);
        return problem(PIN_HELP);
      }
    }
    pin?.setInvalid(false);

    if (role.base_role !== 'admin' && !shopId) return problem('Choose a shop for this employee.');
    if (password && (password.length < 8 || password.length > 72)) return problem('The password must be 8 to 72 characters.', $('#emp-password'));

    const roleFields = role.legacy ? { role: role.base_role } : { role_id: role.id };
    const saveBtn = $('#btn-save');
    saveBtn.disabled = true;

    try {
      if (isEdit) {
        const body = {
          action: 'update',
          id: member.id,
          full_name: fullName,
          phone: phone || null,
          pos_pin: role.pos_access && pinValue ? pinValue : null,
        };
        if (!isSelf) {
          Object.assign(body, roleFields, {
            shop_id: shopId || null,
            commission_rate: commission,
            is_active: $('#emp-active') ? $('#emp-active').checked : true,
          });
        }
        const { data, error } = await supabase.functions.invoke('staff-admin', { body });
        if (error || data?.error) {
          Toast.error(data?.error || error?.message || 'Could not save the employee.');
          return;
        }
        Toast.success(body.pos_pin ? 'Employee details and PIN updated.' : 'Employee details updated.');
        window.location.hash = '#employees';
      } else {
        const { data, error } = await supabase.functions.invoke('staff-admin', {
          body: {
            action: 'create',
            full_name: fullName,
            email,
            phone: phone || null,
            shop_id: shopId || null,
            commission_rate: commission,
            is_active: true,
            pos_pin: role.pos_access ? pinValue : null,
            password: password || null,
            ...roleFields,
          },
        });
        if (error || data?.error) {
          Toast.error(data?.error || error?.message || 'Could not create the employee.');
          return;
        }
        Toast.success(`Employee "${fullName}" added.`);
        window.location.hash = '#employees';
        // Only a generated back office password has to be shown (once)
        if (data.temp_password) {
          setTimeout(() => showCredentialsModal('Employee created', fullName, email, data.temp_password), 250);
        }
      }
    } finally {
      saveBtn.disabled = false;
    }
  };

  // First time: the person adding employees needs a PIN of their own. The form stays behind the dialog.
  if (!isEdit) {
    ensureOwnPin().then((ok) => {
      if (!ok) window.location.hash = '#employees';
    });
  }

  return () => document.removeEventListener('click', outsideClick);
}
