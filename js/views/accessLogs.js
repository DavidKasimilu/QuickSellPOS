import { supabase } from '../supabaseClient.js';
import { globalState } from '../state.js';
import { renderDataTable } from '../components/DataTable.js';
import { Toast } from '../components/Toast.js';

export async function mount(container) {
  let unsubs = [];

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
      <div style="display:flex; align-items:center; gap:12px;">
        <h3 style="margin:0; font-size:1.25rem; font-weight:600;">System Access & Security Audit Logs</h3>
        <span class="badge badge-teal" id="logs-count-badge">0 events</span>
      </div>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-outline" id="btn-refresh-access-logs">
          <i data-lucide="refresh-cw" style="width:16px; height:16px; margin-right:6px;"></i> Refresh Audit Logs
        </button>
      </div>
    </div>

    <div class="chart-box" style="padding:0; overflow-x:auto;">
      <div id="access-logs-table-content"></div>
    </div>
  `;

  document.getElementById('btn-refresh-access-logs').onclick = () => loadAccessLogs();

  async function loadAccessLogs() {
    const tableArea = document.getElementById('access-logs-table-content');
    if (!tableArea) return;

    tableArea.innerHTML = `<p style="padding:24px; color:var(--text-muted);">Fetching system security audit trails...</p>`;

    let query = supabase
      .from('user_access_logs')
      .select('*, profiles(full_name, email), shops(name)')
      .order('created_at', { ascending: false });

    if (globalState.activeShopId) {
      query = query.eq('shop_id', globalState.activeShopId);
    }

    const { data: logs, error } = await query;

    if (error) {
      tableArea.innerHTML = `<p style="padding:20px; color:var(--color-danger);">${error.message}</p>`;
      return;
    }

    const countBadge = document.getElementById('logs-count-badge');
    if (countBadge) countBadge.textContent = `${logs?.length || 0} events`;

    if (!logs || logs.length === 0) {
      tableArea.innerHTML = `
        <div style="padding:40px; text-align:center; color:var(--text-muted);">
          <i data-lucide="shield-alert" style="width:48px; height:48px; margin-bottom:12px; stroke-width:1.5;"></i>
          <p>No security audit logs recorded yet.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons({ root: container });
      return;
    }

    renderDataTable({
      targetId: 'access-logs-table-content',
      columns: [
        { 
          label: 'User / Operator', 
          key: 'profiles', 
          render: (p) => `<strong>${p?.full_name || p?.email || 'System User'}</strong>` 
        },
        { 
          label: 'Action Performed', 
          key: 'action_type', 
          render: (type) => {
            const act = (type || 'login').toLowerCase();
            let badgeClass = 'badge badge-teal';
            if (act.includes('fail') || act.includes('revoke') || act.includes('deny')) badgeClass = 'badge text-danger';
            else if (act.includes('update') || act.includes('edit')) badgeClass = 'badge';
            return `<span class="${badgeClass}">${act.replace('_', ' ').toUpperCase()}</span>`;
          } 
        },
        { label: 'Store Branch', key: 'shops', render: (s) => s?.name || 'Main Branch' },
        { label: 'IP / Terminal Fingerprint', key: 'ip_address', render: (ip, row) => `<code>${ip || row.device_fingerprint || 'Localhost'}</code>` },
        { label: 'Event Details', key: 'details', render: (d) => d || 'User access activity' },
        { label: 'Timestamp', key: 'created_at', render: (d) => new Date(d).toLocaleString() },
      ],
      data: logs || [],
    });

    if (window.lucide) window.lucide.createIcons({ root: container });
  }

  await loadAccessLogs();

  return () => {
    unsubs.forEach((unsub) => unsub && unsub());
  };
}