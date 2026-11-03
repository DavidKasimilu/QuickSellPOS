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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Suppliers Directory</h3>
        <span class="badge badge-teal" id="supplier-count-badge">0 suppliers</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-add-supplier">
          <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Supplier
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="suppliers-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-supplier').onclick = () => openSupplierModal();

  async function loadSuppliers() {
    const tableArea = document.getElementById('suppliers-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching suppliers list...</p>`;

    let query = supabase
      .from('suppliers')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: suppliers, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('supplier-count-badge');
    if (countBadge) countBadge.textContent = `${suppliers?.length || 0} suppliers`;

    renderDataTable({
      targetId: 'suppliers-table-content',
      columns: [
        { label: 'Supplier / Vendor Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Contact Person', key: 'contact_person', render: (cp) => cp || '-' },
        { label: 'Phone Number', key: 'phone', render: (p) => p || '-' },
        { label: 'Email Address', key: 'email', render: (e) => e || '-' },
        { label: 'Physical Address', key: 'address', render: (a) => a || '-' },
        { label: 'Tax PIN / VAT #', key: 'tax_pin', render: (pin) => pin ? `<code>${pin}</code>` : '-' },
      ],
      data: suppliers || [],
      onAction: (action, id) => {
        const item = suppliers.find((s) => s.id === id);
        if (action === 'edit' && item) openSupplierModal(item);
        else if (action === 'delete' && item) confirmSoftDeleteSupplier(item);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Create / Edit Supplier Modal
  function openSupplierModal(supplier = null) {
    const isEdit = !!supplier;

    Modal.open({
      title: isEdit ? `Edit Supplier: ${supplier.name}` : 'Register New Supplier',
      content: `
        <form id="form-supplier-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Supplier / Company Name</label>
            <input type="text" name="name" required value="${supplier?.name || ''}" placeholder="e.g. Acme Wholesalers Ltd" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Contact Person</label>
              <input type="text" name="contact_person" value="${supplier?.contact_person || ''}" placeholder="e.g. John Doe" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Phone Number</label>
              <input type="text" name="phone" value="${supplier?.phone || ''}" placeholder="+254 7..." />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Email Address</label>
              <input type="email" name="email" value="${supplier?.email || ''}" placeholder="orders@supplier.com" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Tax PIN / KRA Registration</label>
              <input type="text" name="tax_pin" value="${supplier?.tax_pin || ''}" placeholder="P051234567X" />
            </div>
          </div>

          <div class="form-group">
            <label>Physical Address / Depot Location</label>
            <input type="text" name="address" value="${supplier?.address || ''}" placeholder="Industrial Area, Street 4" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Supplier' : 'Save Supplier'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          contact_person: fd.contact_person || null,
          phone: fd.phone || null,
          email: fd.email || null,
          tax_pin: fd.tax_pin || null,
          address: fd.address || null,
          updated_at: new Date().toISOString(),
        };

        if (isEdit) {
          const { error } = await supabase.from('suppliers').update(payload).eq('id', supplier.id);
          if (error) {
            Toast.error(error.message);
            return;
          }
        } else {
          payload.created_at = new Date().toISOString();
          const { error } = await supabase.from('suppliers').insert([payload]);
          if (error) {
            Toast.error(error.message);
            return;
          }
        }

        Toast.success('Supplier profile saved.');
        await loadSuppliers();
      },
    });
  }

  // Soft Delete Supplier
  async function confirmSoftDeleteSupplier(supplier) {
    if (!confirm(`Are you sure you want to delete supplier "${supplier.name}"?`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;

    const { error } = await supabase
      .from('suppliers')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq('id', supplier.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Supplier "${supplier.name}" removed.`);
      await loadSuppliers();
    }
  }

  await loadSuppliers();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}