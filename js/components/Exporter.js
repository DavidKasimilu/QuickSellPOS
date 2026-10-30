/**
 * Exporter.js
 * Utility component for exporting datasets to CSV and printable PDF formats.
 */

export const Exporter = {
  /**
   * Export array of objects to CSV format
   * @param {string} filename - Output filename (e.g., 'sales_report.csv')
   * @param {Array<Object>} data - Array of data rows
   * @param {Array<{label: string, key: string}>} columns - Optional explicit column definitions
   */
  exportToCSV(filename, data, columns = null) {
    if (!data || !data.length) {
      alert('No data available to export.');
      return;
    }

    let headers = [];
    let keys = [];

    if (columns && columns.length) {
      headers = columns.map(col => `"${col.label.replace(/"/g, '""')}"`);
      keys = columns.map(col => col.key);
    } else {
      keys = Object.keys(data[0]);
      headers = keys.map(k => `"${k.replace(/_/g, ' ').toUpperCase()}"`);
    }

    const csvRows = [];
    csvRows.push(headers.join(','));

    data.forEach(row => {
      const values = keys.map(key => {
        let val = row[key];
        if (val === null || val === undefined) {
          val = '';
        } else if (typeof val === 'object') {
          // Handle nested objects or relational data (e.g. customer name)
          val = val.name || val.full_name || JSON.stringify(val);
        }
        const stringVal = String(val).replace(/"/g, '""');
        return `"${stringVal}"`;
      });
      csvRows.push(values.join(','));
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvRows.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  /**
   * Print/Export dataset or styled report block to PDF printable window
   * @param {string} title - Report Header Title
   * @param {Array<Object>} data - Array of records
   * @param {Array<{label: string, key: string, render?: Function}>} columns - Column mapping
   * @param {Object} summaryMeta - Optional summary metrics (e.g. Total Revenue, Total Discounts)
   */
  exportToPDF(title, data, columns, summaryMeta = null) {
    if (!data || !data.length) {
      alert('No data available to generate PDF.');
      return;
    }

    const printWindow = window.open('', '_blank', 'width=900,height=700');
    if (!printWindow) {
      alert('Pop-up blocker prevented opening print window.');
      return;
    }

    let summaryHtml = '';
    if (summaryMeta) {
      const metaItems = Object.entries(summaryMeta)
        .map(([k, v]) => `
          <div style="flex:1; background:#f8fafc; border:1px solid #e2e8f0; padding:10px 14px; border-radius:6px; min-width:140px;">
            <div style="font-size:11px; text-transform:uppercase; color:#64748b; font-weight:700;">${k}</div>
            <div style="font-size:16px; font-weight:700; color:#0f172a; margin-top:4px;">${v}</div>
          </div>
        `).join('');
      summaryHtml = `<div style="display:flex; flex-wrap:wrap; gap:12px; margin-bottom:20px;">${metaItems}</div>`;
    }

    const tableHeaders = columns.map(col => `<th style="text-align:left; padding:8px 12px; background:#0d9488; color:#fff; font-size:12px;">${col.label}</th>`).join('');

    const tableRows = data.map((row, idx) => {
      const cells = columns.map(col => {
        let val = row[col.key];
        if (col.render && typeof col.render === 'function') {
          const rawRender = col.render(val, row);
          val = rawRender.replace(/<[^>]*>?/gm, ''); 
        } else if (val === null || val === undefined) {
          val = '-';
        } else if (typeof val === 'object') {
          val = val.name || val.full_name || '-';
        }
        return `<td style="padding:8px 12px; border-bottom:1px solid #e2e8f0; font-size:12px; color:#334155;">${val}</td>`;
      }).join('');
      const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
      return `<tr style="background:${bg};">${cells}</tr>`;
    }).join('');

    const htmlDoc = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title} - QuickSell POS Report</title>
        <style>
          body { font-family: 'Inter', system-ui, -apple-system, sans-serif; margin: 24px; color: #0f172a; }
          .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0d9488; padding-bottom: 12px; margin-bottom: 20px; }
          .brand { font-size: 20px; font-weight: 700; color: #0d9488; }
          .title { font-size: 16px; font-weight: 600; color: #334155; }
          .meta-date { font-size: 11px; color: #64748b; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          @media print {
            body { margin: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <div class="brand">QuickSell POS</div>
            <div class="title">${title}</div>
          </div>
          <div style="text-align:right;">
            <div class="meta-date">Generated: ${new Date().toLocaleString()}</div>
            <button class="no-print" onclick="window.print()" style="margin-top:6px; background:#0d9488; color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; font-weight:600;">Print Report</button>
          </div>
        </div>
        ${summaryHtml}
        <table>
          <thead><tr>${tableHeaders}</tr></thead>
          <tbody>${tableRows}</tbody>
        </table>
      </body>
      </html>
    `;

    printWindow.document.open();
    printWindow.document.write(htmlDoc);
    printWindow.document.close();
  }
};