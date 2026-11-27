(function () {
  'use strict';

  function renderBarChart(container, series, symbol = '₹') {
    if (!container) return;
    if (!series || series.length === 0) {
      container.innerHTML = '<div class="muted" style="padding:32px;text-align:center">No invoice history yet for this period.</div>';
      return;
    }

    const width = 620;
    const height = 230;
    const padL = 56;
    const padB = 30;
    const padT = 18;
    const padR = 14;
    const chartW = width - padL - padR;
    const chartH = height - padT - padB;
    const maxVal = Math.max(100, ...series.map((d) => Number(d.revenue || 0)));
    const barGap = 10;
    const barW = Math.max(14, Math.floor(chartW / series.length) - barGap);

    const bars = series.map((d, idx) => {
      const val = Number(d.revenue || 0);
      const barH = Math.max(4, (val / maxVal) * chartH);
      const x = padL + idx * (barW + barGap);
      const y = padT + (chartH - barH);
      const shortDay = String(d.day).slice(5);
      return `
        <g>
          <rect class="chart-bar-rect" style="--bar-idx:${idx}" x="${x}" y="${y}" width="${barW}" height="${barH}" rx="6" fill="url(#barGrad)">
            <title>${d.day}: ${symbol}${val.toLocaleString('en-IN')} (${d.orders} orders)</title>
          </rect>
          <text x="${x + barW / 2}" y="${height - 8}" text-anchor="middle" fill="var(--muted)" font-size="10" font-family="JetBrains Mono, monospace">${shortDay}</text>
        </g>
      `;
    }).join('');

    const ticks = [0, 0.5, 1].map((t) => {
      const y = padT + chartH * (1 - t);
      const label = Math.round(maxVal * t).toLocaleString('en-IN');
      return `
        <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,4" />
        <text x="${padL - 8}" y="${y + 3}" text-anchor="end" fill="var(--muted)" font-size="10" font-family="JetBrains Mono, monospace">${symbol}${label}</text>
      `;
    }).join('');

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;display:block">
        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--accent)" stop-opacity="1" />
            <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.28" />
          </linearGradient>
        </defs>
        ${ticks}
        ${bars}
      </svg>
    `;
  }

  function renderDonutChart(container, slices, symbol = '₹') {
    if (!container) return;
    const total = (slices || []).reduce((s, x) => s + Number(x.amount || 0), 0);
    if (total <= 0) {
      container.innerHTML = '<div class="muted" style="padding:24px;text-align:center">No payment data yet.</div>';
      return;
    }

    const colors = ['#f97316', '#38bdf8', '#10b981', '#a855f7', '#eab308'];
    let acc = 0;
    const radius = 58;
    const circ = 2 * Math.PI * radius;

    const arcs = slices.map((s, idx) => {
      const frac = Number(s.amount) / total;
      const len = Math.max(0, frac * circ - 2);
      const offset = -acc * circ;
      acc += frac;
      return `
        <circle class="chart-donut-arc" r="${radius}" cx="80" cy="80" fill="transparent"
          stroke="${colors[idx % colors.length]}" stroke-width="18" stroke-linecap="round"
          stroke-dasharray="${len} ${circ}" stroke-dashoffset="${offset}"
          transform="rotate(-90 80 80)" />
      `;
    }).join('');

    const legend = slices.map((s, idx) => {
      const pct = Math.round((Number(s.amount) / total) * 100);
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:8px">
          <span style="display:flex;align-items:center;gap:8px">
            <span style="width:9px;height:9px;border-radius:3px;background:${colors[idx % colors.length]}"></span>
            <strong>${s.mode}</strong>
          </span>
          <span class="mono muted">${pct}% · ${symbol}${Math.round(s.amount).toLocaleString('en-IN')}</span>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:22px;flex-wrap:wrap">
        <svg width="160" height="160" viewBox="0 0 160 160" style="flex-shrink:0">
          ${arcs}
          <text x="80" y="75" text-anchor="middle" fill="var(--muted)" font-size="10" font-weight="600">TOTAL</text>
          <text x="80" y="94" text-anchor="middle" fill="var(--text)" font-size="13" font-weight="700" font-family="JetBrains Mono, monospace">${symbol}${Math.round(total).toLocaleString('en-IN')}</text>
        </svg>
        <div style="flex:1;min-width:170px">${legend}</div>
      </div>
    `;
  }

  window.BistroCharts = { renderBarChart, renderDonutChart };
})();
