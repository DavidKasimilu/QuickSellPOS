import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Staff Directory & Personnel</h3>
        <span class="badge badge-teal" id="staff-count-badge">0 personnel</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-add-staff-member">
          <i data-lucide="user-plus" style="width:16px; height:16px; margin-right:6px;"></i> Register Personnel
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="staff-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-staff-member').onclick = () => openStaffModal();

  async function loadStaffDirectory() {
    const tableArea = document.getElementById('staff-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Loading staff directory...</p>`;

    let query = supabase
      .from('store_staff')
      .select('*')
      .is('deleted_at', null)
      .order('full_name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: staffMembers, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('staff-count-badge');
    if (countBadge) countBadge.textContent = `${staffMembers?.length || 0} personnel`;

    renderDataTable({
      targetId: 'staff-table-content',
      columns: [
        { label: 'Full Name', key: 'full_name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Job Role / Designation', key: 'job_title', render: (jt) => jt || 'General Staff' },
        { label: 'Department', key: 'department', render: (dept) => dept ? `<span class="badge">${dept}</span>` : '-' },
        { label: 'Phone Number', key: 'phone', render: (p) => p || '-' },
        { label: 'Email', key: 'email', render: (e) => e || '-' },
        { 
          label: 'Status', 
          key: 'is_active', 
          render: (act) => act !== false 
            ? '<span class="badge badge-teal">ACTIVE</span>' 
            : '<span class="badge text-danger">INACTIVE</span>' 
        },
      ],
      data: staffMembers || [],
      onAction: (action, id) => {
        const item = staffMembers.find((s) => s.id === id);
        if (action === 'edit' && item) {
          openStaffModal(item);
        } else if (action === 'delete' && item) {
          confirmSoftDeleteStaff(item);
        }
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Create / Edit Staff Modal
  function openStaffModal(staff = null) {
    const isEdit = !!staff;

    Modal.open({
      title: isEdit ? `Edit Personnel: ${staff.full_name}` : 'Register New Staff Member',
      content: `
        <div style="max-height: calc(85vh - 120px); overflow-y: auto; padding-right: 4px;">
          <form id="form-staff-save" style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" name="full_name" required value="${staff?.full_name || ''}" placeholder="e.g. Jane Doe" />
            </div>

            <div class="form-row" style="display:flex; gap:12px;">
              <div class="form-group" style="flex:1;">
                <label>Job Designation / Role</label>
                <input type="text" name="job_title" value="${staff?.job_title || ''}" placeholder="e.g. Sales Associate / Inventory Specialist" />
              </div>
              <div class="form-group" style="flex:1;">
                <label>Department</label>
                <select name="department">
                  <option value="Sales" ${staff?.department === 'Sales' ? 'selected' : ''}>Sales & Checkout</option>
                  <option value="Inventory" ${staff?.department === 'Inventory' ? 'selected' : ''}>Inventory & Warehouse</option>
                  <option value="Management" ${staff?.department === 'Management' ? 'selected' : ''}>Management</option>
                  <option value="Accounts" ${staff?.department === 'Accounts' ? 'selected' : ''}>Accounts & Finance</option>
                  <option value="General" ${!staff?.department || staff?.department === 'General' ? 'selected' : ''}>General Staff</option>
                </select>
              </div>
            </div>

            <div class="form-row" style="display:flex; gap:12px;">
              <div class="form-group" style="flex:1;">
                <label>Phone Contact</label>
                <input type="text" name="phone" value="${staff?.phone || ''}" placeholder="+254 7..." />
              </div>
              <div class="form-group" style="flex:1;">
                <label>Email Address</label>
                <input type="email" name="email" value="${staff?.email || ''}" placeholder="staff@store.com" />
              </div>
            </div>

            <div class="form-group">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" name="is_active" ${staff?.is_active !== false ? 'checked' : ''} />
                Active employee status
              </label>
            </div>

            <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">
              ${isEdit ? 'Update Personnel' : 'Save Staff Member'}
            </button>
          </form>
        </div>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          full_name: fd.full_name,
          job_title: fd.job_title || null,
          department: fd.department || 'General',
          phone: fd.phone || null,
          email: fd.email || null,
          is_active: fd.is_active === 'on',
          updated_at: new Date().toISOString(),
        };

        if (isEdit) {
          const { error } = await supabase
            .from('store_staff')
            .update(payload)
            .eq('id', staff.id);

          if (error) {
            Toast.error(error.message);
            return;
          }
        } else {
          payload.created_at = new Date().toISOString();
          const { error } = await supabase
            .from('store_staff')
            .insert([payload]);

          if (error) {
            Toast.error(error.message);
            return;
          }
        }

        Toast.success(isEdit ? 'Staff record updated successfully.' : 'New staff member saved.');
        await loadStaffDirectory();
      },
    });
  }

  // Soft Delete Staff Member
  async function confirmSoftDeleteStaff(staff) {
    if (!confirm(`Are you sure you want to delete staff member "${staff.full_name}"?`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;

    const { error } = await supabase
      .from('store_staff')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq('id', staff.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Staff member "${staff.full_name}" removed.`);
      await loadStaffDirectory();
    }
  }

  await loadStaffDirectory();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}
