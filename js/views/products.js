import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { BarcodeGenerator } from '../components/BarcodeGenerator.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let activeTab = 'products'; // 'products' | 'categories' | 'modifiers' | 'uom'

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
      <div>
       </div>
      <div id="catalog-action-container"></div>
    </div>

    <!-- Submenu Navigation Tabs -->
    <div style="display:flex; gap:8px; border-bottom:1px solid var(--border-subtle); margin-bottom:20px; overflow-x:auto;">
      <button class="date-chip active" data-cat-tab="products">Products</button>
      <button class="date-chip" data-cat-tab="categories">Categories</button>
      <button class="date-chip" data-cat-tab="modifiers">Modifiers</button>
      <button class="date-chip" data-cat-tab="uom">Units of Measurement (UOM)</button>
    </div>

    <div class="chart-box" style="padding:0;">
      <div id="catalog-table-content"></div>
    </div>
  `;

  // Bind tab switching
  container.querySelectorAll('[data-cat-tab]').forEach((btn) => {
    btn.onclick = () => {
      container.querySelectorAll('[data-cat-tab]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.dataset.catTab;
      loadActiveTab();
    };
  });

  async function loadActiveTab() {
    const actionArea = document.getElementById('catalog-action-container');
    const tableArea = document.getElementById('catalog-table-content');
    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching ${activeTab} data...</p>`;

    switch (activeTab) {
      case 'products':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-product">
            <i data-lucide="plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Product
          </button>
        `;
        document.getElementById('btn-add-product').onclick = () => openProductModal();
        await renderProductsTable(tableArea);
        break;

      case 'categories':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-category">
            <i data-lucide="folder-plus" style="width:16px; height:16px; margin-right:6px;"></i> Add Category
          </button>
        `;
        document.getElementById('btn-add-category').onclick = () => openCategoryModal();
        await renderCategoriesTable(tableArea);
        break;

      case 'modifiers':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-mod-group">
            <i data-lucide="layers" style="width:16px; height:16px; margin-right:6px;"></i> Create Modifier Group
          </button>
        `;
        document.getElementById('btn-add-mod-group').onclick = () => openModifierGroupModal();
        await renderModifiersTable(tableArea);
        break;

      case 'uom':
        actionArea.innerHTML = `
          <button class="btn btn-teal-primary" id="btn-add-uom">
            <i data-lucide="scale" style="width:16px; height:16px; margin-right:6px;"></i> Add UOM
          </button>
        `;
        document.getElementById('btn-add-uom').onclick = () => openUOMModal();
        await renderUOMTable(tableArea);
        break;
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  // =========================================================================
  // 1. Products Table
  // =========================================================================
  async function renderProductsTable(target) {
    let query = supabase.from('products').select('*, categories(name)').order('name');
    if (globalState.activeShopId) query = query.eq('shop_id', globalState.activeShopId);

    const { data: prods, error } = await query;
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'catalog-table-content',
      columns: [
        { label: 'Item Name', key: 'name', render: (n) => `<strong>${n}</strong>` },
        { label: 'Barcode / SKU', key: 'barcode', render: (b, row) => `<code>${b || row.sku || '-'}</code>` },
        { label: 'Category', key: 'categories', render: (c) => c?.name || 'General' },
        { label: 'Retail Price', key: 'retail_price', render: (v) => `${Number(v).toLocaleString()}${currency}` },
        { label: 'Unit Cost', key: 'cost_price', render: (v) => `${Number(v).toLocaleString()}${currency}` },
        {
          label: 'Tools',
          key: 'id',
          align: 'right',
          render: (id, row) => `
            <div style="display:inline-flex; gap:6px;">
              <button class="btn btn-outline btn-sm" data-btn-label="${row.id}" title="Print Barcode Labels">
                <i data-lucide="printer" style="width:13px; height:13px;"></i> Barcode
              </button>
              <button class="btn btn-outline btn-sm" data-btn-mods="${row.id}" title="Map Modifier Groups">
                <i data-lucide="layers" style="width:13px; height:13px;"></i> Modifiers
              </button>
            </div>
          `
        }
      ],
      data: prods || [],
      onAction: (action, id) => {
        const prod = prods.find((p) => p.id === id);
        if (prod) openProductModal(prod);
      },
    });

    // Wire custom label printing & modifier mapping buttons
    target.querySelectorAll('[data-btn-label]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const p = prods.find((prod) => prod.id === btn.dataset.btnLabel);
        if (p) openPrintLabelsModal(p);
      };
    });

    target.querySelectorAll('[data-btn-mods]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const p = prods.find((prod) => prod.id === btn.dataset.btnMods);
        if (p) openProductModifierMappingModal(p);
      };
    });
  }

  // =========================================================================
  // Product-to-Modifier Group Mapping Modal
  // =========================================================================
  async function openProductModifierMappingModal(product) {
    const [groupsRes, existingRes] = await Promise.all([
      supabase.from('modifier_groups').select('*, modifiers(*)'),
      supabase.from('product_modifier_groups').select('*').eq('product_id', product.id),
    ]);

    const allGroups = groupsRes.data || [];
    const existing = existingRes.data || [];
    const mappedIds = new Set(existing.map((e) => e.modifier_group_id));

    if (!allGroups.length) {
      Toast.error('No modifier groups created yet. Create groups in the Modifiers tab first.');
      return;
    }

    const groupRows = allGroups.map((g) => {
      const isChecked = mappedIds.has(g.id);
      const modItems = (g.modifiers || []).map((m) => `${m.name} (+${m.price_delta})`).join(', ') || 'No items';
      return `
        <div style="padding:10px; border:1px solid var(--border-subtle); border-radius:6px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <label style="font-weight:600; display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="mod_group" value="${g.id}" ${isChecked ? 'checked' : ''} />
              ${g.name}
            </label>
            <span style="font-size:0.75rem; color:var(--text-muted); display:block; margin-left:22px;">${modItems}</span>
          </div>
          <span class="badge">${g.selection_type.toUpperCase()}</span>
        </div>
      `;
    }).join('');

    Modal.open({
      title: `Map Modifiers: ${product.name}`,
      content: `
        <form id="form-save-product-mods">
          <p style="font-size:0.8rem; color:var(--text-muted); margin-bottom:12px;">
            Select which option groups prompt the cashier when this item is clicked on the terminal:
          </p>
          <div style="max-height:300px; overflow-y:auto; margin-bottom:16px;">
            ${groupRows}
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Save Modifier Linkages</button>
        </form>
      `,
      onSubmit: async () => {
        const checkedBoxes = Array.from(document.querySelectorAll('input[name="mod_group"]:checked'));
        const selectedGroupIds = checkedBoxes.map((b) => b.value);

        // Delete previous mappings
        await supabase.from('product_modifier_groups').delete().eq('product_id', product.id);

        if (selectedGroupIds.length > 0) {
          const inserts = selectedGroupIds.map((gid) => ({
            product_id: product.id,
            modifier_group_id: gid,
          }));
          const { error } = await supabase.from('product_modifier_groups').insert(inserts);
          if (error) {
            Toast.error(error.message);
            return;
          }
        }

        Toast.success(`Updated modifier links for ${product.name}.`);
        await loadActiveTab();
      },
    });
  }

  // =========================================================================
  // Barcode Generator & Printable Label Sheets Modal
  // =========================================================================
  function openPrintLabelsModal(product) {
    const defaultCode = product.barcode || product.sku || `QS${product.id.slice(0, 8).toUpperCase()}`;
    const svgPreview = BarcodeGenerator.encode(defaultCode);

    Modal.open({
      title: `Barcode Generator: ${product.name}`,
      content: `
        <div style="text-align:center; padding:10px 0;">
          <div style="max-width:260px; margin:0 auto 16px; background:#fff; padding:12px; border:1px solid var(--border-subtle); border-radius:6px;">
            ${svgPreview}
          </div>
          <form id="form-print-labels">
            <div class="form-group" style="text-align:left;">
              <label>Number of Labels to Print</label>
              <input type="number" id="label-quantity" value="24" min="1" max="120" step="1" required />
            </div>
            <button type="submit" class="btn btn-teal-primary btn-block">
              <i data-lucide="printer" style="width:16px; height:16px; margin-right:6px;"></i> Print Label Sheet
            </button>
          </form>
        </div>
      `,
      onSubmit: () => {
        const qty = parseInt(document.getElementById('label-quantity').value, 10) || 24;
        BarcodeGenerator.printLabels(product, qty, currency);
      },
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // =========================================================================
  // 2. Categories Table
  // =========================================================================
  async function renderCategoriesTable(target) {
    let query = supabase.from('categories').select('*').order('name');
    const { data: cats, error } = await query;

    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'catalog-table-content',
      columns: [
        { label: 'Category Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Description', key: 'description', render: (d) => d || '-' },
      ],
      data: cats || [],
      onAction: (action, id) => {
        const cat = cats.find((c) => c.id === id);
        if (cat) openCategoryModal(cat);
      },
    });
  }

  // =========================================================================
  // 3. Modifiers Table
  // =========================================================================
  async function renderModifiersTable(target) {
    const { data: groups, error } = await supabase.from('modifier_groups').select('*, modifiers(*)').order('name');
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'catalog-table-content',
      columns: [
        { label: 'Modifier Group', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Selection Type', key: 'selection_type', render: (s) => `<span class="badge">${s.toUpperCase()}</span>` },
        { 
          label: 'Included Options', 
          key: 'modifiers', 
          render: (items) => (items || []).map((m) => `${m.name} (+${Number(m.price_delta).toLocaleString()})`).join(', ') || 'No options'
        },
      ],
      data: groups || [],
      onAction: (action, id) => {
        const grp = groups.find((g) => g.id === id);
        if (grp) openModifierOptionModal(grp);
      },
    });
  }

  // =========================================================================
  // 4. Units of Measurement (UOM) Table
  // =========================================================================
  async function renderUOMTable(target) {
    const { data: uoms, error } = await supabase.from('uom').select('*').order('name');
    if (error) {
      target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'catalog-table-content',
      columns: [
        { label: 'Unit Name', key: 'name', render: (v) => `<strong>${v}</strong>` },
        { label: 'Short Code / Symbol', key: 'code', render: (c) => `<code>${c}</code>` },
      ],
      data: uoms || [],
      onAction: (action, id) => {
        const item = uoms.find((u) => u.id === id);
        if (item) openUOMModal(item);
      },
    });
  }

  // =========================================================================
  // Modals (Product, Category, UOM, Modifier Groups)
  // =========================================================================
  async function openProductModal(prod = null) {
    const isEdit = !!prod;
    const { data: categories } = await supabase.from('categories').select('id, name');
    const catOpts = `<option value="">-- No Category --</option>` + (categories || []).map((c) => 
      `<option value="${c.id}" ${prod?.category_id === c.id ? 'selected' : ''}>${c.name}</option>`
    ).join('');

    Modal.open({
      title: isEdit ? `Edit Product: ${prod.name}` : 'Create Catalog Product',
      content: `
        <form id="form-product-save">
          <div class="form-group">
            <label>Product Title</label>
            <input type="text" name="name" required value="${prod?.name || ''}" placeholder="Product name" />
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
              <label>Retail Selling Price (${currency})</label>
              <input type="number" step="0.01" name="retail_price" required value="${prod?.retail_price || 0}" />
            </div>
            <div class="form-group" style="flex:1;">
              <label>Cost of Goods (COGS) (${currency})</label>
              <input type="number" step="0.01" name="cost_price" value="${prod?.cost_price || 0}" />
            </div>
          </div>
          <div class="form-row" style="display:flex; gap:12px;">
            <div class="form-group" style="flex:1;">
              <label>Category</label>
              <select name="category_id">${catOpts}</select>
            </div>
            <div class="form-group" style="flex:1;">
              <label>Tax Rate (%)</label>
              <input type="number" step="0.1" name="tax_rate" value="${prod?.tax_rate || 0}" />
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
        const payload = {
          shop_id: globalState.activeShopId,
          name: fd.name,
          barcode: fd.barcode || null,
          sku: fd.sku || null,
          retail_price: parseFloat(fd.retail_price) || 0,
          cost_price: parseFloat(fd.cost_price) || 0,
          category_id: fd.category_id || null,
          tax_rate: parseFloat(fd.tax_rate) || 0,
          track_inventory: fd.track_inventory === 'on',
        };

        const { error } = isEdit
          ? await supabase.from('products').update(payload).eq('id', prod.id)
          : await supabase.from('products').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Product saved.');
          await loadActiveTab();
        }
      },
    });
  }

  function openCategoryModal(cat = null) {
    const isEdit = !!cat;
    Modal.open({
      title: isEdit ? `Edit: ${cat.name}` : 'Create Category',
      content: `
        <form id="form-cat-save">
          <div class="form-group">
            <label>Category Title</label>
            <input type="text" name="name" required value="${cat?.name || ''}" placeholder="e.g. Beverages, Bakery" />
          </div>
          <div class="form-group">
            <label>Description</label>
            <input type="text" name="description" value="${cat?.description || ''}" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update' : 'Save'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = { name: fd.name, description: fd.description };
        const { error } = isEdit
          ? await supabase.from('categories').update(payload).eq('id', cat.id)
          : await supabase.from('categories').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Category saved.');
          await loadActiveTab();
        }
      },
    });
  }

  function openModifierGroupModal() {
    Modal.open({
      title: 'Create Modifier Group',
      content: `
        <form id="form-mod-grp-save">
          <div class="form-group">
            <label>Group Name</label>
            <input type="text" name="name" required placeholder="e.g. Coffee Size, Extra Toppings" />
          </div>
          <div class="form-group">
            <label>Selection Type</label>
            <select name="selection_type">
              <option value="single">Single (Choose One)</option>
              <option value="multiple">Multiple (Check All That Apply)</option>
            </select>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Create Group</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const { error } = await supabase.from('modifier_groups').insert([{
          shop_id: globalState.activeShopId,
          name: fd.name,
          selection_type: fd.selection_type,
        }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Modifier group created.');
          await loadActiveTab();
        }
      },
    });
  }

  function openModifierOptionModal(group) {
    Modal.open({
      title: `Add Option to "${group.name}"`,
      content: `
        <form id="form-mod-opt-save">
          <div class="form-group">
            <label>Option Name</label>
            <input type="text" name="name" required placeholder="e.g. Large, Extra Cheese" />
          </div>
          <div class="form-group">
            <label>Price Surcharge (${currency})</label>
            <input type="number" step="0.01" name="price_delta" value="0.00" required />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Add Option</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const { error } = await supabase.from('modifiers').insert([{
          group_id: group.id,
          name: fd.name,
          price_delta: parseFloat(fd.price_delta) || 0,
        }]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Modifier option added.');
          await loadActiveTab();
        }
      },
    });
  }

  function openUOMModal(uom = null) {
    const isEdit = !!uom;
    Modal.open({
      title: isEdit ? `Edit: ${uom.name}` : 'Register Unit of Measurement',
      content: `
        <form id="form-uom-save">
          <div class="form-group">
            <label>Unit Name</label>
            <input type="text" name="name" required value="${uom?.name || ''}" placeholder="Kilogram, Litre, Pieces" />
          </div>
          <div class="form-group">
            <label>Unit Code / Symbol</label>
            <input type="text" name="code" required value="${uom?.code || ''}" placeholder="kg, l, pcs" />
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">${isEdit ? 'Update UOM' : 'Save UOM'}</button>
        </form>
      `,
      onSubmit: async (fd) => {
        const payload = { name: fd.name, code: fd.code };
        const { error } = isEdit
          ? await supabase.from('uom').update(payload).eq('id', uom.id)
          : await supabase.from('uom').insert([payload]);

        if (error) Toast.error(error.message);
        else {
          Toast.success('Unit saved.');
          await loadActiveTab();
        }
      },
    });
  }

  await loadActiveTab();
  return () => {};
}