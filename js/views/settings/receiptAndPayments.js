import { supabase } from '../../supabaseClient.js';
import { globalState } from '../../state.js';
import { Modal } from '../../components/Modal.js';
import { renderDataTable } from '../../components/DataTable.js';
import { Toast } from '../../components/Toast.js';
import { scoped } from '../../tenant.js';

// =========================================================================
// 1. DESIGN RECEIPT (With Live Thermal Slip Preview)
// =========================================================================
export async function renderReceiptDesignerPane(target) {
  let { data: template } = await supabase
    .from('receipt_templates')
    .select('*')
    .eq('shop_id', globalState.activeShopId)
    .maybeSingle();

  if (!template) {
    template = {
      business_name: globalState.activeShop?.name || 'QuickSell POS Store',
      tax_pin: 'P051000000X',
      header_text: 'Thank you for shopping with us!',
      footer_text: 'Goods once sold are not returnable without a valid receipt.',
      show_tax_breakdown: true,
      show_cashier_name: true,
    };
  }

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Design receipt</h2>
    </div>
    <div style="display:flex; gap:24px; padding:24px; flex-wrap:wrap;">
      <div style="flex:1; min-width:300px;">
        <form id="form-save-receipt">
          <div class="form-group">
            <label>Business Name on Slip</label>
            <input type="text" name="business_name" required value="${template.business_name}" />
          </div>
          <div class="form-group">
            <label>Tax PIN / VAT Registration #</label>
            <input type="text" name="tax_pin" value="${template.tax_pin || ''}" placeholder="e.g. KRA PIN" />
          </div>
          <div class="form-group">
            <label>Header Greeting Note</label>
            <input type="text" name="header_text" value="${template.header_text || ''}" />
          </div>
          <div class="form-group">
            <label>Footer Policy Notice</label>
            <textarea name="footer_text" rows="3">${template.footer_text || ''}</textarea>
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="show_tax_breakdown" ${template.show_tax_breakdown ? 'checked' : ''} />
              Print itemized tax calculations
            </label>
          </div>
          <div class="form-group">
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" name="show_cashier_name" ${template.show_cashier_name ? 'checked' : ''} />
              Display Serving Cashier's Name
            </label>
          </div>
          <button type="submit" class="btn btn-teal-primary btn-block">Save Receipt Layout</button>
        </form>
      </div>

      <div id="receipt-live-preview" style="width:280px; background:#fff; border:1px solid #cbd5e1; border-radius:6px; padding:20px; font-family:monospace; font-size:0.75rem; box-shadow:0 4px 12px rgba(0,0,0,0.05); height:fit-content;">
        <div style="text-align:center; border-bottom:1px dashed #94a3b8; padding-bottom:10px; margin-bottom:10px;">
          <strong id="prev-biz-name" style="font-size:0.95rem; display:block;">${template.business_name}</strong>
          <span id="prev-tax-pin">PIN: ${template.tax_pin || 'P000000000X'}</span><br/>
          <span id="prev-header">${template.header_text || ''}</span>
        </div>
        <div style="margin-bottom:8px;">
          <div>RCPT: #SAMPLE-1001</div>
          <div>DATE: 21/11/2026 10:15</div>
          <div id="prev-cashier" style="${template.show_cashier_name ? '' : 'display:none;'}">CASHIER: Counter 1</div>
        </div>
        <div style="border-top:1px dashed #94a3b8; border-bottom:1px dashed #94a3b8; padding:8px 0; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between;">
            <span>Sample Item 1</span><span>150.00</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span>Sample Item 2 (x2)</span><span>300.00</span>
          </div>
        </div>
        <div style="text-align:right; margin-bottom:12px;">
          <div id="prev-tax-row" style="font-size:0.7rem; color:#64748b; ${template.show_tax_breakdown ? '' : 'display:none;'}">VAT (16%): 62.07</div>
          <div style="font-size:0.9rem; font-weight:bold;">TOTAL: 450.00 ${globalState.preferences.currency || 'KES'}</div>
          <div>CASH TENDERED: 500.00</div>
          <div>CHANGE: 50.00</div>
        </div>
        <div id="prev-footer" style="text-align:center; border-top:1px dashed #94a3b8; padding-top:8px; font-size:0.7rem; color:#64748b;">
          ${template.footer_text || ''}
        </div>
      </div>
    </div>
  `;

  const form = target.querySelector('#form-save-receipt');
  // Live preview updates as user types
  form.addEventListener('input', () => {
    const fd = new FormData(form);
    target.querySelector('#prev-biz-name').textContent = fd.get('business_name') || 'Store Name';
    target.querySelector('#prev-tax-pin').textContent = `PIN: ${fd.get('tax_pin') || 'N/A'}`;
    target.querySelector('#prev-header').textContent = fd.get('header_text') || '';
    target.querySelector('#prev-footer').textContent = fd.get('footer_text') || '';
    target.querySelector('#prev-cashier').style.display = fd.get('show_cashier_name') === 'on' ? 'block' : 'none';
    target.querySelector('#prev-tax-row').style.display = fd.get('show_tax_breakdown') === 'on' ? 'block' : 'none';
  });

  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      shop_id: globalState.activeShopId,
      business_name: fd.get('business_name'),
      tax_pin: fd.get('tax_pin'),
      header_text: fd.get('header_text'),
      footer_text: fd.get('footer_text'),
      show_tax_breakdown: fd.get('show_tax_breakdown') === 'on',
      show_cashier_name: fd.get('show_cashier_name') === 'on',
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('receipt_templates').upsert([payload], { onConflict: 'shop_id' });
    if (error) Toast.error(error.message);
    else Toast.success('Receipt template saved.');
  };
}

// =========================================================================
// 2. PRINT QR CODE IN RECEIPT
// =========================================================================
export async function renderQrReceiptPane(target, settingsRow) {
  const qrCfg = {
    enabled: false,
    qr_type: 'etims_or_url',
    custom_url: '',
    label_text: 'Scan to verify digital receipt',
    qr_size: 120,
    ...(settingsRow?.qr_receipt_config || {}),
  };

  target.innerHTML = `
    <div class="settings-pane-header">
      <h2>Print QR code in receipt</h2>
    </div>
    <div style="display:flex; gap:24px; padding:24px; flex-wrap:wrap;">
      <form id="form-qr-receipt" style="flex:1; min-width:300px; max-width:500px;">
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:10px; cursor:pointer; font-weight:600;">
            <input type="checkbox" name="enabled" ${qrCfg.enabled ? 'checked' : ''} />
            Enable QR Code printing at bottom of thermal receipts
          </label>
        </div>

        <div class="form-group">
          <label>QR Payload Source</label>
          <select name="qr_type">
            <option value="etims_or_url" ${qrCfg.qr_type === 'etims_or_url' ? 'selected' : ''}>KRA eTIMS Verification URL / Receipt Hash</option>
            <option value="receipt_link" ${qrCfg.qr_type === 'receipt_link' ? 'selected' : ''}>Digital Receipt Lookup Link</option>
            <option value="custom_url" ${qrCfg.qr_type === 'custom_url' ? 'selected' : ''}>Custom Store Website / Feedback Form URL</option>
          </select>
        </div>

        <div class="form-group">
          <label>Custom URL (if selected above)</label>
          <input type="text" name="custom_url" value="${qrCfg.custom_url || ''}" placeholder="https://yourstore.co.ke/verify" />
        </div>

        <div class="form-row" style="display:flex; gap:12px;">
          <div class="form-group" style="flex:2;">
            <label>Caption Below QR Code</label>
            <input type="text" name="label_text" value="${qrCfg.label_text || ''}" placeholder="Scan to verify receipt" />
          </div>
          <div class="form-group" style="flex:1;">
            <label>QR Size (px)</label>
            <select name="qr_size">
              <option value="96" ${Number(qrCfg.qr_size) === 96 ? 'selected' : ''}>Small (96px)</option>
              <option value="120" ${Number(qrCfg.qr_size) === 120 ? 'selected' : ''}>Medium (120px)</option>
              <option value="150" ${Number(qrCfg.qr_size) === 150 ? 'selected' : ''}>Large (150px)</option>
            </select>
          </div>
        </div>

        <button type="submit" class="btn btn-teal-primary">Save QR Code Settings</button>
      </form>

      <div style="width:240px; background:#fff; border:1px dashed #94a3b8; border-radius:8px; padding:20px; text-align:center; height:fit-content;">
        <div style="font-size:0.7rem; color:var(--text-muted); margin-bottom:10px; font-family:monospace;">RECEIPT QR PREVIEW</div>
        <div style="width:120px; height:120px; margin:0 auto 10px; border:2px solid #0f172a; display:flex; align-items:center; justify-content:center; background:#f8fafc;">
          <i data-lucide="qr-code" style="width:84px; height:84px; color:#0f172a;"></i>
        </div>
        <div id="qr-prev-caption" style="font-family:monospace; font-size:0.75rem; color:#334155;">${qrCfg.label_text || ''}</div>
      </div>
    </div>
  `;

  target.querySelector('#form-qr-receipt').onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const qr_receipt_config = {
      enabled: fd.get('enabled') === 'on',
      qr_type: fd.get('qr_type'),
      custom_url: fd.get('custom_url'),
      label_text: fd.get('label_text'),
      qr_size: parseInt(fd.get('qr_size')) || 120,
    };

    const { error } = await supabase
      .from('store_settings')
      .upsert([{ shop_id: globalState.activeShopId, qr_receipt_config, updated_at: new Date().toISOString() }], { onConflict: 'shop_id' });

    if (error) Toast.error(error.message);
    else Toast.success('QR receipt settings saved.');
  };
}

// =========================================================================
// 3. PAYMENT TYPES
// =========================================================================
export async function renderPaymentTypesPane(target) {
  target.innerHTML = `
    <div class="settings-pane-header" style="display:flex; justify-content:space-between; align-items:center;">
      <div>
        <h2>Payment types</h2>
        <p style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">Configure Cash, M-PESA Till/Paybill, Card, and Bank channels.</p>
      </div>
      <button class="btn btn-teal-primary btn-sm" id="btn-add-payment-method">
        <i data-lucide="plus"></i> Add Payment Type
      </button>
    </div>
    <div id="settings-payments-table"></div>
  `;

  async function loadPayments() {
    let query = supabase.from('store_payment_methods').select('*').order('created_at');
    query = scoped(query);

    const { data: methods, error } = await query;
    if (error) {
      document.getElementById('settings-payments-table').innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    renderDataTable({
      targetId: 'settings-payments-table',
      columns: [
        { label: 'Channel Name', key: 'display_name', render: (v) => `<strong>${v}</strong>` },
        { label: 'System Key', key: 'method_key', render: (k) => `<code>${k}</code>` },
        { label: 'Till / Account Number', key: 'account_number', render: (acc) => acc || 'N/A' },
        {
          label: 'Status',
          key: 'is_enabled',
          render: (en) => (en ? '<span class="badge badge-teal">ENABLED</span>' : '<span class="badge">DISABLED</span>'),
        },
      ],
      data: methods || [],
      onAction: (action, id) => {
        const item = methods.find((m) => m.id === id);
        if (item) openPaymentMethodModal(item, loadPayments);
      },
    });
  }

  target.querySelector('#btn-add-payment-method').onclick = () => openPaymentMethodModal(null, loadPayments);
  await loadPayments();
}

function openPaymentMethodModal(item, onSaved) {
  const isEdit = !!item;
  Modal.open({
    title: isEdit ? `Edit: ${item.display_name}` : 'Add Payment Type',
    content: `
      <form id="form-paymethod-save">
        <div class="form-group">
          <label>Payment Channel Display Name</label>
          <input type="text" name="display_name" required value="${item?.display_name || ''}" placeholder="e.g. Cash, M-PESA Till, PDQ Card" />
        </div>
        <div class="form-group">
          <label>Internal System Key</label>
          <input type="text" name="method_key" required value="${item?.method_key || ''}" placeholder="e.g. cash, mpesa_till, card" />
        </div>
        <div class="form-group">
          <label>Till / Paybill / Account #</label>
          <input type="text" name="account_number" value="${item?.account_number || ''}" placeholder="e.g. 522522" />
        </div>
        <div class="form-group">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" name="is_enabled" ${item?.is_enabled !== false ? 'checked' : ''} />
            Enable on Cashier Registers
          </label>
        </div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="btn btn-teal-primary" style="flex:1;">${isEdit ? 'Update Channel' : 'Save Channel'}</button>
          ${isEdit ? `<button type="button" id="btn-del-paymethod" class="btn btn-outline text-danger">Delete</button>` : ''}
        </div>
      </form>
    `,
    onSubmit: async (formData) => {
      const payload = {
        shop_id: globalState.activeShopId,
        display_name: formData.display_name,
        method_key: formData.method_key,
        account_number: formData.account_number || null,
        is_enabled: formData.is_enabled === 'on',
      };

      const { error } = isEdit
        ? await supabase.from('store_payment_methods').update(payload).eq('id', item.id)
        : await supabase.from('store_payment_methods').insert([payload]);

      if (error) Toast.error(error.message);
      else {
        Toast.success('Payment method updated.');
        await onSaved();
      }
    },
  });

  if (isEdit) {
    setTimeout(() => {
      const delBtn = document.getElementById('btn-del-paymethod');
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm(`Delete payment type "${item.display_name}"?`)) return;
          const { error } = await supabase.from('store_payment_methods').delete().eq('id', item.id);
          if (error) Toast.error(error.message);
          else {
            Toast.success('Payment method deleted.');
            Modal.close();
            await onSaved();
          }
        };
      }
    }, 50);
  }
}
