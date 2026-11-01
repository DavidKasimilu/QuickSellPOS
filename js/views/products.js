import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  const currency = globalState.preferences?.currency || 'KES';
  let selectedProductIds = new Set();
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Products Directory</h3>
        <span class="badge badge-teal" id="product-count-badge">0 items</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-danger hidden" id="btn-batch-delete">
          <i data-lucide="trash-2" style="width:16px; height:16px; margin-right:6px;"></i> Delete Selected (<span id="batch-count">0</span>)
        </button>
        <button class="btn btn-teal-primary" id="btn-add-product">
          <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Product
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="products-table-content"></div>
    </div>
  `;

  document.getElementById('btn-add-product').onclick = () => openProductModal();
  
  const batchDelBtn = document.getElementById('btn-batch-delete');
  batchDelBtn.onclick = () => batchSoftDeleteProducts();

  unsubs.push(
    globalState.subscribeKey('products', () => fetchAndRenderProducts())
  );

  async function fetchAndRenderProducts() {
    const tableArea = document.getElementById('products-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching products catalog...</p>`;

    let query = supabase
      .from('products')
      .select('*, categories(name), measurement_units(name, short_code)')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('name', { ascending: true });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: prods, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('product-count-badge');
    if (countBadge) countBadge.textContent = `${prods?.length || 0} items`;

    selectedProductIds.clear();
    updateBatchDeleteButton();

    if (!prods || prods.length === 0) {
      tableArea.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="package-open" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5;"></i>
          <p>No active products found in catalog.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
      return;
    }

    let rowsHtml = prods.map((p) => {
      const imgMarkup = p.image_url 
        ? `<img src="${p.image_url}" alt="${p.name}" style="width:36px; height:36px; object-fit:cover; border-radius:4px; border:1px solid var(--border-subtle);" />`
        : `<div style="width:36px; height:36px; border-radius:4px; background:var(--border-subtle); display:flex; align-items:center; justify-content:center; color:var(--text-muted);"><i data-lucide="image" style="width:18px; height:18px;"></i></div>`;

      return `
        <tr data-prod-id="${p.id}">
          <td style="width:40px; text-align:center;">
            <input type="checkbox" class="prod-select-chk" data-id="${p.id}" />
          </td>
          <td style="width:50px;">${imgMarkup}</td>
          <td>
            <strong>${p.name}</strong>
            <div style="font-size:0.75rem; color:var(--text-muted);">${p.categories?.name || 'General'}</div>
          </td>
          <td><code>${p.barcode || p.sku || '-'}</code></td>
          <td>${Number(p.retail_price || 0).toLocaleString()} ${currency}</td>
          <td>${Number(p.cost_price || 0).toLocaleString()} ${currency}</td>
          <td>${p.measurement_units?.short_code || '-'}</td>
          <td style="text-align:right;">
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-outline btn-sm btn-edit-prod" data-id="${p.id}" title="Edit Product">
                <i data-lucide="edit-2" style="width:14px; height:14px;"></i>
              </button>
              <button class="btn btn-outline btn-sm text-danger btn-del-prod" data-id="${p.id}" title="Delete Product">
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
              <input type="checkbox" id="chk-select-all-prods" />
            </th>
            <th style="width:50px;">Image</th>
            <th>Item Name</th>
            <th>Barcode / SKU</th>
            <th>Retail Price</th>
            <th>Cost Price</th>
            <th>Unit</th>
            <th style="text-align:right;">Actions</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    `;

    // Select All
    const selectAllChk = document.getElementById('chk-select-all-prods');
    selectAllChk.onclick = (e) => {
      const chks = tableArea.querySelectorAll('.prod-select-chk');
      chks.forEach((c) => {
        c.checked = e.target.checked;
        if (e.target.checked) selectedProductIds.add(c.dataset.id);
        else selectedProductIds.delete(c.dataset.id);
      });
      updateBatchDeleteButton();
    };

    // Row Checkboxes
    tableArea.querySelectorAll('.prod-select-chk').forEach((chk) => {
      chk.onclick = (e) => {
        e.stopPropagation();
        if (chk.checked) selectedProductIds.add(chk.dataset.id);
        else selectedProductIds.delete(chk.dataset.id);
        updateBatchDeleteButton();
      };
    });

    // Single Actions
    tableArea.querySelectorAll('.btn-edit-prod').forEach((btn) => {
      btn.onclick = () => {
        const prod = prods.find((p) => p.id === btn.dataset.id);
        if (prod) openProductModal(prod);
      };
    });

    tableArea.querySelectorAll('.btn-del-prod').forEach((btn) => {
      btn.onclick = () => {
        const prod = prods.find((p) => p.id === btn.dataset.id);
        if (prod) confirmSoftDeleteProduct(prod);
      };
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  function updateBatchDeleteButton() {
    const btn = document.getElementById('btn-batch-delete');
    const cnt = document.getElementById('batch-count');
    if (!btn || !cnt) return;

    if (selectedProductIds.size > 0) {
      cnt.textContent = selectedProductIds.size;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  // =========================================================================
  // Product Edit / Create Modal with Supabase Storage Image Upload
  // =========================================================================
  async function openProductModal(prod = null) {
    const isEdit = !!prod;

    const [catRes, unitRes] = await Promise.all([
      supabase.from('categories').select('id, name').is('deleted_at', null).order('name'),
      supabase.from('measurement_units').select('id, name, short_code').eq('is_active', true).order('name'),
    ]);

    const categories = catRes.data || [];
    const units = unitRes.data || [];

    const catOpts = `<option value="">-- No Category --</option>` + categories.map((c) => 
      `<option value="${c.id}" ${prod?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    const unitOpts = `<option value="">-- Select Unit --</option>` + units.map((u) => 
      `<option value="${u.id}" ${prod?.unit_id === u.id ? 'selected' : ''}>${u.name} (${u.short_code})</option>`
    ).join('');

    Modal.open({
      title: isEdit ? `Edit Product: ${prod.name}` : 'Create Catalog Product',
      content: `
        <form id="form-product-save" style="display:flex; flex-direction:column; gap:12px;">
          <div class="form-group">
            <label>Product Title</label>
            <input type="text" name="name" required value="${prod?.name || ''}" placeholder="Product name" />
          </div>

          <div class="form-group">
            <label>Product Image</label>
            ${prod?.image_url ? `<div style="margin-bottom:8px;"><img src="${prod.image_url}" style="height:60px; border-radius:4px; border:1px solid var(--border-subtle);" /></div>` : ''}
            <input type="file" id="prod-image-file" accept="image/*" />
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Barcode</label>
              <input type="text" name="barcode" value="${prod?.barcode || ''}" placeholder="Scan or enter code" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>SKU Identifier</label>
              <input type="text" name="sku" value="${prod?.sku || ''}" placeholder="e.g. SKU-100" />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Retail Price (${currency})</label>
              <input type="number" step="0.01" name="retail_price" required value="${prod?.retail_price || 0}" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Cost Price (${currency})</label>
              <input type="number" step="0.01" name="cost_price" value="${prod?.cost_price || 0}" />
            </div>
          </div>

          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Category</label>
              <select name="category_id">${catOpts}</select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Measurement Unit</label>
              <select name="unit_id">${unitOpts}</select>
            </div>
          </div>

          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="track_inventory" ${prod?.track_inventory !== false ? 'checked' : ''} />
              Track warehouse inventory deduction on sales
            </label>
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update Item' : 'Save Product'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const nowIso = new Date().toISOString();
        let imageUrl = prod?.image_url || null;

        // Image upload handling
        const fileInput = document.getElementById('prod-image-file');
        if (fileInput && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          const fileExt = file.name.split('.').pop();
          const fileName = `${globalState.activeShopId || 'common'}/${Date.now()}.${fileExt}`;

          const { data: uploadData, error: uploadErr } = await supabase.storage
            .from('product-images')
            .upload(fileName, file, { cacheControl: '3600', upsert: true });

          if (uploadErr) {
            Toast.error(`Image upload failed: ${uploadErr.message}`);
          } else if (uploadData) {
            const { data: publicUrlData } = supabase.storage
              .from('product-images')
              .getPublicUrl(fileName);
            imageUrl = publicUrlData.publicUrl;
          }
        }

        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          image_url: imageUrl,
          barcode: fd.barcode || null,
          sku: fd.sku || null,
          retail_price: parseFloat(fd.retail_price) || 0,
          cost_price: parseFloat(fd.cost_price) || 0,
          category_id: fd.category_id || null,
          unit_id: fd.unit_id || null,
          track_inventory: fd.track_inventory === 'on',
          is_active: true,
          updated_at: nowIso,
        };

        if (isEdit) {
          const { error } = await supabase.from('products').update(payload).eq('id', prod.id);
          if (error) {
            Toast.error(error.message);
            return;
          }
        } else {
          const newProdId = crypto.randomUUID();
          payload.id = newProdId;
          payload.created_at = nowIso;

          const { error: prodErr } = await supabase.from('products').insert([payload]);
          if (prodErr) {
            Toast.error(prodErr.message);
            return;
          }

          if (globalState.activeShopId) {
            await supabase.from('inventory').insert([{
              shop_id: globalState.activeShopId,
              product_id: newProdId,
              quantity_on_hand: 0,
              min_stock_level: 5.0,
              updated_at: nowIso
            }]);
          }
        }

        Toast.success('Product saved successfully.');
        await fetchAndRenderProducts();
      },
    });
  }

  // =========================================================================
  // Soft Delete Handlers
  // =========================================================================
  async function confirmSoftDeleteProduct(product) {
    if (!confirm(`Are you sure you want to delete "${product.name}"? It can be restored later in Deleted Items.`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;
    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from('products')
      .update({
        is_active: false,
        deleted_at: nowIso,
        deleted_by: user?.id || null,
      })
      .eq('id', product.id);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`Product "${product.name}" moved to deleted items.`);
      await fetchAndRenderProducts();
    }
  }

  async function batchSoftDeleteProducts() {
    if (selectedProductIds.size === 0) return;
    if (!confirm(`Are you sure you want to delete ${selectedProductIds.size} selected products?`)) return;

    const user = (await supabase.auth.getUser())?.data?.user;
    const nowIso = new Date().toISOString();
    const idsToDel = Array.from(selectedProductIds);

    const { error } = await supabase
      .from('products')
      .update({
        is_active: false,
        deleted_at: nowIso,
        deleted_by: user?.id || null,
      })
      .in('id', idsToDel);

    if (error) {
      Toast.error(error.message);
    } else {
      Toast.success(`${idsToDel.length} products soft-deleted.`);
      selectedProductIds.clear();
      await fetchAndRenderProducts();
    }
  }

  await fetchAndRenderProducts();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}