import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let selectedGroupIds = new Set();
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Product Modifiers & Add-ons</h3>
        <span class="badge badge-teal" id="modifier-count-badge">0 groups</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-danger hidden" id="btn-batch-delete-mods">
          <i data-lucide="trash-2" style="width:16px; height:16px; margin-right:6px;"></i> Delete Selected (<span id="batch-mod-count">0</span>)
        </button>
        <button class="btn btn-teal-primary" id="btn-add-mod-group">
          <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Create Modifier Group
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="modifiers-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-mod-group').onclick = () => openModifierGroupModal();
  
  const batchDelBtn = document.getElementById('btn-batch-delete-mods');
  batchDelBtn.onclick = () => batchDeleteModifierGroups();

  unsubs.push(
    globalState.subscribeKey('modifiers', () => fetchAndRenderModifiers())
  );

  async function fetchAndRenderModifiers() {
    const tableArea = document.getElementById('modifiers-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching modifier groups...</p>`;

    let query = supabase
      .from('modifier_groups')
      .select('*, modifiers(*)')
      .order('name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: groups, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('modifier-count-badge');
    if (countBadge) countBadge.textContent = `${groups?.length || 0} groups`;

    selectedGroupIds.clear();
    updateBatchDeleteButton();

    if (!groups || groups.length === 0) {
      tableArea.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="layers" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5;"></i>
          <p>No modifier groups found.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
      return;
    }

    let rowsHtml = groups.map((g) => {
      const options = g.modifiers || [];
      const optionsHtml = options.length > 0
        ? options.map((m) => `
            <span class="badge" style="margin-right:4px; margin-bottom:4px; display:inline-flex; align-items:center; gap:4px; background:var(--border-subtle); color:var(--text-main);">
              ${m.name} (+${Number(m.price_delta || m.price_impact || 0).toLocaleString()} ${currency})
              <i data-lucide="x" class="btn-del-opt" data-opt-id="${m.id}" data-opt-name="${m.name}" style="width:12px; height:12px; cursor:pointer; margin-left:4px;" title="Delete Option"></i>
            </span>
          `).join('')
        : '<span style="color:var(--text-muted); font-size:0.8rem;">No options added yet</span>';

      return `
        <tr data-group-id="${g.id}">
          <td style="width:40px; text-align:center;">
            <input type="checkbox" class="mod-select-chk" data-id="${g.id}" />
          </td>
          <td><strong>${g.name}</strong></td>
          <td><span class="badge badge-teal">${(g.selection_type || 'single').toUpperCase()}</span></td>
          <td><div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">${optionsHtml}</div></td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-outline btn-sm btn-add-opt" data-id="${g.id}" title="Add Option to Group">
                <i data-lucide="plus" style="width:14px; height:14px; margin-right:4px;"></i> Option
              </button>
              <button class="btn btn-outline btn-sm text-danger btn-del-group" data-id="${g.id}" title="Delete Group">
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
              <input type="checkbox" id="chk-select-all-mods" />
            </th>
            <th>Group Name</th>
            <th>Selection Type</th>
            <th>Options / Surcharges</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    // Select All Checkbox
    const selectAllChk = document.getElementById('chk-select-all-mods');
    selectAllChk.onclick = (e) => {
      const chks = tableArea.querySelectorAll('.mod-select-chk');
      chks.forEach((chk) => {
        chk.checked = e.target.checked;
        if (e.target.checked) selectedGroupIds.add(chk.dataset.id);
        else selectedGroupIds.delete(chk.dataset.id);
      });
      updateBatchDeleteButton();
    };

    // Row Checkboxes
    tableArea.querySelectorAll('.mod-select-chk').forEach((chk) => {
      chk.onclick = (e) => {
        e.stopPropagation();
        if (chk.checked) selectedGroupIds.add(chk.dataset.id);
        else selectedGroupIds.delete(chk.dataset.id);
        updateBatchDeleteButton();
      };
    });

    // Add Option to Group
    tableArea.querySelectorAll('.btn-add-opt').forEach((btn) => {
      btn.onclick = () => {
        const group = groups.find((g) => g.id === btn.dataset.id);
        if (group) openModifierOptionModal(group);
      };
    });

    // Delete Single Option Badge
    tableArea.querySelectorAll('.btn-del-opt').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        deleteModifierOption(btn.dataset.optId, btn.dataset.optName);
      };
    });

    // Delete Group
    tableArea.querySelectorAll('.btn-del-group').forEach((btn) => {
      btn.onclick = () => {
        const group = groups.find((g) => g.id === btn.dataset.id);
        if (group) confirmDeleteModifierGroup(group);
      };
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  function updateBatchDeleteButton() {
    const btn = document.getElementById('btn-batch-delete-mods');
    const cnt = document.getElementById('batch-mod-count');
    if (!btn || !cnt) return;

    if (selectedGroupIds.size > 0) {
      cnt.textContent = selectedGroupIds.size;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  // =========================================================================
  // Modals (Modifier Group & Option Creation)
  // =========================================================================
  function openModifierGroupModal() {
    Modal.open({
      title: 'Create Modifier Group',
      content: `
        <form id="form-mod-group-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Group Name</label>
            <input type="text" name="name" required placeholder="e.g. Size, Temperature, Extra Toppings" />
          </div>
          <div class="form-group">
            <label>Selection Type</label>
            <select name="selection_type">
              <option value="single">Single Selection (Choose One)</option>
              <option value="multiple">Multiple Selection (Check All That Apply)</option>
            </select>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Save Group</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const { error } = await supabase.from('modifier_groups').insert([{
          shop_id: globalState.activeShopId,
          name: fd.name,
          selection_type: fd.selection_type,
        }]);

        if (error) {
          Toast.error(error.message);
        } else {
          Toast.success('Modifier group created.');
          await fetchAndRenderModifiers();
        }
      },
    });
  }

  function openModifierOptionModal(group) {
    Modal.open({
      title: `Add Option to "${group.name}"`,
      content: `
        <form id="form-mod-option-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Option Title</label>
            <input type="text" name="name" required placeholder="e.g. Large, Extra Cheese, Hot" />
          </div>
          <div class="form-group">
            <label>Price Surcharge / Impact (${currency})</label>
            <input type="number" step="0.01" name="price_delta" value="0.00" required />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Add Option</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const priceVal = parseFloat(fd.price_delta) || 0;
        const { error } = await supabase.from('modifiers').insert([{
          shop_id: globalState.activeShopId,
          group_id: group.id,
          name: fd.name,
          price_impact: priceVal,
          price_delta: priceVal,
          group_name: group.name,
        }]);

        if (error) {
          Toast.error(error.message);
        } else {
          Toast.success(`Option "${fd.name}" added.`);
          await fetchAndRenderModifiers();
        }
      },
    });
  }

  // =========================================================================
  // Delete Handlers
  // =========================================================================
  async function deleteModifierOption(optionId, optionName) {
    if (!confirm(`Delete option "${optionName}"?`)) return;

    const { error } = await supabase.from('modifiers').delete().eq('id', optionId);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success('Option removed.');
      await fetchAndRenderModifiers();
    }
  }

  async function confirmDeleteModifierGroup(group) {
    if (!confirm(`Are you sure you want to delete group "${group.name}" and all its options?`)) return;

    // Delete options under group first
    await supabase.from('modifiers').delete().eq('group_id', group.id);
    const { error } = await supabase.from('modifier_groups').delete().eq('id', group.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Modifier group "${group.name}" deleted.`);
      await fetchAndRenderModifiers();
    }
  }

  async function batchDeleteModifierGroups() {
    if (selectedGroupIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedGroupIds.size} selected modifier groups?`)) return;

    const idsToDel = Array.from(selectedGroupIds);

    await supabase.from('modifiers').delete().in('group_id', idsToDel);
    const { error } = await supabase.from('modifier_groups').delete().in('id', idsToDel);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`${idsToDel.length} modifier groups deleted.`);
      selectedGroupIds.clear();
      await fetchAndRenderModifiers();
    }
  }

  await fetchAndRenderModifiers();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}