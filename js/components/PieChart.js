/**
 * PieChart.js
 * Lightweight, zero-dependency SVG Pie / Donut Chart component for QuickSell POS analytics.
 */

export const PieChart = {
  // Vibrant color palette for slices
  colors: [
    '#0d9488', // Teal primary
    '#0284c7', // Sky blue
    '#6366f1', // Indigo
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#f59e0b', // Amber
    '#10b981', // Emerald
    '#64748b'  // Slate
  ],

  /**
   * Render SVG Donut/Pie Chart into container
   * @param {HTMLElement|string} target - Container element or element ID
   * @param {Array<{label: string, value: number}>} items - Data series
   * @param {Object} options - Custom options (title, currency, height)
   */
  render(target, items = [], options = {}) {
    const container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;

    const currency = options.currency || '';
    const title = options.title || 'Data Distribution';
    
    // Filter non-zero values
    const validItems = items.filter(i => Number(i.value) > 0);
    const total = validItems.reduce((acc, i) => acc + Number(i.value), 0);

    if (!validItems.length || total === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem; border: 1px solid var(--border-subtle); border-radius: 8px; background: var(--bg-card);">
          <p>No distribution data available for current selection.</p>
        </div>
      `;
      return;
    }

    let cumulativePercent = 0;
    const slices = validItems.map((item, idx) => {
      const val = Number(item.value);
      const percent = val / total;
      const startAngle = cumulativePercent * 360;
      cumulativePercent += percent;
      const endAngle = cumulativePercent * 360;

      const color = this.colors[idx % this.colors.length];

      // SVG Arc Coordinates (Radius 80, Center 100, 100)
      const x1 = 100 + 80 * Math.cos((Math.PI * (startAngle - 90)) / 180);
      const y1 = 100 + 80 * Math.sin((Math.PI * (startAngle - 90)) / 180);
      const x2 = 100 + 80 * Math.cos((Math.PI * (endAngle - 90)) / 180);
      const y2 = 100 + 80 * Math.sin((Math.PI * (endAngle - 90)) / 180);

      const largeArcFlag = percent > 0.5 ? 1 : 0;
      const pathData = percent >= 0.999
        ? `M 100 20 A 80 80 0 1 1 99.99 20 Z` // Full circle
        : `M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;

      return {
        ...item,
        percent: (percent * 100).toFixed(1),
        color,
        pathData
      };
    });

    const svgSlices = slices.map(s => `
      <path d="${s.pathData}" fill="${s.color}" stroke="#ffffff" stroke-width="2">
        <title>${s.label}: ${s.value.toLocaleString()} ${currency} (${s.percent}%)</title>
      </path>
    `).join('');

    const legendItems = slices.map(s => `
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; font-size: 0.8125rem; margin-bottom: 6px;">
        <div style="display: flex; align-items: center; gap: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${s.color}; flex-shrink: 0;"></span>
          <span style="color: var(--text-main); font-weight: 500;">${s.label}</span>
        </div>
        <div style="font-weight: 600; color: var(--text-main); flex-shrink: 0;">
          ${Number(s.value).toLocaleString()} ${currency} <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 400;">(${s.percent}%)</span>
        </div>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="card" style="padding: 20px; background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 10px; margin-bottom: 20px;">
        <h4 style="font-size: 0.9rem; font-weight: 700; color: var(--text-main); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 16px;">${title}</h4>
        <div style="display: flex; flex-wrap: wrap; align-items: center; justify-content: space-around; gap: 24px;">
          <!-- SVG Pie / Donut Canvas -->
          <div style="position: relative; width: 200px; height: 200px; flex-shrink: 0;">
            <svg viewBox="0 0 200 200" style="width: 100%; height: 100%; transform: rotate(0deg);">
              ${svgSlices}
              <!-- Inner cutout for donut chart style -->
              <circle cx="100" cy="100" r="48" fill="#ffffff" />
            </svg>
            <div style="position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; pointer-events: none;">
              <span style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Total</span>
              <span style="font-size: 0.85rem; font-weight: 700; color: var(--teal-700);">${total.toLocaleString()}</span>
            </div>
          </div>

          <!-- Color Coded Legend -->
          <div style="flex: 1; min-width: 220px; max-height: 200px; overflow-y: auto; padding-right: 4px;">
            ${legendItems}
          </div>
        </div>
      </div>
    `;
  }
};