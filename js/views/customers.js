import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Customer Directory</h3>
        <span class="badge badge-teal" id="customer-count-badge">0 customers</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-add-customer">
          <i data-lucide="user-plus" style="width:16px; height:16px; margin-right:6px;"></i> Register Customer
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="customers-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-customer').onclick = () => openCustomerModal();

  async function loadCustomers() {
    const tableArea = document.getElementById('customers-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching customer directory...</p>`;

    let query = supabase
      .from('customers')
      .select('*')
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: customers, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('customer-count-badge');
    if (countBadge) countBadge.textContent = `${customers?.length || 0} customers`;

    renderDataTable({
      targetId: 'customers-table-content',
      columns: [
        { label: 'Customer Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { label: 'Phone Number', key: 'phone', render: (p) => p || '-' },
        { label: 'Email Address', key: 'email', render: (e) => e || '-' },
        { label: 'Loyalty Points', key: 'loyalty_points', render: (pts) => `<span class="badge badge-teal">${pts || 0} pts</span>` },
        { 
          label: 'Credit Balance', 
          key: 'credit_balance', 
          render: (bal) => {
            const v = Number(bal || 0);
            return `<strong style="color:${v > 0 ? 'var(--color-danger)' : 'var(--teal-600)'}">${v.toLocaleString()} ${currency}</strong>`;
          } 
        },
      ],
      data: customers || [],
      onAction: (action, id) => {
        const item = customers.find((c) => c.id === id);
        if (action === 'edit' && item) {
          openCustomerModal(item);
        } else if (action === 'delete' && item) {
          confirmSoftDeleteCustomer(item);
        }
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Create / Edit Customer Modal
  function openCustomerModal(customer = null) {
    const isEdit = !!customer;

    Modal.open({
      title: isEdit ? `Edit Customer: ${customer.name}` : 'Register New Customer',
      content: `
        <div style="max-height: calc(85vh - 120px); overflow-y: auto; padding-right: 4px;">
          <form id="form-customer-save" style="display:flex; flex-direction:column; gap:12px;">
            <div class="form-group">
              <label>Full Name</label>
              <input type="text" name="name" required value="${customer?.name || ''}" placeholder="Customer name" />
            </div>

            <div class="form-row" style="display:flex; gap:12px;">
              <div class="form-group" style="flex:1;">
                <label>Phone Number</label>
                <input type="text" name="phone" value="${customer?.phone || ''}" placeholder="+254 7..." />
              </div>
              <div class="form-group" style="flex:1;">
                <label>Email Address</label>
                <input type="email" name="email" value="${customer?.email || ''}" placeholder="customer@example.com" />
              </div>
            </div>

            <div class="form-row" style="display:flex; gap:12px;">
              <div class="form-group" style="flex:1;">
                <label>Credit Limit (${currency})</label>
                <input type="number" step="0.01" name="credit_limit" value="${customer?.credit_limit || 0}" />
              </div>
              <div class="form-group" style="flex:1;">
                <label>Loyalty Tier</label>
                <select name="loyalty_tier">
                  <option value="bronze" ${!customer?.loyalty_tier || customer?.loyalty_tier === 'bronze' ? 'selected' : ''}>Bronze</option>
                  <option value="silver" ${customer?.loyalty_tier === 'silver' ? 'selected' : ''}>Silver</option>
                  <option value="gold" ${customer?.loyalty_tier === 'gold' ? 'selected' : ''}>Gold</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Physical Address / Notes</label>
              <input type="text" name="address" value="${customer?.address || ''}" placeholder="Location or notes" />
            </div>

            <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:8px;">
              ${isEdit ? 'Update Customer' : 'Save Customer'}
            </button>
          </form>
        </div>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          phone: fd.phone || null,
          email: fd.email || null,
          credit_limit: parseFloat(fd.credit_limit) || 0,
          loyalty_tier: fd.loyalty_tier || 'bronze',
          address: fd.address || null,
          updated_at: new Date().toISOString(),
        };

        if (isEdit) {
          const { error } = await supabase
            .from('customers')
            .update(payload)
            .eq('id', customer.id);

          if (error) {
            Toast.error(error.message);
            return;
          }
        } else {
          payload.created_at = new Date().toISOString();
          const { error } = await supabase
            .from('customers')
            .insert([payload]);

          if (error) {
            Toast.error(error.message);
            return;
          }
        }

        Toast.success(isEdit ? 'Customer updated successfully.' : 'New customer registered.');
        await loadCustomers();
      },
    });
  }

  // Soft Delete Customer
  async function confirmSoftDeleteCustomer(customer) {
    if (!confirm(`Are you sure you want to delete customer "${customer.name}"?`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;

    const { error } = await supabase
      .from('customers')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq('id', customer.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Customer "${customer.name}" removed.`);
      await loadCustomers();
    }
  }

  await loadCustomers();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}
