import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let selectedUnitIds = new Set();
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Units of Measurement (UOM)</h3>
        <span class="badge badge-teal" id="uom-count-badge">0 units</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-danger hidden" id="btn-batch-delete-uom">
          <i data-lucide="trash-2" style="width:16px; height:16px; margin-right:6px;"></i> Delete Selected (<span id="batch-uom-count">0</span>)
        </button>
        <button class="btn btn-teal-primary" id="btn-add-uom">
          <i data-lucide="scale" style="width:16px; height:16px; margin-right:6px;"></i> Add Unit
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="uom-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-uom').onclick = () => openUOMModal();
  
  const batchDelBtn = document.getElementById('btn-batch-delete-uom');
  batchDelBtn.onclick = () => batchDeleteUOMs();

  unsubs.push(
    globalState.subscribeKey('measurement_units', () => fetchAndRenderUOMs())
  );

  async function fetchAndRenderUOMs() {
    const tableArea = document.getElementById('uom-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching measurement units...</p>`;

    let query = supabase
      .from('measurement_units')
      .select('*')
      .order('name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: uoms, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('uom-count-badge');
    if (countBadge) countBadge.textContent = `${uoms?.length || 0} units`;

    selectedUnitIds.clear();
    updateBatchDeleteButton();

    if (!uoms || uoms.length === 0) {
      tableArea.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="scale" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5;"></i>
          <p>No measurement units configured.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
      return;
    }

    let rowsHtml = uoms.map((u) => {
      return `
        <tr data-uom-id="${u.id}">
          <td style="width:40px; text-align:center;">
            <input type="checkbox" class="uom-select-chk" data-id="${u.id}" />
          </td>
          <td><strong>${u.name}</strong></td>
          <td><code>${u.short_code || '-'}</code></td>
          <td>
            <span class="badge ${u.is_active !== false ? 'badge-teal' : ''}">
              ${u.is_active !== false ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-outline btn-sm btn-edit-uom" data-id="${u.id}" title="Edit Unit">
                <i data-lucide="edit-2" style="width:14px; height:14px;"></i>
              </button>
              <button class="btn btn-outline btn-sm text-danger btn-del-uom" data-id="${u.id}" title="Delete Unit">
                <i data-lucide="trash-2" style="width:14px; height:14px;"></i>
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    tableArea.innerHTML = `
      <table class="data-table" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th style="width:40px; text-align:center;">
              <input type="checkbox" id="chk-select-all-uoms" />
            </th>
            <th>Unit Name</th>
            <th>Short Code / Symbol</th>
            <th>Status</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    // Select All Checkbox
    const selectAllChk = document.getElementById('chk-select-all-uoms');
    selectAllChk.onclick = (e) => {
      const chks = tableArea.querySelectorAll('.uom-select-chk');
      chks.forEach((chk) => {
        chk.checked = e.target.checked;
        if (e.target.checked) selectedUnitIds.add(chk.dataset.id);
        else selectedUnitIds.delete(chk.dataset.id);
      });
      updateBatchDeleteButton();
    };

    // Row Checkboxes
    tableArea.querySelectorAll('.uom-select-chk').forEach((chk) => {
      chk.onclick = (e) => {
        e.stopPropagation();
        if (chk.checked) selectedUnitIds.add(chk.dataset.id);
        else selectedUnitIds.delete(chk.dataset.id);
        updateBatchDeleteButton();
      };
    });

    // Edit Handler
    tableArea.querySelectorAll('.btn-edit-uom').forEach((btn) => {
      btn.onclick = () => {
        const uom = uoms.find((u) => u.id === btn.dataset.id);
        if (uom) openUOMModal(uom);
      };
    });

    // Delete Handler
    tableArea.querySelectorAll('.btn-del-uom').forEach((btn) => {
      btn.onclick = () => {
        const uom = uoms.find((u) => u.id === btn.dataset.id);
        if (uom) confirmDeleteUOM(uom);
      };
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  function updateBatchDeleteButton() {
    const btn = document.getElementById('btn-batch-delete-uom');
    const cnt = document.getElementById('batch-uom-count');
    if (!btn || !cnt) return;

    if (selectedUnitIds.size > 0) {
      cnt.textContent = selectedUnitIds.size;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  // =========================================================================
  // Modal Handler (Create / Edit Unit)
  // =========================================================================
  function openUOMModal(uom = null) {
    const isEdit = !!uom;
    Modal.open({
      title: isEdit ? `Edit Unit: ${uom.name}` : 'Register Unit of Measurement',
      content: `
        <form id="form-uom-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Unit Full Name</label>
            <input type="text" name="name" required value="${uom?.name || ''}" placeholder="e.g. Kilogram, Litre, Pieces, Meter" />
          </div>
          <div class="form-group">
            <label>Short Code / Symbol</label>
            <input type="text" name="short_code" required value="${uom?.short_code || ''}" placeholder="e.g. kg, l, pcs, m" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Unit' : 'Save Unit'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          short_code: fd.short_code,
          is_active: true,
        };

        const { error } = isEdit
          ? await supabase.from('measurement_units').update(payload).eq('id', uom.id)
          : await supabase.from('measurement_units').insert([payload]);

        if (error) {
          Toast.error(error.message);
        } else {
          Toast.success(`Unit ${isEdit ? 'updated' : 'saved'}.`);
          await fetchAndRenderUOMs();
        }
      },
    });
  }

  // =========================================================================
  // Delete Handlers
  // =========================================================================
  async function confirmDeleteUOM(uom) {
    if (!confirm(`Are you sure you want to delete measurement unit "${uom.name}"?`)) return;

    const { error } = await supabase.from('measurement_units').delete().eq('id', uom.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Unit "${uom.name}" deleted.`);
      await fetchAndRenderUOMs();
    }
  }

  async function batchDeleteUOMs() {
    if (selectedUnitIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedUnitIds.size} selected measurement units?`)) return;

    const idsToDel = Array.from(selectedUnitIds);

    const { error } = await supabase.from('measurement_units').delete().in('id', idsToDel);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`${idsToDel.length} measurement units deleted.`);
      selectedUnitIds.clear();
      await fetchAndRenderUOMs();
    }
  }

  await fetchAndRenderUOMs();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}