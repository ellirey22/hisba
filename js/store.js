// تخزين محلي بالكامل على الجهاز (localStorage) — ما فيه أي خادم ولا حساب
import { categorize, normalizeMerchant } from './categories.js';
import { parseSMS } from './parser.js';
import { matchCommitment, matchInvestment, commitmentSignature } from './budget.js';

const KEY = 'hisba.v1';

const defaults = () => ({
  txs: [],
  rules: {},          // اسم التاجر بعد التطبيع ← التصنيف (يتعلّمها التطبيق من تصحيحاتك)
  cards: {},          // "البنك|آخر4" ← { nickname, hidden }
  unparsed: [],       // رسائل ما قدر يقرأها، تقدر تضيفها يدوياً
  commitments: [],    // الالتزامات الشهرية: إيجار، فواتير، أقساط تابي/تمارا، قروض
  investments: [],    // محافظ الاستثمار: مبلغ شهري ثابت + مبالغ مؤقتة لدورات معيّنة، أو حساب متغيّر (أوبشن)
  bucketRules: {},    // اسم التاجر ← daily | monthly (تتعلّمها من اختياراتك)
  archive: [],        // لقطة لكل دورة راتب منتهية (الراتب والحد وقتها)
  seen: [],           // بصمات الرسائل عشان ما تنضاف مرتين
  settings: { budget: { salary: 0, payday: 27, savings: 0, monthlyBudget: 0, dailyOverride: 0, rollover: true }, rates: { USD: 3.75, EUR: 4.05, GBP: 4.75, AED: 1.02, EGP: 0.08, TRY: 0.11 }, dismissedSubs: [] },
});

function mergeSettings(st = {}) {
  const d = defaults().settings;
  return { ...d, ...st, budget: { ...d.budget, ...(st.budget || {}) }, rates: { ...d.rates, ...(st.rates || {}) } };
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
  if (state.seen.includes(fp) || (!receivedAt && state.seen.includes(fpText))) return { status: 'duplicate' };

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
  const inv = matchInvestment(tx, state.investments);
  if (inv) tx.investmentId = inv.id;
  const linked = !inv && matchCommitment(tx, state.commitments);
  if (linked) tx.commitmentId = linked.id;
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

export function deleteTx(id) {
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
export function removeUnparsed(id) { state.unparsed = state.unparsed.filter((u) => u.id !== id); save(); }
export function dismissSub(key) { state.settings.dismissedSubs.push(key); save(); }

// ---------- الميزانية والالتزامات ----------
export function updateBudget(patch) { state.settings.budget = { ...state.settings.budget, ...patch }; save(); }

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
    tx = res.tx; status = 'added';
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
    tx = res.tx; status = 'added';
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
    if (ex) { Object.assign(ex, { amount: inv.amount, variable: !!inv.variable, overrides: inv.overrides || {} }); updated++; }
    else { state.investments.push({ overrides: {}, ...inv, id: uid() }); added++; }
  }
  save();
  return { added, updated };
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
export function importJSON(json) {
  const s = JSON.parse(json);
  if (!s || !Array.isArray(s.txs)) throw new Error('ملف النسخة الاحتياطية غير صالح');
  state = { ...defaults(), ...s, settings: mergeSettings(s.settings) };
  save();
}
export function wipe() { state = defaults(); save(); }
