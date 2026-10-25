import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { Modal } from '../components/Modal.js';
import { Toast } from '../components/Toast.js';
import { PrinterDriver } from '../components/PrinterDriver.js';

export async function mount(container) {
  const currency = globalState.preferences.currency || 'KES';
  let unsubs = [];
  
  // Terminal Local Cart State
  let cart = [];
  let products = [];
  let categories = [];
  let discountPlans = [];
  let selectedCategory = 'all';
  let activeDiscount = null;
  let serviceType = 'walk_in'; // 'walk_in' | 'dine_in' | 'takeaway' | 'delivery'

  container.innerHTML = `
    <div class="pos-workspace">
      <!-- 1. Catalog & Barcode Scanner Panel -->
      <section class="pos-catalog-panel">
        <div class="pos-search-bar">
          <div class="input-icon-wrap" style="flex:1;">
            <i data-lucide="search"></i>
            <input type="text" id="pos-barcode-search" placeholder="Scan barcode or search product name / SKU..." autofocus />
          </div>
          <button class="btn btn-outline" id="btn-clear-search">Clear</button>
        </div>

        <div class="pos-category-scroll" id="pos-category-bar">
          <button class="date-chip active" data-cat="all">All Items</button>
        </div>

        <div class="pos-product-grid" id="pos-grid">
          <p style="color:var(--text-muted); font-size:0.875rem;">Loading product catalog...</p>
        </div>
      </section>

      <!-- 2. Active Order Checkout Panel -->
      <section class="pos-cart-panel">
        <div class="cart-header">
          <div>
            <h3 style="font-size:1rem; font-weight:700;">Current Ticket</h3>
            <span style="font-size:0.75rem; color:var(--text-muted);" id="cart-item-count">0 items</span>
          </div>
          <div style="display:flex; align-items:center; gap:8px;">
            <select id="select-service-type" style="padding:4px 8px; font-size:0.75rem; border-radius:4px; border:1px solid var(--border-subtle); background:#fff;">
              <option value="walk_in">Walk-in</option>
              <option value="dine_in">Dine-in</option>
              <option value="takeaway">Takeaway</option>
              <option value="delivery">Delivery</option>
            </select>
            <button class="btn-icon text-danger" id="btn-clear-cart" title="Discard Current Ticket">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>

        <div class="cart-items-scroll" id="cart-items-list">
          <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-subtle);">
            <i data-lucide="shopping-bag" style="width:40px; height:40px; margin-bottom:8px;"></i>
            <p style="font-size:0.875rem;">Ticket is empty</p>
          </div>
        </div>

        <div class="cart-summary">
          <div class="summary-line">
            <span>Subtotal</span>
            <span id="cart-subtotal">0.00 ${currency}</span>
          </div>
          <div class="summary-line" style="cursor:pointer;" id="row-discount-trigger" title="Click to apply discount plan">
            <span style="color:var(--teal-600);"><i data-lucide="tag" style="width:12px; height:12px;"></i> Discount</span>
            <span id="cart-discount" style="color:var(--teal-600);">- 0.00 ${currency}</span>
          </div>
          <div class="summary-line">
            <span>Est. Tax</span>
            <span id="cart-tax">0.00 ${currency}</span>
          </div>
          <div class="summary-line total-line">
            <span>Total Payable</span>
            <span id="cart-grand-total">0.00 ${currency}</span>
          </div>
          <button class="btn btn-teal-primary btn-block" id="btn-checkout-trigger" style="margin-top:12px; padding:12px; font-weight:700;" disabled>
            Tender / Checkout (<span id="btn-checkout-amount">0.00</span>)
          </button>
        </div>
      </section>
    </div>
  `;

  // Reactive listeners for live catalog updates
  unsubs.push(
    globalState.subscribeKey('products', () => {
      loadData();
    })
  );
  unsubs.push(
    globalState.subscribeKey('inventory', () => {
      loadData();
    })
  );

  // =========================================================================
  // Data Loading
  // =========================================================================
  async function loadData() {
    let prodQuery = supabase
      .from('products')
      .select('*, categories(name)')
      .eq('is_active', true)
      .order('name');
    
    if (globalState.activeShopId) prodQuery = prodQuery.eq('shop_id', globalState.activeShopId);

    let catQuery = supabase.from('categories').select('*').order('name');
    if (globalState.activeShopId) {
      catQuery = catQuery.or(`shop_id.eq.${globalState.activeShopId},shop_id.is.null`);
    }

    let discQuery = supabase.from('discount_plans').select('*').eq('is_active', true);
    if (globalState.activeShopId) discQuery = discQuery.eq('shop_id', globalState.activeShopId);

    const [prodRes, catRes, discRes] = await Promise.all([
      prodQuery,
      catQuery,
      discQuery,
    ]);

    products = prodRes.data || [];
    categories = catRes.data || [];
    discountPlans = discRes.data || [];

    renderCategoryButtons();
    renderProductGrid();
  }

  function renderCategoryButtons() {
    const bar = document.getElementById('pos-category-bar');
    if (!bar) return;
    const catHtml = categories.map((c) => `
      <button class="date-chip" data-cat="${c.id}">${c.name}</button>
    `).join('');
    
    bar.innerHTML = `<button class="date-chip active" data-cat="all">All Items</button>` + catHtml;

    bar.querySelectorAll('[data-cat]').forEach((btn) => {
      btn.onclick = () => {
        bar.querySelectorAll('[data-cat]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        selectedCategory = btn.dataset.cat;
        renderProductGrid();
      };
    });
  }

  function renderProductGrid(filterText = '') {
    const grid = document.getElementById('pos-grid');
    if (!grid) return;
    const term = filterText.toLowerCase().trim();

    const filtered = products.filter((p) => {
      const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;
      const matchText = !term || 
        p.name.toLowerCase().includes(term) || 
        (p.barcode && p.barcode.toLowerCase().includes(term)) ||
        (p.sku && p.sku.toLowerCase().includes(term));
      return matchCat && matchText;
    });

    if (!filtered.length) {
      grid.innerHTML = `<p style="padding:20px; color:var(--text-muted); font-size:0.875rem;">No products match query.</p>`;
      return;
    }

    grid.innerHTML = filtered.map((p) => `
      <div class="product-tile" data-pid="${p.id}">
        <span class="p-name">${p.name}</span>
        <div>
          <span class="p-price">${Number(p.retail_price).toLocaleString()} ${currency}</span>
          <div class="p-stock">${p.categories?.name || 'General'}</div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.product-tile').forEach((tile) => {
      tile.onclick = async () => {
        const prod = products.find((p) => p.id === tile.dataset.pid);
        if (!prod) return;

        // Query product_modifier_groups for mapped option sets
        const { data: mappings, error } = await supabase
          .from('product_modifier_groups')
          .select('modifier_group_id, modifier_groups(name, selection_type, modifiers(*))')
          .eq('product_id', prod.id);

        if (!error && mappings && mappings.length > 0) {
          openProductModifierPrompt(prod, mappings);
        } else {
          addToCart(prod);
        }
      };
    });
  }

  // =========================================================================
  // Product Modifier Selection Modal
  // =========================================================================
  function openProductModifierPrompt(product, mappings) {
    let formContent = '';
    mappings.forEach((m) => {
      const grp = m.modifier_groups;
      if (!grp) return;

      const inputType = grp.selection_type === 'single' ? 'radio' : 'checkbox';
      const inputGroupName = `mod_${grp.name.replace(/\s+/g, '_')}`;

      const options = (grp.modifiers || []).map((opt, idx) => `
        <label style="display:flex; justify-content:space-between; align-items:center; padding:8px 0; border-bottom:1px solid var(--border-subtle); cursor:pointer;">
          <div style="display:flex; align-items:center;">
            <input 
              type="${inputType}" 
              name="${inputGroupName}" 
              value="${opt.id}" 
              data-price="${opt.price_delta || opt.price_impact || 0}" 
              data-name="${opt.name}"
              ${inputType === 'radio' && idx === 0 ? 'checked' : ''} 
            />
            <span style="margin-left:8px; font-size:0.875rem;">${opt.name}</span>
          </div>
          <span style="font-weight:600; color:var(--teal-600); font-size:0.875rem;">
            +${Number(opt.price_delta || opt.price_impact || 0).toLocaleString()} ${currency}
          </span>
        </label>
      `).join('');

      formContent += `
        <div style="margin-bottom:16px;">
          <h4 style="font-size:0.875rem; font-weight:700; margin-bottom:8px; color:var(--text-main);">
            ${grp.name} <span style="font-size:0.75rem; font-weight:normal; color:var(--text-muted);">(${(grp.selection_type || 'single').toUpperCase()})</span>
          </h4>
          <div style="background:var(--bg-canvas); padding:6px 12px; border-radius:6px; border:1px solid var(--border-subtle);">
            ${options}
          </div>
        </div>
      `;
    });

    Modal.open({
      title: `Customize: ${product.name}`,
      content: `
        <form id="form-apply-modifiers">
          ${formContent}
          <button type="submit" class="btn btn-teal-primary btn-block" style="margin-top:16px;">
            Add to Ticket with Options
          </button>
        </form>
      `,
      onSubmit: () => {
        const checkedInputs = Array.from(document.querySelectorAll('#form-apply-modifiers input:checked'));
        let modifierTotalDelta = 0;
        const selectedModifierNames = [];

        checkedInputs.forEach((inp) => {
          modifierTotalDelta += parseFloat(inp.dataset.price) || 0;
          if (inp.dataset.name) selectedModifierNames.push(inp.dataset.name);
        });

        const customizedItem = {
          ...product,
          retail_price: Number(product.retail_price) + modifierTotalDelta,
          name: selectedModifierNames.length > 0 
            ? `${product.name} (${selectedModifierNames.join(', ')})` 
            : product.name,
        };

        addToCart(customizedItem);
      },
    });
  }

  // =========================================================================
  // Cart Actions & Discard Logging
  // =========================================================================
  function addToCart(product) {
    const existing = cart.find((i) => i.id === product.id && i.name === product.name);
    if (existing) {
      existing.quantity += 1;
    } else {
      cart.push({
        id: product.id,
        name: product.name,
        price: Number(product.retail_price),
        cost_price: Number(product.cost_price || 0),
        tax_rate: Number(product.tax_rate || 0),
        quantity: 1,
      });
    }
    renderCart();
  }

  async function updateQty(productId, delta, itemName = null) {
    const idx = cart.findIndex((i) => i.id === productId && (!itemName || i.name === itemName));
    if (idx === -1) return;

    if (delta < 0) {
      const droppedItem = cart[idx];
      supabase.from('cart_discard_logs').insert([{
        shop_id: globalState.activeShopId,
        product_id: droppedItem.id,
        product_name: droppedItem.name,
        quantity: 1,
        unit_price: droppedItem.price,
        cashier_id: globalState.user?.id,
        reason: 'Item decremented/removed from open cart ticket',
        created_at: new Date().toISOString()
      }]).then();
    }

    cart[idx].quantity += delta;
    if (cart[idx].quantity <= 0) {
      cart.splice(idx, 1);
    }
    renderCart();
  }

  function calculateTotals() {
    let subtotal = 0;
    let taxAmount = 0;

    cart.forEach((item) => {
      const itemSub = item.price * item.quantity;
      subtotal += itemSub;
      taxAmount += itemSub * (item.tax_rate / 100);
    });

    let discountAmount = 0;
    if (activeDiscount) {
      if (activeDiscount.discount_type === 'percentage') {
        discountAmount = subtotal * (activeDiscount.value / 100);
      } else {
        discountAmount = activeDiscount.value;
      }
      if (discountAmount > subtotal) discountAmount = subtotal;
    }

    const grandTotal = Math.max(0, subtotal - discountAmount + taxAmount);
    return { subtotal, discountAmount, taxAmount, grandTotal };
  }

  function renderCart() {
    const list = document.getElementById('cart-items-list');
    const countEl = document.getElementById('cart-item-count');
    const checkoutBtn = document.getElementById('btn-checkout-trigger');
    if (!list || !countEl || !checkoutBtn) return;

    if (!cart.length) {
      list.innerHTML = `
        <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; color:var(--text-subtle);">
          <i data-lucide="shopping-bag" style="width:40px; height:40px; margin-bottom:8px;"></i>
          <p style="font-size:0.875rem;">Ticket is empty</p>
        </div>
      `;
      countEl.textContent = '0 items';
      checkoutBtn.disabled = true;
      document.getElementById('cart-subtotal').textContent = `0.00 ${currency}`;
      document.getElementById('cart-discount').textContent = `- 0.00 ${currency}`;
      document.getElementById('cart-tax').textContent = `0.00 ${currency}`;
      document.getElementById('cart-grand-total').textContent = `0.00 ${currency}`;
      document.getElementById('btn-checkout-amount').textContent = `0.00 ${currency}`;
      if (window.lucide) window.lucide.createIcons({ root: list });
      return;
    }

    const totalQty = cart.reduce((sum, i) => sum + i.quantity, 0);
    countEl.textContent = `${totalQty} item${totalQty > 1 ? 's' : ''}`;

    list.innerHTML = cart.map((item) => `
      <div class="cart-item-row">
        <div class="cart-item-info">
          <div class="cart-item-title">${item.name}</div>
          <div class="cart-item-meta">${Number(item.price).toLocaleString()} ${currency}</div>
        </div>
        <div class="cart-qty-ctrls">
          <button class="btn-qty" data-qty-id="${item.id}" data-item-name="${encodeURIComponent(item.name)}" data-delta="-1">-</button>
          <span style="font-weight:700; min-width:20px; text-align:center;">${item.quantity}</span>
          <button class="btn-qty" data-qty-id="${item.id}" data-item-name="${encodeURIComponent(item.name)}" data-delta="1">+</button>
        </div>
      </div>
    `).join('');

    list.querySelectorAll('.btn-qty').forEach((btn) => {
      btn.onclick = () => {
        const decodedName = decodeURIComponent(btn.dataset.itemName);
        updateQty(btn.dataset.qtyId, parseInt(btn.dataset.delta), decodedName);
      };
    });

    const { subtotal, discountAmount, taxAmount, grandTotal } = calculateTotals();
    document.getElementById('cart-subtotal').textContent = `${subtotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
    document.getElementById('cart-discount').textContent = `- ${discountAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
    document.getElementById('cart-tax').textContent = `${taxAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
    document.getElementById('cart-grand-total').textContent = `${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
    document.getElementById('btn-checkout-amount').textContent = `${grandTotal.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
    checkoutBtn.disabled = false;
  }

  // =========================================================================
  // Checkout & Payment Tender
  // =========================================================================
  function openCheckoutModal() {
    const { grandTotal } = calculateTotals();
    const finalAmount = grandTotal;

    Modal.open({
      title: 'Tender Order Checkout',
      content: `
        <form id="form-tender-sale">
          <div style="font-size:1.35rem; font-weight:700; color:var(--teal-600); text-align:center; margin-bottom:16px;">
            Payable: ${finalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}
          </div>
          
          <div class="form-group">
            <label>Payment Channel</label>
            <select name="payment_method" id="tender-method">
              <option value="cash">Cash Tender</option>
              <option value="mpesa">M-PESA Till / Paybill</option>
              <option value="card">Card Terminal</option>
            </select>
          </div>

          <div class="form-group" id="group-cash-tender">
            <label>Cash Given by Customer (${currency})</label>
            <input type="number" step="0.01" id="tender-cash-paid" value="${finalAmount}" />
            <div style="margin-top:6px; font-size:0.875rem;">
              <span>Change to return: </span><strong id="tender-change-disp">0.00 ${currency}</strong>
            </div>
          </div>

          <div class="form-group hidden" id="group-ref-no">
            <label>M-PESA / Confirmation Code</label>
            <input type="text" name="ref_code" id="tender-ref-code" placeholder="e.g. QK9928192" />
          </div>

          <button type="submit" class="btn btn-teal-primary btn-block" style="padding:12px; margin-top:16px;">
            Commit Sale & Print Slip
          </button>
        </form>
      `,
      onSubmit: async (formData) => {
        await finalizeSale(formData.payment_method, formData.ref_code, finalAmount);
      },
    });

    const cashInput = document.getElementById('tender-cash-paid');
    const changeDisp = document.getElementById('tender-change-disp');
    const methodSelect = document.getElementById('tender-method');
    const cashGroup = document.getElementById('group-cash-tender');
    const refGroup = document.getElementById('group-ref-no');

    methodSelect.onchange = () => {
      if (methodSelect.value === 'cash') {
        cashGroup.classList.remove('hidden');
        refGroup.classList.add('hidden');
      } else {
        cashGroup.classList.add('hidden');
        refGroup.classList.remove('hidden');
      }
    };

    cashInput.oninput = () => {
      const paid = parseFloat(cashInput.value) || 0;
      const chg = Math.max(0, paid - finalAmount);
      changeDisp.textContent = `${chg.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${currency}`;
    };
  }

  async function finalizeSale(paymentMethod, refCode, finalAmount) {
    const { subtotal, discountAmount, taxAmount, grandTotal } = calculateTotals();
    const receiptNo = `QS-${Date.now().toString().slice(-8)}`;
    const orderId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    const orderPayload = {
      id: orderId,
      shop_id: globalState.activeShopId,
      cashier_id: globalState.user?.id,
      customer_id: null,
      shift_id: globalState.currentShift?.id || null,
      receipt_no: receiptNo,
      service_type: serviceType,
      order_status: 'completed',
      subtotal: subtotal,
      discount_amount: discountAmount,
      tax_amount: taxAmount,
      total: grandTotal,
      synced_from_offline: false,
      created_at: nowIso,
    };

    const lineItems = cart.map((i) => ({
      id: crypto.randomUUID(),
      order_id: orderId,
      product_id: i.id,
      product_name: i.name,
      quantity: i.quantity,
      unit_price: i.price,
      cost_price: i.cost_price,
      tax_rate: i.tax_rate,
      discount_amount: 0,
      total: i.price * i.quantity,
    }));

    const paymentsPayload = [{
      id: crypto.randomUUID(),
      order_id: orderId,
      payment_method: paymentMethod,
      amount: grandTotal,
      reference_no: refCode || null,
      reference_code: refCode || null,
      created_at: nowIso,
    }];

    try {
      // 1. Process Sale via Atomic Supabase RPC
      let rpcExecuted = false;
      try {
        const { error: rpcErr } = await supabase.rpc('process_pos_sale', {
          p_order: orderPayload,
          p_items: lineItems,
          p_payments: paymentsPayload,
        });

        if (!rpcErr) {
          rpcExecuted = true;
        } else {
          console.warn('[Backoffice POS] RPC error, falling back to direct table inserts:', rpcErr.message);
        }
      } catch (e) {
        console.warn('[Backoffice POS] RPC exception, falling back:', e);
      }

      // 2. Fallback Direct Inserts if RPC is unavailable
      if (!rpcExecuted) {
        const { error: orderErr } = await supabase.from('orders').insert([orderPayload]);
        if (orderErr) throw orderErr;

        if (lineItems.length) {
          const { error: itemsErr } = await supabase.from('order_items').insert(lineItems);
          if (itemsErr) throw itemsErr;
        }

        if (paymentsPayload.length) {
          const { error: payErr } = await supabase.from('payments').insert(paymentsPayload);
          if (payErr) throw payErr;
        }
      }

      Toast.success(`Receipt ${receiptNo} recorded.`);

      // 3. Dispatch Receipt Printing via PrinterDriver
      const slipPayload = {
        shopName: globalState.activeShop?.name || 'QuickSell POS',
        branchCode: globalState.activeShop?.branch_code || 'Main',
        receiptNo: receiptNo,
        items: cart.map((i) => ({ name: i.name, quantity: i.quantity, price: i.price })),
        subtotal: subtotal,
        discount: discountAmount,
        tax: taxAmount,
        total: grandTotal,
        currency,
      };

      PrinterDriver.printFallbackSlip(slipPayload);

      // Reset Ticket
      cart = [];
      activeDiscount = null;
      renderCart();

    } catch (err) {
      console.error(err);
      Toast.error(err.message || 'Failed to complete sale transaction.');
    }
  }

  // =========================================================================
  // Search, Clear & Discount Listeners
  // =========================================================================
  const searchInput = document.getElementById('pos-barcode-search');
  searchInput.oninput = (e) => {
    renderProductGrid(e.target.value);
  };

  searchInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      const code = searchInput.value.trim().toLowerCase();
      const matched = products.find((p) => 
        (p.barcode && p.barcode.toLowerCase() === code) || 
        (p.sku && p.sku.toLowerCase() === code)
      );
      if (matched) {
        addToCart(matched);
        searchInput.value = '';
        renderProductGrid();
      }
    }
  };

  document.getElementById('select-service-type').onchange = (e) => {
    serviceType = e.target.value;
  };

  document.getElementById('btn-clear-search').onclick = () => {
    searchInput.value = '';
    renderProductGrid();
  };

  document.getElementById('btn-clear-cart').onclick = async () => {
    if (cart.length && confirm('Discard current ticket items? This action will be audited.')) {
      const discards = cart.map((i) => ({
        shop_id: globalState.activeShopId,
        product_id: i.id,
        product_name: i.name,
        quantity: i.quantity,
        unit_price: i.price,
        cashier_id: globalState.user?.id,
        reason: 'Entire counter ticket discarded by cashier',
        created_at: new Date().toISOString()
      }));

      await supabase.from('cart_discard_logs').insert(discards);

      cart = [];
      activeDiscount = null;
      renderCart();
      Toast.show('Ticket cleared and audit log recorded.');
    }
  };

  document.getElementById('row-discount-trigger').onclick = () => {
    if (!discountPlans.length) {
      Toast.error('No active discount plans configured.');
      return;
    }

    const opts = discountPlans.map((d) => `
      <option value="${d.id}">${d.name} (${d.discount_type === 'percentage' ? `${d.value}%` : `${d.value}${currency}`})</option>
    `).join('');

    Modal.open({
      title: 'Apply Ticket Discount',
      content: `
        <form id="form-apply-disc">
          <div class="form-group">
            <label>Select Active Discount Plan</label>
            <select name="plan_id">${opts}</select>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Apply Discount</button>
        </form>
      `,
      onSubmit: (fd) => {
        activeDiscount = discountPlans.find((p) => p.id === fd.plan_id);
        Toast.success(`Discount plan '${activeDiscount.name}' applied.`);
        renderCart();
      },
    });
  };

  document.getElementById('btn-checkout-trigger').onclick = () => {
    if (cart.length) openCheckoutModal();
  };

  await loadData();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}