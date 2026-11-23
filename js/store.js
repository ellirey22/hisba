// تخزين محلي بالكامل على الجهاز (localStorage) — ما فيه أي خادم ولا حساب
import { categorize, normalizeMerchant } from './categories.js';
import { parseSMS } from './parser.js';

const KEY = 'hisba.v1';

const defaults = () => ({
  txs: [],
  rules: {},          // اسم التاجر بعد التطبيع ← التصنيف (يتعلّمها التطبيق من تصحيحاتك)
  cards: {},          // "البنك|آخر4" ← { nickname, hidden }
  unparsed: [],       // رسائل ما قدر يقرأها، تقدر تضيفها يدوياً
  commitments: [],    // الالتزامات الشهرية: إيجار، فواتير، أقساط تابي/تمارا، قروض
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
  if (c.id) state.commitments = state.commitments.map((x) => (x.id === c.id ? { ...x, ...c } : x));
  else state.commitments.push({ ...c, id: uid() });
  save();
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
