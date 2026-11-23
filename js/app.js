import { CATEGORIES } from './categories.js';
import { splitBatch } from './parser.js';
import * as store from './store.js';
import { periodRange, inRange, totalsByCategory, dailySeries, monthlyTrend, topMerchants, detectSubscriptions, isExpense, sar } from './insights.js';
import { donut, bars, fmt } from './charts.js';

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = (k) => CATEGORIES[k] || CATEGORIES.other;
const money = (n, d = 2) => `<span class="num">${fmt(n, d)}</span>`;
const CUR_AR = { SAR: 'ر.س', USD: '$', EUR: '€', GBP: '£', AED: 'د.إ' };
const curLabel = (c) => CUR_AR[c] || c;
const BASE_URL = location.origin + location.pathname.replace(/index\.html$/, '');

const ui = { tab: 'home', period: 'month', offset: 0, card: 'all', q: '', catFilter: 'all' };

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
  ({ home: renderHome, txs: renderTxs, subs: renderSubs, settings: renderSettings })[ui.tab]();
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
  const range = periodRange(ui.period, ui.offset);
  const prev = periodRange(ui.period, ui.offset - 1);
  const txs = inRange(all, range);
  const spent = txs.filter(isExpense).reduce((a, t) => a + sar(t, rates), 0);
  const income = txs.filter((t) => t.type === 'income').reduce((a, t) => a + sar(t, rates), 0);
  const prevSpent = inRange(all, prev).filter(isExpense).reduce((a, t) => a + sar(t, rates), 0);
  const delta = prevSpent ? ((spent - prevSpent) / prevSpent) * 100 : null;
  const label = ui.period === 'month' ? monthFmt.format(range.start)
    : `${range.start.getDate()} ${shortMonth.format(range.start)} – ${new Date(range.end - 1).getDate()} ${shortMonth.format(new Date(range.end - 1))}`;

  const cats = totalsByCategory(txs, rates);
  const days = dailySeries(txs, range, rates);
  const today = new Date();
  const todayIdx = days.findIndex((d) => d.date.toDateString() === today.toDateString());
  const elapsed = ui.offset === 0 ? Math.max(todayIdx + 1, 1) : days.length;
  const cards = Object.keys(s.cards).filter((k) => !s.cards[k].hidden);

  view.innerHTML = `
    <div class="seg"><button data-p="week" class="${ui.period === 'week' ? 'active' : ''}">أسبوعي</button>
      <button data-p="month" class="${ui.period === 'month' ? 'active' : ''}">شهري</button></div>
    ${cards.length > 1 ? `<select id="card-filter" style="margin-bottom:10px"><option value="all">كل البطاقات</option>${cards.map((k) => {
      const [b, c] = k.split('|'); return `<option value="${esc(k)}" ${ui.card === k ? 'selected' : ''}>${esc(cardName(b, c))}</option>`; }).join('')}</select>` : ''}
    <div class="period"><button id="prev" aria-label="السابق">→</button><span class="label">${label}</span>
      <button id="next" aria-label="التالي" ${ui.offset >= 0 ? 'disabled' : ''}>←</button></div>
    <div class="card hero">
      <div class="muted small">صرفت</div>
      <div class="total">${money(spent, 0)} <small>ر.س</small></div>
      ${delta != null ? `<span class="delta ${delta > 0 ? 'up' : 'down'}">${delta > 0 ? '▲' : '▼'} <span class="num">${fmt(Math.abs(delta))}%</span> عن ${ui.period === 'month' ? 'الشهر' : 'الأسبوع'} اللي قبله</span>` : ''}
      <div class="muted small" style="margin-top:8px">متوسط يومي ${money(spent / elapsed, 0)} ر.س${income ? ` · دخل ${money(income, 0)} ر.س` : ''}</div>
    </div>
    <div class="card"><h2>حسب التصنيف</h2>
      ${cats.length ? `<div class="donut-wrap"><div id="donut"></div><ul class="legend">${cats.map((c) => `
        <li data-cat="${c.category}"><span class="dot" style="background:${cat(c.category).color}"></span>
        <span class="name">${cat(c.category).icon} ${cat(c.category).name}</span><span class="num">${fmt(c.total)}</span>
        <span class="pct num">${fmt((c.total / spent) * 100)}%</span></li>`).join('')}</ul></div>` : '<p class="muted">ما فيه صرف بهذي الفترة</p>'}
    </div>
    <div class="card"><h2>${ui.period === 'month' ? 'الصرف اليومي' : 'أيام الأسبوع'} <small>— الخط المتقطّع = المتوسط</small></h2><div id="bars"></div></div>
    <div class="card"><h2>أكثر الأماكن صرفاً</h2><ul class="list">${topMerchants(txs, 5, rates).map((m) => `
      <li class="row" style="cursor:default"><div class="main"><div class="title">${esc(m.name)}</div><div class="meta">${m.count} عمليات</div></div>
      <div class="amt">${money(m.total, 0)} ر.س</div></li>`).join('') || '<li class="muted">—</li>'}</ul></div>
    <div class="card"><h2>آخر ٦ شهور</h2><div id="trend"></div></div>`;

  view.querySelectorAll('[data-p]').forEach((b) => b.onclick = () => { ui.period = b.dataset.p; ui.offset = 0; render(); });
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
  return `<li class="row ${t.excluded ? 'excluded' : ''}" data-id="${t.id}">
    <div class="ic" style="background:${c.color}22">${c.icon}</div>
    <div class="main"><div class="title">${esc(t.merchant || typeLabel(t.type))}${t.confidence === 'low' ? '<span class="badge warn">راجعها</span>' : ''}</div>
    <div class="meta">${esc(meta)}</div></div>
    <div class="amt ${t.type === 'income' ? 'income' : ''}">${sign}${money(t.amount)} <span class="small muted">${curLabel(t.currency)}</span></div></li>`;
}
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
  openSheet(`
    <h3>${esc(t.merchant || typeLabel(t.type))}</h3>
    <p class="muted small">${esc(fullFmt.format(new Date(t.date)))} · ${esc(cardName(t.bank, t.card))} · ${typeLabel(t.type)}</p>
    <label class="field">التصنيف</label>
    <div class="chips" id="cat-chips">${Object.entries(CATEGORIES).map(([k, c]) =>
      `<button class="chip ${k === t.category ? 'active' : ''}" data-k="${k}">${c.icon} ${c.name}</button>`).join('')}</div>
    <label class="switch"><input type="checkbox" id="apply-all" checked> طبّق على كل عمليات «${esc(t.merchant || '—')}» وتعلّمها للمستقبل</label>
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

// ---------------- الاشتراكات ----------------
function renderSubs() {
  const s = store.getState();
  const subs = detectSubscriptions(visibleTxs(), new Date(), s.settings.dismissedSubs);
  const active = subs.filter((x) => !x.stale);
  const monthly = active.reduce((a, x) => a + x.monthlyCost * (s.settings.rates[x.currency] && x.currency !== 'SAR' ? s.settings.rates[x.currency] : 1), 0);
  const per = { weekly: 'أسبوعياً', monthly: 'شهرياً', quarterly: 'كل ٣ شهور', yearly: 'سنوياً' };
  view.innerHTML = `
    <div class="card hero"><div class="muted small">اشتراكاتك النشطة تكلّفك تقريباً</div>
      <div class="total">${money(monthly, 0)} <small>ر.س / شهر</small></div>
      <div class="muted small">يعني ${money(monthly * 12, 0)} ر.س بالسنة</div></div>
    ${subs.length ? `<div class="card" style="padding:4px 14px"><ul class="list">${subs.map((x) => `
      <li class="row" style="cursor:default"><div class="ic" style="background:${cat(x.category).color}22">${cat(x.category).icon}</div>
      <div class="main"><div class="title">${esc(x.name)}${x.stale ? '<span class="badge">يمكن ألغيته؟</span>' : ''}</div>
      <div class="meta wrap">${per[x.period]} · ${x.count} مرات · التجديد الجاي تقريباً ${esc(dateFmt.format(new Date(x.nextDate)))}</div></div>
      <div><div class="amt">${money(x.amount)} ${curLabel(x.currency)}</div>
      <button class="chip small" data-dismiss="${esc(x.key)}" style="margin-top:4px">مو اشتراك</button></div></li>`).join('')}</ul></div>`
      : `<div class="empty"><div class="big">🔁</div>ما لقيت اشتراكات متكررة للحين.<br><span class="small">أكتشفها تلقائياً لما يتكرر نفس المبلغ لنفس التاجر بشكل أسبوعي أو شهري أو سنوي.</span></div>`}`;
  view.querySelectorAll('[data-dismiss]').forEach((b) => b.onclick = () => store.dismissSub(b.dataset.dismiss));
}

// ---------------- الإعدادات ----------------
function renderSettings() {
  const s = store.getState();
  const exampleURL = `${BASE_URL}?sms=`;
  const rules = Object.entries(s.rules);
  view.innerHTML = `
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
  const rows = [['التاريخ', 'النوع', 'المبلغ', 'العملة', 'التاجر', 'التصنيف', 'البنك', 'البطاقة', 'مستبعدة']];
  for (const t of store.getState().txs.slice().sort((a, b) => new Date(a.date) - new Date(b.date))) {
    rows.push([new Date(t.date).toISOString().replace('T', ' ').slice(0, 16), typeLabel(t.type), t.amount, t.currency, t.merchant,
      cat(t.category).name, t.bank, t.card, t.excluded ? 'نعم' : '']);
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
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
