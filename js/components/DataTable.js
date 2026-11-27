export function renderDataTable({ targetId, columns, data = [], onAction, actionLabel = 'Edit' }) {
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

  // A column with sticky:'left'|'right' stays pinned to that edge of the table while the rest
  // scrolls horizontally - use it for an actions column in a wide table so it's never scrolled out
  // of view. `background` keeps the pinned cell opaque over the rows scrolling beneath it.
  const stickyStyle = (c) => (c.sticky ? `position:sticky; ${c.sticky}:0; background:var(--bg-card); z-index:1;` : '');

  const theadCols = columns
    .map((c) => `<th style="${c.align ? `text-align:${c.align};` : ''} ${stickyStyle(c)}">${c.label}</th>`)
    .join('') + (onAction ? '<th style="text-align: right;">Actions</th>' : '');

  const tbodyRows = data
    .map((row) => {
      const cells = columns
        .map((c) => {
          const val = c.render ? c.render(row[c.key], row) : (row[c.key] ?? '-');
          return `<td style="${c.align ? `text-align:${c.align};` : ''} ${stickyStyle(c)}">${val}</td>`;
        })
        .join('');

      const actionBtn = onAction
        ? `<td style="text-align: right;">
            <button class="btn btn-outline btn-sm" data-row-id="${row.id}" data-action="manage">
              ${actionLabel}
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
      btn.onclick = () => {
        onAction(btn.dataset.action, btn.dataset.rowId);
      };
    });
  }

  // Refresh Lucide icons within newly created rows
  if (window.lucide) {
    window.lucide.createIcons();
  }
}