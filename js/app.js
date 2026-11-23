import { CATEGORIES } from './categories.js';
import { splitBatch } from './parser.js';
import * as store from './store.js';
import { periodRange, inRange, totalsByCategory, dailySeries, monthlyTrend, topMerchants, detectSubscriptions, isExpense, sar } from './insights.js';
import { donut, bars, fmt } from './charts.js';
import * as budget from './budget.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = (k) => CATEGORIES[k] || CATEGORIES.other;
const money = (n, d = 2) => `<span class="num">${fmt(n, d)}</span>`;
const CUR_AR = { SAR: 'ر.س', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' };
const curLabel = (c) => CUR_AR[c] || c;
const BASE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

const ui = { tab: 'home', period: 'cycle', offset: 0, card: 'all', q: '', catFilter: 'all', rTab: 'summary', rOffset: 0, openCat: null };

const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });
const monthFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'long', year: 'numeric' });
const shortMonth = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { month: 'short' });
const timeFmt = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { hour: 'numeric', minute: '2-digit' });
const dayShort = new Intl.DateTimeFormat('ar-SA-u-nu-latn', { weekday: 'narrow' });
const fullFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'medium', timeStyle: 'short' });

// ---------------- Toast & Sheet ----------------
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.innerHTML = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function openSheet(html, onMount) {
  const s = $('#sheet');
  $('.sheet-panel', s).innerHTML = html;
  s.hidden = false;
  onMount?.($('.sheet-panel', s));
}
function closeSheet() { $('#sheet').hidden = true; }
$('#sheet').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });

// ---------------- الاستقبال من الاختصار ----------------
function ingestFromURL() {
  const p = new URLSearchParams(location.search);
  const sms = p.get('sms');
  if (sms == null) return;
  const res = store.addMessage(sms, { sender: p.get('from') || '', receivedAt: p.get('t') || undefined });
  history.replaceState(null, '', location.pathname);
  announce(res);
}

function announce(res) {
  if (res.status === 'added') {
    const t = res.tx, c = cat(t.category);
    toast(`${c.icon} انضافت: <b>${money(t.amount)} ${curLabel(t.currency)}</b> — ${esc(t.merchant || 'بدون اسم')} (${c.name})`);
  } else if (res.status === 'duplicate') toast('هذي الرسالة مضافة من قبل 👌');
  else if (res.status === 'unparsed') toast('ما قدرت أفهم الرسالة، حفظتها في الإعدادات ← «رسائل ما انقرأت»');
  else toast('الرسالة مو عملية مالية (رمز تحقق أو عملية مرفوضة) — تم تجاهلها');
}

// ---------------- التنقّل ----------------
document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  ui.tab = b.dataset.tab;
  document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x === b));
  render(); scrollTo(0, 0);
}));
$('#add-btn').addEventListener('click', openAddSheet);
// ضغطة وحدة: يقرأ رسالة البنك المنسوخة ويضيفها على طول
$('#paste-btn').addEventListener('click', async () => {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { /* المستخدم رفض أو المتصفح ما يدعم */ }
  const items = splitBatch(text || '');
  if (!items.length) {
    openAddSheet();
    return toast('انسخ رسالة البنك أولاً، أو الصقها هنا يدوياً');
  }
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

function render() {
  ({ home: renderHome, txs: renderTxs, reports: renderReports, commits: renderCommitments, settings: renderSettings })[ui.tab]();
}

// ---------------- الملخص ----------------
function renderHome() {
  const s = store.getState();
  const rates = s.settings.rates;
  const all = visibleTxs();
  if (!s.txs.length) {
    view.innerHTML = `<div class="empty"><div class="big">🧮</div><h2>أهلاً في حِسبَة</h2>
      <p>اربط اختصار الآيفون عشان تنضاف صرفياتك تلقائياً من رسائل البنك، أو الصق رسالة الحين وجرّب.</p>
      <div class="btns"><button class="btn primary" id="go-setup">إعداد الاختصار</button><button class="btn" id="go-add">الصق رسالة</button></div></div>`;
    $('#go-setup').onclick = () => { ui.tab = 'settings'; syncTabs(); render(); };
    $('#go-add').onclick = openAddSheet;
    return;
  }
  const payday = s.settings.budget.payday || 27;
  const hasBudget = s.settings.budget.salary > 0;
  if (ui.period === 'cycle' && !hasBudget) ui.period = 'month';
  const rangeOf = (o) => (ui.period === 'cycle' ? budget.cycleFor(new Date(), payday, o) : periodRange(ui.period, o));
  const range = rangeOf(ui.offset);
  const prev = rangeOf(ui.offset - 1);
  const txs = inRange(all, range);
  const spent = txs.filter(isExpense).reduce((a, t) => a + sar(t, rates), 0);
  const income = txs.filter((t) => t.type === 'income').reduce((a, t) => a + sar(t, rates), 0);
  const prevSpent = inRange(all, prev).filter(isExpense).reduce((a, t) => a + sar(t, rates), 0);
  const delta = prevSpent ? ((spent - prevSpent) / prevSpent) * 100 : null;
  const label = ui.period === 'month' ? monthFmt.format(range.start)
    : ui.period === 'cycle' ? `دورة ${range.start.getDate()} ${shortMonth.format(range.start)} – ${new Date(range.end - 1).getDate()} ${shortMonth.format(new Date(range.end - 1))}`
    : `${range.start.getDate()} ${shortMonth.format(range.start)} – ${new Date(range.end - 1).getDate()} ${shortMonth.format(new Date(range.end - 1))}`;

  const cats = totalsByCategory(txs, rates);
  const days = dailySeries(txs, range, rates);
  const today = new Date();
  const todayIdx = days.findIndex((d) => d.date.toDateString() === today.toDateString());
  const elapsed = ui.offset === 0 ? Math.max(todayIdx + 1, 1) : days.length;
  const cards = Object.keys(s.cards).filter((k) => !s.cards[k].hidden);

  view.innerHTML = `
    ${todayCard()}
    <div class="seg">${hasBudget ? `<button data-p="cycle" class="${ui.period === 'cycle' ? 'active' : ''}">دورة الراتب</button>` : ''}
      <button data-p="month" class="${ui.period === 'month' ? 'active' : ''}">شهري</button>
      <button data-p="week" class="${ui.period === 'week' ? 'active' : ''}">أسبوعي</button></div>
    ${cards.length > 1 ? `<select id="card-filter" style="margin-bottom:10px"><option value="all">كل البطاقات</option>${cards.map((k) => {
      const [b, c] = k.split('|'); return `<option value="${esc(k)}" ${ui.card === k ? 'selected' : ''}>${esc(cardName(b, c))}</option>`; }).join('')}</select>` : ''}
    <div class="period"><button id="prev" aria-label="السابق">→</button><span class="label">${label}</span>
      <button id="next" aria-label="التالي" ${ui.offset >= 0 ? 'disabled' : ''}>←</button></div>
    <div class="card hero">
      <div class="muted small">صرفت</div>
      <div class="total">${money(spent, 0)} <small>ر.س</small></div>
      ${delta != null ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} <span class="num">${fmt(Math.abs(delta))}%</span> عن ${{ month: 'الشهر', week: 'الأسبوع', cycle: 'الدورة' }[ui.period]} اللي قبلها</span>` : ''}
      <div class="muted small" style="margin-top:8px">متوسط يومي ${money(spent / elapsed, 0)} ر.س${income ? ` · دخل ${money(income, 0)} ر.س` : ''}</div>
    </div>
    <div class="card"><h2>حسب التصنيف</h2>
      ${cats.length ? `<div class="donut-wrap"><div id="donut"></div><ul class="legend">${cats.map((c) => `
        <li data-cat="${c.category}"><span class="dot" style="background:${cat(c.category).color}"></span>
        <span class="name">${cat(c.category).icon} ${cat(c.category).name}</span><span class="num">${fmt(c.total)}</span>
        <span class="pct num">${fmt((c.total / spent) * 100)}%</span></li>`).join('')}</ul></div>` : '<p class="muted">ما فيه صرف بهذي الفترة</p>'}
    </div>
    <div class="card"><h2>${ui.period === 'week' ? 'أيام الأسبوع' : 'الصرف اليومي'} <small>— الخط المتقطّع = المتوسط</small></h2><div id="bars"></div></div>
    <div class="card"><h2>أكثر الأماكن صرفاً</h2><ul class="list">${topMerchants(txs, 5, rates).map((m) => `
      <li class="row" style="cursor:default"><div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${m.count} عمليات</div></div>
      <div class="amt">${money(m.total, 0)} ر.س</div></li>`).join('') || '<li class="muted">—</li>'}</ul></div>
    <div class="card"><h2>آخر ٦ شهور</h2><div id="trend"></div></div>`;

  view.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { ui.period = b.dataset.p; ui.offset = 0; render(); });
  $('#go-budget')?.addEventListener('click', () => { ui.tab = 'settings'; syncTabs(); render(); $('#budget')?.scrollIntoView(); });
  $('#prev').onclick = () => { ui.offset--; render(); };
  $('#next').onclick = () => { if (ui.offset < 0) { ui.offset++; render(); } };
  $('#card-filter')?.addEventListener('change', (e) => { ui.card = e.target.value; render(); });
  view.querySelectorAll('.legend li').forEach((li) => li.onclick = () => {
    ui.catFilter = li.dataset.cat; ui.tab = 'txs'; syncTabs(); render();
  });
  if (cats.length) $('#donut').appendChild(donut(cats.map((c) => ({ value: c.total, color: cat(c.category).color, label: cat(c.category).name })),
    { center: fmt(spent, 0), sub: 'ر.س' }));
  $('#bars').appendChild(bars(days.map((d) => ({ value: d.total, label: ui.period === 'week' ? dayShort.format(d.date) : String(d.date.getDate()) })),
    { labelEvery: ui.period === 'week' ? 1 : 5, highlight: ui.offset === 0 ? todayIdx : -1 }));
  $('#today-bar')?.addEventListener('click', () => { ui.tab = 'reports'; ui.rTab = 'summary'; ui.rOffset = 0; syncTabs(); render(); });
  const trend = monthlyTrend(all, 6, new Date(), rates);
  $('#trend').appendChild(bars(trend.map((m) => ({ value: m.total, label: shortMonth.format(m.start) })), { height: 130, highlight: 5 }));
}

function syncTabs() {
  document.querySelectorAll('.tabbar button').forEach((x) => x.classList.toggle('active', x.dataset.tab === ui.tab));
}

// ---------------- العمليات ----------------
function txRow(t) {
  const c = cat(t.category);
  const sign = t.type === 'income' ? '+' : '';
  const meta = [timeFmt.format(new Date(t.date)), cardName(t.bank, t.card), c.name].filter(Boolean).join(' · ');
  const bk = budget.counts(t) && store.getState().settings.budget.salary > 0 ? budget.bucketOf(t, store.getState()) : 'daily';
  return `<li class="row ${t.excluded ? 'excluded' : ''}" data-id="${t.id}">
    <div class="ic" style="background:${c.color}22">${c.icon}</div>
    <div class="main"><div class="title">${esc(t.merchant || typeLabel(t.type))}${t.confidence === 'low' ? '<span class="badge warn">راجعها</span>' : ''}${bk !== 'daily' ? `<span class="badge">${BUCKETS[bk].short}</span>` : ''}${t.excluded ? '<span class="badge">مستبعدة</span>' : ''}</div>
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
    <div class="toolbar"><input type="search" id="q" placeholder="🔍 ابحث…" value="${esc(ui.q)}">
      <select id="cat-f"><option value="all">كل التصنيفات</option>${Object.entries(CATEGORIES).map(([k, c]) =>
        `<option value="${k}" ${ui.catFilter === k ? 'selected' : ''}>${c.icon} ${c.name}</option>`).join('')}</select></div>
    ${s.unparsed.length ? `<div class="card small" id="unparsed-note">⚠️ فيه <b>${s.unparsed.length}</b> رسالة ما قدرت أقراها — <a href="#" id="go-unparsed">راجعها</a></div>` : ''}
    ${groups.length ? groups.map((g) => {
      const dayTotal = g.items.filter(isExpense).reduce((a, t) => a + sar(t, s.settings.rates), 0);
      return `<div class="day-head"><span>${dateFmt.format(g.d)}</span><span>${money(dayTotal, 0)} ر.س</span></div>
      <div class="card" style="padding:4px 14px"><ul class="list">${g.items.map(txRow).join('')}</ul></div>`;
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
    <label class="switch"><input type="checkbox" id="bk-remember" checked> تذكّر هذا الاختيار لـ«${esc(t.merchant || '—')}»</label>` : ''}
    <label class="field">اسم التاجر<input type="text" id="e-merchant" value="${esc(t.merchant)}"></label>
    <label class="field">المبلغ (${curLabel(t.currency)})<input type="number" step="0.01" inputmode="decimal" id="e-amount" value="${t.amount}"></label>
    <label class="field">النوع<select id="e-type">${['purchase', 'bill', 'transfer', 'withdrawal', 'income'].map((k) =>
      `<option value="${k}" ${t.type === k ? 'selected' : ''}>${typeLabel(k)}</option>`).join('')}</select></label>
    <label class="switch"><input type="checkbox" id="e-excl" ${t.excluded ? 'checked' : ''}> استبعدها من الإحصائيات (مثلاً تحويل بين حساباتك)</label>
    ${t.raw ? `<details><summary class="small">نص الرسالة الأصلي</summary><div class="raw" dir="auto">${esc(t.raw)}</div></details>` : ''}
    <button class="btn primary block" id="save">حفظ</button>
    <button class="btn danger block" id="del">حذف العملية</button>`, (p) => {
    p.querySelectorAll('#cat-chips .chip').forEach((b) => b.onclick = () => {
      chosen = b.dataset.k; p.querySelectorAll('#cat-chips .chip').forEach((x) => x.classList.toggle('active', x === b));
    });
    p.querySelectorAll('#bk-chips .chip').forEach((b) => b.onclick = () => {
      chosenBucket = b.dataset.b; p.querySelectorAll('#bk-chips .chip').forEach((x) => x.classList.toggle('active', x === b));
    });
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
      if (chosenBucket !== curBucket) {
        const n = store.setBucket(id, chosenBucket, $('#bk-remember', p)?.checked);
        if (n > 1) toast(`✅ عمليات «${esc(t.merchant)}» صارت تنحسب ${BUCKETS[chosenBucket].name}`);
      }
      closeSheet();
    };
    $('#del', p).onclick = () => { if (confirm('تحذف العملية؟')) { store.deleteTx(id); closeSheet(); } };
  });
}

// ---------------- إضافة ----------------
function openAddSheet() {
  openSheet(`
    <h3>إضافة عملية</h3>
    <div class="seg"><button class="active" data-m="sms">لصق رسالة بنك</button><button data-m="manual">إدخال يدوي</button></div>
    <div id="m-sms">
      <textarea id="sms-text" dir="auto" placeholder="الصق نص رسالة البنك هنا (تقدر تلصق أكثر من رسالة، افصل بينها بسطر فاضي)"></textarea>
      <div class="btns" style="margin-top:8px"><button class="btn" id="paste">📋 لصق من الحافظة</button><button class="btn primary" id="add-sms">إضافة</button></div>
    </div>
    <div id="m-manual" hidden>
      <label class="field">المبلغ (ر.س)<input type="number" step="0.01" inputmode="decimal" id="m-amount"></label>
      <label class="field">المكان / التاجر<input type="text" id="m-merchant"></label>
      <label class="field">التصنيف<select id="m-cat"><option value="">تلقائي</option>${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}">${c.icon} ${c.name}</option>`).join('')}</select></label>
      <label class="field">التاريخ<input type="datetime-local" id="m-date"></label>
      <button class="btn primary block" id="add-manual">إضافة</button>
    </div>`, (p) => {
    const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $('#m-date', p).value = d.toISOString().slice(0, 16);
    p.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => {
      p.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('active', x === b));
      $('#m-sms', p).hidden = b.dataset.m !== 'sms'; $('#m-manual', p).hidden = b.dataset.m !== 'manual';
    });
    $('#paste', p).onclick = async () => {
      try { $('#sms-text', p).value = await navigator.clipboard.readText(); } catch { toast('ما قدرت أقرأ الحافظة — الصق يدوياً'); }
    };
    $('#add-sms', p).onclick = () => {
      const items = splitBatch($('#sms-text', p).value);
      if (!items.length) return;
      closeSheet();
      if (items.length === 1) announce(store.addMessage(items[0].text, items[0]));
      else importReport(store.addMany(items));
    };
    $('#add-manual', p).onclick = () => {
      const amount = parseFloat($('#m-amount', p).value);
      if (!(amount > 0)) return toast('اكتب المبلغ');
      const tx = store.addManual({ amount, merchant: $('#m-merchant', p).value.trim(), date: new Date($('#m-date', p).value).toISOString(),
        ...($('#m-cat', p).value ? { category: $('#m-cat', p).value, categorySource: 'manual' } : {}) });
      closeSheet(); announce({ status: 'added', tx });
    };
  });
}

function importReport(c) {
  toast(`✅ انضافت ${c.added} · مكررة ${c.duplicate} · متجاهلة ${c.ignored}${c.unparsed ? ` · ما انقرأت ${c.unparsed}` : ''}`, 5000);
}

// ---------------- بطاقة اليوم (الحد اليومي) ----------------
function todayCard() {
  const s = store.getState();
  if (!(s.settings.budget.salary > 0)) {
    return `<div class="card budget-cta"><b>💡 حدد راتبك ويوم نزوله</b><p class="small muted">وأحسب لك حد يومي يترحّل فايضه لبكرة، وأعرّفك وين توصل قبل الراتب الجاي.</p>
      <button class="btn primary block" id="go-budget">إعداد الميزانية</button></div>`;
  }
  const r = budget.today(s, visibleTxs());
  const p = r.plan;
  const pct = Math.min(Math.max(r.spentToday / Math.max(r.allowance, 1), 0), 1) * 100;
  const daysToSalary = p.days - r.idx;
  const monthlyLeft = p.monthlyBudget - r.monthlySpent;
  return `<div class="card today ${r.remainingToday < 0 ? 'neg' : ''}" id="today-bar">
    <div class="today-top"><div><div class="muted small">باقي لك اليوم</div>
      <div class="today-amt">${money(r.remainingToday, 0)} <small>ر.س</small></div></div>
      <div class="ring" style="--p:${pct}"><span class="num">${fmt(pct)}%</span></div></div>
    <div class="meter"><span style="width:${pct}%"></span></div>
    <div class="today-meta small">
      <span>صرفت اليوم ${money(r.spentToday, 0)}</span>
      <span>حدك ${money(p.daily, 0)}${p.rollover && Math.abs(r.carry) >= 1 ? ` ${r.carry > 0 ? '+' : '−'} ${money(Math.abs(r.carry), 0)} مرحّل` : ''}</span>
    </div>
    ${r.remainingToday < 0 ? `<div class="alert small">⚠️ تجاوزت حدك اليوم بـ ${money(-r.remainingToday, 0)} ر.س${p.rollover ? '، وبينخصم من حد الأيام الجاية' : ''}</div>` : ''}
    <div class="today-grid small">
      <div><b>${daysToSalary}</b><span>يوم للراتب</span></div>
      <div><b>${money(r.dailyLeft, 0)}</b><span>باقي من الحدود اليومية</span></div>
      ${p.monthlyBudget > 0 ? `<div><b class="${monthlyLeft < 0 ? 'bad' : ''}">${money(monthlyLeft, 0)}</b><span>باقي من ميزانية الشهر</span></div>` : ''}
      ${Math.abs(r.suggestedDaily - p.daily) > p.daily * 0.1 ? `<div><b>${money(r.suggestedDaily, 0)}</b><span>حدك الواقعي لين الراتب</span></div>` : ''}
    </div></div>`;
}

// ---------------- التقارير ----------------
function maybeArchive() {
  const s = store.getState();
  const b = s.settings.budget;
  if (!(b.salary > 0)) return;
  const prev = budget.cycleFor(new Date(), b.payday || 27, -1);
  const p = budget.plan(s);
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
  const range = hasBudget ? budget.cycleFor(new Date(), payday, ui.rOffset) : periodRange('month', ui.rOffset);
  const snap = s.archive.find((a) => a.start === range.start.toISOString());
  const p = budget.plan(s);
  const salary = snap?.salary ?? p?.salary ?? 0;
  const daily = snap?.daily ?? p?.daily ?? 0;
  const R = budget.cycleReport(s, all, range, daily);
  const label = `${range.start.getDate()} ${shortMonth.format(range.start)} – ${new Date(range.end - 1).getDate()} ${shortMonth.format(new Date(range.end - 1))} ${range.start.getFullYear()}`;
  const tabs = { summary: 'التقرير', places: 'وين أصرف', habits: 'عاداتي', archive: 'الأرشيف' };

  let body = '';
  if (ui.rTab === 'summary') body = reportSummary(R, salary, daily, hasBudget);
  else if (ui.rTab === 'places') body = reportPlaces(R);
  else if (ui.rTab === 'habits') body = reportHabits();
  else body = reportArchive(all, hasBudget, payday);

  view.innerHTML = `
    <div class="seg">${Object.entries(tabs).map(([k, n]) => `<button data-rt="${k}" class="${ui.rTab === k ? 'active' : ''}">${n}</button>`).join('')}</div>
    ${['summary', 'places'].includes(ui.rTab) ? `<div class="period"><button id="rprev" aria-label="السابق">→</button>
      <span class="label">${hasBudget ? 'دورة ' : ''}${label}</span><button id="rnext" aria-label="التالي" ${ui.rOffset >= 0 ? 'disabled' : ''}>←</button></div>` : ''}
    ${body}`;

  view.querySelectorAll('[data-rt]').forEach((x) => x.onclick = () => { ui.rTab = x.dataset.rt; render(); });
  $('#rprev')?.addEventListener('click', () => { ui.rOffset--; render(); });
  $('#rnext')?.addEventListener('click', () => { if (ui.rOffset < 0) { ui.rOffset++; render(); } });
  if (ui.rTab === 'summary' && R.total) {
    $('#r-days').appendChild(bars(R.perDay.map((v, i) => ({ value: v, label: String(new Date(range.start.getTime() + i * 864e5).getDate()) })),
      { labelEvery: 5, limit: daily, highlight: R.perDay.indexOf(Math.max(...R.perDay)) }));
    $('#r-donut').appendChild(donut(R.byCategory.map((c) => ({ value: c.total, color: cat(c.key).color, label: cat(c.key).name })), { center: fmt(R.total, 0), sub: 'ر.س' }));
  }
  view.querySelectorAll('[data-cat-toggle]').forEach((x) => x.onclick = () => { ui.openCat = ui.openCat === x.dataset.catToggle ? null : x.dataset.catToggle; render(); });
  view.querySelectorAll('[data-merchant]').forEach((x) => x.onclick = () => openMerchantSheet(x.dataset.merchant, range));
  view.querySelectorAll('[data-cycle]').forEach((x) => x.onclick = () => { ui.rOffset = +x.dataset.cycle; ui.rTab = 'summary'; render(); scrollTo(0, 0); });
}

const pctBar = (pct, color = 'var(--primary)') => `<div class="meter thin"><span style="width:${Math.min(pct, 100)}%;background:${color}"></span></div>`;

function reportSummary(R, salary, daily, hasBudget) {
  if (!R.total) return '<div class="empty"><div class="big">📭</div>ما فيه صرف بهذي الدورة</div>';
  const saved = salary - R.total;
  const slotMax = Math.max(...Object.values(R.slots), 1);
  const wdMax = Math.max(...R.weekday, 1);
  return `
    <div class="card hero"><div class="muted small">إجمالي الصرف</div>
      <div class="total">${money(R.total, 0)} <small>ر.س</small></div>
      ${hasBudget ? `<div class="small muted">${fmt((R.total / salary) * 100)}% من الراتب · ${saved >= 0 ? `تبقّى <b class="good">${money(saved, 0)}</b>` : `تجاوزت الراتب بـ <b class="bad">${money(-saved, 0)}</b>`} ر.س</div>
      ${pctBar((R.total / salary) * 100, saved >= 0 ? 'var(--primary)' : 'var(--danger)')}` : ''}
      <div class="stats small">
        <div><b>${money(R.avgPerDay, 0)}</b><span>متوسط يومي</span></div>
        <div><b>${R.count}</b><span>عملية</span></div>
        <div><b>${R.noSpendDays}</b><span>يوم بدون صرف</span></div>
        ${R.daysOver != null ? `<div><b class="${R.daysOver ? 'bad' : 'good'}">${R.daysOver}</b><span>يوم تجاوزت الحد</span></div>` : ''}
      </div></div>
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

function reportPlaces(R) {
  if (!R.total) return '<div class="empty"><div class="big">📭</div>ما فيه صرف بهذي الدورة</div>';
  return `<p class="small muted" style="margin:0 4px 10px">اضغط على أي تصنيف عشان تشوف المحلات، وعلى أي محل عشان تشوف عملياته.</p>
    ${R.byCategory.map((c) => {
      const open = ui.openCat === c.key;
      const ms = R.merchants.filter((m) => m.category === c.key);
      return `<div class="card place ${open ? 'open' : ''}">
        <div class="place-head" data-cat-toggle="${c.key}"><div class="ic" style="background:${cat(c.key).color}22">${cat(c.key).icon}</div>
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
  const first = new Date(Math.min(...all.map((t) => +new Date(t.date))));
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
  view.innerHTML = `
    <div class="card hero"><div class="muted small">التزاماتك الشهرية</div>
      <div class="total">${money(total, 0)} <small>ر.س / شهر</small></div>
      ${salary > 0 ? `<div class="small muted"><span class="num">${fmt((total / salary) * 100)}%</span> من راتبك</div>${pctBar((total / salary) * 100, total / salary > 0.5 ? 'var(--danger)' : 'var(--primary)')}` : ''}
      ${remainingDebt ? `<div class="small muted" style="margin-top:6px">باقي عليك من الأقساط والقروض: <b>${money(remainingDebt, 0)}</b> ر.س</div>` : ''}
    </div>
    <button class="btn primary block" id="add-c" style="margin:0 0 12px">＋ إضافة التزام</button>
    ${list.length ? `<div class="card" style="padding:4px 14px"><ul class="list">${list.map(({ c, st }) => {
      const k = budget.COMMITMENT_KINDS[c.kind] || budget.COMMITMENT_KINDS.other;
      return `<li class="row ${st.active ? '' : 'excluded'}" data-c="${c.id}"><div class="ic" style="background:var(--track)">${k.icon}</div>
        <div class="main"><div class="title">${esc(c.name)}${c.provider ? `<span class="badge">${esc(c.provider)}</span>` : ''}</div>
          <div class="meta wrap">${k.name}${st.next ? ` · الدفعة الجاية ${dateFmt.format(st.next)}` : ''}${st.remaining != null ? ` · ${st.active ? `باقي ${st.remaining} من ${c.total}` : 'خلص ✅'}` : ''}</div>
          ${st.paid != null ? pctBar((st.paid / c.total) * 100) : ''}</div>
        <div class="amt">${money(c.amount, 0)} ر.س</div></li>`;
    }).join('')}</ul></div>` : '<div class="empty small">ما أضفت أي التزام. أضف إيجارك وفواتيرك وأقساطك عشان تنخصم من راتبك قبل ما أحسب حدك اليومي.</div>'}
    ${inst.length ? `<div class="card"><h2>🧩 أقساط لقيتها في عملياتك</h2>${inst.map((x, i) => `<div class="kv"><span>${esc(x.name)} <span class="badge">${x.provider}</span></span>
      <button class="chip" data-inst="${i}">إضافة</button></div>`).join('')}</div>` : ''}
    ${subs.length ? `<div class="card"><h2>🔁 اشتراكات اكتشفتها</h2>${subs.map((x, i) => `<div class="kv"><span>${esc(x.name)} · ${money(x.amount)} ${curLabel(x.currency)}${x.stale ? ' <span class="badge">يمكن ألغيته؟</span>' : ''}</span>
      <span><button class="chip" data-sub="${i}">إضافة</button> <button class="chip" data-dismiss="${esc(x.key)}">مو اشتراك</button></span></div>`).join('')}</div>` : ''}`;
  $('#add-c').onclick = () => openCommitmentSheet();
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

function openCommitmentSheet(c = {}) {
  const kinds = budget.COMMITMENT_KINDS;
  openSheet(`<h3>${c.id ? 'تعديل التزام' : 'التزام جديد'}</h3>
    <label class="field">النوع<select id="c-kind">${Object.entries(kinds).map(([k, v]) => `<option value="${k}" ${c.kind === k ? 'selected' : ''}>${v.icon} ${v.name}</option>`).join('')}</select></label>
    <label class="field">الاسم<input type="text" id="c-name" value="${esc(c.name || '')}" placeholder="مثلاً: إيجار الشقة، قسط الجوال"></label>
    <label class="field">المبلغ الشهري (ر.س)<input type="number" step="0.01" inputmode="decimal" id="c-amount" value="${c.amount ?? ''}"></label>
    <label class="field">يوم الدفع بالشهر<input type="number" min="1" max="31" inputmode="numeric" id="c-day" value="${c.day ?? ''}"></label>
    <div id="c-finite">
      <label class="field">الجهة<select id="c-provider">${['', 'تابي', 'تمارا', 'بنك', 'أخرى'].map((x) => `<option ${c.provider === x ? 'selected' : ''} value="${x}">${x || '—'}</option>`).join('')}</select></label>
      <label class="field">عدد الأقساط الكلي<input type="number" min="1" inputmode="numeric" id="c-total" value="${c.total ?? ''}"></label>
      <label class="field">تاريخ أول قسط<input type="date" id="c-start" value="${esc((c.startDate || '').slice(0, 10))}"></label>
    </div>
    <label class="field">كلمة تظهر في رسالة البنك عند السداد <span class="small">(اختياري: عشان أربط عمليات السداد بهذا الالتزام وما أحسبها من حدك اليومي)</span>
      <input type="text" id="c-key" value="${esc(c.keyword || '')}" placeholder="مثلاً: tabby أو اسم المؤجر"></label>
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
      const startDate = $('#c-start', p).value;
      store.saveCommitment({
        id: c.id, kind, name, amount, keyword: $('#c-key', p).value.trim(),
        day: parseInt($('#c-day', p).value, 10) || (startDate ? new Date(startDate).getDate() : 1),
        provider: finite ? $('#c-provider', p).value : '', total: finite ? parseInt($('#c-total', p).value, 10) || 0 : 0,
        startDate: finite ? startDate : '',
      });
      closeSheet(); toast('✅ انحفظ الالتزام');
    };
    $('#c-del', p)?.addEventListener('click', () => { if (confirm('تحذف الالتزام؟')) { store.deleteCommitment(c.id); closeSheet(); } });
  });
}

// ---------------- الإعدادات ----------------
function renderSettings() {
  const s = store.getState();
  const exampleURL = `${BASE_URL}?sms=`;
  const rules = Object.entries(s.rules);
  const bRules = Object.entries(s.bucketRules || {});
  const B = s.settings.budget;
  const P = budget.plan(s);
  const detected = !(B.salary > 0) && budget.detectSalary(s.txs);
  view.innerHTML = `
    <div class="card" id="budget"><h2>💰 الراتب والميزانية</h2>
      ${detected ? `<div class="alert small">لقيت إيداع راتب ${money(detected.amount, 0)} ر.س يوم ${detected.day} — <a href="#" id="use-detected">استخدمه</a></div>` : ''}
      <div class="grid2">
        <label class="field">الراتب الشهري (ر.س)<input type="number" inputmode="decimal" id="b-salary" value="${B.salary || ''}" placeholder="مثلاً 12000"></label>
        <label class="field">يوم نزول الراتب<input type="number" min="1" max="31" inputmode="numeric" id="b-payday" value="${B.payday || 27}"></label>
        <label class="field">هدف ادخار شهري<input type="number" inputmode="decimal" id="b-savings" value="${B.savings || ''}" placeholder="0"></label>
        <label class="field">ميزانية مشتريات شهرية<input type="number" inputmode="decimal" id="b-monthly" value="${B.monthlyBudget || ''}" placeholder="0"></label>
      </div>
      <p class="small muted" style="margin-top:-4px">«ميزانية المشتريات الشهرية» للأشياء الكبيرة اللي ما تبغاها تاكل حدك اليومي (ملابس، أجهزة، هدايا…). تختار لكل عملية: يومي أو شهري.</p>
      <label class="field">الحد اليومي (ر.س) <span class="small">— خلّه فاضي عشان أحسبه تلقائياً${P ? `: <b>${fmt(P.autoDaily, 0)}</b>` : ''}</span>
        <input type="number" inputmode="decimal" id="b-daily" value="${B.dailyOverride || ''}" placeholder="${P ? fmt(P.autoDaily, 0) : 'تلقائي'}"></label>
      <label class="switch"><input type="checkbox" id="b-roll" ${B.rollover !== false ? 'checked' : ''}> ترحيل الفائض: اللي ما تصرفه اليوم ينضاف لحد بكرة (والتجاوز ينخصم منه)</label>
      ${P ? `<div class="plan small">
        <div class="kv"><span>الراتب</span><span>${money(P.salary, 0)}</span></div>
        <div class="kv"><span>− الالتزامات الشهرية</span><span>${money(P.commitments, 0)}</span></div>
        <div class="kv"><span>− الادخار</span><span>${money(P.savings, 0)}</span></div>
        <div class="kv"><span>− ميزانية المشتريات الشهرية</span><span>${money(P.monthlyBudget, 0)}</span></div>
        <div class="kv total-line"><span>= للصرف اليومي (${P.days} يوم)</span><span>${money(P.forDaily, 0)} ← ${money(P.autoDaily, 0)}/يوم</span></div>
        ${P.forDaily < 0 ? '<div class="alert">⚠️ التزاماتك وادخارك أكبر من راتبك — راجع الأرقام</div>' : ''}
      </div>` : ''}
      <button class="btn primary block" id="b-save">حفظ الميزانية</button>
    </div>

    <div class="card"><h2>⚡ ربط اختصارات الآيفون</h2>
      <p class="small muted">iOS ما يسمح لأي تطبيق يقرأ الرسائل مباشرة، فنستخدم «أتمتة» في تطبيق الاختصارات تمرّر رسالة البنك لحِسبَة تلقائياً.</p>
      <div class="seg" id="mode-seg"><button class="active" data-mode="url">الطريقة الفورية</button><button data-mode="file">الطريقة الصامتة</button></div>
      <div id="mode-file" hidden>
        <ol class="steps small">
          <li>افتح <b>الاختصارات</b> ← <b>الأتمتة</b> ← <b>＋</b> ← <b>الرسالة</b>.</li>
          <li>في <b>المرسل</b> اختر اسم البنك (تقدر تسوي أتمتة لكل بنك)، واختر <b>تشغيل فوراً</b>.</li>
          <li>أضف إجراء <b>نص</b> واكتب فيه:<br><code>#### </code> ثم متغيّر <b>التاريخ الحالي</b> (التنسيق: ISO 8601) ثم <code> | </code> ثم متغيّر <b>المرسل</b>، وفي سطر جديد متغيّر <b>الرسالة</b> (المحتوى).</li>
          <li>أضف إجراء <b>إلحاق بملف نصي</b>، والملف: <code>Shortcuts/hisba.txt</code> في iCloud Drive، وفعّل «سطر جديد».</li>
          <li>كل ما تبغى تحدّث صرفياتك: اضغط الزر تحت واختر ملف <b>hisba.txt</b>. الرسائل المكررة ما تنضاف مرتين، فما يحتاج تمسح الملف.</li>
        </ol>
        <label class="btn primary block">📥 استيراد رسائل من ملف<input type="file" id="import-file" accept=".txt,text/plain" hidden></label>
        <p class="small muted">ميزة هالطريقة: ما يفتح شي كل ما وصلتك رسالة، والتطبيق يشتغل من الشاشة الرئيسية.</p>
      </div>
      <div id="mode-url">
        <ol class="steps small">
          <li>نفس الخطوة ١ و٢ فوق (أتمتة ← الرسالة ← المرسل: البنك ← تشغيل فوراً).</li>
          <li>أضف إجراء <b>ترميز URL</b> على متغيّر <b>الرسالة</b>.</li>
          <li>أضف إجراء <b>عنوان URL</b> واكتب: <code>${esc(exampleURL)}</code> ثم ناتج الترميز، ثم <code>&amp;from=</code> ومتغيّر <b>المرسل</b>.</li>
          <li>أضف إجراء <b>فتح عناوين URL</b>.</li>
        </ol>
        <button class="btn block" id="copy-url">📋 نسخ الرابط</button>
        <p class="small muted">⚠️ هالطريقة تفتح سفاري كل ما وصلت رسالة، وتنحفظ العمليات في نسخة سفاري (iOS يفصل بيانات سفاري عن التطبيق المضاف للشاشة الرئيسية). استخدم حِسبَة من سفاري لو اخترتها.</p>
        <button class="btn block" id="test-url">🧪 جرّب رابط تجريبي</button>
      </div>
    </div>

    ${s.unparsed.length ? `<div class="card" id="unparsed"><h2>رسائل ما انقرأت <small>(${s.unparsed.length})</small></h2>
      ${s.unparsed.map((u) => `<div style="margin-bottom:10px"><div class="raw" dir="auto">${esc(u.text)}</div>
      <div class="btns" style="margin-top:6px"><button class="btn small" data-manual="${u.id}">إدخال يدوي</button><button class="btn small danger" data-rm="${u.id}">حذف</button></div></div>`).join('')}
      <p class="small muted">لو بنكك يرسل بصيغة ما فهمتها، أرسل نص الرسالة (بعد ما تخفي الأرقام الحساسة) عشان ينضاف دعمها.</p></div>` : ''}

    <div class="card"><h2>💳 البطاقات <small>— تنضاف تلقائياً من الرسائل</small></h2>
      ${Object.keys(s.cards).length ? `<ul class="list">${Object.entries(s.cards).map(([k, v]) => { const [b, c] = k.split('|'); return `
        <li class="row" style="cursor:default"><div class="main"><div class="title">${esc(b)} <span class="num">•${esc(c)}</span></div>
        <input type="text" placeholder="اسم مختصر (مثلاً: مدى الراتب)" value="${esc(v.nickname)}" data-nick="${esc(k)}" style="margin-top:4px"></div>
        <label class="switch" style="margin:0"><input type="checkbox" data-hide="${esc(k)}" ${v.hidden ? '' : 'checked'}> تُحسب</label></li>`; }).join('')}</ul>`
        : '<p class="small muted">ما فيه بطاقات للحين.</p>'}
    </div>

    <div class="card"><h2>🧠 اللي تعلّمته منك <small>(${rules.length})</small></h2>
      ${rules.length ? `<ul class="list">${rules.map(([k, c]) => `<li class="row" style="cursor:default"><div class="main"><div class="title">${esc(k)}</div>
        <div class="meta">${cat(c).icon} ${cat(c).name}</div></div><button class="chip" data-rule="${esc(k)}">نسيان</button></li>`).join('')}</ul>`
        : '<p class="small muted">لما تغيّر تصنيف عملية، أتذكّر التاجر وأصنّف عملياته الجاية تلقائياً.</p>'}
      ${bRules.length ? `<h2 style="margin-top:14px">☀️/🗓️ يومي أو شهري</h2><ul class="list">${bRules.map(([k, b]) => `<li class="row" style="cursor:default"><div class="main"><div class="title">${esc(k)}</div>
        <div class="meta">${BUCKETS[b].icon} ${BUCKETS[b].name}</div></div><button class="chip" data-brule="${esc(k)}">نسيان</button></li>`).join('')}</ul>` : ''}
    </div>

    <div class="card"><h2>💱 أسعار العملات <small>(بالريال، للعمليات الأجنبية)</small></h2>
      <div class="chips">${Object.entries(s.settings.rates).map(([c, r]) => `<label class="small" style="display:flex;align-items:center;gap:6px">${c}
        <input type="number" step="0.01" value="${r}" data-rate="${c}" style="width:80px;padding:6px 8px"></label>`).join('')}</div>
    </div>

    <div class="card"><h2>📤 البيانات</h2>
      <p class="small muted">كل بياناتك محفوظة على جهازك بس — ما فيه حساب ولا خادم. خذ نسخة احتياطية بين فترة وثانية.</p>
      <div class="btns"><button class="btn" id="csv">تصدير CSV</button><button class="btn" id="backup">نسخة احتياطية</button></div>
      <label class="btn block">استرجاع نسخة احتياطية<input type="file" id="restore" accept=".json,application/json" hidden></label>
      <button class="btn danger block" id="wipe">حذف كل البيانات</button>
      <p class="small muted" style="text-align:center;margin-top:12px">${s.txs.length} عملية محفوظة</p>
    </div>`;

  view.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => {
    view.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
    $('#mode-file').hidden = b.dataset.mode !== 'file'; $('#mode-url').hidden = b.dataset.mode !== 'url';
  });
  $('#import-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    importReport(store.addMany(splitBatch(await f.text())));
  };
  $('#copy-url').onclick = () => navigator.clipboard.writeText(exampleURL).then(() => toast('انسخ الرابط ✅'));
  $('#test-url').onclick = () => {
    location.href = `${exampleURL}${encodeURIComponent('شراء عبر نقاط البيع\nبطاقة:1234;مدى-ابل باي\nمبلغ:SAR 18.00\nلدى:BARNS COFFEE\nفي:' + new Date().toISOString().slice(0, 16).replace('T', ' '))}&from=AlRajhiBank&t=${encodeURIComponent(new Date().toISOString())}`;
  };
  view.querySelectorAll('[data-rm]').forEach((b) => b.onclick = () => store.removeUnparsed(b.dataset.rm));
  view.querySelectorAll('[data-manual]').forEach((b) => b.onclick = () => {
    const u = s.unparsed.find((x) => x.id === b.dataset.manual);
    openAddSheet();
    const panel = $('.sheet-panel'); panel.querySelector('[data-m="manual"]').click();
    const m = u.text.match(/\d+(?:[.,]\d+)?/); if (m) $('#m-amount', panel).value = m[0].replace(',', '.');
    $('#m-merchant', panel).focus();
    store.removeUnparsed(u.id);
  });
  view.querySelectorAll('[data-nick]').forEach((i) => i.onchange = () => store.updateCard(i.dataset.nick, { nickname: i.value.trim() }));
  view.querySelectorAll('[data-hide]').forEach((i) => i.onchange = () => store.updateCard(i.dataset.hide, { hidden: !i.checked }));
  view.querySelectorAll('[data-rule]').forEach((b) => b.onclick = () => store.deleteRule(b.dataset.rule));
  view.querySelectorAll('[data-brule]').forEach((b) => b.onclick = () => store.deleteBucketRule(b.dataset.brule));
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) && v > 0 ? v : 0; };
  $('#use-detected')?.addEventListener('click', (e) => { e.preventDefault(); $('#b-salary').value = detected.amount; $('#b-payday').value = detected.day; });
  $('#b-save').onclick = () => {
    const payday = Math.min(Math.max(parseInt($('#b-payday').value, 10) || 27, 1), 31);
    store.updateBudget({ salary: num('#b-salary'), payday, savings: num('#b-savings'), monthlyBudget: num('#b-monthly'),
      dailyOverride: num('#b-daily'), rollover: $('#b-roll').checked });
    toast('✅ انحفظت الميزانية'); maybeArchive();
  };
  view.querySelectorAll('[data-rate]').forEach((i) => i.onchange = () => {
    const v = parseFloat(i.value); if (v > 0) store.updateSettings({ rates: { ...s.settings.rates, [i.dataset.rate]: v } });
  });
  $('#csv').onclick = exportCSV;
  $('#backup').onclick = () => download(`hisba-backup-${new Date().toISOString().slice(0, 10)}.json`, store.exportJSON(), 'application/json');
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
ingestFromURL();
maybeArchive();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
