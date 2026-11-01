import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let selectedCategoryIds = new Set();
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Product Categories</h3>
        <span class="badge badge-teal" id="category-count-badge">0 categories</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-danger hidden" id="btn-batch-delete-cats">
          <i data-lucide="trash-2" style="width:16px; height:16px; margin-right:6px;"></i> Delete Selected (<span id="batch-cat-count">0</span>)
        </button>
        <button class="btn btn-teal-primary" id="btn-add-category">
          <i data-lucide="folder-plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Category
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="categories-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-category').onclick = () => openCategoryModal();
  
  const batchDelBtn = document.getElementById('btn-batch-delete-cats');
  batchDelBtn.onclick = () => batchSoftDeleteCategories();

  unsubs.push(
    globalState.subscribeKey('categories', () => fetchAndRenderCategories())
  );

  async function fetchAndRenderCategories() {
    const tableArea = document.getElementById('categories-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching categories...</p>`;

    let query = supabase
      .from('categories')
      .select('*')
      .or('is_deleted.eq.false,is_deleted.is.null')
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: cats, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('category-count-badge');
    if (countBadge) countBadge.textContent = `${cats?.length || 0} categories`;

    selectedCategoryIds.clear();
    updateBatchDeleteButton();

    if (!cats || cats.length === 0) {
      tableArea.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="folder-open" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5;"></i>
          <p>No active categories found.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
      return;
    }

    let rowsHtml = cats.map((c) => {
      return `
        <tr data-cat-id="${c.id}">
          <td style="width:40px; text-align:center;">
            <input type="checkbox" class="cat-select-chk" data-id="${c.id}" />
          </td>
          <td><strong>${c.name}</strong></td>
          <td>${c.description || '<span style="color:var(--text-muted);">-</span>'}</td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-outline btn-sm btn-edit-cat" data-id="${c.id}" title="Edit Category">
                <i data-lucide="edit-2" style="width:14px; height:14px;"></i>
              </button>
              <button class="btn btn-outline btn-sm text-danger btn-del-cat" data-id="${c.id}" title="Delete Category">
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
              <input type="checkbox" id="chk-select-all-cats" />
            </th>
            <th>Category Title</th>
            <th>Description</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    // Select All Checkbox
    const selectAllChk = document.getElementById('chk-select-all-cats');
    selectAllChk.onclick = (e) => {
      const chks = tableArea.querySelectorAll('.cat-select-chk');
      chks.forEach((chk) => {
        chk.checked = e.target.checked;
        if (e.target.checked) selectedCategoryIds.add(chk.dataset.id);
        else selectedCategoryIds.delete(chk.dataset.id);
      });
      updateBatchDeleteButton();
    };

    // Row Checkboxes
    tableArea.querySelectorAll('.cat-select-chk').forEach((chk) => {
      chk.onclick = (e) => {
        e.stopPropagation();
        if (chk.checked) selectedCategoryIds.add(chk.dataset.id);
        else selectedCategoryIds.delete(chk.dataset.id);
        updateBatchDeleteButton();
      };
    });

    // Action Handlers
    tableArea.querySelectorAll('.btn-edit-cat').forEach((btn) => {
      btn.onclick = () => {
        const cat = cats.find((c) => c.id === btn.dataset.id);
        if (cat) openCategoryModal(cat);
      };
    });

    tableArea.querySelectorAll('.btn-del-cat').forEach((btn) => {
      btn.onclick = () => {
        const cat = cats.find((c) => c.id === btn.dataset.id);
        if (cat) confirmSoftDeleteCategory(cat);
      };
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  function updateBatchDeleteButton() {
    const btn = document.getElementById('btn-batch-delete-cats');
    const cnt = document.getElementById('batch-cat-count');
    if (!btn || !cnt) return;

    if (selectedCategoryIds.size > 0) {
      cnt.textContent = selectedCategoryIds.size;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  // =========================================================================
  // Modal Handler (Create / Edit Category)
  // =========================================================================
  function openCategoryModal(cat = null) {
    const isEdit = !!cat;
    Modal.open({
      title: isEdit ? `Edit Category: ${cat.name}` : 'Create Category',
      content: `
        <form id="form-cat-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Category Title</label>
            <input type="text" name="name" required value="${cat?.name || ''}" placeholder="e.g. Beverages, Snacks, Electronics" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <input type="text" name="description" value="${cat?.description || ''}" placeholder="Short description of this group" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Category' : 'Save Category'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const nowIso = new Date().toISOString();
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          description: fd.description || null,
          updated_at: nowIso,
        };

        const { error } = isEdit
          ? await supabase.from('categories').update(payload).eq('id', cat.id)
          : await supabase.from('categories').insert([{ ...payload, is_deleted: false, created_at: nowIso }]);

        if (error) {
          Toast.error(error.message);
        } else {
          Toast.success(`Category ${isEdit ? 'updated' : 'created'}.`);
          await fetchAndRenderCategories();
        }
      },
    });
  }

  // =========================================================================
  // Soft Delete Handlers
  // =========================================================================
  async function confirmSoftDeleteCategory(cat) {
    if (!confirm(`Are you sure you want to delete "${cat.name}"? It can be restored later in Deleted Items.`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from('categories')
      .update({
        is_deleted: true,
        deleted_at: nowIso,
        deleted_by: user?.id || null,
      })
      .eq('id', cat.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Category "${cat.name}" moved to deleted items.`);
      await fetchAndRenderCategories();
    }
  }

  async function batchSoftDeleteCategories() {
    if (selectedCategoryIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedCategoryIds.size} selected categories?`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;
    const nowIso = new Date().toISOString();
    const idsToDel = Array.from(selectedCategoryIds);

    const { error } = await supabase
      .from('categories')
      .update({
        is_deleted: true,
        deleted_at: nowIso,
        deleted_by: user?.id || null,
      })
      .in('id', idsToDel);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`${idsToDel.length} categories soft-deleted.`);
      selectedCategoryIds.clear();
      await fetchAndRenderCategories();
    }
  }

  await fetchAndRenderCategories();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}