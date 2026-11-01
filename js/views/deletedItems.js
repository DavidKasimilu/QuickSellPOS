import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let activeFilter = 'all'; // 'all' | 'product' | 'category'
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <span class="badge badge-teal" id="deleted-count-badge">0 items</span>
      </div>
      
      <!-- Filter Controls -->
      <div style="display:flex; gap:8px;">
        <button class="date-chip active" data-filter="all">All Items</button>
        <button class="date-chip" data-filter="product">Products</button>
        <button class="date-chip" data-filter="category">Categories</button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="deleted-table-content"></div>
    </div>
  `;

  // Bind filter buttons
  container.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter;
      fetchAndRenderDeletedItems();
    };
  });

  async function fetchAndRenderDeletedItems() {
    const tableArea = document.getElementById('deleted-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching deleted items archive...</p>`;

    const shopId = globalState.activeShopId;
    if (!shopId) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--text-muted);">No active shop selected.</p>`;
      return;
    }

    // Call Supabase RPC function to pull soft-deleted items across products and categories
    const { data: items, error } = await supabase.rpc('get_deleted_items', {
      p_shop_id: shopId
    });

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    // Filter by tab if selected
    let filteredItems = items || [];
    if (activeFilter !== 'all') {
      filteredItems = filteredItems.filter((i) => i.item_type === activeFilter);
    }

    const countBadge = document.getElementById('deleted-count-badge');
    if (countBadge) countBadge.textContent = `${filteredItems.length} items`;

    if (filteredItems.length === 0) {
      tableArea.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="trash-2" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5;"></i>
          <p>No deleted items found in archive.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
      return;
    }

    let rowsHtml = filteredItems.map((item) => {
      const typeBadge = item.item_type === 'product' 
        ? `<span class="badge badge-teal">PRODUCT</span>`
        : `<span class="badge" style="background:var(--border-subtle); color:var(--text-main);">CATEGORY</span>`;

      const formattedDate = item.deleted_at 
        ? new Date(item.deleted_at).toLocaleString() 
        : 'Unknown';

      return `
        <tr data-item-id="${item.item_id}">
          <td><strong>${item.item_name}</strong></td>
          <td>${typeBadge}</td>
          <td><span style="font-size:0.8rem; color:var(--text-muted);">${item.details || '-'}</span></td>
          <td style="font-size:0.8rem;">${formattedDate}</td>
          <td style="font-size:0.8rem;">${item.deleted_by_name || 'System'}</td>
          <td style="text-align:right;">
            <button class="btn btn-teal-primary btn-sm btn-restore-item" data-id="${item.item_id}" data-type="${item.item_type}" data-name="${item.item_name}">
              <i data-lucide="rotate-ccw" style="width:13px; height:13px; margin-right:4px;"></i> Restore
            </button>
          </td>
        </tr>
      `;
    }).join('');

    tableArea.innerHTML = `
      <table class="data-table" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th>Item Name</th>
            <th>Type</th>
            <th>Details / SKU</th>
            <th>Deleted On</th>
            <th>Deleted By</th>
            <th style="text-align:right;">Action</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    // Bind Restore buttons
    tableArea.querySelectorAll('.btn-restore-item').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        const type = btn.dataset.type;
        const name = btn.dataset.name;
        restoreItem(id, type, name);
      };
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  async function restoreItem(itemId, itemType, itemName) {
    if (!confirm(`Are you sure you want to restore "${itemName}" back to active catalog?`)) return;

    const { data: success, error } = await supabase.rpc('restore_deleted_item', {
      p_item_id: itemId,
      p_item_type: itemType
    });

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`"${itemName}" restored successfully.`);
      await fetchAndRenderDeletedItems();
    }
  }

  await fetchAndRenderDeletedItems();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}
