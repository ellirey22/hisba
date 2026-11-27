// تخزين محلي بالكامل على الجهاز (localStorage) — ما فيه أي خادم ولا حساب
import { categorize, normalizeMerchant } from './categories.js';
import { parseSMS } from './parser.js';
import { matchCommitment, matchInvestment, commitmentSignature, cycleFor, commitmentStatus } from './budget.js';
import { DEFAULT_RATES } from './rates.js';

const KEY = 'hisba.v1';

const defaults = () => ({
  txs: [],
  rules: {},          // اسم التاجر بعد التطبيع ← التصنيف (يتعلّمها التطبيق من تصحيحاتك)
  cards: {},          // "البنك|آخر4" ← { nickname, hidden }
  unparsed: [],       // رسائل ما قدر يقرأها، تقدر تضيفها يدوياً
  commitments: [],    // الالتزامات الشهرية: إيجار، فواتير، أقساط تابي/تمارا، قروض
  debts: [],          // التسليف: سلّفت/استلفت من أشخاص مع الدفعات
  investments: [],    // محافظ الاستثمار: مبلغ شهري ثابت + مبالغ مؤقتة لدورات معيّنة، أو حساب متغيّر (أوبشن)
  bucketRules: {},    // اسم التاجر ← daily | monthly (تتعلّمها من اختياراتك)
  archive: [],        // لقطة لكل دورة راتب منتهية (الراتب والحد وقتها)
  seen: [],           // بصمات الرسائل عشان ما تنضاف مرتين
  settings: { name: 'آلاء', theme: 'blue', mode: 'auto', privacy: false, budget: { salary: 0, payday: 27, savings: 0, dailyOverride: 0, rollover: true }, rates: { ...DEFAULT_RATES }, ratesUpdated: 0, dismissedSubs: [] },
});

function mergeSettings(st = {}) {
  const d = defaults().settings;
  return { ...d, ...st, budget: { ...d.budget, ...(st.budget || {}) }, rates: { ...d.rates, ...(st.rates || {}) }, name: st.name ?? d.name };
}

let state = load();
const listeners = new Set();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.txs)) return { ...defaults(), ...s, settings: mergeSettings(s.settings) };
  } catch { /* بيانات تالفة: نبدأ من جديد */ }
  return defaults();
}

function save() {
  localStorage.setItem(KEY, JSON.stringify(state));
  listeners.forEach((fn) => fn(state));
}

export const getState = () => state;
export const subscribe = (fn) => listeners.add(fn);

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

function registerCard(tx) {
  if (!tx.card) return;
  const k = `${tx.bank}|${tx.card}`;
  if (!state.cards[k]) state.cards[k] = { nickname: '', hidden: false };
}

/**
 * يضيف رسالة بنك. يرجع { status: 'added'|'duplicate'|'ignored'|'unparsed', tx? }
 * stamp: وقت الاستلام من الاختصار (يدخل في البصمة عشان رسالتين متطابقتين بوقتين مختلفين ما تنحذف وحدة منهم)
 */
export function addMessage(text, { sender = '', receivedAt, persist = true } = {}) {
  const clean = String(text || '').trim();
  if (!clean) return { status: 'ignored' };
  const fp = hash(clean + '|' + (receivedAt ? new Date(receivedAt).toISOString().slice(0, 16) : ''));
  const fpText = hash(clean);
  // مكرّرة فقط لو الرسالة فعلاً موجودة عندنا (عملية أو غير مقروءة) — اللي انحذفت من قبل تنضاف من جديد
  const alive = state.txs.some((t) => (t.raw || '').trim() === clean) || state.unparsed.some((u) => u.text === clean);
  if ((state.seen.includes(fp) || (!receivedAt && state.seen.includes(fpText))) && (alive || !parseSMS(clean, { sender }))) return { status: 'duplicate' };

  const parsed = parseSMS(clean, { sender, receivedAt: receivedAt ? new Date(receivedAt) : undefined });
  state.seen.push(fp, fpText);
  if (state.seen.length > 5000) state.seen = state.seen.slice(-4000);
  if (!parsed) {
    // نحفظ الرسائل اللي فيها مبلغ بس ما فهمناها، ونتجاهل رموز التحقق وغيرها
    if (/\d/.test(clean) && !/(رمز|otp|code|كلمة\s*المرور)/i.test(clean)) {
      state.unparsed.unshift({ id: uid(), text: clean, sender, date: (receivedAt ? new Date(receivedAt) : new Date()).toISOString() });
      state.unparsed = state.unparsed.slice(0, 50);
      if (persist) save();
      return { status: 'unparsed' };
    }
    if (persist) save();
    return { status: 'ignored' };
  }
  const { category, source } = categorize(parsed, state.rules);
  const tx = { id: uid(), ...parsed, category, categorySource: source, addedAt: new Date().toISOString() };
  const dd = tx.type !== 'income' && state.debts.find((d) => d.direction === 'lent' && !d.principalTxId && Math.abs(d.amount - tx.amount) < 0.5 && Math.abs(new Date(tx.date) - new Date(d.date)) < 4 * 864e5);
  if (dd) { applyDebtLink(tx, dd, 'principal'); dd.principalTxId = tx.id; }
  const inv = !dd && matchInvestment(tx, state.investments);
  if (inv) tx.investmentId = inv.id;
  let linked = !dd && !inv && matchCommitment(tx, state.commitments);
  // دفعة تابي/تمارا جديدة وما لها التزام: نضيفها تلقائياً كدفعة في الالتزامات
  if (!linked && !dd && !inv && /tabby|تابي|tamara|تمارا/i.test(`${tx.merchant} ${clean}`) && tx.type !== 'income') {
    const d = new Date(tx.date), label = /tamara|تمارا/i.test(`${tx.merchant} ${clean}`) ? 'تمارا' : 'تابي';
    linked = { id: uid(), kind: 'installment', name: tx.merchant || label, amount: tx.amount, day: d.getDate(), provider: label,
      keyword: normalizeMerchant(tx.merchant) || label.toLowerCase(), approx: false, total: 1, startDate: ymd(d), auto: true };
    state.commitments.push(linked);
  }
  if (linked) { tx.commitmentId = linked.id; tx.bucket = 'commitment'; }
  state.txs.push(tx);
  registerCard(tx);
  if (persist) save();
  return { status: 'added', tx };
}

export function addMany(items) {
  const counts = { added: 0, duplicate: 0, ignored: 0, unparsed: 0 };
  for (const it of items) counts[addMessage(it.text, { ...it, persist: false }).status]++;
  save();
  return counts;
}

export function addManual(tx) {
  const t = {
    id: uid(), type: 'purchase', currency: 'SAR', card: '', bank: 'يدوي', channel: '', raw: '',
    confidence: 'high', addedAt: new Date().toISOString(), ...tx,
  };
  if (!t.category) Object.assign(t, (({ category, source }) => ({ category, categorySource: source }))(categorize(t, state.rules)));
  state.txs.push(t);
  save();
  return t;
}

export function updateTx(id, patch) {
  const t = state.txs.find((x) => x.id === id);
  if (t) Object.assign(t, patch);
  save();
}

/** ينسى بصمة الرسالة عشان لو حذفتها وأعدت لصقها تنضاف من جديد */
function forget(raw) {
  const clean = String(raw || '').trim(); if (!clean) return;
  const drop = new Set([hash(clean), hash(clean + '|')]);
  state.seen = state.seen.filter((h) => !drop.has(h));
}
/** يعيد قراءة نص رسالة معدَّل ويحدّث بيانات العملية (يحافظ على التصنيف والربط) */
export function reparseTx(id, text) {
  const t = state.txs.find((x) => x.id === id); const clean = String(text || '').trim();
  if (!t || !clean) return false;
  const parsed = parseSMS(clean, { sender: t.bank });
  if (!parsed) return false;
  forget(t.raw);
  const keep = parsed.date ? { date: parsed.date } : {};
  Object.assign(t, { raw: clean, amount: parsed.amount, currency: parsed.currency, type: parsed.type, merchant: parsed.merchant || t.merchant,
    card: parsed.card || t.card, channel: parsed.channel || t.channel, confidence: 'high', ...keep });
  state.seen.push(hash(clean), hash(clean + '|'));
  save(); return true;
}
export function deleteTx(id) {
  forget(state.txs.find((x) => x.id === id)?.raw);
  state.txs = state.txs.filter((x) => x.id !== id);
  save();
}

/**
 * التعلّم: لما المستخدم يغيّر تصنيف عملية، نحفظ قاعدة للتاجر ونطبّقها على عملياته السابقة
 * (إلا اللي المستخدم غيّرها يدوياً بنفسه لتصنيف ثاني).
 */
export function setCategory(id, category, applyToMerchant = true) {
  const t = state.txs.find((x) => x.id === id);
  if (!t) return 0;
  t.category = category; t.categorySource = 'manual';
  let n = 1;
  const key = normalizeMerchant(t.merchant);
  if (applyToMerchant && key) {
    state.rules[key] = category;
    for (const o of state.txs) {
      if (o !== t && o.categorySource !== 'manual' && normalizeMerchant(o.merchant) === key && o.type === t.type) {
        o.category = category; o.categorySource = 'learned'; n++;
      }
    }
  }
  save();
  return n;
}

export function deleteRule(key) {
  delete state.rules[key];
  for (const t of state.txs) {
    if (t.categorySource === 'learned' && normalizeMerchant(t.merchant) === key) {
      Object.assign(t, (({ category, source }) => ({ category, categorySource: source }))(categorize(t, state.rules)));
    }
  }
  save();
}

export function updateCard(key, patch) { state.cards[key] = { ...state.cards[key], ...patch }; save(); }
export function updateSettings(patch) { state.settings = { ...state.settings, ...patch }; save(); }
export function removeUnparsed(id) { forget(state.unparsed.find((u) => u.id === id)?.text); state.unparsed = state.unparsed.filter((u) => u.id !== id); save(); }
export function dismissSub(key) { state.settings.dismissedSubs.push(key); save(); }

// ---------- الميزانية والالتزامات ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** أول راتب جاي (أو اليوم لو اليوم يوم الراتب) — منه تبدأ الحسبة تلقائياً */
export function nextPayday(payday, now = new Date()) {
  const cur = cycleFor(now, payday);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return +today <= +cur.start ? cur.start : cycleFor(now, payday, 1).start;
}
export function updateBudget(patch) {
  const b = { ...state.settings.budget, ...patch };
  delete b.monthlyBudget;
  // أول مرة تحدد فيها الراتب: الحسبة تبدأ لحالها من أول راتب جاي
  if (b.salary > 0 && !b.startDate) b.startDate = ymd(nextPayday(b.payday || 27));
  state.settings.budget = b;
  save();
}

export function saveCommitment(c) {
  let saved;
  if (c.id) state.commitments = state.commitments.map((x) => (x.id === c.id ? (saved = { ...x, ...c }) : x));
  else state.commitments.push(saved = { ...c, id: uid() });
  save();
  return saved;
}
/**
 * يربط رسالة بنك نموذجية بالتزام: يتعلّم بصمتها، ويسجّل العملية (لو ما كانت مسجّلة) كسداد لهذا الالتزام.
 * يرجع { ok, status, tx } أو { ok:false } لو الرسالة ما انقرأت.
 */
export function linkCommitmentMessage(commitmentId, text) {
  const c = state.commitments.find((x) => x.id === commitmentId);
  const clean = String(text || '').trim();
  if (!c || !clean) return { ok: false };
  let tx = state.txs.find((t) => (t.raw || '').trim() === clean);
  let status = 'existing';
  if (!tx) {
    const res = addMessage(clean, { persist: false });
    if (res.status !== 'added') { save(); return { ok: false, reason: res.status }; }
    tx = res.tx; status = 'added'; tx.viaLink = true;
  }
  c.signature = commitmentSignature(tx);
  c.sample = clean;
  tx.commitmentId = c.id; tx.bucket = 'commitment';
  // نربط العمليات السابقة اللي تطابق البصمة الجديدة
  let n = 0;
  for (const t of state.txs) {
    if (t !== tx && !t.commitmentId && matchCommitment(t, [c])) { t.commitmentId = c.id; n++; }
  }
  save();
  return { ok: true, status, tx, linkedOld: n };
}

// ---------- الاستثمار ----------
export function saveInvestment(inv) {
  let saved;
  if (inv.id) state.investments = state.investments.map((x) => (x.id === inv.id ? (saved = { ...x, ...inv }) : x));
  else state.investments.push(saved = { overrides: {}, ...inv, id: uid() });
  save();
  return saved;
}
export function deleteInvestment(id) {
  state.investments = state.investments.filter((i) => i.id !== id);
  for (const t of state.txs) if (t.investmentId === id) delete t.investmentId;
  save();
}

/** يتعلّم رسالة التحويل لمحفظة، ويسجّل التحويل كاستثمار (مو صرف) */
export function linkInvestmentMessage(id, text) {
  const inv = state.investments.find((x) => x.id === id);
  const clean = String(text || '').trim();
  if (!inv || !clean) return { ok: false };
  let tx = state.txs.find((t) => (t.raw || '').trim() === clean);
  let status = 'existing';
  if (!tx) {
    const res = addMessage(clean, { persist: false });
    if (res.status !== 'added') { save(); return { ok: false, reason: res.status }; }
    tx = res.tx; status = 'added'; tx.viaLink = true;
  }
  inv.signature = commitmentSignature(tx);
  inv.sample = clean;
  delete tx.commitmentId; delete tx.bucket;
  tx.investmentId = inv.id;
  let n = 0;
  for (const t of state.txs) if (t !== tx && !t.investmentId && t.type !== 'income' && matchInvestment(t, [inv])) { t.investmentId = inv.id; delete t.commitmentId; n++; }
  save();
  return { ok: true, status, tx, linkedOld: n };
}

/** كود إعداد يلصقه المستخدم (HISBA-SETUP:...) يضيف/يحدّث المحافظ بالاسم */
export function applySetup(code) {
  const m = String(code).trim().match(/^HISBA-SETUP:([A-Za-z0-9+/=_-]+)$/);
  if (!m) return null;
  const json = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))));
  let added = 0, updated = 0;
  for (const inv of json.investments || []) {
    const ex = state.investments.find((x) => x.name === inv.name);
    if (ex) { Object.assign(ex, { amount: inv.amount, variable: !!inv.variable, overrides: inv.overrides || {}, cap: +inv.cap || 0 }); updated++; }
    else { state.investments.push({ overrides: {}, ...inv, id: uid() }); added++; }
  }
  if (json.budget) state.settings.budget = { ...state.settings.budget, ...json.budget };
  save();
  return { added, updated, budget: !!json.budget };
}

// ---------- التسليف ----------
// تسليفك لغيرك مو صرف (تنستبعد العملية)، وتسديدك لدين عليك ينحسب التزام (ينقص من راتبك بس مو من حدك اليومي)
function applyDebtLink(tx, debt, role) {
  unlinkDebtTx(tx);
  tx.debtId = debt.id; tx.debtRole = role;
  delete tx.commitmentId; delete tx.investmentId;
  if (tx.type === 'income') return;
  if (debt.direction === 'lent' && role === 'principal') { tx.excluded = true; tx.debtExcluded = true; }
  else if (debt.direction === 'borrowed' && role === 'payment') { tx.bucket = 'commitment'; tx.debtBucket = true; }
}
function unlinkDebtTx(tx) {
  if (tx.debtExcluded) tx.excluded = false;
  if (tx.debtBucket) delete tx.bucket;
  delete tx.debtExcluded; delete tx.debtBucket; delete tx.debtId; delete tx.debtRole;
}

export function saveDebt(d) {
  let saved;
  if (d.id) state.debts = state.debts.map((x) => (x.id === d.id ? (saved = { ...x, ...d }) : x));
  else {
    state.debts.unshift(saved = { payments: [], ...d, id: uid() });
    if (saved.direction === 'lent') {
      const t = state.txs.find((x) => !x.debtId && !x.investmentId && !x.commitmentId && x.type !== 'income' && Math.abs(x.amount - saved.amount) < 0.5 && Math.abs(new Date(x.date) - new Date(saved.date)) < 4 * 864e5);
      if (t) { applyDebtLink(t, saved, 'principal'); saved.principalTxId = t.id; }
    }
  }
  save();
  return saved;
}
export function deleteDebt(id) {
  for (const t of state.txs) if (t.debtId === id) unlinkDebtTx(t);
  state.debts = state.debts.filter((x) => x.id !== id);
  save();
}
/** يجيب عملية من رسالة بنك (موجودة أو جديدة) بدون ما يربطها */
export function debtMessageTx(text) {
  const clean = String(text || '').trim();
  if (!clean) return { ok: false };
  const ex = state.txs.find((t) => (t.raw || '').trim() === clean);
  if (ex) return { ok: true, tx: ex, status: 'existing' };
  const res = addMessage(clean, { persist: false });
  if (res.status !== 'added') { save(); return { ok: false, reason: res.status }; }
  return { ok: true, tx: res.tx, status: 'added' };
}
/** يربط عملية بدين: role = principal (أصل الدين) أو payment (سداد) */
export function attachDebtTx(debtId, txId, role) {
  const d = state.debts.find((x) => x.id === debtId);
  const tx = state.txs.find((x) => x.id === txId);
  if (!d || !tx) return false;
  applyDebtLink(tx, d, role);
  if (role === 'principal') d.principalTxId = tx.id;
  else if (!d.payments.some((p) => p.txId === tx.id)) d.payments.push({ id: uid(), amount: tx.amount, date: tx.date, txId: tx.id });
  save();
  return true;
}
export function unlinkTxDebt(txId) {
  const tx = state.txs.find((x) => x.id === txId);
  if (!tx || !tx.debtId) return;
  const d = state.debts.find((x) => x.id === tx.debtId);
  if (d) { d.payments = d.payments.filter((p) => p.txId !== tx.id); if (d.principalTxId === tx.id) delete d.principalTxId; }
  unlinkDebtTx(tx);
  save();
}
export function addDebtPayment(debtId, { amount, date }) {
  const d = state.debts.find((x) => x.id === debtId);
  if (!d) return;
  d.payments.push({ id: uid(), amount, date });
  save();
}
export function deleteDebtPayment(debtId, paymentId) {
  const d = state.debts.find((x) => x.id === debtId);
  const p = d?.payments.find((x) => x.id === paymentId);
  if (!p) return;
  const tx = p.txId && state.txs.find((t) => t.id === p.txId);
  if (tx) unlinkDebtTx(tx);
  d.payments = d.payments.filter((x) => x.id !== paymentId);
  save();
}

// ---------- علامات «تم» لكل دورة ----------
const flip = (obj, key) => { const o = { ...(obj || {}) }; if (o[key]) delete o[key]; else o[key] = true; return o; };
/** علامة السداد: للالتزامات المقسّطة تزيد عدد الدفعات المسدّدة (حتى قبل الموعد)، والإلغاء يرجعها */
export function toggleCommitmentPaid(id, key) {
  const c = state.commitments.find((x) => x.id === id); if (!c) return;
  const on = !c.paid?.[key];
  c.paid = flip(c.paid, key);
  if (c.total > 0 && c.startDate && (c.kind === 'installment' || c.kind === 'loan')) {
    const st = commitmentStatus({ ...c, manualPaid: 0 });
    const byDate = st.paid ?? 0;
    c.manualPaid = on ? Math.min(c.total, Math.max(byDate, c.manualPaid || 0) + 1) : Math.max(byDate, (c.manualPaid || 0) - 1);
  }
  save();
}
export function toggleInvestmentDone(id, key) { const i = state.investments.find((x) => x.id === id); if (i) { i.done = flip(i.done, key); save(); } }
/** تسوية الدين بالكامل بضغطة، والضغطة الثانية تلغيها */
export function toggleDebtSettled(id) {
  const d = state.debts.find((x) => x.id === id); if (!d) return false;
  const rem = Math.max(d.amount - d.payments.reduce((a, p) => a + (+p.amount || 0), 0), 0);
  if (rem > 0.004) { d.payments.push({ id: uid(), amount: rem, date: new Date().toISOString(), settle: true }); save(); return true; }
  d.payments = d.payments.filter((p) => !p.settle); save(); return false;
}
/** يفك ربط عملية بالتزام/محفظة (من شاشة العملية) */
export function linkTxCommitment(txId, commitmentId) {
  const t = state.txs.find((x) => x.id === txId); if (!t) return;
  t.commitmentId = commitmentId; t.bucket = 'commitment'; save();
}
export function unlinkTx(txId) {
  const t = state.txs.find((x) => x.id === txId); if (!t) return;
  if (t.commitmentId && t.bucket === 'commitment') delete t.bucket;
  delete t.commitmentId; delete t.investmentId; delete t.viaLink; save();
}
/** يمسح الرسالة اللي اتعلّمها التزام/محفظة، ولو العملية انضافت بسبب الربط تنحذف معها */
export function clearLink(kind, id) {
  const c = (kind === 'inv' ? state.investments : state.commitments).find((x) => x.id === id); if (!c) return;
  const field = kind === 'inv' ? 'investmentId' : 'commitmentId';
  const sample = (c.sample || '').trim();
  state.txs = state.txs.filter((t) => {
    if (t[field] !== id || !sample || (t.raw || '').trim() !== sample) return true;
    if (t.viaLink) return false;
    delete t[field]; if (kind === 'com' && t.bucket === 'commitment') delete t.bucket; return true;
  });
  delete c.signature; delete c.sample; save();
}

export function deleteCommitment(id) { state.commitments = state.commitments.filter((c) => c.id !== id); save(); }

/** يحدد نوع الصرف (يومي/شهري) لعملية، ولو طلب المستخدم يتذكّره للتاجر */
export function setBucket(id, bucket, remember = true) {
  const t = state.txs.find((x) => x.id === id);
  if (!t) return 0;
  t.bucket = bucket;
  let n = 1;
  const key = normalizeMerchant(t.merchant);
  if (remember && key) {
    state.bucketRules[key] = bucket;
    for (const o of state.txs) if (o !== t && !o.bucket && normalizeMerchant(o.merchant) === key) n++;
  }
  save();
  return n;
}
export function deleteBucketRule(key) { delete state.bucketRules[key]; save(); }

/** يحفظ لقطة للدورات المنتهية عشان التقرير يعرض الراتب والحد اللي كانوا وقتها */
export function archiveCycle(snap) {
  if (state.archive.some((a) => a.start === snap.start)) return;
  state.archive.unshift(snap);
  save();
}

export function exportJSON() { return JSON.stringify(state, null, 2); }
/** يفحص نص هل هو نسخة احتياطية لحِسبَة؟ يرجع ملخصها أو null */
export function inspectBackup(text) {
  const t = String(text || '').trim();
  if (t[0] !== '{' || !t.includes('"txs"')) return null;
  try { const s = JSON.parse(t); return Array.isArray(s.txs) ? { txs: s.txs.length, debts: (s.debts || []).length, commitments: (s.commitments || []).length } : null; } catch { return null; }
}
export function importJSON(json) {
  const s = JSON.parse(json);
  if (!s || !Array.isArray(s.txs)) throw new Error('ملف النسخة الاحتياطية غير صالح');
  state = { ...defaults(), ...s, settings: mergeSettings(s.settings) };
  save();
}
export function wipe() { state = defaults(); save(); }
