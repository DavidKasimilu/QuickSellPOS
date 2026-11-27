// Shift Management.
// Used two ways:
//   1. as its own page          -> mount(container)
//   2. inside Sales > Shifts tab -> renderShiftsPanel(target, opts) + openStartCloseModal(opts)
// Both share the same table, the same View / Close buttons and the same Start / Close modal.
import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { Modal } from '../components/Modal.js';
import { scoped } from '../tenant.js';
import { mountDateRangeFilter } from '../components/DateRangeFilter.js';
import { openReceiptDetail } from '../components/ReceiptViewer.js';

const pad = (n) => String(n).padStart(2, '0');
// LOCAL calendar date (toISOString would shift the day for users ahead of or behind UTC)
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const stamp = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-');
const MANAGER_ROLES = ['admin', 'owner', 'manager'];
const METHOD_LABELS = { cash: 'Cash', mpesa: 'Mobile Money', card: 'Card' };

const isManager = () => MANAGER_ROLES.includes(String(globalState.role || '').toLowerCase());
const currencyCode = () => globalState.activeShop?.currency || globalState.preferences?.currency || 'KES';
const personName = (p) => p?.full_name || p?.email || '';

function formatDuration(start, end) {
  const ms = new Date(end || new Date()) - new Date(start);
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m${end ? '' : ' (running)'}`;
}

// ====================================================================== data
async function fetchShifts({ from, to, status = 'all', cashierId = 'ALL' } = {}) {
  let query = supabase
    .from('shifts')
    .select('*, shops(name), opener:profiles!shifts_staff_id_fkey(full_name, email), closer:profiles!shifts_closed_by_fkey(full_name, email)')
    .order('opened_at', { ascending: false });

  // shifts that overlap the chosen days (a shift that started yesterday and is still open still counts as today)
  if (to) query = query.lte('opened_at', new Date(`${to}T23:59:59.999`).toISOString());
  if (from) query = query.or(`closed_at.is.null,closed_at.gte.${new Date(`${from}T00:00:00`).toISOString()}`);
  if (status !== 'all') query = query.eq('status', status);
  if (cashierId && cashierId !== 'ALL') query = query.eq('staff_id', cashierId);

  // the table follows the store picked in the app (same as the other Sales pages)
  query = scoped(query);

  const { data, error } = await query;
  if (error) return { rows: [], error };

  const rows = data || [];
  // open shifts have no saved totals yet: ask the database for the live figures
  await Promise.all(rows.filter((r) => r.status === 'open').map(async (r) => {
    const { data: live } = await supabase.rpc('shift_payload', { p_shift_id: r.id });
    if (live?.totals) {
      r.orders_count = live.totals.orders_count;
      r.total_sales = live.totals.total_sales;
      r.cash_sales = live.totals.cash_sales;
      r.expected_cash = live.totals.expected_cash;
    }
  }));
  // convenience fields (also used by the CSV / PDF export in Sales Reports)
  rows.forEach((r) => { r.staff = r.opener; r.shop_name = r.shops?.name || ''; });
  return { rows, error: null };
}

// ====================================================================== table (shared)
const panelCtx = new WeakMap();

function bindTable(target, reload) {
  panelCtx.set(target, { reload });
  if (target.dataset.shiftsBound) return;
  target.dataset.shiftsBound = '1';
  // One delegated listener per target: survives every re-render of the table.
  target.addEventListener('click', (e) => {
    const ctx = panelCtx.get(target);
    const viewBtn = e.target.closest('[data-shift-view]');
    if (viewBtn) { openShiftDetail(viewBtn.dataset.shiftView, { onChanged: ctx?.reload }); return; }
    const closeBtn = e.target.closest('[data-shift-close]');
    if (closeBtn) openCloseShift(closeBtn.dataset.shiftClose, { onDone: ctx?.reload });
  });
}

function renderShiftsTable(target, rows) {
  const canClose = isManager();
  const cur = esc(currencyCode());
  renderDataTable({
    targetId: target.id,
    columns: [
      {
        label: 'Actions', key: 'id', sticky: 'left',
        render: (id, row) => `
          <button type="button" class="btn btn-primary btn-sm" data-shift-view="${esc(id)}">View</button>
          ${row.status === 'open' && canClose ? `<button type="button" class="btn btn-outline btn-sm text-danger" data-shift-close="${esc(id)}" style="margin-left:6px;">Close</button>` : ''}`,
      },
      {
        label: 'Staff Member', key: 'opener',
        render: (opener, row) => `<strong>${esc(personName(opener) || 'Staff')}</strong>` +
          (row.closer ? `<div style="font-size:0.75rem; color:var(--text-muted);">closed by ${esc(personName(row.closer))}</div>` : ''),
      },
      { label: 'Store', key: 'shop_name', render: (v) => esc(v || '-') },
      { label: 'Opened At', key: 'opened_at', render: (d) => esc(stamp(d)) },
      { label: 'Closed At', key: 'closed_at', render: (d) => (d ? esc(stamp(d)) : '<span class="badge badge-teal">OPEN</span>') },
      { label: 'Float', key: 'opening_cash', align: 'right', render: (v) => `${money(v)} ${cur}` },
      { label: 'Sales', key: 'total_sales', align: 'right', render: (v) => `<strong>${money(v)} ${cur}</strong>` },
      { label: 'Counted Cash', key: 'actual_cash', align: 'right', render: (v) => (v == null ? '-' : `${money(v)} ${cur}`) },
      {
        label: 'Difference', key: 'cash_variance', align: 'right',
        render: (v) => {
          if (v == null) return '-';
          const n = Number(v);
          return `<span style="color:${n < 0 ? 'var(--color-danger)' : n > 0 ? 'var(--teal-600)' : 'inherit'}; font-weight:600;">${n > 0 ? '+' : ''}${money(n)}</span>`;
        },
      },
    ],
    data: rows,
  });
}

/**
 * Renders the shifts table (with View / Close buttons) into `target`.
 * opts: { from, to, status, cashierId, onRows(rows) }
 * Returns the rows that were loaded.
 */
export async function renderShiftsPanel(target, opts = {}) {
  if (!target) return [];
  if (!target.id) target.id = `shifts-panel-${Date.now()}`;
  const reload = () => renderShiftsPanel(target, opts);
  bindTable(target, reload);

  target.innerHTML = '<p style="padding:24px; color:var(--text-muted);">Loading shifts...</p>';
  const { rows, error } = await fetchShifts(opts);
  if (error) {
    target.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${esc(error.message)}</p>`;
    opts.onRows?.([]);
    return [];
  }
  renderShiftsTable(target, rows);
  opts.onRows?.(rows);
  return rows;
}

// ====================================================================== shift detail
export async function openShiftDetail(id, opts = {}) {
  try {
    await openShiftDetailInner(id, opts);
  } catch (err) {
    console.error('[Shifts] Could not open shift detail:', err);
    Toast.error(err.message || 'Could not load this shift.');
  }
}

async function openShiftDetailInner(id, opts) {
  const { data: s, error } = await supabase.rpc('shift_payload', { p_shift_id: id });
  if (error) throw new Error(error.message);
  if (!s) throw new Error('This shift could not be found.');
  const t = s.totals || {};
  const cur = esc(currencyCode());
  const windowEnd = s.closed_at || new Date().toISOString();

  // Filtered by shift / store id only (not the sidebar's active shop) so a shift from any store opens correctly.
  // Row-level security still limits everything to what this user may see.
  const ordersQ = supabase.from('orders')
    .select('id, receipt_no, total, created_at, order_status, is_deleted, cashier:profiles!orders_cashier_id_fkey(full_name, email)')
    .eq('shift_id', id).order('created_at', { ascending: false }).limit(300);
  const payQ = supabase.from('payments').select('amount, payment_method, orders!inner(shift_id)').eq('orders.shift_id', id);
  const cashQ = supabase.from('cash_transactions')
    .select('cashier_id, amount, action_type, note, created_at')
    .eq('shop_id', s.shop_id).gte('created_at', s.opened_at).lte('created_at', windowEnd);
  const voidQ = supabase.from('deleted_order_items')
    .select('product_name, quantity, unit_price, reason, created_at, removed_by:profiles!deleted_order_items_removed_by_fkey(full_name, email)')
    .eq('shop_id', s.shop_id).gte('created_at', s.opened_at).lte('created_at', windowEnd);
  const shopQ = supabase.from('shops').select('name').eq('id', s.shop_id).maybeSingle();

  // one query failing must not blank out the whole view
  const [ordersRes, payRes, cashRes, voidRes, shopRes] = await Promise.allSettled([ordersQ, payQ, cashQ, voidQ, shopQ]);
  const settled = (res, label) => {
    if (res.status === 'rejected') { console.error(`[Shifts] ${label} query threw:`, res.reason); return []; }
    if (res.value?.error) { console.error(`[Shifts] ${label} query error:`, res.value.error.message); return []; }
    return res.value?.data || [];
  };
  const orders = settled(ordersRes, 'orders');
  const pays = settled(payRes, 'payments');
  const cashMovesRaw = settled(cashRes, 'cash_transactions');
  const voids = settled(voidRes, 'deleted_order_items');
  const shopName = shopRes.status === 'fulfilled' ? shopRes.value?.data?.name : '';

  const byMethod = {};
  pays.forEach((p) => { byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + Number(p.amount || 0); });

  // cash_transactions.cashier_id points at the auth user, so names are resolved separately
  const cashierIds = [...new Set(cashMovesRaw.map((c) => c.cashier_id).filter(Boolean))];
  let cashierNames = {};
  if (cashierIds.length) {
    const { data: names, error: namesErr } = await supabase.from('profiles').select('id, full_name, email').in('id', cashierIds);
    if (namesErr) console.error('[Shifts] profile name lookup error:', namesErr.message);
    cashierNames = Object.fromEntries((names || []).map((n) => [n.id, n]));
  }

  // cash movements and removed items (sales are listed separately as receipts)
  const events = [
    ...cashMovesRaw.map((c) => ({
      at: c.created_at, kind: c.action_type === 'in' ? 'cash-in' : 'cash-out',
      text: `Cash ${c.action_type === 'in' ? 'added' : 'removed'} by ${esc(personName(cashierNames[c.cashier_id]) || 'Unknown')}${c.note ? ` - ${esc(c.note)}` : ''}`,
      amount: c.action_type === 'in' ? Number(c.amount) : -Number(c.amount),
    })),
    ...voids.map((v) => ({
      at: v.created_at, kind: 'voided-item',
      text: `Removed ${esc(v.quantity)} x ${esc(v.product_name)} by ${esc(personName(v.removed_by) || 'Unknown')}${v.reason ? ` - ${esc(v.reason)}` : ''}`,
      amount: null,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));

  const eventColor = (k) => (k === 'cash-in' ? 'var(--teal-600)' : 'var(--color-danger)');
  const row = (l, v, strong) => `<div style="display:flex; justify-content:space-between; gap:12px; padding:6px 0; border-bottom:1px solid var(--border-subtle); font-size:0.9rem;"><span style="color:var(--text-muted);">${l}</span><span style="${strong ? 'font-weight:700;' : ''} text-align:right;">${v}</span></div>`;
  const canClose = s.status === 'open' && isManager();

  Modal.open({
    title: `Shift: ${esc(shopName || 'Store')} - ${esc(stamp(s.opened_at))}`,
    content: `
      <div style="background:var(--bg-surface); border-radius:8px; padding:12px 14px; margin-bottom:14px;">
        ${row('Status', s.status === 'open' ? '<span class="badge badge-teal">OPEN</span>' : '<span class="badge">CLOSED</span>')}
        ${row('Store', esc(shopName || '-'))}
        ${row('Opened by', esc(s.opened_by_name || '-'))}
        ${row('Opened at', esc(stamp(s.opened_at)))}
        ${row('Closed by', esc(s.closed_by_name || (s.status === 'open' ? 'Still open' : '-')))}
        ${row('Closed at', esc(stamp(s.closed_at)))}
        ${row('Device', esc(String(s.opened_device || '-').slice(0, 60)))}
        ${row('Duration', esc(formatDuration(s.opened_at, s.closed_at)))}
        <div style="height:6px;"></div>
        ${row('Opening cash (float)', `${money(s.opening_cash)} ${cur}`)}
        ${row('Orders', esc(t.orders_count ?? 0))}
        ${row('Total sales', `${money(t.total_sales)} ${cur}`, true)}
        ${Object.keys(byMethod).map((m) => row(`Paid by ${esc(METHOD_LABELS[m] || m)}`, `${money(byMethod[m])} ${cur}`)).join('')}
        ${row('On credit (unpaid)', `${money(t.credit_sales)} ${cur}`)}
        ${row('Cash in / out', `${money(t.cash_in)} / ${money(t.cash_out)}`)}
        ${row('Expected cash', `${money(s.expected_cash ?? t.expected_cash)} ${cur}`, true)}
        ${s.actual_cash != null ? row('Counted cash', `${money(s.actual_cash)} ${cur}`) : ''}
        ${s.cash_variance != null ? row('Difference', `${Number(s.cash_variance) > 0 ? '+' : ''}${money(s.cash_variance)} ${cur}`, true) : ''}
        ${s.open_notes ? row('Opening note', esc(s.open_notes)) : ''}
        ${s.close_notes ? row('Closing note', esc(s.close_notes)) : ''}
      </div>

      ${canClose ? `<button type="button" id="sd-close-shift" class="btn btn-outline text-danger" style="width:100%; margin-bottom:14px;">Close this shift</button>` : ''}

      <h4 style="margin:0 0 8px; font-size:0.9rem;">Receipts in this shift (${orders.length})</h4>
      <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px; margin-bottom:14px;">
        ${orders.length ? orders.map((o) => `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:8px 10px; border-bottom:1px solid var(--border-subtle); font-size:0.85rem;">
            <div style="min-width:0;">
              <div><code>${esc(o.receipt_no)}</code>${o.is_deleted ? ' <span class="badge text-danger">VOIDED</span>' : ''}</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">${esc(new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} - ${esc(personName(o.cashier) || 'Unknown')}</div>
            </div>
            <div style="display:flex; align-items:center; gap:10px;">
              <strong style="white-space:nowrap; ${o.is_deleted ? 'text-decoration:line-through; color:var(--text-muted);' : ''}">${money(o.total)} ${cur}</strong>
              <button type="button" class="btn btn-primary btn-sm sd-receipt-view" data-receipt-id="${esc(o.id)}">View</button>
            </div>
          </div>`).join('') : '<p style="padding:14px; color:var(--text-muted); margin:0;">No receipts in this shift.</p>'}
      </div>
      ${orders.length >= 300 ? '<p style="font-size:0.75rem; color:var(--text-muted); margin:-8px 0 14px;">Showing the latest 300 receipts.</p>' : ''}

      <h4 style="margin:0 0 8px; font-size:0.9rem;">Cash movements &amp; removed items (${events.length})</h4>
      <div style="max-height:200px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px;">
        ${events.length ? events.map((a) => `
          <div style="display:flex; justify-content:space-between; gap:10px; padding:8px 10px; border-bottom:1px solid var(--border-subtle); font-size:0.82rem;">
            <div>
              <div>${a.text}</div>
              <div style="font-size:0.72rem; color:var(--text-muted);">${esc(new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div>
            </div>
            ${a.amount != null ? `<div style="white-space:nowrap; font-weight:700; color:${eventColor(a.kind)};">${a.amount < 0 ? '-' : ''}${money(Math.abs(a.amount))}</div>` : ''}
          </div>`).join('') : '<p style="padding:14px; color:var(--text-muted); margin:0;">None recorded.</p>'}
      </div>`,
  });

  // receipt rows open the shared receipt viewer (PDF, print, email) with a way back to this shift
  document.querySelectorAll('.sd-receipt-view').forEach((btn) => {
    btn.onclick = () => openReceiptFromShift(btn.dataset.receiptId, id, opts);
  });
  const closeBtn = document.getElementById('sd-close-shift');
  if (closeBtn) closeBtn.onclick = () => openCloseShift(id, { onDone: opts.onChanged });
}

// The receipt viewer replaces the open modal, so add a "Back to shift" button on top of it.
async function openReceiptFromShift(orderId, shiftId, opts) {
  await openReceiptDetail(orderId);
  const anchor = document.getElementById('btn-single-pdf');
  const root = anchor?.parentElement?.parentElement;
  if (!root) return;
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'btn btn-outline btn-sm';
  back.style.marginBottom = '10px';
  back.textContent = '\u2190 Back to shift';
  back.onclick = () => openShiftDetail(shiftId, opts);
  root.insertBefore(back, root.firstChild);
}

// ====================================================================== close (manager / admin)
// Works for any shift id (from the table, the detail view or the Start/Close list); the expected
// cash is always fetched fresh.
export async function openCloseShift(id, opts = {}) {
  const { data: live, error } = await supabase.rpc('shift_payload', { p_shift_id: id });
  if (error || !live) { Toast.error(error?.message || 'This shift could not be found.'); return; }
  if (live.status && live.status !== 'open') { Toast.error('This shift is already closed.'); opts.onDone?.(); return; }

  let shopName = '';
  if (live.shop_id) {
    const { data: shop } = await supabase.from('shops').select('name').eq('id', live.shop_id).maybeSingle();
    shopName = shop?.name || '';
  }
  const expected = live.expected_cash ?? live.totals?.expected_cash;
  const cur = esc(currencyCode());

  Modal.open({
    title: `Close shift${shopName ? `: ${esc(shopName)}` : ''}`,
    content: `
      <form>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">
          Opened by <strong>${esc(live.opened_by_name || '-')}</strong> on ${esc(stamp(live.opened_at))}.<br>
          Expected cash in the drawer: <strong>${money(expected)} ${cur}</strong>.
          Make sure every terminal has synced its sales before closing.
        </p>
        <div class="form-group"><label>Cash counted (${cur})</label>
          <input type="number" name="counted" min="0" step="0.01" required /></div>
        <div class="form-group"><label>Note (optional)</label>
          <input type="text" name="notes" maxlength="200" /></div>
        <button type="submit" class="btn btn-primary" style="width:100%;">Close shift</button>
      </form>`,
    onSubmit: async (fd) => {
      const counted = parseFloat(fd.counted);
      if (Number.isNaN(counted) || counted < 0) { Toast.error('Enter the counted cash.'); return false; }
      const { error: closeErr } = await supabase.rpc('close_shift', { p_shift_id: id, p_actual_cash: counted, p_notes: fd.notes || null });
      if (closeErr) { Toast.error(closeErr.message); return false; }
      Toast.success('Shift closed.');
      opts.onDone?.();
    },
  });
}

// ====================================================================== Start / Close modal
// Step 1: choose Start or Close.
//   Start -> list of the admin's stores (stores that already have an open shift are disabled).
//   Close -> list of every open shift with its store name.
// Both lists are deliberately org-wide (not limited to the active store); RLS limits them to the
// stores this user can reach.
export function openStartCloseModal(opts = {}) {
  Modal.open({
    title: 'Start / Close Shift',
    content: '<div id="sc-body"></div>',
  });
  const body = () => document.getElementById('sc-body');
  const cardStyle = 'display:block; width:100%; text-align:left; padding:14px 16px; cursor:pointer; border:1px solid var(--border-subtle); background:var(--bg-card); font-family:inherit; border-radius:8px;';
  const backBtn = '<button type="button" id="sc-back" class="btn btn-outline btn-sm" style="margin-bottom:12px;">\u2190 Back</button>';

  function showChoice() {
    body().innerHTML = `
      <p style="color:var(--text-muted); font-size:0.85rem; margin:0 0 12px;">What would you like to do?</p>
      <div style="display:flex; flex-direction:column; gap:10px;">
        <button type="button" id="sc-choose-start" class="chart-box" style="${cardStyle}">
          <div style="font-weight:700;">Start a shift</div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Pick a store and enter the opening cash</div>
        </button>
        <button type="button" id="sc-choose-close" class="chart-box" style="${cardStyle}">
          <div style="font-weight:700;">Close a shift</div>
          <div style="font-size:0.8rem; color:var(--text-muted);">Choose from the shifts that are currently open</div>
        </button>
      </div>`;
    body().querySelector('#sc-choose-start').onclick = showStart;
    body().querySelector('#sc-choose-close').onclick = showClose;
  }

  async function showStart() {
    body().innerHTML = `${backBtn}<p style="color:var(--text-muted); font-size:0.85rem;">Loading your stores...</p>`;
    body().querySelector('#sc-back').onclick = showChoice;

    const [{ data: shops, error: shopsErr }, { data: openShifts, error: openErr }] = await Promise.all([
      supabase.from('shops').select('id, name').order('name'),
      supabase.from('shifts').select('shop_id').eq('status', 'open'),
    ]);
    if (!body()) return;
    if (shopsErr || openErr) {
      body().innerHTML = `${backBtn}<p style="color:var(--color-danger);">${esc(shopsErr?.message || openErr?.message)}</p>`;
      body().querySelector('#sc-back').onclick = showChoice;
      return;
    }
    if (!shops || !shops.length) {
      body().innerHTML = `${backBtn}<p style="color:var(--text-muted);">No stores found for your account.</p>`;
      body().querySelector('#sc-back').onclick = showChoice;
      return;
    }
    const openShopIds = new Set((openShifts || []).map((s) => s.shop_id));
    const firstFree = shops.find((s) => !openShopIds.has(s.id));

    body().innerHTML = `
      ${backBtn}
      <div class="form-group"><label>Choose a store</label>
        <div style="display:flex; flex-direction:column; gap:8px; max-height:220px; overflow-y:auto;">
          ${shops.map((s) => {
            const busy = openShopIds.has(s.id);
            return `
            <label style="display:flex; align-items:center; gap:10px; padding:10px 12px; border:1px solid var(--border-subtle); border-radius:8px; ${busy ? 'opacity:0.55; cursor:not-allowed;' : 'cursor:pointer;'}">
              <input type="radio" name="sc-shop" value="${esc(s.id)}" ${busy ? 'disabled' : ''} ${firstFree && firstFree.id === s.id ? 'checked' : ''} />
              <span style="font-weight:600;">${esc(s.name)}</span>
              ${busy ? '<span class="badge" style="margin-left:auto;">Shift already open</span>' : ''}
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="form-group"><label>Opening cash</label>
        <input type="number" id="sc-start-cash" min="0" step="0.01" value="0" /></div>
      <div class="form-group"><label>Note (optional)</label>
        <input type="text" id="sc-start-notes" maxlength="200" /></div>
      ${!firstFree ? '<p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:10px;">Every store already has an open shift.</p>' : ''}
      <button type="button" id="sc-start-btn" class="btn btn-primary" style="width:100%;" ${!firstFree ? 'disabled' : ''}>Start shift</button>`;

    body().querySelector('#sc-back').onclick = showChoice;
    body().querySelector('#sc-start-btn').onclick = async () => {
      const btn = body().querySelector('#sc-start-btn');
      const picked = body().querySelector('input[name="sc-shop"]:checked');
      const cash = parseFloat(body().querySelector('#sc-start-cash').value);
      if (!picked) { Toast.error('Choose a store.'); return; }
      if (Number.isNaN(cash) || cash < 0) { Toast.error('Enter the opening cash (0 or more).'); return; }
      btn.disabled = true; btn.textContent = 'Starting...';
      const { data, error } = await supabase.rpc('open_shift', {
        p_shop_id: picked.value, p_opening_cash: cash,
        p_notes: body().querySelector('#sc-start-notes').value.trim() || null,
        p_device: 'Back office',
      });
      if (error) { Toast.error(error.message); btn.disabled = false; btn.textContent = 'Start shift'; return; }
      Toast.success(data?.created === false ? 'A shift was already running for that store - joined it.' : 'Shift started.');
      Modal.close();
      opts.onDone?.();
    };
  }

  async function showClose() {
    body().innerHTML = `${backBtn}<p style="color:var(--text-muted); font-size:0.85rem;">Loading open shifts...</p>`;
    body().querySelector('#sc-back').onclick = showChoice;

    const { data: open, error } = await supabase
      .from('shifts')
      .select('id, shop_id, staff_id, opened_at, opening_cash, shops(name), opener:profiles!shifts_staff_id_fkey(full_name, email)')
      .eq('status', 'open')
      .order('opened_at', { ascending: false });
    if (!body()) return;
    if (error) {
      body().innerHTML = `${backBtn}<p style="color:var(--color-danger);">${esc(error.message)}</p>`;
      body().querySelector('#sc-back').onclick = showChoice;
      return;
    }
    if (!isManager()) {
      body().innerHTML = `${backBtn}<p style="color:var(--text-muted);">Only an admin, owner or manager can close a shift.</p>`;
      body().querySelector('#sc-back').onclick = showChoice;
      return;
    }
    if (!open || !open.length) {
      body().innerHTML = `${backBtn}<p style="color:var(--text-muted);">No shifts are currently open.</p>`;
      body().querySelector('#sc-back').onclick = showChoice;
      return;
    }

    body().innerHTML = `
      ${backBtn}
      <p style="color:var(--text-muted); font-size:0.85rem; margin:0 0 10px;">Select the shift to close:</p>
      <div style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto;">
        ${open.map((s) => `
          <button type="button" class="chart-box" data-close-shift="${esc(s.id)}" style="${cardStyle}">
            <div style="font-weight:700;">${esc(s.shops?.name || 'Unknown store')}</div>
            <div style="font-size:0.78rem; color:var(--text-muted);">
              Opened ${esc(stamp(s.opened_at))} by ${esc(personName(s.opener) || '-')} - float ${money(s.opening_cash)}
            </div>
          </button>`).join('')}
      </div>`;
    body().querySelector('#sc-back').onclick = showChoice;
    body().querySelectorAll('[data-close-shift]').forEach((btn) => {
      btn.onclick = () => openCloseShift(btn.dataset.closeShift, { onDone: opts.onDone });
    });
  }

  showChoice();
}

// ====================================================================== standalone page
export async function mount(container) {
  const today = new Date();
  let range = { from: ymd(today), to: ymd(today) };   // default: today only
  let status = 'all';
  let rows = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Shift Management</h3>
        <span class="badge badge-teal" id="shift-count-badge">0 shifts</span>
        <span style="font-size:0.8rem; color:var(--text-muted);">Showing: <strong id="shift-range-label">Today</strong></span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-teal-primary" id="btn-start-close-shift">Start / Close Shift</button>
        <button class="btn btn-outline" id="btn-shifts-export">Export CSV</button>
        <button class="btn btn-outline" id="btn-shifts-refresh">Refresh</button>
      </div>
    </div>

    <div class="chart-box" style="padding:14px; margin-bottom:14px;">
      <div style="display:flex; gap:16px; flex-wrap:wrap; align-items:flex-end;">
        <div><label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">Period</label>
          <div id="shift-daterange"></div></div>
        <div><label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">Status</label>
          <select id="shift-status"><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select></div>
      </div>
    </div>

    <div id="shift-summary" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:14px;"></div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="shifts-table-content"></div>
    </div>
  `;

  const tableArea = container.querySelector('#shifts-table-content');

  function renderSummary() {
    const closed = rows.filter((r) => r.status === 'closed');
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const variance = closed.reduce((a, r) => a + (Number(r.cash_variance) || 0), 0);
    const cur = esc(currencyCode());
    const card = (label, value, color) => `
      <div class="chart-box" style="padding:14px;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">${label}</div>
        <div style="font-size:1.25rem; font-weight:700; ${color ? `color:${color};` : ''}">${value}</div>
      </div>`;
    const el = container.querySelector('#shift-summary');
    if (!el) return;
    el.innerHTML =
      card('Shifts', rows.length) +
      card('Orders', sum('orders_count')) +
      card('Total sales', `${money(sum('total_sales'))} ${cur}`) +
      card('Cash sales', `${money(sum('cash_sales'))} ${cur}`) +
      card('Cash difference (closed)', `${variance > 0 ? '+' : ''}${money(variance)} ${cur}`, variance < 0 ? 'var(--color-danger)' : variance > 0 ? 'var(--teal-600)' : '');
  }

  async function load() {
    await renderShiftsPanel(tableArea, {
      from: range.from, to: range.to, status,
      onRows: (r) => {
        rows = r;
        const badge = container.querySelector('#shift-count-badge');
        if (badge) badge.textContent = `${r.length} shift${r.length === 1 ? '' : 's'}`;
        renderSummary();
      },
    });
  }

  function exportCsv() {
    if (!rows.length) return Toast.error('Nothing to export.');
    const head = ['Store', 'Opened', 'Closed', 'Opened by', 'Closed by', 'Status', 'Opening cash', 'Orders', 'Total sales', 'Cash sales', 'Expected cash', 'Counted cash', 'Difference'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [
      r.shop_name, r.opened_at, r.closed_at || '', personName(r.opener), personName(r.closer),
      r.status, r.opening_cash, r.orders_count, r.total_sales, r.cash_sales, r.expected_cash ?? '', r.actual_cash ?? '', r.cash_variance ?? '',
    ].map(q).join(','));
    const blob = new Blob([[head.map(q).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shifts_${range.from}_to_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  mountDateRangeFilter(container.querySelector('#shift-daterange'), {
    initial: { start: range.from, end: range.to },
    onChange: (r) => {
      range = { from: r.start, to: r.end };
      const lbl = container.querySelector('#shift-range-label');
      if (lbl) lbl.textContent = r.label;
      load();
    },
  });
  container.querySelector('#shift-status').onchange = (e) => { status = e.target.value; load(); };
  container.querySelector('#btn-shifts-refresh').onclick = () => load();
  container.querySelector('#btn-shifts-export').onclick = exportCsv;
  container.querySelector('#btn-start-close-shift').onclick = () => openStartCloseModal({ onDone: load });

  await load();
  return () => {};
}
