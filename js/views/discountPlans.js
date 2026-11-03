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
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Promotional Discount Plans</h3>
        <span class="badge badge-teal" id="discount-plans-count-badge">0 active plans</span>
      </div>
      <div>
        <button class="btn btn-teal-primary" id="btn-add-discount-plan">
          <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Create Discount Plan
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="discount-plans-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-discount-plan').onclick = () => openDiscountPlanModal();

  async function loadDiscountPlans() {
    const tableArea = document.getElementById('discount-plans-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching promotional discount plans...</p>`;

    let query = supabase
      .from('discount_plans')
      .select('*')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: plans, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('discount-plans-count-badge');
    if (countBadge) countBadge.textContent = `${plans?.length || 0} plans`;

    renderDataTable({
      targetId: 'discount-plans-table-content',
      columns: [
        { label: 'Plan Name', key: 'name', render: (val) => `<strong>${val}</strong>` },
        { 
          label: 'Discount Value', 
          key: 'discount_type', 
          render: (type, row) => {
            const val = Number(row.discount_value || 0);
            return type === 'percentage' 
              ? `<span class="badge badge-teal" style="font-weight:bold;">${val}% OFF</span>`
              : `<span class="badge badge-teal" style="font-weight:bold;">${val.toLocaleString()} ${currency} OFF</span>`;
          } 
        },
        { label: 'Min Buy Qty', key: 'min_quantity', render: (qty) => `${qty || 1} units` },
        { label: 'Promo Code', key: 'promo_code', render: (code) => code ? `<code>${code}</code>` : 'Automatic' },
        { 
          label: 'Status', 
          key: 'is_active', 
          render: (act) => act ? '<span class="badge badge-teal">ACTIVE</span>' : '<span class="badge">INACTIVE</span>' 
        },
        { label: 'Created Date', key: 'created_at', render: (d) => new Date(d).toLocaleDateString() },
      ],
      data: plans || [],
      onAction: (action, id) => {
        const item = plans.find((p) => p.id === id);
        if (action === 'edit' && item) openDiscountPlanModal(item);
        else if (action === 'delete' && item) confirmSoftDeleteDiscountPlan(item);
      },
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // Create / Edit Discount Plan Modal
  function openDiscountPlanModal(plan = null) {
    const isEdit = !!plan;

    Modal.open({
      title: isEdit ? `Edit Discount Plan: ${plan.name}` : 'Create Discount Plan',
      content: `
        <form id="form-discount-plan-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Discount Plan Title</label>
            <input type="text" name="name" required value="${plan?.name || ''}" placeholder="e.g. Black Friday Special / Bulk Buy Deal" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Discount Method</label>
              <select name="discount_type" required>
                <option value="percentage" ${plan?.discount_type === 'percentage' ? 'selected' : ''}>Percentage (%)</option>
                <option value="fixed" ${plan?.discount_type === 'fixed' ? 'selected' : ''}>Fixed Amount (${currency})</option>
              </select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Discount Amount / Rate</label>
              <input type="number" step="0.01" min="0.01" name="discount_value" required value="${plan?.discount_value || ''}" placeholder="e.g. 10" />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Min Minimum Item Qty</label>
              <input type="number" min="1" name="min_quantity" value="${plan?.min_quantity || 1}" placeholder="1" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Promo Code (Optional)</label>
              <input type="text" name="promo_code" value="${plan?.promo_code || ''}" placeholder="e.g. SAVE10" />
            </div>
          </div>

          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="is_active" ${plan?.is_active !== false ? 'checked' : ''} />
              Enable active discount scheme on checkout
            </label>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Plan' : 'Save Discount Plan'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          discount_type: fd.discount_type,
          discount_value: parseFloat(fd.discount_value) || 0,
          min_quantity: parseInt(fd.min_quantity) || 1,
          promo_code: fd.promo_code ? fd.promo_code.toUpperCase().trim() : null,
          is_active: fd.is_active === 'on',
          updated_at: new Date().toISOString(),
        };

        if (isEdit) {
          const { error } = await supabase.from('discount_plans').update(payload).eq('id', plan.id);
          if (error) {
            Toast.error(error.message);
            return;
          }
        } else {
          payload.created_at = new Date().toISOString();
          const { error } = await supabase.from('discount_plans').insert([payload]);
          if (error) {
            Toast.error(error.message);
            return;
          }
        }

        Toast.success('Discount plan saved successfully.');
        await loadDiscountPlans();
      },
    });
  }

  // Soft Delete Discount Plan
  async function confirmSoftDeleteDiscountPlan(plan) {
    if (!confirm(`Are you sure you want to delete discount plan "${plan.name}"?`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;

    const { error } = await supabase
      .from('discount_plans')
      .update({
        is_active: false,
        deleted_at: new Date().toISOString(),
        deleted_by: user?.id || null,
      })
      .eq('id', plan.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Discount plan "${plan.name}" removed.`);
      await loadDiscountPlans();
    }
  }

  await loadDiscountPlans();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}