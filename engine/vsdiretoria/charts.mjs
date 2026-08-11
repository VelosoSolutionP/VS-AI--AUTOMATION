/**
 * VSdiretoria — charts. Geradores de SVG puros (sem lib externa, self-contained),
 * theme-aware via CSS vars (--c1..--c6, --fg, --muted, --grid). Testáveis (retornam string).
 */

const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Donut com legenda embutida. segments = [{label,value}]. */
export function donut(segments, { size = 200, thickness = 26 } = {}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const cx = size / 2;
  let acc = 0;
  const arcs = segments.map((seg, i) => {
    const frac = seg.value / total;
    const dash = frac * c;
    const el = `<circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${PALETTE[i % PALETTE.length]}" stroke-width="${thickness}" stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" stroke-dashoffset="${(-acc * c).toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"><title>${esc(seg.label)}: ${seg.value}</title></circle>`;
    acc += frac;
    return el;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" class="donut">
    ${arcs}
    <text x="${cx}" y="${cx - 4}" text-anchor="middle" class="donut-num">${total}</text>
    <text x="${cx}" y="${cx + 16}" text-anchor="middle" class="donut-lbl">itens</text>
  </svg>`;
}

/** Legenda (cores + label + valor) pareada com o donut. */
export function legend(segments) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return `<ul class="legend">${segments.map((s, i) =>
    `<li><span class="dot" style="background:${PALETTE[i % PALETTE.length]}"></span>${esc(s.label)}<b>${s.value}</b><em>${Math.round((s.value / total) * 100)}%</em></li>`,
  ).join('')}</ul>`;
}

/** Colunas verticais (ex.: entregas por mês). items = [{label,value}]. */
export function columns(items, { height = 180 } = {}) {
  if (!items.length) { return '<p class="empty">sem dados no período</p>'; }
  const max = Math.max(...items.map((i) => i.value), 1);
  const bw = 100 / items.length;
  const bars = items.map((it, i) => {
    const h = (it.value / max) * 80;
    const x = i * bw + bw * 0.15;
    const w = bw * 0.7;
    const y = 90 - h;
    return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.5" fill="var(--c1)"><title>${esc(it.label)}: ${it.value}</title></rect>
      <text x="${x + w / 2}" y="97" text-anchor="middle" class="col-x">${esc(it.label.slice(5))}</text>
      <text x="${x + w / 2}" y="${y - 2}" text-anchor="middle" class="col-v">${it.value}</text></g>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="${height}" class="cols">${bars}</svg>`;
}

/** Barras horizontais com rótulo (ex.: por responsável / horas). */
export function barsH(items, { unit = '' } = {}) {
  if (!items.length) { return '<p class="empty">sem dados</p>'; }
  const max = Math.max(...items.map((i) => i.value), 1);
  return `<div class="bars">${items.map((it, i) =>
    `<div class="bar-row"><span class="bar-lbl" title="${esc(it.label)}">${esc(it.label)}</span>
      <span class="bar-track"><span class="bar-fill" style="width:${(it.value / max) * 100}%;background:${PALETTE[i % PALETTE.length]}"></span></span>
      <span class="bar-val">${it.value}${unit}</span></div>`,
  ).join('')}</div>`;
}

/** Medidor radial (0-100%) pra taxas de aderência/entrega. */
export function gauge(pctValue, { size = 130, label = '' } = {}) {
  const v = Math.max(0, Math.min(100, pctValue));
  const r = size / 2 - 12;
  const cx = size / 2;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  const cor = v >= 80 ? 'var(--ok)' : v >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" class="gauge">
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="var(--grid)" stroke-width="10"/>
    <circle cx="${cx}" cy="${cx}" r="${r}" fill="none" stroke="${cor}" stroke-width="10" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" transform="rotate(-90 ${cx} ${cx})"/>
    <text x="${cx}" y="${cx + 2}" text-anchor="middle" class="gauge-num">${Math.round(v)}%</text>
    ${label ? `<text x="${cx}" y="${cx + 20}" text-anchor="middle" class="gauge-lbl">${esc(label)}</text>` : ''}
  </svg>`;
}
