// Shared "view a single receipt" modal: full detail, items, payment breakdown, export to PDF,
// print (WebUSB / Bluetooth / fallback slip preview), and email the receipt to a customer.
// Used by Sales Management (salesReports.js) and Shift Management (shifts.js) so there is one
// place that implements print/PDF/email, instead of two copies that can drift apart.
import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { scoped } from '../tenant.js';
import { Modal } from './Modal.js';
import { Toast } from './Toast.js';
import { Exporter } from './Exporter.js';
import { PrinterDriver } from './PrinterDriver.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n) || 0).toLocaleString();
const METHOD_LABELS = { cash: 'Cash', mpesa: 'Mobile Money', card: 'Card' };

/**
 * Opens the receipt detail modal for one order.
 * @param {string} orderId - the order's id. Always re-fetched fresh (never trust data passed in from
 *   a list that may be stale), and row-level security limits this to the caller's own shop(s).
 */
export async function openReceiptDetail(orderId) {
  const currency = globalState.activeShop?.currency || globalState.preferences?.currency || 'KES';

  let orderQ = supabase.from('orders').select('*, customers(name, phone, email)').eq('id', orderId);
  orderQ = scoped(orderQ);
  const { data: order, error: orderErr } = await orderQ.maybeSingle();
  if (orderErr || !order) {
    Toast.error(orderErr?.message || 'This receipt could not be found.');
    return;
  }

  const { data: items } = await supabase.from('order_items').select('*').eq('order_id', orderId);
  const { data: payments } = await supabase.from('payments').select('*').eq('order_id', orderId);

  const itemsRows = (items || []).map((i) => `
      <tr>
        <td style="padding:6px 0;">${esc(i.product_name)}</td>
        <td style="text-align:right;">${esc(i.quantity)} x ${money(i.unit_price)}</td>
        <td style="text-align:right; font-weight:600;">${money(i.total)} ${esc(currency)}</td>
      </tr>`).join('');

  const totalPaid = (payments || []).reduce((a, p) => a + Number(p.amount || 0), 0);
  const paymentsRows = (payments || []).map((p) => `
      <tr>
        <td style="padding:2px 0; color:var(--text-muted);">${esc(METHOD_LABELS[p.payment_method] || p.payment_method)}${p.reference_code ? ` (${esc(p.reference_code)})` : ''}</td>
        <td style="text-align:right;">${money(p.amount)} ${esc(currency)}</td>
      </tr>`).join('');
  const balanceDue = Number(order.total || 0) - totalPaid;

  Modal.open({
    title: `Receipt Details: ${esc(order.receipt_no)}`,
    content: `
      <div>
        <div style="font-size:0.875rem; border-bottom:1px solid var(--border-subtle); padding-bottom:10px; margin-bottom:10px;">
          <p><strong>Date:</strong> ${esc(new Date(order.created_at).toLocaleString())}</p>
          <p><strong>Channel:</strong> ${esc((order.service_type || 'walk_in').toUpperCase())}</p>
          <p><strong>Status:</strong> ${esc((order.order_status || '').toUpperCase())}${order.is_deleted ? ' <span class="badge text-danger">VOIDED</span>' : ''}</p>
          ${order.customers?.name ? `<p><strong>Customer:</strong> ${esc(order.customers.name)}${order.customers.phone ? ` (${esc(order.customers.phone)})` : ''}</p>` : ''}
          <p><strong>Subtotal:</strong> ${money(order.subtotal)} ${esc(currency)}</p>
          ${Number(order.discount_amount) ? `<p><strong>Discount:</strong> -${money(order.discount_amount)} ${esc(currency)}</p>` : ''}
          ${Number(order.tax_amount) ? `<p><strong>Tax:</strong> ${money(order.tax_amount)} ${esc(currency)}</p>` : ''}
          <p style="font-size:1.05rem; font-weight:700; margin-top:6px;"><strong>Grand Total:</strong> ${money(order.total)} ${esc(currency)}</p>
        </div>

        <table style="width:100%; border-collapse:collapse; font-size:0.85rem; margin-bottom:12px;">
          <tbody>${itemsRows || '<tr><td style="padding:8px 0; color:var(--text-muted);">No items recorded.</td></tr>'}</tbody>
        </table>

        ${paymentsRows ? `
        <div style="margin-bottom:16px;">
          <h4 style="font-size:0.8rem; color:var(--text-muted); margin:0 0 6px;">PAYMENTS</h4>
          <table style="width:100%; font-size:0.85rem;"><tbody>${paymentsRows}</tbody></table>
          ${balanceDue > 0.009 ? `<p style="color:var(--color-danger); font-size:0.82rem; margin-top:4px;">Balance due: ${money(balanceDue)} ${esc(currency)}</p>` : ''}
        </div>` : ''}

        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">
          <button id="btn-single-pdf" class="btn btn-outline" style="flex:1; min-width:120px;">Export PDF</button>
          <button id="btn-print-usb" class="btn btn-outline" style="flex:1; min-width:120px;">WebUSB Print</button>
          <button id="btn-print-bt" class="btn btn-outline" style="flex:1; min-width:120px;">Bluetooth Print</button>
          <button id="btn-print-fallback" class="btn btn-teal-primary" style="flex:1; min-width:120px;">Slip Preview</button>
        </div>

        <div style="border-top:1px solid var(--border-subtle); padding-top:12px;">
          <h4 style="font-size:0.8rem; color:var(--text-muted); margin:0 0 6px;">EMAIL THIS RECEIPT</h4>
          <div style="display:flex; gap:8px;">
            <input type="email" id="receipt-email-input" placeholder="customer@example.com" value="${esc(order.customers?.email || '')}" style="flex:1;" />
            <button id="btn-email-receipt" class="btn btn-teal-primary">Send</button>
          </div>
        </div>
      </div>
    `,
  });

  const slipPayload = {
    shopName: globalState.activeShop?.name || 'QuickSell POS',
    receiptNo: order.receipt_no,
    items: (items || []).map((i) => ({ name: i.product_name, quantity: i.quantity, price: Number(i.unit_price) })),
    subtotal: Number(order.subtotal || 0),
    discount: Number(order.discount_amount || 0),
    tax: Number(order.tax_amount || 0),
    total: Number(order.total || 0),
    currency,
  };

  document.getElementById('btn-single-pdf').onclick = () => {
    const pdfCols = [
      { label: 'Item Name', key: 'product_name' },
      { label: 'Quantity', key: 'quantity' },
      { label: 'Unit Price', key: 'unit_price' },
      { label: 'Total', key: 'total' },
    ];
    Exporter.exportToPDF(`Receipt ${order.receipt_no}`, items || [], pdfCols, {
      'Receipt No': order.receipt_no,
      'Total Amount': `${money(order.total)} ${currency}`,
    });
  };

  document.getElementById('btn-print-usb').onclick = () => PrinterDriver.printViaUSB(slipPayload);
  document.getElementById('btn-print-bt').onclick = () => PrinterDriver.printViaBluetooth(slipPayload);
  document.getElementById('btn-print-fallback').onclick = () => PrinterDriver.printFallbackSlip(slipPayload);

  document.getElementById('btn-email-receipt').onclick = async () => {
    const btn = document.getElementById('btn-email-receipt');
    const email = document.getElementById('receipt-email-input').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Toast.error('Enter a valid email address.');
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const { data, error } = await supabase.functions.invoke('send-receipt', { body: { order_id: orderId, email } });
      if (error || data?.error) throw new Error(data?.error || error.message);
      Toast.success(`Receipt sent to ${email}.`);
    } catch (err) {
      Toast.error(err.message || 'The email could not be sent.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send';
    }
  };
}
