import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';
import { Modal } from '../components/Modal.js';
import { scoped } from '../tenant.js';

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

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">Shift Management</h3>
        <span class="badge badge-teal" id="shift-count-badge">0 shifts</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-outline" id="btn-shifts-export">Export CSV</button>
        <button class="btn btn-outline" id="btn-shifts-refresh">Refresh</button>
      </div>
    </div>

    <div class="chart-box" style="padding:14px; margin-bottom:14px;">
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
        <button class="btn btn-outline btn-sm" data-preset="today">Today</button>
        <button class="btn btn-outline btn-sm" data-preset="yesterday">Yesterday</button>
        <button class="btn btn-outline btn-sm" data-preset="7days">Last 7 days</button>
        <button class="btn btn-outline btn-sm" data-preset="month">This month</button>
      </div>
      <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end;">
        <div><label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">From</label>
          <input type="date" id="shift-from" value="${range.from}" /></div>
        <div><label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">To</label>
          <input type="date" id="shift-to" value="${range.to}" /></div>
        <div><label style="display:block; font-size:0.75rem; color:var(--text-muted); margin-bottom:4px;">Status</label>
          <select id="shift-status"><option value="all">All</option><option value="open">Open</option><option value="closed">Closed</option></select></div>
        <button class="btn btn-primary" id="btn-shift-apply">Apply</button>
      </div>
    </div>

    <div id="shift-summary" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(170px, 1fr)); gap:12px; margin-bottom:14px;"></div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="shifts-table-content"></div>
    </div>
  `;

  // ------------------------------------------------------------------ date controls
  const setRange = (from, to) => {
    range = { from, to };
    document.getElementById('shift-from').value = from;
    document.getElementById('shift-to').value = to;
    load();
  };
  container.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.onclick = () => {
      const now = new Date();
      const p = btn.dataset.preset;
      if (p === 'today') setRange(ymd(now), ymd(now));
      if (p === 'yesterday') { const y = new Date(now); y.setDate(y.getDate() - 1); setRange(ymd(y), ymd(y)); }
      if (p === '7days') { const s = new Date(now); s.setDate(s.getDate() - 6); setRange(ymd(s), ymd(now)); }
      if (p === 'month') setRange(ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(now));
    };
  });
  document.getElementById('btn-shift-apply').onclick = () => {
    const from = document.getElementById('shift-from').value;
    const to = document.getElementById('shift-to').value;
    if (!from || !to) return Toast.error('Choose both dates.');
    if (from > to) return Toast.error('The start date must be before the end date.');
    range = { from, to };
    status = document.getElementById('shift-status').value;
    load();
  };
  document.getElementById('shift-status').onchange = (e) => { status = e.target.value; load(); };
  document.getElementById('btn-shifts-refresh').onclick = () => load();
  document.getElementById('btn-shifts-export').onclick = exportCsv;

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
        { label: 'Opened', key: 'opened_at', render: (d) => esc(stamp(d)) },
        { label: 'Closed', key: 'closed_at', render: (d) => (d ? esc(stamp(d)) : '<span class="badge badge-teal">Running</span>') },
        { label: 'Opened by', key: 'opener', render: (p) => esc(p?.full_name || p?.email || '-') },
        { label: 'Closed by', key: 'closer', render: (p) => esc(p?.full_name || p?.email || '-') },
        { label: 'Status', key: 'status', render: (s) => (s === 'open' ? '<span class="badge badge-teal">OPEN</span>' : '<span class="badge">CLOSED</span>') },
        { label: 'Opening cash', key: 'opening_cash', align: 'right', render: (v) => money(v) },
        { label: 'Orders', key: 'orders_count', align: 'right', render: (v) => esc(v ?? 0) },
        { label: 'Total sales', key: 'total_sales', align: 'right', render: (v) => `<strong>${money(v)}</strong>` },
        { label: 'Expected cash', key: 'expected_cash', align: 'right', render: (v) => (v == null ? '-' : money(v)) },
        { label: 'Counted', key: 'actual_cash', align: 'right', render: (v) => (v == null ? '-' : money(v)) },
        {
          label: 'Difference', key: 'cash_variance', align: 'right',
          render: (v) => {
            if (v == null) return '-';
            const n = Number(v);
            return `<span style="color:${n < 0 ? 'var(--color-danger)' : n > 0 ? 'var(--teal-600)' : 'inherit'}; font-weight:600;">${n > 0 ? '+' : ''}${money(n)}</span>`;
          },
        },
        {
          label: '', key: 'id', align: 'right',
          render: (id, row) => `
            <button class="btn btn-outline btn-sm" data-shift-view="${id}">View</button>
            ${row.status === 'open' && canClose ? `<button class="btn btn-outline btn-sm text-danger" data-shift-close="${id}" style="margin-left:6px;">Close</button>` : ''}`,
        },
      ],
      data: rows,
    });
    container.querySelectorAll('[data-shift-view]').forEach((b) => { b.onclick = () => openDetail(b.dataset.shiftView); });
    container.querySelectorAll('[data-shift-close]').forEach((b) => { b.onclick = () => openClose(b.dataset.shiftClose); });
  }

  // ------------------------------------------------------------------ detail
  async function openDetail(id) {
    const { data: s, error } = await supabase.rpc('shift_payload', { p_shift_id: id });
    if (error || !s) return Toast.error(error?.message || 'Could not load this shift.');
    const t = s.totals || {};
    const cur = esc(globalState.activeShop?.currency || globalState.preferences?.currency || 'KES');

    let ordersQ = supabase.from('orders')
      .select('receipt_no, total, created_at, order_status, cashier:profiles!orders_cashier_id_fkey(full_name, email)')
      .eq('shift_id', id).order('created_at', { ascending: false }).limit(200);
    ordersQ = scoped(ordersQ);
    const { data: orders } = await ordersQ;

    let payQ = supabase.from('payments').select('amount, payment_method, orders!inner(shift_id)').eq('orders.shift_id', id);
    payQ = scoped(payQ);
    const { data: pays } = await payQ;
    const byMethod = {};
    (pays || []).forEach((p) => { byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + Number(p.amount || 0); });

    const row = (l, v, strong) => `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid var(--border-subtle); font-size:0.9rem;"><span style="color:var(--text-muted);">${l}</span><span style="${strong ? 'font-weight:700;' : ''}">${v}</span></div>`;
    Modal.open({
      title: `Shift ${esc(stamp(s.opened_at))}`,
      content: `
        ${row('Status', s.status === 'open' ? 'OPEN' : 'CLOSED')}
        ${row('Opened by', esc(s.opened_by_name || '-'))}
        ${row('Closed by', esc(s.closed_by_name || '-'))}
        ${row('Device', esc(String(s.opened_device || '-').slice(0, 60)))}
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
        <h4 style="margin:16px 0 8px; font-size:0.9rem;">Sales in this shift (${(orders || []).length})</h4>
        <div style="max-height:220px; overflow-y:auto; border:1px solid var(--border-subtle); border-radius:6px;">
          ${(orders || []).length ? `<table style="width:100%; font-size:0.82rem; border-collapse:collapse;">
            ${(orders || []).map((o) => `<tr style="border-bottom:1px solid var(--border-subtle);">
              <td style="padding:6px 8px;"><code>${esc(o.receipt_no)}</code></td>
              <td style="padding:6px 8px;">${esc(new Date(o.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</td>
              <td style="padding:6px 8px;">${esc(o.cashier?.full_name || o.cashier?.email || '')}</td>
              <td style="padding:6px 8px; text-align:right;"><strong>${money(o.total)}</strong></td></tr>`).join('')}
          </table>` : '<p style="padding:12px; color:var(--text-muted); margin:0;">No sales yet.</p>'}
        </div>`,
    });
  }

  // ------------------------------------------------------------------ close (manager / admin)
  function openClose(id) {
    const r = rows.find((x) => x.id === id);
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
