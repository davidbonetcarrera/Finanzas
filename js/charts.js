// Gráficos SVG sencillos (sin librerías).
import { s, h } from './dom.js';
import { fmt } from './money.js';

const W = 340;

function niceMax(v) {
  if (v <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
const short = (cents) => {
  const v = cents / 100;
  if (Math.abs(v) >= 1000) return '$' + (v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1).replace('.0', '') + 'k';
  return '$' + Math.round(v);
};

/**
 * Barras apiladas por mes (gasto real por categoría) con una marca de ingresos.
 * data: [{ label, parts: [{ value, cls, name }], marker }]
 */
export function stackedBars(data, { height = 190, markerLabel = 'Ingresos' } = {}) {
  const padL = 36, padB = 22, padT = 8, innerH = height - padB - padT;
  const max = niceMax(Math.max(...data.map((d) => Math.max(d.parts.reduce((a, p) => a + p.value, 0), d.marker || 0)), 0));
  const n = data.length;
  const slot = (W - padL - 4) / n;
  const bw = Math.min(22, slot * 0.62);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', role: 'img' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(s('line', { x1: padL, x2: W, y1: y(v), y2: y(v), class: 'grid' }),
      s('text', { x: padL - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, short(v)));
  }
  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    let acc = 0;
    const g = s('g');
    const total = d.parts.reduce((a, p) => a + p.value, 0);
    for (const p of d.parts) {
      if (p.value <= 0) continue;
      const y0 = y(acc), y1 = y(acc + p.value);
      g.append(s('rect', { x: cx - bw / 2, y: y1, width: bw, height: Math.max(0.5, y0 - y1), class: p.cls }));
      acc += p.value;
    }
    g.append(s('title', null, `${d.label}: gasto ${fmt(total)}${d.marker ? ' · ingresos ' + fmt(d.marker) : ''}`));
    svg.append(g);
    if (d.marker) svg.append(s('line', { x1: cx - bw / 2 - 4, x2: cx + bw / 2 + 4, y1: y(d.marker), y2: y(d.marker), class: 'marker' }));
    svg.append(s('text', { x: cx, y: height - 6, class: 'axis', 'text-anchor': 'middle' }, d.label));
  });
  return svg;
}

/** Barras positivas/negativas (saldo mensual). data: [{ label, value, empty }] */
export function balanceBars(data, { height = 150 } = {}) {
  const padL = 36, padB = 22, padT = 8, innerH = height - padB - padT;
  const maxAbs = niceMax(Math.max(1, ...data.map((d) => Math.abs(d.value))));
  const hasNeg = data.some((d) => d.value < 0);
  const min = hasNeg ? -maxAbs : 0;
  const max = maxAbs;
  const y = (v) => padT + innerH - ((v - min) / (max - min)) * innerH;
  const n = data.length;
  const slot = (W - padL - 4) / n;
  const bw = Math.min(22, slot * 0.62);
  const svg = s('svg', { viewBox: `0 0 ${W} ${height}`, class: 'chart', role: 'img' });
  for (const v of hasNeg ? [min, min / 2, 0, max / 2, max] : [0, max / 4, max / 2, (3 * max) / 4, max]) {
    svg.append(s('line', { x1: padL, x2: W, y1: y(v), y2: y(v), class: v === 0 ? 'zero' : 'grid' }),
      s('text', { x: padL - 4, y: y(v) + 3, class: 'axis', 'text-anchor': 'end' }, short(v)));
  }
  data.forEach((d, i) => {
    const cx = padL + slot * i + slot / 2;
    if (!d.empty) {
      const y0 = y(0), y1 = y(d.value);
      svg.append(s('rect', { x: cx - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(0.5, Math.abs(y1 - y0)), class: d.value >= 0 ? 'pos' : 'neg' },
        s('title', null, `${d.label}: ${fmt(d.value)}`)));
    }
    svg.append(s('text', { x: cx, y: height - 6, class: 'axis', 'text-anchor': 'middle' }, d.label));
  });
  return svg;
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map(([cls, label]) => h('span', null, h('i', { class: 'sw ' + cls }), label)));
}
