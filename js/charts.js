// رسوم بيانية SVG خفيفة بدون مكتبات
const NS = 'http://www.w3.org/2000/svg';

function el(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export function fmt(n, digits = 0) {
  return new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

// دائرة مجوّفة للتصنيفات
export function donut(items, { size = 200, thickness = 26, center = '' , sub = '' } = {}) {
  const svg = el('svg', { viewBox: `0 0 ${size} ${size}`, class: 'donut', role: 'img' });
  const r = (size - thickness) / 2, c = size / 2, C = 2 * Math.PI * r;
  const total = items.reduce((s, i) => s + i.value, 0);
  el('circle', { cx: c, cy: c, r, fill: 'none', stroke: 'var(--track)', 'stroke-width': thickness }, svg);
  let acc = 0;
  const gap = items.length > 1 ? 2 : 0;
  for (const it of items) {
    const len = total ? (it.value / total) * C : 0;
    if (len <= 0) continue;
    const seg = el('circle', {
      cx: c, cy: c, r, fill: 'none', stroke: it.color, 'stroke-width': thickness,
      'stroke-dasharray': `${Math.max(len - gap, 0.1)} ${C}`, 'stroke-dashoffset': -acc,
      transform: `rotate(-90 ${c} ${c})`,
    }, svg);
    el('title', {}, seg).textContent = `${it.label}: ${fmt(it.value)}`;
    acc += len;
  }
  const t1 = el('text', { x: c, y: c - 2, 'text-anchor': 'middle', class: 'donut-big' }, svg); t1.textContent = center;
  const t2 = el('text', { x: c, y: c + 20, 'text-anchor': 'middle', class: 'donut-sub' }, svg); t2.textContent = sub;
  return svg;
}

// أعمدة (يومي/شهري)
export function bars(data, { height = 150, labelEvery = 1, highlight = -1, color = 'var(--accent)', limit = 0 } = {}) {
  const w = 340, padB = 22, padT = 16;
  const svg = el('svg', { viewBox: `0 0 ${w} ${height}`, class: 'bars', role: 'img' });
  const max = Math.max(...data.map((d) => d.value), limit * 1.1, 1);
  const bw = w / data.length;
  // خط المتوسط
  const avg = data.reduce((s, d) => s + d.value, 0) / (data.length || 1);
  if (limit > 0) {
    const y = height - padB - (limit / max) * (height - padB - padT);
    el('line', { x1: 0, x2: w, y1: y, y2: y, class: 'limit-line' }, svg);
  } else if (avg > 0) {
    const y = height - padB - (avg / max) * (height - padB - padT);
    el('line', { x1: 0, x2: w, y1: y, y2: y, class: 'avg-line' }, svg);
  }
  data.forEach((d, i) => {
    // RTL: أول عنصر على اليمين
    const x = w - (i + 1) * bw + bw * 0.18;
    const h = (d.value / max) * (height - padB - padT);
    const rect = el('rect', {
      x, y: height - padB - h, width: bw * 0.64, height: Math.max(h, d.value > 0 ? 2 : 0), rx: 3,
      fill: i === highlight ? 'var(--accent-strong)' : limit > 0 && d.value > limit ? 'var(--danger)' : color,
    }, svg);
    el('title', {}, rect).textContent = `${d.label}: ${fmt(d.value)}`;
    if (i % labelEvery === 0 || i === data.length - 1) {
      const t = el('text', { x: x + bw * 0.32, y: height - 6, 'text-anchor': 'middle', class: 'bar-label' }, svg);
      t.textContent = d.label;
    }
  });
  return svg;
}
