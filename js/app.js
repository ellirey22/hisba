import { CATEGORIES } from './categories.js';
import { splitBatch } from './parser.js';
import * as store from './store.js';
import { periodRange, inRange, totalsByCategory, dailySeries, monthlyTrend, topMerchants, detectSubscriptions, isExpense, sar } from './insights.js';
import { donut, bars, fmt } from './charts.js';
import * as budget from './budget.js';
import { svg, autoIconify } from './icons.js';
import { refreshRates } from './rates.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = (k) => CATEGORIES[k] || CATEGORIES.other;
// المبالغ تنعرض بدقّة: الكسور تظهر (2,500.5) والأرقام الصحيحة بدون أصفار (2,500)
const moneyFmt = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 2 });
const money = (n, d = 2) => `<span class="num m">${d === 0 ? moneyFmt.format(Math.round(n * 100) / 100) : fmt(n, d)}</span>`;
const CUR_AR = { SAR: 'ر.س', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' };
const curLabel = (c) => CUR_AR[c] || c;
const BASE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

const ui = { tab: 'home', period: 'cycle', offset: 0, card: 'all', q: '', catFilter: 'all', rTab: 'summary', rPeriod: 'month', rOffset: 0, openCat: null, acc: {}, allCats: false };

/** قسم ينفتح وينغلق: الرأس فيه أيقونة وعنوان وسطر ملخص */
function acc(key, { ico, tint, title, body }) {
  const open = !!ui.acc[key];
  return `<section class="acc ${open ? 'open' : ''}" data-acc="${key}"><button class="acc-h" aria-expanded="${open}">
    <span class="ic" ${tint ? `style="--tint:${tint}"` : ''}>${svg(ico, 'f')}</span>
    <span class="t"><b>${title}</b></span><span class="chev">${svg('caret-down', 'r')}</span></button>
    <div class="acc-b"><div><div class="acc-in">${body}</div></div></div></section>`;
}
view.addEventListener('click', (e) => {
  const h = e.target.closest('.acc-h'); if (!h) return;
  const a = h.parentElement; const open = a.classList.toggle('open');
  ui.acc[a.dataset.acc] = open; h.setAttribute('aria-expanded', open);
});
const closeAcc = (key) => { ui.acc[key] = false; view.querySelector(`[data-acc="${key}"]`)?.classList.remove('open'); };

const THEMES = { blue: { name: 'أزرق', c: '#0071e3' }, green: { name: 'أخضر', c: '#1f8f63' }, violet: { name: 'بنفسجي', c: '#6a5ae0' }, coral: { name: 'مرجاني', c: '#d9533a' }, graphite: { name: 'رمادي', c: '#48484a' } };
const MODES = { auto: 'تلقائي', light: 'فاتح', dark: 'داكن' };
function applyAppearance() {
  const { theme, mode, privacy } = store.getState().settings; const root = document.documentElement;
  root.classList.toggle('privacy', !!privacy); if (typeof maskInputs === 'function') maskInputs();
  const eye = document.getElementById('eye-btn'); if (eye) eye.innerHTML = svg(privacy ? 'eye-closed' : 'eye', 'r');
  root.dataset.theme = THEMES[theme] ? theme : 'blue';
  if (mode === 'light' || mode === 'dark') root.dataset.mode = mode; else delete root.dataset.mode;
  const dark = mode === 'dark' || (mode !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#theme-color').content = dark ? '#000000' : '#f5f5f7';
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyAppearance);
// iOS ما يطبّق text-security: نحوّل حقول الراتب إلى password وقت الإخفاء (ويرجع نص عند التعديل)
const SECRET_IN = '#b-savings, #b-daily';
function maskInputs() {
  const on = document.documentElement.classList.contains('privacy');
  document.querySelectorAll(SECRET_IN).forEach((i) => { i.autocomplete = 'off'; i.type = on && document.activeElement !== i ? 'password' : 'text'; });
}
document.addEventListener('focusin', (e) => { if (e.target.matches?.(SECRET_IN)) e.target.type = 'text'; });
document.addEventListener('focusout', (e) => { if (e.target.matches?.(SECRET_IN)) setTimeout(maskInputs, 0); });
new MutationObserver(maskInputs).observe(document.getElementById('view'), { childList: true, subtree: true });

const greeting = (d = new Date()) => { const h = d.getHours(); return h >= 4 && h < 12 ? 'صباح الخير' : h < 23 && h >= 12 ? 'مساء الخير' : 'ليلتك سعيدة'; };
const TAB_NAMES = { txs: 'العمليات', reports: 'التقارير', commits: 'الالتزامات', settings: 'الإعدادات' };
function updateHeader() {
  $('#topbar').classList.toggle('is-tab', ui.tab !== 'home');
  const name = (store.getState().settings.name || '').trim();
  if (ui.tab === 'home') { $('#greet-t').textContent = name ? `${greeting()}، ${name}` : greeting(); $('#greet-s').textContent = dateFmt.format(new Date()); }
  else { $('#greet-t').textContent = TAB_NAMES[ui.tab] || ''; $('#greet-s').textContent = ''; }
}

const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
const shortMonth = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'short' });
const timeFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dayShort = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { weekday: 'narrow' });
const fullFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });

// ---------------- خانات الأرقام: تقبل الأرقام العربية والإنجليزية ----------------
const toLatinDigits = (v) => String(v)
  .replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
  .replace(/[٫،,]/g, '.').replace(/[٬\s]/g, '');
document.addEventListener('input', (e) => {
  const el = e.target;
  if (!el.matches?.('[data-num]')) return;
  let v = toLatinDigits(el.value).replace(/[^\d.]/g, '');
  const i = v.indexOf('.');
  if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '');
  if (v !== el.value) el.value = v;
});

// ---------------- Toast & Sheet ----------------
let toastTimer;
$('#toast').addEventListener('click', (e) => { const b = e.target.closest('[data-edit-tx]'); if (b) { $('#toast').hidden = true; openTxSheet(b.dataset.editTx); } });
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.innerHTML = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

let closeTimer;
function openSheet(html, onMount) {
  const s = $('#sheet'), panel = $('.sheet-panel', s), bd = $('.sheet-backdrop', s);
  clearTimeout(closeTimer);
  s.classList.remove('closing'); panel.style.cssText = ''; bd.style.cssText = '';
  panel.innerHTML = html;
  s.hidden = false;
  panel.scrollTop = 0;
  enhanceSegs(panel);
  onMount?.(panel);
}
function closeSheet() {
  const s = $('#sheet');
  if (s.hidden || s.classList.contains('closing')) return;
  const panel = $('.sheet-panel', s), bd = $('.sheet-backdrop', s);
  s.classList.add('closing');
  panel.style.animation = 'none'; panel.style.transition = 'transform .32s cubic-bezier(.4,0,.8,.4)'; panel.style.transform = 'translateY(108%)';
  bd.style.animation = 'none'; bd.style.opacity = '0';
  closeTimer = setTimeout(() => { s.hidden = true; s.classList.remove('closing'); panel.style.cssText = ''; bd.style.cssText = ''; }, 330);
}
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

// سحب النافذة للأسفل لإغلاقها — ما نلمس شي إلا لما يبدأ السحب فعلاً (عشان ضغطات الأزرار تمر بسلاسة)
(() => {
  const panel = $('.sheet-panel');
  let y0 = null, dy = 0, t0 = 0, drag = false, zone = false;
  panel.addEventListener('touchstart', (e) => {
    zone = e.touches[0].clientY - panel.getBoundingClientRect().top < 60;
    y0 = e.touches[0].clientY; dy = 0; drag = false; t0 = Date.now();
  }, { passive: true });
  panel.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const d = e.touches[0].clientY - y0;
    if (!drag) { if (d > 8 && (zone || panel.scrollTop <= 0)) { drag = true; panel.style.transition = 'none'; panel.style.animation = 'none'; } else return; }
    dy = Math.max(d, 0); panel.style.transform = `translateY(${dy}px)`;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  const end = (cancel) => {
    if (!drag) { y0 = null; return; }
    const fast = dy / Math.max(Date.now() - t0, 1) > 0.6;
    if (!cancel && (dy > 110 || (fast && dy > 40))) closeSheet();
    else { panel.style.transition = 'transform .4s cubic-bezier(.34,1.45,.5,1)'; panel.style.transform = ''; setTimeout(() => { panel.style.transition = ''; panel.style.animation = ''; }, 420); }
    y0 = null; drag = false;
  };
  panel.addEventListener('touchend', () => end(false));
  panel.addEventListener('touchcancel', () => end(true));
})();

// ---------------- لمسات التصميم ----------------
// مفاتيح التبديل تنزلق: نحفظ آخر موضع ونتحرك منه للموضع الجديد
const segMemory = new Map();
function enhanceSegs(root = view) {
  root.querySelectorAll('.seg').forEach((seg, n) => {
    const active = seg.querySelector('button.active'); if (!active) return;
    seg.classList.add('js');
    let thumb = seg.querySelector('.thumb');
    if (!thumb) { thumb = document.createElement('i'); thumb.className = 'thumb'; seg.prepend(thumb); }
    const key = `${ui.tab}:${root === view ? n : 'sheet' + n}`;
    const place = (b) => { thumb.style.width = `${b.offsetWidth}px`; thumb.style.transform = `translateX(${b.offsetLeft - 2}px)`; };
    const prev = segMemory.get(key);
    if (prev && prev.el !== active.textContent) {
      thumb.style.transition = 'none'; thumb.style.width = `${prev.w}px`; thumb.style.transform = `translateX(${prev.x}px)`;
      void thumb.offsetWidth; thumb.style.transition = '';
    }
    requestAnimationFrame(() => place(active));
    segMemory.set(key, { el: active.textContent, x: active.offsetLeft - 2, w: active.offsetWidth });
  });
}

// الأرقام الكبيرة تعدّ من الصفر
function countUp(root = view) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.total > .num, .hc-amt > .num, .sum-amt > .num, .mini b .num, .hc-stats b .num').forEach((el) => {
    const raw = el.textContent.trim(); const target = parseFloat(raw.replace(/,/g, '').replace('−', '-'));
    if (!isFinite(target) || target === 0) return;
    const dec = (raw.split('.')[1] || '').length; const nf = new Intl.NumberFormat('ar-SA-u-nu-latn', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const t0 = performance.now(), dur = 900;
    const tick = (now) => {
      const k = Math.min((now - t0) / dur, 1), e = 1 - Math.pow(1 - k, 4);
      el.textContent = nf.format(target * e); if (k < 1) requestAnimationFrame(tick); else el.textContent = raw;
    };
    el.textContent = nf.format(0); requestAnimationFrame(tick);
  });
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = document.createElement('div'); box.className = 'confetti';
  const colors = ['#34c759', '#ff9500', '#007aff', '#ff2d55', '#af52de', '#ffcc00', '#18b9a5'];
  for (let i = 0; i < 46; i++) {
    const p = document.createElement('i');
    p.style.cssText = `left:${Math.random() * 100}%;background:${colors[i % colors.length]};animation-duration:${1.3 + Math.random() * 1.3}s;animation-delay:${Math.random() * .25}s;--dx:${(Math.random() - .5) * 160}px;--rot:${(Math.random() - .5) * 900}deg`;
    box.appendChild(p);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 3200);
}

// ---------------- الاستقبال من الاختصار ----------------
function ingestFromURL() {
  const p = new URLSearchParams(location.search);
  const sms = p.get('sms');
  if (sms == null) return;
  const res = store.addMessage(sms, { sender: p.get('from') || '', receivedAt: p.get('t') || undefined });
  history.replaceState(null, '', location.pathname);
  announce(res);
}

function tryBackup(text) {
  const b = store.inspectBackup(text);
  if (!b) return false;
  if (confirm(`استرجاع نسخة احتياطية فيها ${b.txs} عملية${b.debts ? ` و${b.debts} دين` : ''}؟ بتحل مكان البيانات الحالية.`)) {
    try { store.importJSON(text); toast('✅ تم استرجاع النسخة'); confetti(); } catch (e) { toast(esc(e.message)); }
  }
  return true;
}

function trySetup(text) {
  if (!/^\s*HISBA-SETUP:/.test(text || '')) return false;
  try {
    const r = store.applySetup(text);
    toast(`✅ تم الإعداد: ${r.added} محفظة جديدة${r.updated ? ` و${r.updated} تحدّثت` : ''}${r.budget ? '، وضبطت يوم الراتب وبداية الحسبة' : ''}`, 6000);
    ui.tab = 'commits'; syncTabs(); render(); confetti();
  } catch { toast('كود الإعداد غير صالح — انسخه كامل'); }
  return true;
}

function announce(res) {
  if (res.status === 'added') {
    ui.flashId = res.tx.id; setTimeout(() => { ui.flashId = null; }, 2500);
    const t = res.tx, c = cat(t.category);
    const cm = t.commitmentId && store.getState().commitments.find((x) => x.id === t.commitmentId);
    const iv = t.investmentId && store.getState().investments.find((x) => x.id === t.investmentId);
    if (iv && iv.variable && iv.cap > 0) {
      const c = capStatus(iv);
      toast(c.left < 0 ? `🚨 تجاوزت سقف «${esc(iv.name)}» الشهري (${money(iv.cap, 0)}) بـ <b>${money(-c.left, 0)} ر.س</b> — حوّلت هالدورة ${money(c.got, 0)}`
        : `🎲 تحويل «${esc(iv.name)}»: <b>${money(t.amount)}</b> — ${c.pct >= 80 ? '⚠️ ' : ''}باقي لك من السقف ${money(c.left, 0)} ر.س من ${money(iv.cap, 0)}، وحدك اليومي اتعدّل`, 7000);
    } else if (iv) toast(`📈 تحويل استثمار «${esc(iv.name)}»: <b>${money(t.amount)} ${curLabel(t.currency)}</b> — ما ينحسب صرف${iv.variable ? '، وحدك اليومي اتعدّل' : ''}`, 5000);
    else if (cm) toast(`📌 سداد التزام «${esc(cm.name)}»: <b>${money(t.amount)} ${curLabel(t.currency)}</b> — ما ينحسب من حدك اليومي`);
    else if (t.type === 'purchase' && (!t.merchant || t.categorySource === 'default')) {
      toast(`❓ انضافت <b>${money(t.amount)} ${curLabel(t.currency)}</b> بس ما عرفت وين — حدّد المكان والتصنيف`, 4500);
      setTimeout(() => openTxSheet(t.id), 450);
    } else toast(`${c.icon} انضافت: <b>${money(t.amount)} ${curLabel(t.currency)}</b> — ${esc(t.merchant || 'بدون اسم')} (${c.name}) <button class="tact" data-edit-tx="${t.id}">تعديل</button>`, 6000);
  } else if (res.status === 'duplicate') toast('هذي الرسالة مضافة من قبل 👌');
  else if (res.status === 'unparsed') { toast('ما فهمت الرسالة — عدّلها وأنا أحفظها'); const u = store.getState().unparsed[0]; if (u) setTimeout(() => openFixSheet(u), 350); }
  else toast('الرسالة مو عملية مالية (رمز تحقق أو عملية مرفوضة) — تم تجاهلها');
}

// ---------------- احتفالات «تم» ----------------
function celebrate(kind, { name = '', amount = 0, x, y, title = '' }) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  navigator.vibrate?.(kind === 'debt' ? [15, 40, 25] : 18);
  document.querySelector('.fx')?.remove();
  const fx = document.createElement('div'); fx.className = `fx fx-${kind}`;
  x = x ?? innerWidth / 2; y = y ?? innerHeight / 2;
  fx.style.setProperty('--x', x + 'px'); fx.style.setProperty('--y', y + 'px');
  const R = (a, b) => a + Math.random() * (b - a);
  let core = '', bits = '';
  if (kind === 'commit') {
    core = `<svg viewBox="0 0 100 100"><circle class="disc" cx="50" cy="50" r="44"/><path class="draw" d="M30 52 L45 66 L71 36"/></svg>`;
    const cols = ['#ff9f0a', '#ffd60a', '#ff453a', '#64d2ff', '#bf5af2', '#30d158'];
    for (let i = 0; i < 46; i++) bits += `<p style="left:${R(0, 100)}vw;top:-20px;background:${cols[i % 6]};animation-duration:${R(1.6, 3)}s;animation-delay:${R(0, .7)}s;--dx:${R(-60, 60)}px;--r:${R(200, 700)}deg"></p>`;
  } else if (kind === 'invest') {
    core = `<svg viewBox="0 0 100 100"><circle class="disc" cx="50" cy="50" r="44"/><path class="draw" d="M24 66 L40 50 L52 58 L74 32"/><path class="draw" style="animation-delay:.95s;stroke-dasharray:60;stroke-dashoffset:60" d="M60 32 H74 V46"/></svg>`;
    for (let i = 0; i < 26; i++) { const sz = R(10, 34); bits += `<p style="left:${R(2, 96)}vw;top:100vh;width:${sz}px;height:${sz}px;--dx:${R(-40, 40)}px;animation-duration:${R(1.8, 3.2)}s;animation-delay:${R(0, 1)}s"></p>`; }
  } else {
    core = `<svg viewBox="0 0 100 100"><circle class="disc" cx="50" cy="50" r="44"/></svg><div class="hs">${svg('handshake' in {} ? 'handshake' : 'check', 'f')}</div>`;
    for (let i = 0; i < 24; i++) { const a = R(0, Math.PI * 2), d = R(90, 190); bits += `<p style="--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d - 40}px;--r:${R(-300, 300)}deg;--d:${R(.25, .6)}s"></p>`; }
  }
  fx.innerHTML = `<span class="fx-ring"></span><span class="fx-ring r2"></span><span class="fx-ring r3"></span><div class="fx-core">${core}</div>${bits}
    <div class="fx-card"><span>${title}</span><b>${esc(name)}</b>${amount ? `<em>${money(amount, 0)}</em>` : ''}</div>`;
  document.body.appendChild(fx);
  const close = () => { fx.classList.add('out'); setTimeout(() => fx.remove(), 400); };
  fx.onclick = close; setTimeout(close, 2800);
}

// ---------------- التنقّل ----------------
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  ui.tab = b.dataset.tab;
  syncTabs();
  render(); scrollTo({ top: 0, behavior: 'smooth' });
}));
$('#paste-btn').innerHTML = svg('clipboard-text', 'r');
$('#eye-btn').addEventListener('click', () => {
  const on = !store.getState().settings.privacy;
  ui.skipRender = true; store.updateSettings({ privacy: on }); applyAppearance();
});
// ضغطة وحدة: يقرأ رسالة البنك المنسوخة ويضيفها على طول
$('#paste-btn').addEventListener('click', async () => {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* المستخدم رفض أو المتصفح ما يدعم */ }
  if (tryBackup(text) || trySetup(text)) return;
  const items = splitBatch(text || '');
  if (!items.length) return toast('انسخ رسالة البنك أولاً ثم اضغط هنا');
  if (items.length === 1) announce(store.addMessage(items[0].text, items[0]));
  else importReport(store.addMany(items));
});
store.subscribe(() => render());

function visibleTxs() {
  const s = store.getState();
  const hiddenCards = new Set(Object.entries(s.cards).filter(([, v]) => v.hidden).map(([k]) => k));
  return s.txs.filter((t) => !hiddenCards.has(`${t.bank}|${t.card}`) && (ui.card === 'all' || `${t.bank}|${t.card}` === ui.card));
}

function cardName(bank, card) {
  const c = store.getState().cards[`${bank}|${card}`];
  if (c?.nickname) return c.nickname;
  return card ? `${bank} •${card}` : bank;
}

let lastSig = '';
function render() {
  if (ui.skipRender) { ui.skipRender = false; return; }
  applyAppearance(); updateHeader();
  // حركة الدخول تشتغل بس لما تتغير الشاشة (مو مع كل تعديل بسيط)
  const sig = `${ui.tab}|${ui.rTab}|${ui.period}|${ui.offset}|${ui.rOffset}`;
  const entering = sig !== lastSig; lastSig = sig;
  view.classList.toggle('enter', entering);
  ({ home: renderHome, txs: renderTxs, reports: renderReports, commits: renderCommitments, settings: renderSettings })[ui.tab]();
  enhanceSegs(view);
  if (entering) countUp(view);
}

// ---------------- الملخص ----------------
const dayOnly = (d) => { const x = new Date(d); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
function relDay(d) {
  const diff = Math.round((dayOnly(d) - dayOnly(new Date())) / 864e5);
  if (diff === 0) return 'اليوم'; if (diff === -1) return 'أمس'; if (diff === 1) return 'بكرة';
  if (diff === 2) return 'بعد يومين'; if (diff > 2 && diff <= 10) return `بعد ${diff} أيام`;
  return dayFmt.format(new Date(d)).replace(/\s*\d{4}$/, '').replace(/،$/, '');
}

function renderHome() {
  const s = store.getState();
  const rates = s.settings.rates;
  const all = visibleTxs();
  if (!s.txs.length && !(s.settings.budget.salary > 0)) {
    view.innerHTML = `<div class="empty"><div class="big">🧮</div><h2>جاهز نبدأ؟</h2>
      <p>انسخ أي رسالة من البنك واضغط أيقونة اللصق فوق، وأنا أصنّفها وأحسب لك كل شي.</p></div>`;
    return;
  }
  const B = s.settings.budget;
  const hasBudget = B.salary > 0;
  const range = hasBudget ? budget.cycleFor(new Date(), B.payday || 27) : periodRange('month', 0);
  const txs = inRange(all, range);
  const cats = totalsByCategory(txs, rates);
  const catTotal = cats.reduce((a, c) => a + c.total, 0);
  const shown = ui.allCats ? cats : cats.slice(0, 4);
  const countOf = (k) => txs.filter((t) => isExpense(t) && t.category === k).length;
  const recent = all.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 4);
  const rangeLabel = `${range.start.getDate()} ${shortMonth.format(range.start)} – ${new Date(range.end - 1).getDate()} ${shortMonth.format(new Date(range.end - 1))}`;

  view.innerHTML = `
    ${todayCard()}
    ${cycleCard(all)}
    ${cats.length ? `<div class="card"><div class="h2row"><h2>وين راحت فلوسك</h2><span class="small">${rangeLabel}</span></div>
      <div class="stack">${cats.map((c) => `<span style="flex:${c.total} 1 0;background:${cat(c.category).color}"></span>`).join('')}</div>
      <ul class="list">${shown.map((c) => `<li class="row" data-cat="${c.category}"><div class="ic" style="--tint:${cat(c.category).color}">${cat(c.category).icon}</div>
        <div class="main"><div class="title">${cat(c.category).name}</div><div class="meta"><span class="num">${fmt((c.total / catTotal) * 100)}%</span> · ${countOf(c.category)} عمليات</div></div>
        <div class="amt">${money(c.total, 0)}</div></li>`).join('')}</ul>
      ${cats.length > 4 ? `<button class="card-link" id="more-cats">${ui.allCats ? 'عرض أقل' : `عرض الكل (${cats.length})`}</button>` : ''}</div>` : ''}
    ${recent.length ? `<div class="card"><div class="h2row"><h2>آخر العمليات</h2></div>
      <ul class="list">${recent.map((t) => txRow(t, { rel: true })).join('')}</ul>
      <button class="card-link" id="all-tx">كل العمليات</button></div>` : ''}
    ${upcomingCard()}`;

  $('#go-budget')?.addEventListener('click', () => { ui.tab = 'settings'; ui.acc.budget = true; syncTabs(); render(); scrollTo({ top: 0 }); });
  $('#more-cats')?.addEventListener('click', () => { ui.allCats = !ui.allCats; render(); });
  $('#all-tx')?.addEventListener('click', () => { ui.tab = 'txs'; ui.catFilter = 'all'; syncTabs(); render(); scrollTo({ top: 0 }); });
  view.querySelectorAll('[data-go]').forEach((x) => x.onclick = () => { ui.tab = x.dataset.go; syncTabs(); render(); scrollTo({ top: 0 }); });
  view.querySelectorAll('.row[data-cat]').forEach((li) => li.onclick = () => { ui.catFilter = li.dataset.cat; ui.tab = 'txs'; syncTabs(); render(); scrollTo({ top: 0 }); });
  view.querySelectorAll('.row[data-id]').forEach((r) => r.onclick = () => openTxSheet(r.dataset.id));
  $('#today-bar')?.addEventListener('click', () => { ui.tab = 'reports'; ui.rTab = 'summary'; ui.rOffset = 0; syncTabs(); render(); scrollTo({ top: 0 }); });
}

/** بطاقة الدورة: كم صرفت من المتاح، ووين أنت من الوقت، ومقارنة بالدورة اللي قبل بنفس النقطة */
function cycleCard(all) {
  const s = store.getState();
  const rates = s.settings.rates;
  if (!(s.settings.budget.salary > 0)) {
    const r0 = periodRange('month', 0), r1 = periodRange('month', -1);
    const sp = inRange(all, r0).filter(isExpense).reduce((a, t) => a + sar(t, rates), 0);
    const day = new Date().getDate();
    const pv = all.filter((t) => isExpense(t) && new Date(t.date) >= r1.start && new Date(t.date) < new Date(r1.start.getTime() + day * 864e5)).reduce((a, t) => a + sar(t, rates), 0);
    const d = pv ? ((sp - pv) / pv) * 100 : null;
    return `<div class="card"><div class="cyc-top"><h2>${monthFmt.format(r0.start)}</h2></div><div class="cyc-amt">${money(sp, 0)} <small>ر.س</small></div>
      ${d != null ? `<div class="insight ${d > 3 ? 'bad' : d < -3 ? 'good' : ''}">${d > 3 ? `أكثر بـ ${fmt(d)}% من الشهر اللي قبل بنفس الوقت` : d < -3 ? `أقل بـ ${fmt(-d)}% من الشهر اللي قبل بنفس الوقت` : 'نفس مستوى الشهر اللي قبل'}</div>` : ''}</div>`;
  }
  const r = budget.today(s, all);
  if (!r || r.pending) return '';
  const p = r.plan;
  const spent = r.dailySpent + r.monthlySpent;
  const avail = Math.max(p.forDaily, 1);
  const pct = (spent / avail) * 100;
  const pctTime = ((r.idx + 1) / p.days) * 100;
  const prev = budget.cycleFor(new Date(), s.settings.budget.payday || 27, -1);
  const cut = new Date(prev.start.getTime() + (r.idx + 1) * 864e5);
  const pv = budget.tracked(s, all).filter((t) => budget.counts(t) && budget.bucketOf(t, s) !== 'commitment' && new Date(t.date) >= prev.start && new Date(t.date) < cut).reduce((a, t) => a + sar(t, rates), 0);
  const d = pv ? ((spent - pv) / pv) * 100 : null;
  let ins;
  if (d != null && Math.abs(d) > 3) ins = { cls: d > 0 ? 'bad' : 'good', ico: d > 0 ? '🔥' : '✅', text: d > 0 ? `أكثر بـ ${fmt(d)}% من الدورة اللي قبل بنفس الوقت` : `أقل بـ ${fmt(-d)}% من الدورة اللي قبل بنفس الوقت` };
  else if (pct > pctTime + 8) ins = { cls: 'bad', ico: '⚠️', text: 'صرفك أسرع من وقت الدورة — خفّف شوي' };
  else ins = { cls: 'good', ico: '✅', text: 'ماشي على الخطة' };
  return `<div class="card"><div class="cyc-top"><h2>دورة ${monthName(p.key)}</h2><span class="pill">اليوم ${r.idx + 1} من ${p.days}</span></div>
    <div class="cyc-amt">${money(spent, 0)} <small>من ${money(avail, 0)} ر.س</small></div>
    <div class="cbar"><span class="${pct > 100 ? 'over' : ''}" style="width:${Math.min(pct, 100)}%"></span><i style="inset-inline-start:${Math.min(pctTime, 100)}%"></i></div>
    <div class="cyc-legend"><span>صرفت <span class="num">${fmt(pct)}%</span></span><span>مرّ <span class="num">${fmt(pctTime)}%</span> من الدورة</span></div>
    <div class="insight ${ins.cls}">${ins.ico} ${ins.text}</div></div>`;
}

/** الجاي: الراتب والالتزامات والتحويلات اللي باقية في الدورة */
function upcomingCard() {
  const s = store.getState();
  const B = s.settings.budget;
  const items = [];
  if (B.salary > 0) items.push({ ico: '💰', tint: 'var(--green)', title: 'الراتب', date: budget.cycleFor(new Date(), B.payday || 27, 1).start, amount: B.salary, income: true });
  const cyc = B.salary > 0 ? budget.cycleFor(new Date(), B.payday || 27) : periodRange('month', 0);
  for (const c of s.commitments) {
    const st = budget.commitmentStatus(c);
    if (!st.active || !st.next) continue;
    const paid = budget.commitmentDone(c, budget.cycleKey(cyc), s.txs, s.commitments, cyc);
    if (!paid && (st.next - new Date()) / 864e5 > 20) continue;
    items.push({ ico: budget.commitIcon(c), tint: budget.commitTint(c), title: c.name, date: st.next, amount: c.amount, paid });
  }
  const invs = s.investments || [];
  const done = budget.investedInRange(invs, s.txs, cyc, s.settings.rates);
  const key = budget.cycleKey(cyc);
  for (const i of invs) { const amt = budget.investAmount(i, key); if (!i.variable && amt) { const paid = budget.investmentDone(i, key, done[i.id] || 0); items.push({ ico: '📈', tint: 'var(--blue)', title: i.name, date: null, amount: paid ? amt : amt - (done[i.id] || 0), paid }); } }
  if (!items.length) return '';
  items.sort((a, b) => (a.paid ? 1 : 0) - (b.paid ? 1 : 0) || (a.date || Infinity) - (b.date || Infinity));
  return `<div class="card"><div class="h2row"><h2>الجاي</h2></div><ul class="list">${items.slice(0, 8).map((x) => `<li class="row ${x.paid ? 'paid' : ''}" data-go="${x.income ? 'settings' : 'commits'}">
    <div class="ic" style="--tint:${x.tint}">${x.ico}</div><div class="main"><div class="title">${esc(x.title)}</div><div class="meta">${x.paid ? 'تم السداد ✅' : x.date ? relDay(x.date) : 'هالدورة'}</div></div>
    <div class="amt ${x.income ? 'income' : ''}">${x.income ? '+' : ''}${money(x.amount, 0)}</div></li>`).join('')}</ul></div>`;
}

function syncTabs() {
  const btns = [...document.querySelectorAll('.tabbar button')];
  btns.forEach((x) => x.classList.toggle('active', x.dataset.tab === ui.tab));
  document.body.dataset.tab = ui.tab;
  $('#tabbar').style.setProperty('--i', Math.max(btns.findIndex((x) => x.dataset.tab === ui.tab), 0));
}

// ---------------- العمليات ----------------
function txRow(t, opt = {}) {
  const c = cat(t.category);
  const sign = t.type === 'income' ? '+' : '';
  const meta = (opt.rel ? [`${relDay(t.date)} ${timeFmt.format(new Date(t.date))}`, c.name] : [timeFmt.format(new Date(t.date)), cardName(t.bank, t.card), c.name]).filter(Boolean).join(' · ');
  const bk = budget.counts(t) && store.getState().settings.budget.salary > 0 ? budget.bucketOf(t, store.getState()) : 'daily';
  return `<li class="row ${t.excluded ? 'excluded' : ''} ${ui.flashId === t.id ? 'flash' : ''}" data-id="${t.id}">
    <div class="ic" style="--tint:${c.color}">${c.icon}</div>
    <div class="main"><div class="title">${esc(t.merchant || typeLabel(t.type))}${t.confidence === 'low' ? '<span class="badge warn">راجعها</span>' : ''}${bk !== 'daily' ? `<span class="badge">${BUCKETS[bk].short}</span>` : ''}${t.excluded ? '<span class="badge">مستبعدة</span>' : ''}${t.investmentId ? '<span class="badge">📈 استثمار</span>' : ''}${t.debtId ? '<span class="badge">🤝 تسليف</span>' : ''}</div>
    <div class="meta">${esc(meta)}</div></div>
    <div class="amt ${t.type === 'income' ? 'income' : ''}">${sign}${money(t.amount)} <span class="small muted">${curLabel(t.currency)}</span></div></li>`;
}
const BUCKETS = {
  daily: { name: 'من الحد اليومي', short: 'يومي', icon: '☀️' },
  monthly: { name: 'من ميزانية الشهر', short: 'شهري', icon: '🗓️' },
  commitment: { name: 'سداد التزام', short: 'التزام', icon: '📌' },
};
const typeLabel = (t) => ({ purchase: 'شراء', income: 'إيداع / استرداد', transfer: 'حوالة', withdrawal: 'سحب نقدي', bill: 'سداد فاتورة' }[t] || 'عملية');

function renderTxs() {
  const s = store.getState();
  let txs = visibleTxs().slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (ui.catFilter !== 'all') txs = txs.filter((t) => t.category === ui.catFilter);
  if (ui.q) { const q = ui.q.toLowerCase(); txs = txs.filter((t) => `${t.merchant} ${t.amount} ${t.bank} ${cat(t.category).name}`.toLowerCase().includes(q)); }

  const groups = [];
  for (const t of txs.slice(0, 400)) {
    const k = new Date(t.date).toDateString();
    if (groups.at(-1)?.k !== k) groups.push({ k, d: new Date(t.date), items: [] });
    groups.at(-1).items.push(t);
  }
  view.innerHTML = `
    <div class="toolbar"><input type="search" id="q" placeholder="ابحث…" value="${esc(ui.q)}">
      <select id="cat-f"><option value="all">كل التصنيفات</option>${Object.entries(CATEGORIES).map(([k, c]) =>
        `<option value="${k}" ${ui.catFilter === k ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></div>
    ${s.unparsed.length ? `<div class="card small" id="unparsed-note">⚠️ فيه <b>${s.unparsed.length}</b> رسالة ما قدرت أقراها — <a href="#" id="go-unparsed">راجعها</a></div>` : ''}
    ${groups.length ? groups.map((g, gi) => {
      const dayTotal = g.items.filter(isExpense).reduce((a, t) => a + sar(t, s.settings.rates), 0);
      const key = `day:${g.k}`;
      const open = ui.q || ui.catFilter !== 'all' ? true : ui.acc[key] ?? gi === 0;
      return `<section class="acc day-acc ${open ? 'open' : ''}" data-acc="${key}"><button class="acc-h" aria-expanded="${open}">
        <span class="t"><b>${dateFmt.format(g.d)}</b><span>${g.items.length} عملية</span></span>
        <span class="day-sum">${money(dayTotal, 0)} ر.س</span><span class="chev">${svg('caret-down', 'r')}</span></button>
        <div class="acc-b"><div><div class="acc-in"><ul class="list">${g.items.map(txRow).join('')}</ul></div></div></div></section>`;
    }).join('') : '<div class="empty"><div class="big">🔍</div>ما فيه عمليات</div>'}`;

  const q = $('#q');
  q.oninput = () => { ui.q = q.value; const pos = q.selectionStart; render(); const n = $('#q'); n.focus(); n.setSelectionRange(pos, pos); };
  $('#cat-f').onchange = (e) => { ui.catFilter = e.target.value; render(); };
  $('#go-unparsed')?.addEventListener('click', (e) => { e.preventDefault(); ui.tab = 'settings'; syncTabs(); render(); $('#unparsed')?.scrollIntoView(); });
  view.querySelectorAll('.row[data-id]').forEach((r) => r.onclick = () => openTxSheet(r.dataset.id));
}

function openTxSheet(id) {
  const t = store.getState().txs.find((x) => x.id === id);
  if (!t) return;
  let chosen = t.category;
  const st = store.getState();
  const hasBudget = st.settings.budget.salary > 0;
  const curBucket = budget.bucketOf(t, st);
  let chosenBucket = curBucket;
  openSheet(`
    <h3>${esc(t.merchant || typeLabel(t.type))}</h3>
    <p class="muted small">${esc(fullFmt.format(new Date(t.date)))} · ${esc(cardName(t.bank, t.card))} · ${typeLabel(t.type)}</p>
    <label class="field">التصنيف</label>
    <div class="chips" id="cat-chips">${Object.entries(CATEGORIES).map(([k, c]) =>
      `<button class="chip ${k === t.category ? 'active' : ''}" data-k="${k}">${c.icon} ${c.name}</button>`).join('')}</div>
    <label class="switch"><input type="checkbox" id="apply-all" checked> طبّق على كل عمليات «${esc(t.merchant || '—')}» وتعلّمها للمستقبل</label>
    ${hasBudget && budget.counts(t) ? `<label class="field">تنحسب من</label>
    <div class="chips" id="bk-chips">${Object.entries(BUCKETS).map(([k, b]) =>
      `<button class="chip ${k === curBucket ? 'active' : ''}" data-b="${k}">${b.icon} ${b.name}</button>`).join('')}</div>
    <label class="switch"><input type="checkbox" id="bk-remember" checked> تذكّر هذا الاختيار لـ«${esc(t.merchant || '—')}»</label>
    <div id="cm-wrap" hidden><label class="field">أي التزام؟
      <select id="e-commit"><option value="">— غير مربوطة —</option>${st.commitments.filter((x) => x.id !== t.commitmentId).map((x) => `<option value="c:${x.id}">${budget.commitIcon(x)} ${esc(x.name)}</option>`).join('')}<option value="new">➕ التزام جديد (تابي، تمارا، قرض…)</option></select></label>
      <div id="nc-wrap" hidden>
        <label class="field">نوع الالتزام<select id="nc-kind">${['installment', 'loan', 'subscription', 'other'].map((k) => `<option value="${k}" ${k === (/tabby|تابي|tamara|تمارا/i.test(t.merchant || '') ? 'installment' : 'installment') ? 'selected' : ''}>${budget.COMMITMENT_KINDS[k].icon} ${budget.COMMITMENT_KINDS[k].name}</option>`).join('')}</select></label>
        <div id="nc-fin"><label class="field">الجهة<select id="nc-prov">${['', 'تابي', 'تمارا', 'بنك', 'أخرى'].map((x) => `<option value="${x}" ${x === (/tabby|تابي/i.test(t.merchant || '') ? 'تابي' : /tamara|تمارا/i.test(t.merchant || '') ? 'تمارا' : '') ? 'selected' : ''}>${x || '—'}</option>`).join('')}</select></label>
        <label class="field">كم دفعة باقية بعد هذي الدفعة؟ <span class="small">(اكتب 0 لو هذي آخر دفعة)</span><input type="text" data-num inputmode="numeric" id="nc-left" value="0"></label></div>
      </div></div>` : ''}
    <label class="field">اسم التاجر<input type="text" id="e-merchant" value="${esc(t.merchant)}"></label>
    <label class="field">المبلغ (${curLabel(t.currency)})<input type="text" data-num step="0.01" inputmode="decimal" id="e-amount" value="${t.amount}"></label>
    <label class="field">النوع<select id="e-type">${['purchase', 'bill', 'transfer', 'withdrawal', 'income'].map((k) =>
      `<option value="${k}" ${t.type === k ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select></label>
    <label class="switch"><input type="checkbox" id="e-excl" ${t.excluded ? 'checked' : ''}> استبعدها من الإحصائيات (مثلاً تحويل بين حساباتك)</label>
    ${t.type !== 'purchase' || t.merchant ? `<label class="field">🤝 تسليف / سداد دين
      <select id="e-debt"><option value="">— بدون —</option>
        ${t.debtId ? '<option value="unlink">فك الربط بالدين</option>' : ''}
        ${st.debts.filter((x) => budget.debtRemaining(x) > 0.004 && x.id !== t.debtId).map((x) => `<option value="d:${x.id}">${x.direction === 'lent' ? 'سداد من' : 'سداد لـ'} ${esc(x.person)} (متبقي ${fmt(budget.debtRemaining(x), 0)})</option>`).join('')}
        ${!t.debtId ? '<option value="new:lent">📤 هذي تسليف جديد</option><option value="new:borrowed">📥 هذي استلاف جديد</option>' : ''}</select></label>` : ''}
    ${t.commitmentId || t.investmentId ? `<button class="btn block" id="e-unlink" style="margin-top:0">فك ربطها بـ«${esc((t.investmentId ? st.investments.find((x) => x.id === t.investmentId) : st.commitments.find((x) => x.id === t.commitmentId))?.name || '—')}»</button>` : ''}
    ${t.raw ? `<details><summary class="small">نص الرسالة الأصلي</summary><div class="raw" dir="auto">${esc(t.raw)}</div></details>` : ''}
    <button class="btn primary block" id="save">حفظ</button>
    <button class="btn danger block" id="del">حذف العملية</button>`, (p) => {
    p.querySelectorAll('#cat-chips .chip').forEach((b) => b.onclick = () => {
      chosen = b.dataset.k; p.querySelectorAll('#cat-chips .chip').forEach((x) => x.classList.toggle('active', x === b));
    });
    p.querySelectorAll('#bk-chips .chip').forEach((b) => b.onclick = () => {
      chosenBucket = b.dataset.b; p.querySelectorAll('#bk-chips .chip').forEach((x) => x.classList.toggle('active', x === b));
      if ($('#cm-wrap', p)) $('#cm-wrap', p).hidden = chosenBucket !== 'commitment' || !!t.commitmentId;
    });
    const ncSync = () => { const nw = $('#nc-wrap', p); if (!nw) return; nw.hidden = $('#e-commit', p).value !== 'new'; $('#nc-fin', p).hidden = !['installment', 'loan'].includes($('#nc-kind', p).value); };
    $('#e-commit', p)?.addEventListener('change', ncSync); $('#nc-kind', p)?.addEventListener('change', ncSync); ncSync();
    if ($('#cm-wrap', p)) $('#cm-wrap', p).hidden = chosenBucket !== 'commitment' || !!t.commitmentId;
    $('#save', p).onclick = () => {
      const amount = parseFloat($('#e-amount', p).value);
      store.updateTx(id, {
        merchant: $('#e-merchant', p).value.trim(), type: $('#e-type', p).value,
        amount: isFinite(amount) && amount > 0 ? amount : t.amount, excluded: $('#e-excl', p).checked, confidence: 'high',
      });
      if (chosen !== t.category || $('#apply-all', p).checked && t.categorySource !== 'manual') {
        const n = store.setCategory(id, chosen, $('#apply-all', p).checked);
        if (n > 1) toast(`✅ تعلّمت! عدّلت ${n} عمليات لـ«${cat(chosen).name}»`);
      }
      const dv = $('#e-debt', p)?.value;
      if (dv === 'unlink') store.unlinkTxDebt(id);
      else if (dv?.startsWith('d:')) {
        const debt = store.getState().debts.find((x) => x.id === dv.slice(2));
        const isIncome = ($('#e-type', p).value) === 'income';
        const role = (debt.direction === 'lent') === isIncome ? 'payment' : (debt.principalTxId ? null : 'principal');
        if (role) { store.attachDebtTx(debt.id, id, role); toast(`✅ انربطت بدين «${esc(debt.person)}»`); } else toast('هذي العملية ما تناسب هذا الدين');
      } else if (dv?.startsWith('new:')) {
        closeSheet();
        const cur = store.getState().txs.find((x) => x.id === id);
        return openDebtSheet({ direction: dv.slice(4), amount: cur.amount, date: cur.date, person: cur.merchant && !/^\d+$/.test(cur.merchant) ? cur.merchant : '', txId: id });
      }
      if (chosenBucket !== curBucket) {
        const n = store.setBucket(id, chosenBucket, $('#bk-remember', p)?.checked);
        if (n > 1) toast(`✅ عمليات «${esc(t.merchant)}» صارت تنحسب ${BUCKETS[chosenBucket].name}`);
      }
      const cv = chosenBucket === 'commitment' ? $('#e-commit', p)?.value : '';
      if (cv?.startsWith('c:')) { store.linkTxCommitment(id, cv.slice(2)); toast('✅ انربطت بالالتزام'); }
      if (cv === 'new') {
        const cur = store.getState().txs.find((x) => x.id === id);
        const kind = $('#nc-kind', p).value, finite = ['installment', 'loan'].includes(kind);
        const c = store.saveCommitment({ kind, name: cur.merchant || 'التزام', amount: cur.amount, day: new Date(cur.date).getDate(), keyword: cur.merchant || '', approx: false,
          provider: finite ? $('#nc-prov', p).value : '', total: finite ? 1 + (parseInt($('#nc-left', p).value, 10) || 0) : 0, startDate: finite ? new Date(cur.date).toISOString().slice(0, 10) : '' });
        store.linkTxCommitment(id, c.id); toast(finite && c.total > 1 ? `✅ انحفظ الالتزام — باقي ${c.total - 1} دفعات` : '✅ انحفظ الالتزام وانربطت الدفعة فيه');
      }
      closeSheet();
    };
    $('#e-unlink', p)?.addEventListener('click', () => { store.unlinkTx(id); closeSheet(); toast('✅ انفكّ الربط، والعملية رجعت تنحسب كصرف عادي'); });
    $('#del', p).onclick = () => { if (confirm('تحذف العملية؟')) { store.deleteTx(id); closeSheet(); } };
  });
}

// ---------------- تعديل رسالة ما انفهمت ----------------
function openFixSheet(u) {
  const num = (u.text.match(/\d+(?:[.,]\d+)?/) || [''])[0].replace(',', '.');
  openSheet(`
    <h3>ما فهمت هالرسالة</h3>
    <div class="raw" dir="auto">${esc(u.text)}</div>
    <label class="field">المبلغ (ر.س)<input type="text" data-num inputmode="decimal" id="f-amount" value="${num}"></label>
    <label class="field">المكان / التاجر<input type="text" id="f-merchant"></label>
    <label class="field">التصنيف<select id="f-cat"><option value="">تلقائي</option>${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.icon} ${c.name}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn primary" id="f-save">حفظ</button><button class="btn danger" id="f-del">تجاهل الرسالة</button></div>`, (p) => {
    $('#f-save', p).onclick = () => {
      const amount = parseFloat($('#f-amount', p).value);
      if (!(amount > 0)) return toast('اكتب المبلغ');
      const tx = store.addManual({ amount, merchant: $('#f-merchant', p).value.trim(), date: u.date, raw: u.text, bank: u.sender || 'يدوي',
        ...($('#f-cat', p).value ? { category: $('#f-cat', p).value, categorySource: 'manual' } : {}) });
      store.removeUnparsed(u.id); closeSheet(); announce({ status: 'added', tx });
    };
    $('#f-del', p).onclick = () => { store.removeUnparsed(u.id); closeSheet(); };
  });
}

function importReport(c) {
  toast(`✅ انضافت ${c.added} · مكررة ${c.duplicate} · متجاهلة ${c.ignored}${c.unparsed ? ` · ما انقرأت ${c.unparsed}` : ''}`, 5000);
}

// ---------------- بطاقة اليوم (الحد اليومي) ----------------
const startsIn = (n) => (n <= 0 ? 'تبدأ اليوم' : n === 1 ? 'تبدأ بكرة' : n === 2 ? 'تبدأ بعد يومين' : `تبدأ بعد ${n} ${n <= 10 ? 'أيام' : 'يوم'}`);
function todayCard() {
  const s = store.getState();
  if (!(s.settings.budget.salary > 0)) {
    return `<div class="card budget-cta"><b>ابدأ بإضافة راتبك</b><p class="small muted">وأحسب لك حدك اليومي تلقائياً.</p>
      <button class="btn primary block" id="go-budget">إضافة الراتب</button></div>`;
  }
  const r = budget.today(s, visibleTxs());
  if (r.pending) {
    const p = r.plan;
    return `<div class="card hero-card"><div class="hc-label">حدك اليومي</div>
      <div class="hc-amt">${money(p.daily, 0)} <small>ر.س</small></div><span class="hc-pill">${startsIn(r.daysToStart)}</span>
      <div class="hc-stats"><div><b>${p.days}</b><span>يوم في الدورة</span></div><div><b>${money(p.commitmentsPlanned, 0)}</b><span>التزامات</span></div><div><b>${money(p.investmentsPlanned, 0)}</b><span>استثمار</span></div></div></div>`;
  }
  const p = r.plan;
  const pct = Math.min(Math.max(r.spentToday / Math.max(r.allowance, 1), 0), 1) * 100;
  const daysToSalary = p.days - r.idx;
  // آخر ٧ أيام من الحد اليومي
  const week = [];
  for (let k = 6; k >= 0; k--) {
    const i = r.idx - k;
    week.push({ v: i >= 0 ? r.perDay[i] : 0, d: new Date(p.start.getTime() + i * 864e5), today: k === 0 });
  }
  const max = Math.max(...week.map((w) => w.v), p.daily * 1.2, 1);
  const capAlerts = (s.investments || []).filter((i) => i.variable && i.cap > 0).map((i) => { const c = capStatus(i);
    return c.pct >= 80 ? `<div class="alert">${c.left < 0 ? `🚨 تجاوزت سقف «${esc(i.name)}» بـ ${money(-c.left, 0)} ر.س` : `⚠️ «${esc(i.name)}»: باقي ${money(c.left, 0)} من سقف ${money(c.cap, 0)}`}</div>` : ''; }).join('');
  const od = budget.debtSummary(s.debts).overdue;
  return `<div class="card hero-card ${r.remainingToday < 0 ? 'neg' : ''}" id="today-bar">
    <div class="hc-top"><div><div class="hc-label">${r.remainingToday < 0 ? 'تجاوزت حدك اليوم' : 'باقي لك اليوم'}</div>
      <div class="hc-amt">${money(Math.abs(r.remainingToday), 0)} <small>ر.س</small></div></div>
      <div class="ring" style="--p:${pct}"><span class="num">${fmt(pct)}%</span></div></div>
    <div class="hc-meta" style="margin-top:6px"><span>صرفت ${money(r.spentToday, 0)}</span>
      <span>الحد ${money(p.daily, 0)}${p.rollover && Math.abs(r.carry) >= 1 ? ` ${r.carry > 0 ? '+' : '−'} ${money(Math.abs(r.carry), 0)} مرحّل` : ''}</span></div>
    ${capAlerts}
    ${od.length ? `<div class="alert">🤝 ${od.length === 1 ? 'دين متأخر' : `${od.length} ديون متأخرة`}: ${od.map((d) => esc(d.person)).join('، ')}</div>` : ''}
    <div class="wk">${week.map((w, k) => `<i style="height:${Math.max((w.v / max) * 100, 4)}%;--i:${k}" class="${w.today ? 'on' : ''} ${w.v > p.daily ? 'over' : ''}"></i>`).join('')}
      <span class="wk-line" style="bottom:${(p.daily / max) * 100}%"></span></div>
    <div class="wk-l">${week.map((w) => `<span class="${w.today ? 'on' : ''}">${w.today ? 'اليوم' : dayShort.format(w.d)}</span>`).join('')}</div>
    <div class="hc-stats"><div><b>${daysToSalary}</b><span>يوم للراتب</span></div><div><b>${money(r.dailyLeft, 0)}</b><span>متبقي من الدورة</span></div>
      <div><b>${money(r.suggestedDaily, 0)}</b><span>حدك الواقعي</span></div></div></div>`;
}

// ---------------- التقارير ----------------
function maybeArchive() {
  const s = store.getState();
  const b = s.settings.budget;
  if (!(b.salary > 0)) return;
  const prev = budget.cycleFor(new Date(), b.payday || 27, -1);
  const p = budget.plan(s);
  const st = budget.startOf(s);
  if (st && prev.start < st) return;
  if (p && s.txs.some((t) => new Date(t.date) >= prev.start && new Date(t.date) < prev.end)) {
    store.archiveCycle({ start: prev.start.toISOString(), end: prev.end.toISOString(), salary: p.salary, daily: p.daily, commitments: p.commitments });
  }
}

function renderReports() {
  const s = store.getState();
  const b = s.settings.budget;
  const all = visibleTxs();
  const payday = b.payday || 27;
  const hasBudget = b.salary > 0;
  const st0 = hasBudget ? budget.startOf(s) : null;
  const ref = st0 && new Date() < st0 ? st0 : new Date();
  const per = ui.rPeriod || 'month';
  const mid = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  let range, canPrev;
  if (per === 'week') {
    const start = mid(ref); start.setDate(start.getDate() - start.getDay() + ui.rOffset * 7);
    const end = new Date(start); end.setDate(end.getDate() + 7);
    range = { start, end }; canPrev = !st0 || start > st0;
  } else if (per === 'year') {
    range = { start: new Date(ref.getFullYear() + ui.rOffset, 0, 1), end: new Date(ref.getFullYear() + ui.rOffset + 1, 0, 1) };
    canPrev = !st0 || range.start > st0;
  } else {
    range = hasBudget ? budget.cycleFor(ref, payday, ui.rOffset) : periodRange('month', ui.rOffset);
    canPrev = !hasBudget || !st0 || budget.cycleFor(ref, payday, ui.rOffset - 1).end > st0;
    if (!canPrev && ui.rOffset < 0 && range.end <= st0) ui.rOffset++;
  }
  const snap = per === 'month' ? s.archive.find((a) => a.start === range.start.toISOString()) : null;
  const p = budget.plan(s);
  const salary = snap?.salary ?? p?.salary ?? 0;
  const daily = per === 'year' ? 0 : snap?.daily ?? p?.daily ?? 0;
  const R = budget.cycleReport(s, all, range, daily);
  const fullDate = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short' });
  const label = per === 'year' ? '' : `${range.start.getDate()} ${shortMonth.format(range.start)} – ${new Date(range.end - 1).getDate()} ${shortMonth.format(new Date(range.end - 1))} ${range.start.getFullYear()}`;
  const tabs = { summary: 'التقرير', places: 'وين أصرف', habits: 'عاداتي', archive: 'الأرشيف' };

  let body = '';
  if (ui.rTab === 'summary') body = reportSummary(R, salary, daily, hasBudget && per === 'month');
  else if (ui.rTab === 'places') body = reportPlaces(R);
  else if (ui.rTab === 'habits') body = reportHabits();
  else body = reportArchive(all, hasBudget, payday);

  const PER = { week: 'أسبوعي', month: 'شهري', year: 'سنوي' };
  const periodTitle = per === 'week' ? `أسبوع <small>${label}</small>` : per === 'year' ? `سنة ${range.start.getFullYear()}` : hasBudget ? `دورة ${monthName(budget.cycleKey(range))}<small>${label}</small>` : label;
  view.innerHTML = `
    ${['summary', 'places'].includes(ui.rTab) ? `<div class="seg" id="seg-per">${Object.entries(PER).map(([k, n]) => `<button data-rp="${k}" class="${per === k ? 'active' : ''}">${n}</button>`).join('')}</div>` : ''}
    <div class="seg">${Object.entries(tabs).map(([k, n]) => `<button data-rt="${k}" class="${ui.rTab === k ? 'active' : ''}">${n}</button>`).join('')}</div>
    ${['summary', 'places'].includes(ui.rTab) ? `<div class="period"><button id="rprev" aria-label="السابق" ${canPrev ? '' : 'disabled'}>→</button>
      <span class="label">${periodTitle}</span><button id="rnext" aria-label="التالي" ${ui.rOffset >= 0 ? 'disabled' : ''}>←</button></div>` : ''}
    ${body}`;

  view.querySelectorAll('[data-rp]').forEach((x) => x.onclick = () => { ui.rPeriod = x.dataset.rp; ui.rOffset = 0; render(); });
  view.querySelectorAll('[data-rt]').forEach((x) => x.onclick = () => { ui.rTab = x.dataset.rt; render(); });
  $('#rprev')?.addEventListener('click', () => { if (canPrev) { ui.rOffset--; render(); } });
  $('#rnext')?.addEventListener('click', () => { if (ui.rOffset < 0) { ui.rOffset++; render(); } });
  if (ui.rTab === 'summary' && R.total) {
    const dayAt = (i) => new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() + i);
    let series, every = 5;
    if (per === 'year') {
      const mo = new Array(12).fill(0); R.perDay.forEach((v, i) => { mo[dayAt(i).getMonth()] += v; });
      series = mo.map((v, i) => ({ value: v, label: new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'narrow' }).format(new Date(2026, i, 1)) })); every = 1;
    } else if (per === 'week') {
      series = R.perDay.map((v, i) => ({ value: v, label: budget.WEEKDAYS[dayAt(i).getDay()] })); every = 1;
    } else series = R.perDay.map((v, i) => ({ value: v, label: String(dayAt(i).getDate()) }));
    $('#r-days').appendChild(bars(series, { labelEvery: every, limit: per === 'year' ? 0 : daily, highlight: series.map((x) => x.value).indexOf(Math.max(...series.map((x) => x.value))) }));
    $('#r-donut').appendChild(donut(R.byCategory.map((c) => ({ value: c.total, color: cat(c.key).color, label: cat(c.key).name })), { center: fmt(R.total, 0), sub: 'ر.س' }));
  }
  view.querySelectorAll('[data-cat-toggle]').forEach((x) => x.onclick = () => { ui.openCat = ui.openCat === x.dataset.catToggle ? null : x.dataset.catToggle; render(); });
  view.querySelectorAll('[data-merchant]').forEach((x) => x.onclick = () => openMerchantSheet(x.dataset.merchant, range));
  view.querySelectorAll('[data-cycle]').forEach((x) => x.onclick = () => { ui.rOffset = +x.dataset.cycle; ui.rTab = 'summary'; render(); scrollTo(0, 0); });
}

const pctBar = (pct, color = 'var(--primary)') => `<div class="meter thin"><span style="width:${Math.min(pct, 100)}%;background:${color}"></span></div>`;

function reportSummary(R, salary, daily, hasBudget) {
  if (!R.total) return '<div class="empty"><div class="big">📭</div>ما فيه صرف بهذي الفترة</div>';
  const saved = salary - R.total;
  const slotMax = Math.max(...Object.values(R.slots), 1);
  const wdMax = Math.max(...R.weekday, 1);
  return `
    <div class="card hero"><div class="muted small">إجمالي الصرف</div>
      <div class="total">${money(R.total, 0)} <small>ر.س</small></div>
      ${hasBudget ? `<div class="small muted"><span class="num m">${fmt((R.total / salary) * 100)}%</span> من الراتب · ${saved >= 0 ? `تبقّى <b class="good">${money(saved, 0)}</b>` : `تجاوزت الراتب بـ <b class="bad">${money(-saved, 0)}</b>`} ر.س</div>
      ${pctBar((R.total / salary) * 100, saved >= 0 ? 'var(--primary)' : 'var(--danger)')}` : ''}
      <div class="stats small">
        <div><b>${money(R.avgPerDay, 0)}</b><span>متوسط يومي</span></div>
        <div><b>${R.count}</b><span>عملية</span></div>
        <div><b>${R.noSpendDays}</b><span>يوم بدون صرف</span></div>
        ${R.daysOver != null ? `<div><b class="${R.daysOver ? 'bad' : 'good'}">${R.daysOver}</b><span>يوم تجاوزت الحد</span></div>` : ''}
      </div></div>
    ${invReport(R.range)}
    <div class="card highlight-cards">
      ${R.topDay ? `<div><span class="muted small">🔥 أكثر يوم صرفت فيه</span><b>${dateFmt.format(R.topDay.date)}</b>
        <span>${money(R.topDay.total, 0)} ر.س · <span class="num">${fmt(R.topDay.pct)}%</span> من الدورة</span></div>` : ''}
      ${R.topWeekday ? `<div><span class="muted small">📅 أكثر يوم بالأسبوع</span><b>${R.topWeekday.name}</b>
        <span>${money(R.topWeekday.total, 0)} ر.س · <span class="num">${fmt(R.topWeekday.pct)}%</span></span></div>` : ''}
      ${R.merchants[0] ? `<div><span class="muted small">📍 أكثر مكان</span><b>${esc(R.merchants[0].label)}</b>
        <span>${R.merchants[0].count} مرات · ${money(R.merchants[0].total, 0)} ر.س</span></div>` : ''}
    </div>
    <div class="card"><h2>الصرف اليومي <small>— ${daily ? 'الخط الأحمر = حدك اليومي' : 'الخط المتقطّع = المتوسط'}</small></h2><div id="r-days"></div></div>
    <div class="card"><h2>حسب التصنيف</h2><div class="donut-wrap"><div id="r-donut"></div>
      <ul class="legend">${R.byCategory.map((c) => `<li><span class="dot" style="background:${cat(c.key).color}"></span>
        <span class="name">${cat(c.key).icon} ${cat(c.key).name} <span class="muted small">(${c.count})</span></span><span class="num">${fmt(c.total, 0)}</span>
        <span class="pct num">${fmt(c.pct)}%</span></li>`).join('')}</ul></div></div>
    ${hasBudget ? `<div class="card"><h2>توزيع الصرف</h2>${R.byBucket.map((x) => `<div class="kv"><span>${BUCKETS[x.key].icon} ${BUCKETS[x.key].name}</span>
      <span>${money(x.total, 0)} ر.س · <span class="num">${fmt(x.pct)}%</span></span></div>${pctBar(x.pct)}`).join('')}</div>` : ''}
    <div class="card"><h2>💳 حسب البطاقة</h2>${R.byCard.map((x) => {
      const [bk, cd] = x.key.split('|');
      return `<div class="kv"><span>${esc(cardName(bk, cd))} <span class="muted small">(${x.count})</span></span><span>${money(x.total, 0)} ر.س · <span class="num">${fmt(x.pct)}%</span></span></div>${pctBar(x.pct)}`;
    }).join('')}</div>
    <div class="card"><h2>🕐 وقت الصرف</h2>${Object.entries(R.slots).map(([n, v]) => `<div class="kv"><span>${n}</span><span>${money(v, 0)} ر.س</span></div>${pctBar((v / slotMax) * 100, 'var(--accent)')}`).join('')}</div>
    <div class="card"><h2>📅 أيام الأسبوع</h2>${budget.WEEKDAYS.map((n, i) => `<div class="kv"><span>${n}</span><span>${money(R.weekday[i], 0)} ر.س</span></div>${pctBar((R.weekday[i] / wdMax) * 100, 'var(--accent)')}`).join('')}</div>`;
}

function invReport(range) {
  const s = store.getState();
  if (!s.investments?.length) return '';
  const done = budget.investedInRange(s.investments, s.txs, range, s.settings.rates);
  const key = budget.cycleKey(range);
  const planned = budget.investmentsPlanned(s.investments, key);
  const sent = s.investments.filter((i) => !i.variable).reduce((a, i) => a + (done[i.id] || 0), 0);
  return `<div class="card"><h2>📈 استثمرت هالدورة</h2>
    <div class="kv"><span>المخطط</span><span>${money(planned, 0)} ر.س</span></div>
    <div class="kv"><span>المحوّل فعلياً للمحافظ الثابتة</span><b class="${planned && sent >= planned ? 'good' : ''}">${money(sent, 0)} ر.س</b></div>
    ${s.investments.map((i) => done[i.id] ? `<div class="kv small muted"><span>${i.variable ? '🎲' : '📈'} ${esc(i.name)}</span><span>${money(done[i.id], 0)}</span></div>` : '').join('')}
    <p class="small muted">التحويلات للاستثمار ما تدخل في إجمالي الصرف.</p></div>`;
}

function reportPlaces(R) {
  if (!R.total) return '<div class="empty"><div class="big">📭</div>ما فيه صرف بهذي الدورة</div>';
  return `<p class="small muted" style="margin:0 4px 10px">اضغط على أي تصنيف عشان تشوف المحلات، وعلى أي محل عشان تشوف عملياته.</p>
    ${R.byCategory.map((c) => {
      const open = ui.openCat === c.key;
      const ms = R.merchants.filter((m) => m.category === c.key);
      return `<div class="card place ${open ? 'open' : ''}">
        <div class="place-head" data-cat-toggle="${c.key}"><div class="ic" style="--tint:${cat(c.key).color}">${cat(c.key).icon}</div>
          <div class="main"><div class="title">${cat(c.key).name}</div><div class="meta">${c.count} عملية · ${ms.length} مكان · <span class="num">${fmt(c.pct)}%</span></div></div>
          <div class="amt">${money(c.total, 0)} ر.س</div><span class="chev">${open ? '▴' : '▾'}</span></div>
        ${pctBar(c.pct, cat(c.key).color)}
        ${open ? `<ul class="list">${ms.map((m) => `<li class="row" data-merchant="${esc(m.key)}"><div class="main"><div class="title">${esc(m.label)}</div>
          <div class="meta">${m.count} ${m.count > 2 && m.count < 11 ? 'مرات' : 'مرة'} · متوسط ${money(m.total / m.count, 0)} ر.س</div></div>
          <div class="amt">${money(m.total, 0)} ر.س</div></li>`).join('')}</ul>` : ''}
      </div>`;
    }).join('')}`;
}

function openMerchantSheet(key, range) {
  const s = store.getState();
  const list = visibleTxs().filter((t) => budget.counts(t) && (budget.normKey(t.merchant) === key)).sort((a, b) => new Date(b.date) - new Date(a.date));
  const inCycle = list.filter((t) => new Date(t.date) >= range.start && new Date(t.date) < range.end);
  const total = list.reduce((a, t) => a + sar(t, s.settings.rates), 0);
  const name = list[0]?.merchant || key;
  openSheet(`<h3>${esc(name)}</h3>
    <div class="stats small"><div><b>${inCycle.length}</b><span>مرات بهالدورة</span></div><div><b>${list.length}</b><span>مرات بالكل</span></div>
      <div><b>${money(total, 0)}</b><span>ر.س بالكل</span></div><div><b>${money(total / (list.length || 1), 0)}</b><span>متوسط العملية</span></div></div>
    <ul class="list">${list.slice(0, 60).map((t) => `<li class="row" style="cursor:default"><div class="main"><div class="title">${dateFmt.format(new Date(t.date))}</div>
      <div class="meta">${timeFmt.format(new Date(t.date))} · ${esc(cardName(t.bank, t.card))}</div></div><div class="amt">${money(t.amount)} ${curLabel(t.currency)}</div></li>`).join('')}</ul>`);
}

function reportHabits() {
  const s = store.getState();
  const h = budget.habits(s, visibleTxs(), new Date(), CATEGORIES);
  const subs = detectSubscriptions(visibleTxs(), new Date(), s.settings.dismissedSubs)
    .filter((x) => !s.commitments.some((c) => budget.normKey(c.keyword || c.name) === x.key));
  return `<p class="small muted" style="margin:0 4px 10px">أنماط تتكرر في صرفك خلال آخر ٩٠ يوم.</p>
    ${h.length ? `<div class="card"><ul class="habits">${h.map((x) => `<li><span class="hi">${x.icon || '•'}</span><span>${esc(x.text)}</span></li>`).join('')}</ul></div>`
      : '<div class="empty"><div class="big">🌱</div>أحتاج عمليات أكثر عشان أطلع عاداتك. كمّل تسجيل صرفك وارجع بعد كم أسبوع.</div>'}
    ${subs.length ? `<div class="card"><h2>🔁 مدفوعات متكررة اكتشفتها</h2>${subs.map((x) => `<div class="kv"><span>${esc(x.name)}</span>
      <span>${money(x.amount)} ${curLabel(x.currency)} · ${{ weekly: 'أسبوعي', monthly: 'شهري', quarterly: 'ربعي', yearly: 'سنوي' }[x.period]}</span></div>`).join('')}
      <p class="small muted">تقدر تضيفها لالتزاماتك من تبويب «الالتزامات».</p></div>` : ''}`;
}

function reportArchive(all, hasBudget, payday) {
  const s = store.getState();
  if (!all.length) return '<div class="empty"><div class="big">🗂️</div>ما فيه بيانات للحين</div>';
  const st = budget.startOf(s);
  const tr = budget.tracked(s, all);
  if (!tr.length) return `<div class="empty"><div class="big">🗂️</div>${st ? `الأرشيف يبدأ من ${dateFmt.format(st)}` : 'ما فيه بيانات للحين'}</div>`;
  const first = new Date(Math.max(Math.min(...tr.map((t) => +new Date(t.date))), st ? +st : 0));
  const rows = [];
  for (let o = 0; o > -36; o--) {
    const r = hasBudget ? budget.cycleFor(new Date(), payday, o) : periodRange('month', o);
    if (r.end <= first) break;
    const snap = s.archive.find((a) => a.start === r.start.toISOString());
    const salary = snap?.salary ?? (o === 0 ? budget.plan(s)?.salary : null) ?? s.settings.budget.salary;
    const R = budget.cycleReport(s, all, r, snap?.daily || 0);
    rows.push({ o, r, R, salary });
  }
  const max = Math.max(...rows.map((x) => x.R.total), 1);
  return `<p class="small muted" style="margin:0 4px 10px">كل ${hasBudget ? 'دورة راتب' : 'شهر'} يتأرشف تلقائياً. اضغط على أي وحدة عشان تفتح تقريرها.</p>
    <div class="card" style="padding:4px 14px"><ul class="list">${rows.map(({ o, r, R, salary }) => `
      <li class="row" data-cycle="${o}"><div class="main"><div class="title">${r.start.getDate()} ${shortMonth.format(r.start)} – ${new Date(r.end - 1).getDate()} ${shortMonth.format(new Date(r.end - 1))} ${r.start.getFullYear()}${o === 0 ? '<span class="badge">الحالية</span>' : ''}</div>
        <div class="meta">${R.count} عملية${R.topDay ? ` · أكثر يوم ${R.topDay.date.getDate()} ${shortMonth.format(R.topDay.date)}` : ''}${R.byCategory[0] ? ` · أكثر تصنيف ${cat(R.byCategory[0].key).name}` : ''}</div>
        ${pctBar((R.total / max) * 100)}</div>
        <div class="amt">${money(R.total, 0)} ر.س${hasBudget && salary ? `<div class="small ${salary - R.total >= 0 ? 'good' : 'bad'}">${salary - R.total >= 0 ? 'وفّرت' : 'تجاوزت'} ${money(Math.abs(salary - R.total), 0)}</div>` : ''}</div></li>`).join('')}</ul></div>`;
}

// ---------------- الالتزامات ----------------
function renderCommitments() {
  const s = store.getState();
  const salary = s.settings.budget.salary;
  const list = s.commitments.map((c) => ({ c, st: budget.commitmentStatus(c) })).sort((a, b) => (a.st.active === b.st.active ? (a.st.next || 0) - (b.st.next || 0) : a.st.active ? -1 : 1));
  const total = budget.commitmentsTotal(s.commitments);
  const subs = detectSubscriptions(visibleTxs(), new Date(), s.settings.dismissedSubs)
    .filter((x) => !s.commitments.some((c) => budget.normKey(c.keyword || c.name) === x.key));
  const inst = budget.suggestInstallments(visibleTxs(), s.commitments);
  const remainingDebt = list.reduce((a, { st }) => a + (st.remainingAmount || 0), 0);
  const st0 = budget.startOf(s);
  const ref = st0 && new Date() < st0 ? st0 : new Date(); // قبل بداية الحسبة نعرض أول دورة فعلية
  const cyc = s.settings.budget.salary > 0 ? budget.cycleFor(ref, s.settings.budget.payday || 27) : periodRange('month', 0);
  const paidOf = (c) => budget.paidInRange(c, s.txs, s.commitments, cyc);
  const needSample = list.filter(({ c, st }) => st.active && !c.signature && !c.keyword);
  const activeN = list.filter(({ st }) => st.active).length;
  const ckey = budget.cycleKey(cyc);
  const body = `<div class="kpis"><div class="kpi" style="--tint:var(--orange)"><span>شهرياً</span><b>${money(total, 0)} <small>ر.س</small></b></div>
      ${salary > 0 ? `<div class="kpi neutral"><span>من الراتب</span><b><span class="num m">${fmt((total / salary) * 100)}%</span></b></div>` : ''}
      ${remainingDebt ? `<div class="kpi neutral"><span>باقي أقساط</span><b>${money(remainingDebt, 0)}</b></div>` : ''}</div>
    ${list.length ? `<ul class="list">${list.map(({ c, st }) => {
      const on = st.active && budget.commitmentDone(c, ckey, s.txs, s.commitments, cyc);
      const meta = [st.next ? `الجاي ${dayFmt.format(st.next)}` : '', st.remaining != null && st.active ? `باقي ${st.remaining} من ${c.total}` : ''].filter(Boolean).join(' · ');
      return `<li class="row ${st.active ? '' : 'excluded'}" data-c="${c.id}"><div class="ic" style="--tint:${budget.commitTint(c)}">${budget.commitIcon(c)}</div>
        <div class="main"><div class="title">${esc(c.name)}</div><div class="meta wrap">${meta || (budget.COMMITMENT_KINDS[c.kind] || budget.COMMITMENT_KINDS.other).name}</div>
          ${st.paid != null && st.active ? pctBar((st.paid / c.total) * 100, 'var(--orange)') : ''}</div>
        <div class="amt"><span>${c.approx ? '≈ ' : ''}${money(c.amount, 0)}</span>${st.active ? chk('data-c-paid', c.id, on, 'تم السداد') : '<span class="pill">خلص</span>'}</div></li>`;
    }).join('')}</ul>` : '<div class="empty-mini">أضف إيجارك وفواتيرك وأقساطك عشان تنخصم من راتبك قبل ما أحسب حدك اليومي.</div>'}
    ${inst.length || subs.length ? `<div class="sec-title">مقترحات من عملياتك</div>
      ${inst.map((x, i) => `<div class="kv"><span>🧩 ${esc(x.name)} <span class="pill">${x.provider}</span></span><button class="chip small" data-inst="${i}">إضافة</button></div>`).join('')}
      ${subs.map((x, i) => `<div class="kv"><span>🔁 ${esc(x.name)} · ${money(x.amount)} ${curLabel(x.currency)}</span>
        <span><button class="chip small" data-sub="${i}">إضافة</button> <button class="chip small" data-dismiss="${esc(x.key)}">✕</button></span></div>`).join('')}` : ''}
    <button class="add-link" id="add-c">＋ إضافة التزام</button>`;
  view.innerHTML = `
    ${acc('commits', { ico: 'calendar-check', tint: '#ff8a00', title: 'الالتزامات الشهرية', body })}
    ${investmentsSection(cyc)}
    ${debtsSection()}`;
  // علامات «تم»: ما تفتح النافذة، وتتجدد كل دورة لحالها
  view.querySelectorAll('[data-c-paid]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const c = store.getState().commitments.find((x) => x.id === b.dataset.cPaid); const was = b.classList.contains('on'); store.toggleCommitmentPaid(b.dataset.cPaid, ckey); if (!was && c) celebrate('commit', { name: c.name, amount: budget.investAmount ? c.amount : c.amount, x: e.clientX, y: e.clientY, title: 'تم السداد' }); });
  view.querySelectorAll('[data-inv-done]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const iv = store.getState().investments.find((x) => x.id === b.dataset.invDone); const was = b.classList.contains('on'); store.toggleInvestmentDone(b.dataset.invDone, ckey); if (!was && iv) celebrate('invest', { name: iv.name, amount: budget.investAmount(iv, ckey), x: e.clientX, y: e.clientY, title: 'تم التحويل' }); });
  view.querySelectorAll('[data-settle]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); const d = store.getState().debts.find((x) => x.id === b.dataset.settle); if (store.toggleDebtSettled(b.dataset.settle) && d) celebrate('debt', { name: d.person || d.name || '', amount: d.amount, x: e.clientX, y: e.clientY, title: 'انسدّ الدين' }); });
  view.querySelectorAll('[data-debtf]').forEach((b) => b.onclick = () => { ui.debtF = b.dataset.debtf; render(); });
  $('#add-c').onclick = () => openCommitmentSheet();
  $('#add-inv').onclick = () => openInvestmentSheet();
  $('#add-lent').onclick = () => openDebtSheet({ direction: 'lent' });
  $('#add-borrowed').onclick = () => openDebtSheet({ direction: 'borrowed' });
  view.querySelectorAll('[data-debt]').forEach((x) => x.onclick = () => openDebtDetail(x.dataset.debt));
  view.querySelectorAll('[data-inv]').forEach((x) => x.onclick = () => openInvestmentSheet(s.investments.find((i) => i.id === x.dataset.inv)));
  view.querySelectorAll('[data-inv-link]').forEach((x) => x.onclick = (e) => {
    e.stopPropagation();
    openInvestmentSheet(s.investments.find((i) => i.id === x.dataset.invLink), true);
  });
  view.querySelectorAll('[data-link]').forEach((x) => x.onclick = async (e) => {
    e.stopPropagation();
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { /* */ }
    if (!text.trim()) return openCommitmentSheet(s.commitments.find((c) => c.id === x.dataset.link), true);
    linkResult(store.linkCommitmentMessage(x.dataset.link, text), s.commitments.find((c) => c.id === x.dataset.link));
  });
  view.querySelectorAll('[data-c]').forEach((x) => x.onclick = () => openCommitmentSheet(s.commitments.find((c) => c.id === x.dataset.c)));
  view.querySelectorAll('[data-sub]').forEach((x) => x.onclick = () => {
    const v = subs[+x.dataset.sub];
    openCommitmentSheet({ name: v.name, amount: Math.round(sar(v, s.settings.rates) * 100) / 100, kind: 'subscription', keyword: v.name, day: new Date(v.nextDate).getDate() });
  });
  view.querySelectorAll('[data-inst]').forEach((x) => x.onclick = () => {
    const v = inst[+x.dataset.inst];
    openCommitmentSheet({ name: v.name, amount: v.amount, kind: 'installment', provider: v.provider, keyword: v.name, total: 4, startDate: new Date().toISOString().slice(0, 10) });
  });
  view.querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => store.dismissSub(b.dataset.dismiss));
}

const monthName = (key) => { const [y, m] = key.split('-'); return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long' }).format(new Date(+y, +m - 1, 1)); };

function investmentsSection(cyc) {
  const s = store.getState();
  const invs = s.investments || [];
  const key = budget.cycleKey(cyc);
  const done = budget.investedInRange(invs, s.txs, cyc, s.settings.rates);
  const planned = budget.investmentsPlanned(invs, key);
  const salary = s.settings.budget.salary;
  const sent = invs.filter((i) => !i.variable).reduce((a, i) => { const amt = budget.investAmount(i, key); const g = done[i.id] || 0; return a + (budget.investmentDone(i, key, g) ? Math.max(amt, g) : g); }, 0);
  const body = `${invs.length ? `<div class="kpis"><div class="kpi" style="--tint:var(--blue)"><span>المخطط</span><b>${money(planned, 0)} <small>ر.س</small></b></div>
      <div class="kpi" style="--tint:${sent >= planned && planned ? 'var(--good)' : 'var(--text)'}"><span>تحوّل</span><b>${money(sent, 0)} <small>ر.س</small></b></div>
      ${salary > 0 && planned ? `<div class="kpi neutral"><span>من الراتب</span><b><span class="num m">${fmt((planned / salary) * 100)}%</span></b></div>` : ''}</div>
      ${planned ? pctBar(Math.min((sent / planned) * 100, 100), 'var(--blue)') : ''}
      <ul class="list">${invs.map((i) => {
        const amt = budget.investAmount(i, key);
        const got = done[i.id] || 0;
        const on = !i.variable && budget.investmentDone(i, key, got);
        return `<li class="row" data-inv="${i.id}"><div class="ic" style="--tint:${i.variable ? 'var(--orange)' : 'var(--blue)'}">${i.variable ? '🎲' : '📈'}</div>
          <div class="main"><div class="title">${esc(i.name)}</div>
          <div class="meta wrap">${i.variable ? (i.cap > 0 ? capLine(got, i.cap) : `متغيّر${got ? ` · حوّلت ${money(got, 0)}` : ''}`) : got && !on ? `حوّلت ${money(got, 0)} من ${money(amt, 0)}` : 'شهرياً'}</div>
          ${i.variable && !i.signature ? `<button class="teach" data-inv-link="${i.id}">📩 علّمني رسالة التحويل</button>` : ''}</div>
          <div class="amt">${i.variable ? (i.cap > 0 ? `<span>${money(i.cap, 0)}</span><span class="pill">سقف</span>` : '—') : `<span>${money(amt, 0)}</span>${chk('data-inv-done', i.id, on, 'تم التحويل')}`}</div></li>`;
      }).join('')}</ul>` : '<div class="empty-mini">مبلغ المحفظة ينخصم من الراتب قبل الحد اليومي، وتحويلاتها ما تنحسب صرف.</div>'}
    <button class="add-link" id="add-inv">＋ إضافة محفظة</button>`;
  return acc('inv', { ico: 'trend-up', tint: '#0a7cff', title: 'الاستثمار', body });
}

function capLine(got, cap) {
  const pct = (got / cap) * 100;
  const left = cap - got;
  return `${money(got, 0)} من سقف ${money(cap, 0)} · ${left >= 0 ? `باقي ${money(left, 0)}` : `<b class="bad">تجاوزت بـ ${money(-left, 0)}</b>`}
    ${pctBar(pct, pct > 100 ? 'var(--danger)' : pct >= 80 ? '#f59f00' : 'var(--primary)')}`;
}

/** حالة سقف الحسابات المتغيّرة في الدورة الحالية */
function capStatus(inv) {
  const s = store.getState();
  const cyc = budget.cycleFor(new Date(), s.settings.budget.payday || 27);
  const got = budget.investedInRange([inv], s.txs, cyc, s.settings.rates)[inv.id] || 0;
  return { got, cap: inv.cap, left: inv.cap - got, pct: (got / inv.cap) * 100 };
}

function openInvestmentSheet(inv = {}, focusSample = false) {
  const ov = Object.entries(inv.overrides || {}).sort();
  const thisKey = budget.cycleKey(budget.cycleFor(new Date(), store.getState().settings.budget.payday || 27));
  openSheet(`<h3>${inv.id ? 'تعديل محفظة' : 'محفظة جديدة'}</h3>
    <label class="field">الاسم<input type="text" id="i-name" value="${esc(inv.name || '')}" placeholder="مثلاً: المحفظة التقنية"></label>
    <label class="switch"><input type="checkbox" id="i-var" ${inv.variable ? 'checked' : ''}> مبلغ متغيّر (مثل حساب الأوبشن): ما له مبلغ ثابت، وكل تحويل له ينقص حدك اليومي لباقي الدورة</label>
    <label class="field" id="i-cap-wrap">السقف الشهري (ر.س) <span class="small">— أنبّهك لما تقرب منه وإذا تجاوزته</span>
      <input type="text" data-num inputmode="decimal" id="i-cap" value="${inv.cap || ''}" placeholder="بدون سقف"></label>
    <div id="i-fixed">
      <label class="field">المبلغ الشهري الثابت (ر.س)<input type="text" data-num inputmode="decimal" id="i-amount" value="${inv.amount ?? ''}"></label>
      <label class="field">مبالغ مؤقتة لدورات معيّنة <span class="small">(بعدها يرجع للمبلغ الثابت تلقائياً)</span></label>
      <div id="i-ov">${ov.map(([k, v]) => ovRow(k, v)).join('')}</div>
      <button class="btn block" id="i-add-ov" style="margin-top:0">＋ مبلغ مؤقت لدورة</button>
    </div>
    <div id="i-msg">
      <label class="field">رسالة البنك للتحويل لهذي المحفظة <span class="small">(مرة وحدة، وبعدها أتعرّف على التحويلات لحالي)</span>
        <textarea id="i-sample" dir="auto" style="min-height:80px">${esc(inv.sample || '')}</textarea></label>
      ${inv.signature ? `<p class="small good" style="margin-top:-4px">✅ متعلّمها${inv.signature.target ? ` — المستفيد •${esc(inv.signature.target)}` : inv.signature.merchant ? ` — ${esc(inv.signature.merchant)}` : ''}</p>` : ''}
      <button class="btn block" id="i-paste" style="margin-top:0">📋 لصق من الحافظة</button>
    </div>
    <button class="btn primary block" id="i-save">حفظ</button>
    ${inv.id ? '<button class="btn danger block" id="i-del">حذف المحفظة</button>' : ''}`, (p) => {
    const sync = () => { const v = $('#i-var', p).checked; $('#i-fixed', p).hidden = v; $('#i-cap-wrap', p).hidden = !v; $('#i-msg', p).hidden = !v; };
    if (focusSample) setTimeout(() => $('#i-sample', p)?.scrollIntoView({ block: 'center' }), 60);
    $('#i-var', p).onchange = sync; sync();
    const bindRows = () => p.querySelectorAll('[data-ov-del]').forEach((b) => b.onclick = () => b.closest('.ov-row').remove());
    bindRows();
    $('#i-add-ov', p).onclick = () => { $('#i-ov', p).insertAdjacentHTML('beforeend', ovRow(thisKey, '')); bindRows(); };
    $('#i-paste', p).onclick = async () => { try { $('#i-sample', p).value = await navigator.clipboard.readText(); } catch { toast('الصقها يدوياً'); } };
    $('#i-save', p).onclick = () => {
      const name = $('#i-name', p).value.trim();
      const variable = $('#i-var', p).checked;
      const amount = parseFloat($('#i-amount', p).value) || 0;
      if (!name || (!variable && !(amount > 0))) return toast('اكتب الاسم والمبلغ');
      const overrides = {};
      p.querySelectorAll('.ov-row').forEach((r) => {
        const k = r.querySelector('[data-ov-month]').value; const v = parseFloat(r.querySelector('[data-ov-amount]').value);
        if (/^\d{4}-\d{2}$/.test(k) && v >= 0) overrides[k] = v;
      });
      const saved = store.saveInvestment({ id: inv.id, name, variable, amount: variable ? 0 : amount, overrides: variable ? {} : overrides,
        cap: variable ? parseFloat($('#i-cap', p).value) || 0 : 0 });
      const sample = variable ? $('#i-sample', p).value.trim() : '';
      closeSheet();
      if (sample && sample !== (inv.sample || '')) linkResult(store.linkInvestmentMessage(saved.id, sample), saved);
      else {
        // مسحت الرسالة (أو المحفظة ثابتة وما تحتاج رسالة): نمسح اللي اتعلّمته، وأي عملية انضافت بسببها
        if (inv.id && (inv.sample || inv.signature) && !sample) store.clearLink('inv', saved.id);
        toast('✅ انحفظت المحفظة');
      }
    };
    $('#i-del', p)?.addEventListener('click', () => { if (confirm('تحذف المحفظة؟ تحويلاتها السابقة بترجع تنحسب كعمليات عادية.')) { store.deleteInvestment(inv.id); closeSheet(); } });
  });
}
const ovRow = (k, v) => `<div class="ov-row"><input type="month" data-ov-month value="${esc(k)}">
  <input type="text" data-num inputmode="decimal" data-ov-amount value="${esc(v)}" placeholder="المبلغ"><button class="chip" data-ov-del>✕</button></div>`;

// ---------------- التسليف ----------------
const dayFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { day: 'numeric', month: 'short', year: 'numeric' });
const todayInput = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const fromInput = (v) => new Date(`${v || todayInput()}T12:00:00`).toISOString();

const hueOf = (str) => { let h = 0; for (const ch of String(str)) h = (h * 31 + ch.codePointAt(0)) % 360; return h; };
/** علامة تفعيل: تضغطها تصير «تم»، وتضغطها مرة ثانية ترجع «بانتظار» */
const chk = (attr, id, on, onLabel) => `<button class="chk ${on ? 'on' : ''}" ${attr}="${id}" aria-pressed="${on}" aria-label="${onLabel}"><span class="chk-c">${svg('check', 'r')}</span></button>`;

function debtRow(d, now = new Date()) {
  const rem = budget.debtRemaining(d), paid = budget.debtPaid(d);
  const late = rem > 0 && d.dueDate && new Date(`${d.dueDate}T23:59:59`) < now;
  const lent = d.direction === 'lent';
  const meta = [dayFmt.format(new Date(d.date)), d.note && esc(d.note), paid > 0 && rem > 0 ? `انسدد ${money(paid, 0)} من ${money(d.amount, 0)}` : ''].filter(Boolean).join(' · ');
  return `<li class="row noic" data-debt="${d.id}">
    <div class="main"><div class="title">${esc(d.person)}${late ? '<span class="pill late" style="margin-inline-start:6px">متأخر</span>' : ''}</div><div class="meta wrap">${meta}</div>
      ${paid > 0 && rem > 0 ? pctBar((paid / d.amount) * 100, lent ? 'var(--green)' : 'var(--red)') : ''}</div>
    <div class="amt"><span class="${rem > 0 ? (lent ? 'good' : 'bad') : 'muted'}">${money(rem > 0 ? rem : d.amount, 0)}</span>${chk('data-settle', d.id, rem <= 0, 'تم السداد')}</div></li>`;
}

function debtsSection() {
  const s = store.getState();
  const sm = budget.debtSummary(s.debts);
  const f = ui.debtF || (sm.lent.length || !sm.borrowed.length ? 'lent' : 'borrowed');
  const lists = { lent: sm.lent, borrowed: sm.borrowed, settled: sm.settled };
  const empty = { lent: 'ما سلّفت أحد للحين', borrowed: 'ما عليك ديون', settled: 'ما فيه ديون مسدّدة' };
  const body = `<div class="kpis"><div class="kpi" style="--tint:var(--good)"><span>لي</span><b>${money(sm.toMe, 0)} <small>ر.س</small></b></div>
      <div class="kpi" style="--tint:var(--bad)"><span>عليّ</span><b>${money(sm.iOwe, 0)} <small>ر.س</small></b></div></div>
    ${s.debts.length ? `<div class="seg sub-seg">${[['lent', 'لي', sm.lent.length], ['borrowed', 'عليّ', sm.borrowed.length], ['settled', 'المسدّدة', sm.settled.length]].map(([k, n, c]) =>
      `<button data-debtf="${k}" class="${k === f ? 'active' : ''}">${n}${c ? ` (${c})` : ''}</button>`).join('')}</div>
    ${lists[f].length ? `<ul class="list">${lists[f].map((d) => debtRow(d)).join('')}</ul>` : `<div class="empty-mini">${empty[f]}</div>`}` : ''}
    <div class="add-row"><button class="add-link" id="add-lent">📤 سلّفت أحد</button><button class="add-link" id="add-borrowed">📥 استلفت</button></div>`;
  return acc('debts', { ico: 'hand-coins', tint: '#30b158', title: 'التسليف', body });
}

function openDebtSheet(d = {}) {
  const editing = !!d.id;
  let dir = d.direction || 'lent';
  openSheet(`<h3>${editing ? 'تعديل الدين' : 'دين جديد'}</h3>
    <div class="seg" id="d-dir"><button data-d="lent" class="${dir === 'lent' ? 'active' : ''}">📤 سلّفت</button><button data-d="borrowed" class="${dir === 'borrowed' ? 'active' : ''}">📥 استلفت</button></div>
    <label class="field"><span id="d-who">${dir === 'lent' ? 'سلّفت مين؟' : 'استلفت من مين؟'}</span><input type="text" id="d-person" value="${esc(d.person || '')}" placeholder="الاسم"></label>
    <label class="field">المبلغ (ر.س)<input type="text" data-num inputmode="decimal" id="d-amount" value="${d.amount ?? ''}"></label>
    <label class="field">التاريخ<input type="date" id="d-date" value="${d.date ? new Date(d.date).toISOString().slice(0, 10) : todayInput()}"></label>
    <label class="field">موعد السداد المتوقع <span class="small">(اختياري، أنبّهك لو تأخر)</span><input type="date" id="d-due" value="${esc(d.dueDate || '')}"></label>
    <label class="field">ملاحظة <span class="small">(اختياري)</span><input type="text" id="d-note" value="${esc(d.note || '')}" placeholder="مثلاً: سلفة للسيارة"></label>
    <button class="btn primary block" id="d-save">حفظ</button>`, (p) => {
    p.querySelectorAll('#d-dir [data-d]').forEach((b) => b.onclick = () => {
      dir = b.dataset.d; p.querySelectorAll('#d-dir [data-d]').forEach((x) => x.classList.toggle('active', x === b));
      $('#d-who', p).textContent = dir === 'lent' ? 'سلّفت مين؟' : 'استلفت من مين؟';
    });
    $('#d-save', p).onclick = () => {
      const person = $('#d-person', p).value.trim();
      const amount = parseFloat($('#d-amount', p).value);
      if (!person || !(amount > 0)) return toast('اكتب الاسم والمبلغ');
      const saved = store.saveDebt({ id: d.id, direction: dir, person, amount, date: fromInput($('#d-date', p).value), dueDate: $('#d-due', p).value || '', note: $('#d-note', p).value.trim() });
      if (d.txId) store.attachDebtTx(saved.id, d.txId, 'principal');
      closeSheet();
      toast(`✅ انحفظ: ${dir === 'lent' ? 'سلّفت' : 'استلفت من'} ${esc(person)} ${money(amount, 0)} ر.س`, 3500);
    };
  });
}

function openDebtDetail(id) {
  const d = store.getState().debts.find((x) => x.id === id);
  if (!d) return;
  const lent = d.direction === 'lent';
  const rem = budget.debtRemaining(d), paid = budget.debtPaid(d);
  const pays = [...d.payments].sort((a, b) => new Date(b.date) - new Date(a.date));
  const remind = `السلام عليكم ${d.person}، تذكير بسيط بمبلغ ${fmt(rem, 2)} ريال عليك لي${d.note ? ` (${d.note})` : ''}. الله يجزاك خير.`;
  openSheet(`<h3>${lent ? '📤' : '📥'} ${esc(d.person)}</h3>
    <p class="muted small">${lent ? 'سلّفته' : 'استلفت منه'} ${money(d.amount, 0)} ر.س في ${esc(dayFmt.format(new Date(d.date)))}${d.note ? ` · ${esc(d.note)}` : ''}</p>
    <div class="stats stats3"><div><b>${money(d.amount, 0)}</b><span>الأصل</span></div><div><b class="good">${money(paid, 0)}</b><span>انسدد</span></div>
      <div><b class="${rem > 0 ? (lent ? 'good' : 'bad') : ''}">${money(rem, 0)}</b><span>المتبقي</span></div></div>
    ${pctBar((paid / d.amount) * 100, lent ? 'var(--good)' : 'var(--danger)')}
    ${d.dueDate && rem > 0 ? `<p class="small ${new Date(`${d.dueDate}T23:59:59`) < new Date() ? 'bad' : 'muted'}">📅 موعد السداد: ${esc(dayFmt.format(new Date(`${d.dueDate}T12:00:00`)))}${new Date(`${d.dueDate}T23:59:59`) < new Date() ? ' (متأخر)' : ''}</p>` : ''}
    ${rem > 0 ? `<button class="btn primary block" id="dd-pay">${lent ? 'استلمت جزء من المبلغ' : 'سدّدت جزء من المبلغ'}</button>` : '<p class="good small">✅ مسدّد بالكامل</p>'}
    ${rem > 0 && lent ? `<a class="btn block" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(remind)}">📲 ذكّره بواتساب</a>` : ''}
    <div class="sec-title">السجل</div>
    <ul class="list">${pays.map((x) => `<li class="row" style="cursor:default"><div class="main"><div class="title">${lent ? 'استلمت' : 'سدّدت'}${x.txId ? ' <span class="badge">من رسالة بنك</span>' : ''}</div>
      <div class="meta">${esc(dayFmt.format(new Date(x.date)))}</div></div><div class="amt good">${money(x.amount, 0)} ر.س</div>
      <button class="chip" data-del-pay="${x.id}" aria-label="حذف">✕</button></li>`).join('') || '<li class="muted small" style="padding:8px 0">ما فيه سداد للحين</li>'}</ul>
    <div class="btns" style="margin-top:10px"><button class="btn" id="dd-edit">تعديل</button><button class="btn danger" id="dd-del">حذف</button></div>`, (p) => {
    $('#dd-pay', p)?.addEventListener('click', () => openPaymentSheet(d.id));
    $('#dd-edit', p).onclick = () => openDebtSheet(d);
    $('#dd-del', p).onclick = () => { if (confirm('تحذف هذا الدين مع سجله؟')) { store.deleteDebt(d.id); closeSheet(); } };
    p.querySelectorAll('[data-del-pay]').forEach((b) => b.onclick = () => { store.deleteDebtPayment(d.id, b.dataset.delPay); openDebtDetail(d.id); });
  });
}

function openPaymentSheet(id) {
  const d = store.getState().debts.find((x) => x.id === id);
  const lent = d.direction === 'lent';
  const rem = budget.debtRemaining(d);
  openSheet(`<h3>${lent ? 'استلمت سداد من' : 'سدّدت لـ'} ${esc(d.person)}</h3>
    <p class="muted small">المتبقي ${money(rem, 0)} ر.س</p>
    <label class="field">المبلغ (ر.س)<input type="text" data-num inputmode="decimal" id="p-amount" value="${rem}"></label>
    <label class="field">التاريخ<input type="date" id="p-date" value="${todayInput()}"></label>
    <button class="btn primary block" id="p-save">حفظ</button>`, (p) => {
    $('#p-save', p).onclick = () => {
      const amount = parseFloat($('#p-amount', p).value);
      if (!(amount > 0)) return toast('اكتب المبلغ');
      if (amount > rem + 0.004) return toast(`المبلغ أكبر من المتبقي (${fmt(rem, 2)})`);
      store.addDebtPayment(id, { amount, date: fromInput($('#p-date', p).value) });
      closeSheet();
      if (budget.debtRemaining(store.getState().debts.find((x) => x.id === id)) <= 0.004) { toast('🎉 انسدد الدين بالكامل'); confetti(); } else toast('✅ انحفظ السداد');
    };
  });
}

function linkResult(r, c) {
  if (r.ok) {
    const sig = c.signature || {};
    const how = sig.merchant ? `اسم «${esc(r.tx.merchant)}»` : sig.target ? `المستفيد •${sig.target}` : `المبلغ ${fmt(sig.amount)} من ${esc(sig.bank)}`;
    toast(`✅ تعلّمت رسالة «${esc(c.name)}» — بتعرّف عليها من ${how}${r.status === 'added' ? (r.tx.investmentId ? '، وسجّلت التحويل (ما ينحسب صرف)' : '، وسجّلت السداد') : ''}${r.linkedOld ? ` وربطت ${r.linkedOld} عمليات سابقة` : ''}`, 6000);
  } else toast(r.reason === 'ignored' ? 'هذي ما تبان رسالة سداد (يمكن رمز تحقق؟) — انسخ رسالة الخصم' : 'ما قدرت أقرأ الرسالة — تأكد إنك نسخت رسالة الخصم كاملة');
}

const normK = (x = '') => String(x);
function openCommitmentSheet(c = {}, focusSample = false, fromTx = null) {
  const kinds = budget.COMMITMENT_KINDS;
  openSheet(`<h3>${c.id ? 'تعديل التزام' : 'التزام جديد'}</h3>
    <label class="field">النوع<select id="c-kind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${v.icon} ${v.name}</option>`).join('')}</select></label>
    <label class="field">الاسم<input type="text" id="c-name" value="${esc(c.name || '')}" placeholder="مثلاً: إيجار الشقة، قسط الجوال"></label>
    <label class="field">المبلغ الشهري (ر.س)<input type="text" data-num step="0.01" inputmode="decimal" id="c-amount" value="${c.amount ?? ''}"></label>
    <label class="field">يوم الدفع بالشهر<input type="text" data-num min="1" max="31" inputmode="numeric" id="c-day" value="${c.day ?? ''}"></label>
    <div id="c-finite">
      <label class="field">الجهة<select id="c-provider">${['', 'تابي', 'تمارا', 'بنك', 'أخرى'].map((x) => `<option ${c.provider === x ? 'selected' : ''} value="${x}">${x || '—'}</option>`).join('')}</select></label>
      ${fromTx ? `<label class="field">كم دفعة باقية بعد هذي الدفعة؟ <span class="small">(اكتب 0 لو هذي آخر دفعة)</span><input type="text" data-num min="0" inputmode="numeric" id="c-left" value="0"></label>
        <label class="field">تاريخ هذي الدفعة<input type="date" id="c-paidon" value="${esc(new Date(fromTx.date).toISOString().slice(0, 10))}"></label>`
      : `<label class="field">عدد الأقساط الكلي<input type="text" data-num min="1" inputmode="numeric" id="c-total" value="${c.total ?? ''}"></label>
      <label class="field">تاريخ أول قسط<input type="date" id="c-start" value="${esc((c.startDate || '').slice(0, 10))}"></label>`}
    </div>
    <label class="field">كلمة تظهر في رسالة البنك عند السداد <span class="small">(اختياري: عشان أربط عمليات السداد بهذا الالتزام وما أحسبها من حدك اليومي)</span>
      <input type="text" id="c-key" value="${esc(c.keyword || '')}" placeholder="مثلاً: tabby أو اسم المؤجر"></label>
    <label class="switch"><input type="checkbox" id="c-approx" ${c.approx ? 'checked' : ''}> المبلغ تقريبي (يزيد أحياناً مثل فاتورة الجوال)</label>
    <button class="btn primary block" id="c-save">حفظ</button>
    ${c.id ? '<button class="btn danger block" id="c-del">حذف</button>' : ''}`, (p) => {
    const sync = () => { $('#c-finite', p).hidden = !['installment', 'loan'].includes($('#c-kind', p).value); };
    $('#c-kind', p).onchange = sync; sync();
    $('#c-save', p).onclick = () => {
      const amount = parseFloat($('#c-amount', p).value);
      const name = $('#c-name', p).value.trim();
      if (!name || !(amount > 0)) return toast('اكتب الاسم والمبلغ');
      const kind = $('#c-kind', p).value;
      const finite = ['installment', 'loan'].includes(kind);
      let startDate = $('#c-start', p)?.value || '', totalN = parseInt($('#c-total', p)?.value, 10) || 0;
      if (fromTx) { // هذي الدفعة = القسط الأول المسجّل، والباقي بعدها
        startDate = $('#c-paidon', p).value; totalN = 1 + (parseInt($('#c-left', p).value, 10) || 0);
      }
      const saved = store.saveCommitment({
        id: c.id, kind, name, amount, keyword: $('#c-key', p).value.trim(), approx: $('#c-approx', p).checked,
        day: parseInt($('#c-day', p).value, 10) || (startDate ? new Date(startDate).getDate() : 1),
        provider: finite ? $('#c-provider', p).value : '', total: finite ? totalN : 0,
        startDate: finite ? startDate : '',
      });
      if (fromTx) store.linkTxCommitment(fromTx.id, saved.id);
      closeSheet(); toast(fromTx ? '✅ انحفظ الالتزام وانربطت الدفعة فيه' : '✅ انحفظ الالتزام');
    };
    $('#c-del', p)?.addEventListener('click', () => { if (confirm('تحذف الالتزام؟')) { store.deleteCommitment(c.id); closeSheet(); } });
  });
}

// ---------------- الإعدادات ----------------
function renderSettings() {
  const s = store.getState();
  const rules = Object.entries(s.rules);
  const bRules = Object.entries(s.bucketRules || {});
  const B = s.settings.budget;
  const P = budget.plan(s);
  const TD = P ? budget.today(s, s.txs) : null;
  const detected = !(B.salary > 0) && budget.detectSalary(s.txs);
  const theme = THEMES[s.settings.theme] ? s.settings.theme : 'blue';
  const mode = s.settings.mode || 'auto';
  const nextPay = B.salary > 0 ? budget.cycleFor(new Date(), B.payday || 27, 1).start : null;
  const cardKeys = Object.keys(s.cards);

  const budgetBody = `${detected ? `<div class="alert">لقيت إيداع راتب ${money(detected.amount, 0)} ر.س يوم ${detected.day} — <a href="#" id="use-detected">استخدمه</a></div>` : ''}
    <div class="grid2" style="margin-top:12px">
      <label class="field">الراتب الشهري<input type="text" data-num inputmode="decimal" id="b-salary" value="${B.salary || ''}" placeholder="مثلاً 12000" ${B.salary > 0 ? 'hidden' : ''}>${B.salary > 0 ? '<button type="button" class="field-btn" id="b-salary-edit">تعديل</button>' : ''}</label>
      <label class="field">يوم نزول الراتب<input type="text" data-num inputmode="numeric" id="b-payday" value="${B.payday || 27}"></label>
      <label class="field">ادخار إضافي شهري<input type="text" data-num inputmode="decimal" id="b-savings" value="${B.savings || ''}" placeholder="0"></label>
      <label class="field">حد يومي ثابت<input type="text" data-num inputmode="decimal" id="b-daily" value="${B.dailyOverride || ''}" placeholder="${TD ? fmt(TD.plan.autoDaily, 0) : 'تلقائي'}"></label>
    </div>
    ${nextPay ? `<p class="small muted" style="margin:-4px 0 6px">الراتب الجاي: <b>${dateFmt.format(nextPay)}</b></p>` : ''}
    <label class="switch"><input type="checkbox" id="b-roll" ${B.rollover !== false ? 'checked' : ''}> ترحيل الفائض لليوم الجاي</label>
    ${P ? `<div class="plan small">
      <div class="kv"><span>الراتب</span><span>${money(P.salary, 0)}</span></div>
      <div class="kv"><span>− الالتزامات المسدّدة</span><span>${money(P.commitments, 0)}</span></div>
      ${P.investments || P.investmentsPlanned ? `<div class="kv"><span>− الاستثمار المحوَّل</span><span>${money(P.investments, 0)}</span></div>` : ''}
      ${P.extraSavings ? `<div class="kv"><span>− ادخار إضافي</span><span>${money(P.extraSavings, 0)}</span></div>` : ''}
      ${TD?.plan?.unplanned ? `<div class="kv"><span>− تحويلات متغيّرة (أوبشن)</span><span>${money(TD.plan.unplanned, 0)}</span></div>` : ''}
      <div class="kv total-line"><span>للصرف اليومي (${P.days} يوم)</span><span>${money(TD?.plan ? TD.plan.autoDaily : P.autoDaily, 0)} / يوم</span></div>
      ${P.forDaily < 0 ? '<div class="alert">التزاماتك وادخارك أكبر من راتبك — راجع الأرقام</div>' : ''}</div>` : ''}
    <button class="btn primary block" id="b-save">حفظ</button>`;

  view.innerHTML = [
    acc('profile', { ico: 'user', tint: '#8e8e93', title: 'الملف الشخصي', sub: esc(s.settings.name || 'بدون اسم'),
      body: `<label class="field" style="margin-top:12px">اسمك (يظهر في التحية)<input type="text" id="p-name" value="${esc(s.settings.name || '')}" placeholder="الاسم"></label>
        <button class="btn primary block" id="p-save">حفظ</button>` }),
    acc('look', { ico: 'paint-brush', tint: '#ff375f', title: 'المظهر', sub: `${THEMES[theme].name} · ${MODES[mode]}`,
      body: `<div class="sec-title">لون التطبيق</div><div class="swatches">${Object.entries(THEMES).map(([k, t]) =>
        `<button class="sw ${k === theme ? 'active' : ''}" data-theme-set="${k}" style="--c:${t.c}" aria-label="${t.name}">${svg('check', 'f')}</button>`).join('')}</div>
        <div class="sec-title">الوضع</div><div class="seg">${Object.entries(MODES).map(([k, n]) => `<button data-mode-set="${k}" class="${k === mode ? 'active' : ''}">${n}</button>`).join('')}</div>` }),
    acc('budget', { ico: 'wallet', tint: '#30b158', title: 'الراتب والميزانية', sub: B.salary > 0 ? `<span class="num m">${fmt(B.salary, 0)}</span> ر.س · يوم ${B.payday || 27}` : 'ما انضبط للحين', body: budgetBody }),
    acc('cards', { ico: 'credit-card', tint: '#0a7cff', title: 'البطاقات', sub: cardKeys.length ? `${cardKeys.length} ${cardKeys.length === 1 ? 'بطاقة' : 'بطاقات'}` : 'تنضاف تلقائياً من الرسائل',
      body: cardKeys.length ? `<ul class="list" style="margin-top:8px">${Object.entries(s.cards).map(([k, v]) => { const [b, c] = k.split('|'); return `
        <li class="row" style="cursor:default"><div class="main"><div class="title">${esc(b)} <span class="num">•${esc(c)}</span></div>
        <input type="text" placeholder="اسم مختصر (مثلاً: مدى الراتب)" value="${esc(v.nickname)}" data-nick="${esc(k)}" style="margin-top:6px"></div>
        <label class="switch" style="margin:0"><input type="checkbox" data-hide="${esc(k)}" ${v.hidden ? '' : 'checked'}></label></li>`; }).join('')}</ul>`
        : '<p class="small muted" style="margin:12px 0 0">ما فيه بطاقات للحين.</p>' }),
    acc('learned', { ico: 'sparkle', tint: '#af52de', title: 'اللي تعلّمته منك', sub: `${rules.length + bRules.length} ${rules.length + bRules.length === 1 ? 'قاعدة' : 'قواعد'}`,
      body: `${rules.length ? `<ul class="list" style="margin-top:8px">${rules.map(([k, c]) => `<li class="row" style="cursor:default"><div class="main"><div class="title">${esc(k)}</div>
        <div class="meta">${cat(c).icon} ${cat(c).name}</div></div><button class="chip small" data-rule="${esc(k)}">نسيان</button></li>`).join('')}</ul>`
        : '<p class="small muted" style="margin:12px 0 0">لما تغيّر تصنيف عملية، أتذكّر التاجر وأصنّف عملياته الجاية تلقائياً.</p>'}
        ${bRules.length ? `<div class="sec-title">يومي أو شهري</div><ul class="list">${bRules.map(([k, b]) => `<li class="row" style="cursor:default"><div class="main"><div class="title">${esc(k)}</div>
        <div class="meta">${BUCKETS[b].icon} ${BUCKETS[b].name}</div></div><button class="chip small" data-brule="${esc(k)}">نسيان</button></li>`).join('')}</ul>` : ''}` }),
    acc('data', { ico: 'cloud-arrow-up', tint: '#5856d6', title: 'البيانات والنسخ الاحتياطي', sub: `${s.txs.length} عملية محفوظة على جهازك`,
      body: `<p class="small muted" style="margin:12px 0 10px">بياناتك على جهازك بس. خذ نسخة قبل ما تحذف التطبيق أو تغيّر جوالك.</p>
        <div class="btns"><button class="btn" id="backup-copy">📋 نسخ النسخة</button><button class="btn" id="backup-paste">📥 استرجاع من الحافظة</button></div>
        <div class="btns" style="margin-top:10px"><button class="btn" id="backup">حفظ كملف</button><label class="btn">استرجاع من ملف<input type="file" id="restore" accept=".json,application/json" hidden></label></div>
        <button class="btn block" id="csv">تصدير CSV</button>
        <button class="btn danger block" id="wipe">حذف كل البيانات</button>` }),
    s.unparsed.length ? acc('unparsed', { ico: 'warning-circle', tint: '#ff3b30', title: 'رسائل ما انقرأت', sub: `${s.unparsed.length}`,
      body: `<div style="margin-top:12px">${s.unparsed.map((u) => `<div style="margin-bottom:12px"><div class="raw" dir="auto">${esc(u.text)}</div>
      <div class="btns" style="margin-top:8px"><button class="btn" data-manual="${u.id}">عدّل</button><button class="btn danger" data-rm="${u.id}">حذف</button></div></div>`).join('')}</div>` }) : '',
  ].join('');

  view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => store.removeUnparsed(b.dataset.rm));
  view.querySelectorAll('[data-manual]').forEach((b) => b.onclick = () => {
    openFixSheet(s.unparsed.find((x) => x.id === b.dataset.manual));
  });
  view.querySelectorAll('[data-nick]').forEach((i) => i.onchange = () => { ui.skipRender = true; store.updateCard(i.dataset.nick, { nickname: i.value.trim() }); });
  view.querySelectorAll('[data-hide]').forEach((i) => i.onchange = () => store.updateCard(i.dataset.hide, { hidden: !i.checked }));
  view.querySelectorAll('[data-rule]').forEach((b) => b.onclick = () => store.deleteRule(b.dataset.rule));
  view.querySelectorAll('[data-brule]').forEach((b) => b.onclick = () => store.deleteBucketRule(b.dataset.brule));
  view.querySelectorAll('[data-theme-set]').forEach((b) => b.onclick = () => store.updateSettings({ theme: b.dataset.themeSet }));
  view.querySelectorAll('[data-mode-set]').forEach((b) => b.onclick = () => store.updateSettings({ mode: b.dataset.modeSet }));
  const afterSave = (key, msg) => { closeAcc(key); ui.skipRender = true; toast(msg); setTimeout(() => { ui.skipRender = false; render(); }, 480); };
  $('#p-save').onclick = () => { ui.skipRender = true; store.updateSettings({ name: $('#p-name').value.trim() }); updateHeader(); afterSave('profile', '✅ انحفظ'); };
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : 0; };
  $('#b-salary-edit')?.addEventListener('click', (e) => { e.preventDefault(); e.target.hidden = true; const i = $('#b-salary'); i.hidden = false; i.focus(); });
  $('#use-detected')?.addEventListener('click', (e) => { e.preventDefault(); $('#b-salary').value = detected.amount; $('#b-payday').value = detected.day; });
  $('#b-save').onclick = () => {
    const payday = Math.min(Math.max(parseInt($('#b-payday').value, 10) || 27, 1), 31);
    ui.skipRender = true;
    store.updateBudget({ salary: num('#b-salary'), payday, savings: num('#b-savings'), dailyOverride: num('#b-daily'), rollover: $('#b-roll').checked });
    maybeArchive(); afterSave('budget', '✅ انحفظت الميزانية');
  };
  $('#csv').onclick = exportCSV;
  $('#backup').onclick = () => download(`hisba-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON(), 'application/json');
  $('#backup-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(store.exportJSON()); toast('✅ انسخت النسخة الاحتياطية — الصقها في ملاحظات أو رسالة لنفسك تحتفظ بها'); }
    catch { toast('ما قدرت أنسخ — جرّب «حفظ كملف»'); }
  };
  $('#backup-paste').onclick = async () => {
    let text = ''; try { text = await navigator.clipboard.readText(); } catch { /* */ }
    if (!tryBackup(text)) toast('ما لقيت نسخة احتياطية في الحافظة — انسخها أول');
  };
  $('#restore').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { store.importJSON(await f.text()); toast('✅ تم استرجاع النسخة'); } catch (err) { toast(esc(err.message)); }
  };
  $('#wipe').onclick = () => { if (confirm('متأكد؟ بتنحذف كل العمليات والإعدادات من هذا الجهاز.')) store.wipe(); };
}

function exportCSV() {
  const rows = [['التاريخ', 'النوع', 'المبلغ', 'العملة', 'التاجر', 'التصنيف', 'تنحسب من', 'البنك', 'البطاقة', 'مستبعدة']];
  for (const t of store.getState().txs.slice().sort((a, b) => new Date(a.date) - new Date(b.date))) {
    rows.push([new Date(t.date).toISOString().replace('T', ' ').slice(0, 16), typeLabel(t.type), t.amount, t.currency, t.merchant,
      cat(t.category).name, budget.counts(t) ? BUCKETS[budget.bucketOf(t, store.getState())].short : '', t.bank, t.card, t.excluded ? 'نعم' : '']);
  }
  const csv = rows.map((r) => r.map((v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = "'" + s; // حماية من حقن الصيغ في Excel
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\n');
  download(`hisba-${new Date().toISOString().slice(0, 10)}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
}

function download(name, content, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- تشغيل ----------------
// أيقونات شريط التبويبات (عادي + ممتلئ) وتحويل الإيموجي لأيقونات
document.querySelectorAll('.tabbar button').forEach((b) => {
  b.querySelector('.ti').innerHTML = `<span class="off">${svg(b.dataset.ic, 'r')}</span><span class="on">${svg(b.dataset.ic, 'f')}</span>`;
});
autoIconify(document.body);
window.addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', scrollY > 6), { passive: true });
syncTabs();
applyAppearance(); updateHeader();
setInterval(updateHeader, 60000);
refreshRates(store.getState, store.updateSettings);
ingestFromURL();
maybeArchive();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

let sy = 0, sRaf = 0;
addEventListener('scroll', () => { sy = scrollY; if (!sRaf) sRaf = requestAnimationFrame(() => { sRaf = 0; document.documentElement.style.setProperty('--sy', sy); }); }, { passive: true });
