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

export async function mount(container) {
  const today = new Date();
  let range = { from: ymd(today), to: ymd(today) };   // default: today only
  let status = 'all';
  let rows = [];
  let dateRangeEnd;

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

  // ------------------------------------------------------------------ date controls
  mountDateRangeFilter(container.querySelector('#shift-daterange'), {
    initial: { start: range.from, end: range.to },
    onChange: (r) => {
      range = { from: r.start, to: r.end };
      const lbl = document.getElementById('shift-range-label');
      if (lbl) lbl.textContent = r.label;
      load();
    },
  });
  document.getElementById('shift-status').onchange = (e) => { status = e.target.value; load(); };
  document.getElementById('btn-shifts-refresh').onclick = () => load();
  document.getElementById('btn-shifts-export').onclick = exportCsv;
  document.getElementById('btn-start-close-shift').onclick = openStartCloseModal;

  // ------------------------------------------------------------------ data
  async function load() {
    const area = document.getElementById('shifts-table-content');
    if (!area) return;
    area.innerHTML = '<p style="padding:24px; color:var(--text-muted);">Loading shifts...</p>';

    const fromIso = new Date(`${range.from}T00:00:00`).toISOString();
    const toIso = new Date(`${range.to}T23:59:59.999`).toISOString();

    // shifts that overlap the chosen days (a shift that started yesterday and is still open still counts as today)
    let query = supabase
      .from('shifts')
      .select('*, opener:profiles!shifts_staff_id_fkey(full_name, email), closer:profiles!shifts_closed_by_fkey(full_name, email)')
      .lte('opened_at', toIso)
      .or(`closed_at.is.null,closed_at.gte.${fromIso}`)
      .order('opened_at', { ascending: false });
    query = scoped(query);
    if (status !== 'all') query = query.eq('status', status);

    const { data, error } = await query;
    if (error) {
      area.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${esc(error.message)}</p>`;
      return;
    }
    rows = data || [];

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

    document.getElementById('shift-count-badge').textContent = `${rows.length} shift${rows.length === 1 ? '' : 's'}`;
    renderSummary();
    renderTable();
  }

  function renderSummary() {
    const closed = rows.filter((r) => r.status === 'closed');
    const sum = (k) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
    const variance = closed.reduce((a, r) => a + (Number(r.cash_variance) || 0), 0);
    const cur = esc(globalState.activeShop?.currency || globalState.preferences?.currency || 'KES');
    const card = (label, value, color) => `
      <div class="chart-box" style="padding:14px;">
        <div style="font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">${label}</div>
        <div style="font-size:1.25rem; font-weight:700; ${color ? `color:${color};` : ''}">${value}</div>
      </div>`;
    document.getElementById('shift-summary').innerHTML =
      card('Shifts', rows.length) +
      card('Orders', sum('orders_count')) +
      card('Total sales', `${money(sum('total_sales'))} ${cur}`) +
      card('Cash sales', `${money(sum('cash_sales'))} ${cur}`) +
      card('Cash difference (closed)', `${variance > 0 ? '+' : ''}${money(variance)} ${cur}`, variance < 0 ? 'var(--color-danger)' : variance > 0 ? 'var(--teal-600)' : '');
  }

  function renderTable() {
    const canClose = MANAGER_ROLES.includes(globalState.role);
    renderDataTable({
      targetId: 'shifts-table-content',
      columns: [
        {
          label: 'Actions', key: 'id', sticky: 'left',
          render: (id, row) => `
            <button class="btn btn-primary btn-sm" data-shift-view="${id}">View</button>
            ${row.status === 'open' && canClose ? `<button class="btn btn-outline btn-sm text-danger" data-shift-close="${id}" style="margin-left:6px;">Close</button>` : ''}`,
        },
        { label: 'Status', key: 'status', render: (s) => (s === 'open' ? '<span class="badge badge-teal">OPEN</span>' : '<span class="badge">CLOSED</span>') },
        { label: 'Opened', key: 'opened_at', render: (d) => esc(stamp(d)) },
        {
          label: 'Closed', key: 'closed_at',
          render: (d, row) => (d ? esc(stamp(d)) : `<span class="badge badge-teal">Running</span>`),
        },
        {
          label: 'Staff', key: 'opener',
          render: (opener, row) => `${esc(opener?.full_name || opener?.email || '-')}` +
            (row.closer ? `<div style="font-size:0.75rem; color:var(--text-muted);">closed by ${esc(row.closer?.full_name || row.closer?.email || '-')}</div>` : ''),
        },
        { label: 'Orders', key: 'orders_count', align: 'right', render: (v) => esc(v ?? 0) },
        { label: 'Total sales', key: 'total_sales', align: 'right', render: (v) => `<strong>${money(v)}</strong>` },
        {
          label: 'Cash (open./exp./count./diff.)', key: 'opening_cash', align: 'right',
          render: (openingCash, row) => {
            const parts = [money(openingCash)];
            parts.push(row.expected_cash == null ? '-' : money(row.expected_cash));
            parts.push(row.actual_cash == null ? '-' : money(row.actual_cash));
            if (row.cash_variance != null) {
              const n = Number(row.cash_variance);
              parts.push(`<span style="color:${n < 0 ? 'var(--color-danger)' : n > 0 ? 'var(--teal-600)' : 'inherit'}; font-weight:600;">${n > 0 ? '+' : ''}${money(n)}</span>`);
            } else {
              parts.push('-');
            }
            return parts.join(' / ');
          },
        },
      ],
      data: rows,
    });
  }

  // One delegated listener for the whole table area: survives every re-render, and there is
  // exactly one copy of it no matter how many times load()/renderTable() runs.
  const tableArea = document.getElementById('shifts-table-content');
  if (tableArea) {
    tableArea.addEventListener('click', (e) => {
      const viewBtn = e.target.closest('[data-shift-view]');
      if (viewBtn) { openDetail(viewBtn.dataset.shiftView); return; }
      const closeBtn = e.target.closest('[data-shift-close]');
      if (closeBtn) openClose(closeBtn.dataset.shiftClose);
    });
  } else {
    console.error('[Shifts] #shifts-table-content was not found - View/Close buttons will not respond.');
  }

  // ------------------------------------------------------------------ detail
  async function openDetail(id) {
    try {
      await openDetailInner(id);
    } catch (err) {
      console.error('[Shifts] Could not open shift detail:', err);
      Toast.error(err.message || 'Could not load this shift.');
    }
  }

  async function openDetailInner(id) {
    const { data: s, error } = await supabase.rpc('shift_payload', { p_shift_id: id });
    if (error) throw new Error(error.message);
    if (!s) throw new Error('This shift could not be found.');
    const t = s.totals || {};
    const cur = esc(globalState.activeShop?.currency || globalState.preferences?.currency || 'KES');

    const windowEnd = s.closed_at || new Date().toISOString();

    let ordersQ = supabase.from('orders')
      .select('id, receipt_no, total, created_at, order_status, is_deleted, cashier:profiles!orders_cashier_id_fkey(full_name, email)')
      .eq('shift_id', id).order('created_at', { ascending: false }).limit(300);
    ordersQ = scoped(ordersQ);

    let payQ = supabase.from('payments').select('amount, payment_method, orders!inner(shift_id)').eq('orders.shift_id', id);
    payQ = scoped(payQ);

    let cashQ = supabase.from('cash_transactions')
      .select('cashier_id, amount, action_type, note, created_at')
      .eq('shop_id', s.shop_id).gte('created_at', s.opened_at).lte('created_at', windowEnd);
    cashQ = scoped(cashQ);

    let voidQ = supabase.from('deleted_order_items')
      .select('product_name, quantity, unit_price, reason, created_at, removed_by:profiles!deleted_order_items_removed_by_fkey(full_name, email)')
      .eq('shop_id', s.shop_id).gte('created_at', s.opened_at).lte('created_at', windowEnd);
    voidQ = scoped(voidQ);

    // one query failing (e.g. an unexpected relationship name on an older database) must not blank
    // out the whole activity feed - run them independently and log whichever one failed
    const [ordersRes, payRes, cashRes, voidRes] = await Promise.allSettled([ordersQ, payQ, cashQ, voidQ]);
    const settled = (res, label) => {
      if (res.status === 'rejected') { console.error(`[Shifts] ${label} query threw:`, res.reason); return []; }
      if (res.value?.error) { console.error(`[Shifts] ${label} query error:`, res.value.error.message); return []; }
      return res.value?.data || [];
    };
    const orders = settled(ordersRes, 'orders');
    const pays = settled(payRes, 'payments');
    const cashMovesRaw = settled(cashRes, 'cash_transactions');
    const voids = settled(voidRes, 'deleted_order_items');

    const byMethod = {};
    pays.forEach((p) => { byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + Number(p.amount || 0); });

    // cash_transactions.cashier_id points at the auth user, not a profiles row, so names are resolved separately
    const cashierIds = [...new Set(cashMovesRaw.map((c) => c.cashier_id).filter(Boolean))];
    let cashierNames = {};
    if (cashierIds.length) {
      let namesQ = supabase.from('profiles').select('id, full_name, email').in('id', cashierIds);
      namesQ = scoped(namesQ);
      const { data: names, error: namesErr } = await namesQ;
      if (namesErr) console.error('[Shifts] profile name lookup error:', namesErr.message);
      cashierNames = Object.fromEntries((names || []).map((n) => [n.id, n]));
    }
    const cashMoves = cashMovesRaw.map((c) => ({ ...c, cashier: cashierNames[c.cashier_id] }));

    // one chronological activity feed: sales, cash movements, voided items
    const activity = [
      ...(orders || []).map((o) => ({
        at: o.created_at, kind: o.is_deleted ? 'voided-sale' : 'sale', id: o.id,
        text: `${o.is_deleted ? 'Voided sale' : 'Sale'} <code>${esc(o.receipt_no)}</code> by ${esc(o.cashier?.full_name || o.cashier?.email || 'Unknown')}`,
        amount: o.is_deleted ? null : Number(o.total),
      })),
      ...(cashMoves || []).map((c) => ({
        at: c.created_at, kind: c.action_type === 'in' ? 'cash-in' : 'cash-out',
        text: `Cash ${c.action_type === 'in' ? 'added' : 'removed'} by ${esc(c.cashier?.full_name || c.cashier?.email || 'Unknown')}${c.note ? ` - ${esc(c.note)}` : ''}`,
        amount: c.action_type === 'in' ? Number(c.amount) : -Number(c.amount),
      })),
      ...(voids || []).map((v) => ({
        at: v.created_at, kind: 'voided-item',
        text: `Removed ${esc(v.quantity)} x ${esc(v.product_name)} by ${esc(v.removed_by?.full_name || v.removed_by?.email || 'Unknown')}${v.reason ? ` - ${esc(v.reason)}` : ''}`,
        amount: null,
      })),
    ].sort((a, b) => new Date(b.at) - new Date(a.at));

    const colorFor = (kind) => ({ sale: 'var(--teal-600)', 'cash-in': 'var(--teal-600)', 'cash-out': 'var(--color-danger)', 'voided-sale': 'var(--color-danger)', 'voided-item': 'var(--color-danger)' }[kind] || 'inherit');

    const row = (l, v, strong) => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border-subtle); font-size:0.9rem;"><span style="color:var(--text-muted);">${l}</span><span style="${strong ? 'font-weight:700;' : ''}">${v}</span></div>`;
    Modal.open({
      title: `Shift ${esc(stamp(s.opened_at))}`,
      content: `
        <!-- Summary -->
        <div style="background:var(--bg-surface); border-radius:8px; padding:12px 14px; margin-bottom:14px;">
          ${row('Status', s.status === 'open' ? '<span class="badge badge-teal">OPEN</span>' : '<span class="badge">CLOSED</span>')}
          ${row('Opened by', esc(s.opened_by_name || '-'))}
          ${row('Closed by', esc(s.closed_by_name || '-'))}
          ${row('Device', esc(String(s.opened_device || '-').slice(0, 60)))}
          ${row('Duration', esc(formatDuration(s.opened_at, s.closed_at)))}
          <div style="height:6px;"></div>
          ${row('Opening cash', `${money(s.opening_cash)} ${cur}`)}
          ${row('Orders', esc(t.orders_count ?? 0))}
          ${row('Total sales', `${money(t.total_sales)} ${cur}`, true)}
          ${Object.keys(byMethod).map((m) => row(`Paid by ${esc(m)}`, `${money(byMethod[m])} ${cur}`)).join('')}
          ${row('On credit (unpaid)', `${money(t.credit_sales)} ${cur}`)}
          ${row('Cash in / out', `${money(t.cash_in)} / ${money(t.cash_out)}`)}
          ${row('Expected cash', `${money(s.expected_cash ?? t.expected_cash)} ${cur}`, true)}
          ${s.actual_cash != null ? row('Counted cash', `${money(s.actual_cash)} ${cur}`) : ''}
          ${s.cash_variance != null ? row('Difference', `${Number(s.cash_variance) > 0 ? '+' : ''}${money(s.cash_variance)} ${cur}`, true) : ''}
          ${s.open_notes ? row('Opening note', esc(s.open_notes)) : ''}
          ${s.close_notes ? row('Closing note', esc(s.close_notes)) : ''}
        </div>

        <!-- Activity -->
        <h4 style="margin:0 0 8px; font-size:0.9rem;">Activity during this shift (${activity.length})</h4>
        <div style="max-height:320px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px;">
          ${activity.length ? activity.map((a) => `
            <div class="${a.id ? 'qs-activity-row' : ''}" ${a.id ? `data-receipt-view="${a.id}" role="button" tabindex="0"` : ''} style="display:flex; justify-content:space-between; gap:10px; padding:8px 10px; border-bottom:1px solid var(--border-subtle); font-size:0.82rem; ${a.id ? 'cursor:pointer;' : ''}">
              <div>
                <div>${a.text}${a.id ? ' <span style="color:var(--teal-600); font-size:0.72rem;">(view receipt)</span>' : ''}</div>
                <div style="font-size:0.72rem; color:var(--text-muted);">${esc(new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</div>
              </div>
              ${a.amount != null ? `<div style="white-space:nowrap; font-weight:700; color:${colorFor(a.kind)};">${a.amount < 0 ? '-' : ''}${money(Math.abs(a.amount))}</div>` : ''}
            </div>`).join('') : '<p style="padding:14px; color:var(--text-muted); margin:0;">No activity recorded.</p>'}
        </div>`,
    });

    // sales in the activity feed are clickable: open the same receipt view used in Sales Management
    document.getElementById('global-modal')?.querySelectorAll('[data-receipt-view]').forEach((el) => {
      el.onclick = () => openReceiptDetail(el.dataset.receiptView);
    });
  }

  function formatDuration(start, end) {
    const ms = new Date(end || new Date()) - new Date(start);
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return `${h}h ${m}m${end ? '' : ' (running)'}`;
  }

  // ------------------------------------------------------------------ start / close (one shop at a time)
  // "Start a shift" lists every store this admin/manager can open a shift in, marking ones that
  // already have one running. "Close a shift" lists every currently open shift with its store name.
  // Not scoped to the single active shop (unlike everything else on this page): an admin manages
  // several stores, so BOTH lists are deliberately org-wide - relying on the shops/shifts RLS
  // policies themselves (which already return every store the signed-in admin/manager may reach).
  async function openStartCloseModal() {
    Modal.open({
      title: 'Start / Close Shift',
      content: `
        <div style="display:flex; gap:8px; margin-bottom:16px;">
          <button type="button" id="sc-tab-start" class="btn btn-teal-primary" style="flex:1;">Start a shift</button>
          <button type="button" id="sc-tab-close" class="btn btn-outline" style="flex:1;">Close a shift</button>
        </div>
        <div id="sc-body"><p style="color:var(--text-muted); font-size:0.85rem;">Loading...</p></div>
      `,
    });

    const modalRoot = document.getElementById('global-modal');
    const tabStart = modalRoot.querySelector('#sc-tab-start');
    const tabClose = modalRoot.querySelector('#sc-tab-close');
    const body = () => modalRoot.querySelector('#sc-body');

    const setTab = (which) => {
      tabStart.className = which === 'start' ? 'btn btn-teal-primary' : 'btn btn-outline';
      tabStart.style.flex = '1';
      tabClose.className = which === 'close' ? 'btn btn-teal-primary' : 'btn btn-outline';
      tabClose.style.flex = '1';
      if (which === 'start') renderStartTab(); else renderCloseTab();
    };
    tabStart.onclick = () => setTab('start');
    tabClose.onclick = () => setTab('close');

    async function renderStartTab() {
      body().innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Loading your stores...</p>';

      // Deliberately NOT using scoped(): this must list every store the admin manages, not just
      // the one currently active in the sidebar. RLS (shops_select) already limits this correctly.
      const [{ data: shops, error: shopsErr }, { data: openShifts, error: openErr }] = await Promise.all([
        supabase.from('shops').select('id, name').order('name'),
        supabase.from('shifts').select('shop_id').eq('status', 'open'),
      ]);
      if (shopsErr || openErr) {
        body().innerHTML = `<p style="color:var(--color-danger);">${esc(shopsErr?.message || openErr?.message)}</p>`;
        return;
      }
      const openShopIds = new Set((openShifts || []).map((s) => s.shop_id));
      const available = (shops || []).filter((s) => !openShopIds.has(s.id));
      const busy = (shops || []).filter((s) => openShopIds.has(s.id));

      if (!shops || !shops.length) {
        body().innerHTML = '<p style="color:var(--text-muted);">No stores found for your account.</p>';
        return;
      }

      body().innerHTML = `
        <div class="form-group"><label>Store</label>
          <select id="sc-start-shop">
            ${available.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            ${busy.map((s) => `<option value="${s.id}" disabled>${esc(s.name)} (shift already open)</option>`).join('')}
          </select>
        </div>
        <div class="form-group"><label>Opening cash</label>
          <input type="number" id="sc-start-cash" min="0" step="0.01" value="0" /></div>
        <div class="form-group"><label>Note (optional)</label>
          <input type="text" id="sc-start-notes" maxlength="200" /></div>
        ${!available.length ? '<p style="color:var(--text-muted); font-size:0.85rem; margin-bottom:10px;">Every store already has an open shift.</p>' : ''}
        <button type="button" id="sc-start-btn" class="btn btn-primary" style="width:100%;" ${!available.length ? 'disabled' : ''}>Start shift</button>
      `;

      body().querySelector('#sc-start-btn').onclick = async () => {
        const btn = body().querySelector('#sc-start-btn');
        const shopId = body().querySelector('#sc-start-shop').value;
        const cash = parseFloat(body().querySelector('#sc-start-cash').value);
        if (Number.isNaN(cash) || cash < 0) { Toast.error('Enter the opening cash (0 or more).'); return; }
        btn.disabled = true; btn.textContent = 'Starting...';
        const { data, error } = await supabase.rpc('open_shift', {
          p_shop_id: shopId, p_opening_cash: cash,
          p_notes: body().querySelector('#sc-start-notes').value.trim() || null,
          p_device: 'Back office',
        });
        if (error) { Toast.error(error.message); btn.disabled = false; btn.textContent = 'Start shift'; return; }
        Toast.success(data.created ? 'Shift started.' : 'A shift was already running for that store - joined it.');
        Modal.close();
        load();
      };
    }

    async function renderCloseTab() {
      body().innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem;">Loading open shifts...</p>';

      const { data: open, error } = await supabase
        .from('shifts')
        .select('id, shop_id, staff_id, opened_at, opening_cash, shops(name), opener:profiles!shifts_staff_id_fkey(full_name, email)')
        .eq('status', 'open')
        .order('opened_at', { ascending: false });
      if (error) { body().innerHTML = `<p style="color:var(--color-danger);">${esc(error.message)}</p>`; return; }

      if (!open || !open.length) {
        body().innerHTML = '<p style="color:var(--text-muted);">No shifts are currently open.</p>';
        return;
      }

      body().innerHTML = `
        <div style="display:flex; flex-direction:column; gap:8px; max-height:320px; overflow-y:auto;">
          ${open.map((s) => `
            <button type="button" class="chart-box" data-close-shift="${s.id}"
              style="display:block; width:100%; text-align:left; padding:12px 14px; cursor:pointer; border:1px solid var(--border-subtle); background:var(--bg-card); font-family:inherit;">
              <div style="font-weight:700;">${esc(s.shops?.name || 'Unknown store')}</div>
              <div style="font-size:0.78rem; color:var(--text-muted);">
                Opened ${esc(stamp(s.opened_at))} by ${esc(s.opener?.full_name || s.opener?.email || '-')}
              </div>
            </button>`).join('')}
        </div>`;

      body().querySelectorAll('[data-close-shift]').forEach((btn) => {
        btn.onclick = () => openClose(btn.dataset.closeShift);
      });
    }

    setTab('start');
  }

  // ------------------------------------------------------------------ close (manager / admin)
  // Accepts a shift id that may or may not be in the currently-filtered `rows` (e.g. opened from the
  // Start/Close Shift list, or while the page's own status filter is set to "Closed") - so the
  // expected cash is always fetched fresh rather than assumed to already be loaded.
  async function openClose(id) {
    let r = rows.find((x) => x.id === id);
    if (!r?.expected_cash && r?.expected_cash !== 0) {
      const { data: live } = await supabase.rpc('shift_payload', { p_shift_id: id });
      if (live) r = { ...r, expected_cash: live.totals?.expected_cash };
    }
    const cur = esc(globalState.activeShop?.currency || globalState.preferences?.currency || 'KES');
    Modal.open({
      title: 'Close shift',
      content: `
        <form>
          <p style="font-size:0.85rem; color:var(--text-muted); margin-bottom:12px;">
            Expected cash in the drawer: <strong>${money(r?.expected_cash)} ${cur}</strong>.
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
        const { error } = await supabase.rpc('close_shift', { p_shift_id: id, p_actual_cash: counted, p_notes: fd.notes || null });
        if (error) { Toast.error(error.message); return false; }
        Toast.success('Shift closed.');
        load();
      },
    });
  }

  function exportCsv() {
    if (!rows.length) return Toast.error('Nothing to export.');
    const head = ['Opened', 'Closed', 'Opened by', 'Closed by', 'Status', 'Opening cash', 'Orders', 'Total sales', 'Cash sales', 'Expected cash', 'Counted cash', 'Difference'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) => [
      r.opened_at, r.closed_at || '', r.opener?.full_name || r.opener?.email || '', r.closer?.full_name || r.closer?.email || '',
      r.status, r.opening_cash, r.orders_count, r.total_sales, r.cash_sales, r.expected_cash ?? '', r.actual_cash ?? '', r.cash_variance ?? '',
    ].map(q).join(','));
    const blob = new Blob([[head.map(q).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `shifts_${range.from}_to_${range.to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  await load();
  return () => {};
}
