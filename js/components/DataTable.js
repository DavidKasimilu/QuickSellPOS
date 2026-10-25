export function renderDataTable({ targetId, columns, data = [], onAction, showDefaultAction = true }) {
  const container = document.getElementById(targetId);
  if (!container) return;

  if (!data || data.length === 0) {
    container.innerHTML = `
      <div style="padding: 48px 24px; text-align: center; color: var(--text-subtle);">
        <p style="font-size: 0.9rem; margin-bottom: 4px;">No records found</p>
        <span style="font-size: 0.775rem;">Add new items or select a different filter range.</span>
      </div>
    `;
    return;
  }

  // Only append default Actions header if onAction is provided AND showDefaultAction is true
  const includeActionCol = Boolean(onAction && showDefaultAction);

  const theadCols = columns
    .map((c) => `<th style="${c.align ? `text-align:${c.align};` : ''}">${c.label}</th>`)
    .join('') + (includeActionCol ? '<th style="text-align: right;">Actions</th>' : '');

  const tbodyRows = data
    .map((row) => {
      const cells = columns
        .map((c) => {
          const val = c.render ? c.render(row[c.key], row) : (row[c.key] ?? '-');
          return `<td style="${c.align ? `text-align:${c.align};` : ''}">${val}</td>`;
        })
        .join('');

      const actionBtn = includeActionCol
        ? `<td style="text-align: right;">
            <button class="btn btn-outline btn-sm" data-row-id="${row.id}" data-action="manage">
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
    window.lucide.createIcons();
  }
}