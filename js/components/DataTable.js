export function renderDataTable({ targetId, columns, data = [], onAction }) {
  const container = document.getElementById(targetId);
  if (!container) return;

  if (!data || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = `
      <div style="padding: 48px 24px; text-align: center; color: var(--text-subtle);">
        <p style="font-size: 0.9rem; margin-bottom: 4px;">No records found</p>
        <span style="font-size: 0.775rem;">Add new items or select a different filter range.</span>
      </div>
    `;
    return;
  }

  const theadCols = columns
    .map((c) => `<th style="${c.align ? `text-align:${c.align};` : ''}">${c.label}</th>`)
    .join('') + (onAction ? '<th style="text-align: right;">Actions</th>' : '');

  const tbodyRows = data
    .map((row) => {
      const cells = columns
        .map((c) => {
          let val = '-';
          try {
            if (typeof c.render === 'function') {
              val = c.render(row[c.key], row);
            } else {
              val = row[c.key] ?? '-';
            }
          } catch (e) {
            val = '-';
          }
          return `<td style="${c.align ? `text-align:${c.align};` : ''}">${val ?? '-'}</td>`;
        })
        .join('');

      const actionBtn = onAction
        ? `<td style="text-align: right;">
            <button class="btn btn-outline btn-sm" data-row-id="${row.id || ''}" data-action="manage">
              Manage
            </button>
           </td>`
        : '';

      return `<tr>${cells}${actionBtn}</tr>`;
    })
    .join('');

  container.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>${theadCols}</tr>
      </thead>
      <tbody>
        ${tbodyRows}
      </tbody>
    </table>
  `;

  if (onAction) {
    container.querySelectorAll('button[data-row-id]').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        onAction(btn.dataset.action || 'manage', btn.dataset.rowId);
      };
    });
  }

  if (window.lucide) {
    try {
      window.lucide.createIcons({ root: container });
    } catch (_) {}
  }
}
