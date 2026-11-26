// الميزانية: دورة الراتب، الحد اليومي مع الترحيل، الالتزامات، تقارير الدورة، والعادات
import { normalizeMerchant } from './categories.js';
import { sar } from './insights.js';
import { normalizeText } from './parser.js';

const DAY = 864e5;
const dim = (y, m) => new Date(y, m + 1, 0).getDate();
const atPayday = (y, m, payday) => new Date(y, m, Math.min(payday, dim(y, m)));
const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ---------------- دورة الراتب ----------------
/**
 * يوم نزول الراتب الفعلي في شهر: لو صادف ويكند (الجمعة/السبت) ينزل قبله أو بعده:
 * الجمعة ← الخميس اللي قبله · السبت ← الأحد اللي بعده
 */
export function actualPayday(y, m, payday = 27) {
  const d = atPayday(y, m, payday);
  if (d.getDay() === 5) d.setDate(d.getDate() - 1);
  else if (d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

/** الدورة اللي فيها التاريخ: من يوم الراتب لين اليوم اللي قبل الراتب الجاي. offset = -1 للدورة السابقة */
export function cycleFor(date = new Date(), payday = 27, offset = 0) {
  const d = midnight(date);
  // الشهر الاسمي للراتب (راتب نوفمبر ممكن ينزل ٢٦ نوفمبر لو ٢٧ جمعة)
  let y = d.getFullYear(), m = d.getMonth();
  if (d < actualPayday(y, m, payday)) m -= 1;
  else if (d >= actualPayday(y, m + 1, payday)) m += 1;
  m += offset;
  const start = actualPayday(y, m, payday);
  const end = actualPayday(y, m + 1, payday);
  const nominal = new Date(y, m, 1);
  return { start, end, days: Math.round((end - start) / DAY), key: `${nominal.getFullYear()}-${String(nominal.getMonth() + 1).padStart(2, '0')}` };
}

// ---------------- نوع الصرف لكل عملية ----------------
// daily = من الحد اليومي · monthly = من ميزانية المشتريات الشهرية · commitment = سداد التزام
// التحويل للاستثمار مو صرف: فلوسك انتقلت من مكان لمكان
export function counts(tx) { return tx.type !== 'income' && !tx.excluded && !tx.investmentId; }

export function bucketOf(tx, state) {
  if (tx.bucket) return tx.bucket;
  const key = normalizeMerchant(tx.merchant);
  if (key && state.bucketRules?.[key]) return state.bucketRules[key];
  if (matchCommitment(tx, state.commitments)) return 'commitment';
  if (tx.type === 'bill' || tx.type === 'transfer') return 'monthly';
  return 'daily';
}

/** رقم المستفيد/الحساب المحوَّل له (آخر ٤ أرقام) من نص الرسالة */
export function extractTarget(raw = '') {
  const t = normalizeText(raw);
  const m = t.match(/(?:إلى|الى|to|المستفيد|beneficiary|لحساب|للحساب|IBAN|آيبان|ايبان)[^\d\n]{0,25}?[*xX•]*\s*(?:SA\d{2}[\d\s]*)?(\d{4})\b(?![\d/:-])/i);
  return m ? m[1] : '';
}

/** بصمة رسالة سداد الالتزام: نتعلّمها من رسالة نموذجية يلصقها المستخدم مرة وحدة */
export function commitmentSignature(tx) {
  return {
    merchant: normalizeMerchant(tx.merchant), target: extractTarget(tx.raw), type: tx.type,
    amount: tx.amount, bank: tx.bank,
  };
}

export function matchCommitment(tx, commitments = []) { return matchSignature(tx, commitments, 'commitmentId'); }
export function matchInvestment(tx, investments = []) {
  if (tx.type === 'income') return null;
  return matchSignature(tx, investments, 'investmentId');
}

function matchSignature(tx, commitments, linkField) {
  if (!commitments.length) return null;
  if (tx[linkField]) { const c = commitments.find((x) => x.id === tx[linkField]); if (c) return c; }
  const m = normalizeMerchant(tx.merchant);
  const target = tx.raw ? extractTarget(tx.raw) : '';
  for (const c of commitments) {
    const k = normalizeMerchant(c.keyword || '');
    if (k && m && (m === k || m.includes(k))) return c;
    const sig = c.signature;
    if (!sig) continue;
    if (sig.merchant && m && (m === sig.merchant || m.startsWith(sig.merchant + ' ') || sig.merchant.startsWith(m + ' '))) return c;
    if (sig.target && target && sig.target === target) return c;
    // رسالة بدون تاجر ولا مستفيد (مثل خصم قسط القرض): نفس البنك والنوع والمبلغ تقريباً
    if (!sig.merchant && !sig.target && sig.type === tx.type && sig.bank === tx.bank
      && Math.abs(sig.amount - tx.amount) <= Math.max(1, sig.amount * 0.01)) return c;
  }
  return null;
}

/** هل انسدد الالتزام في الدورة؟ */
export function paidInRange(c, txs, commitments, range) {
  return txs.filter((t) => { const d = new Date(t.date); return d >= range.start && d < range.end && !t.excluded && matchCommitment(t, commitments)?.id === c.id; });
}

// ---------------- الالتزامات ----------------
export const COMMITMENT_KINDS = {
  rent: { name: 'إيجار', icon: '🏠' },
  bill: { name: 'فاتورة', icon: '🧾' },
  phone: { name: 'جوال وإنترنت', icon: '📱' },
  family: { name: 'عائلة', icon: '❤️' },
  installment: { name: 'تقسيط (تابي/تمارا)', icon: '🧩' },
  loan: { name: 'قرض', icon: '🏦' },
  subscription: { name: 'اشتراك', icon: '🔁' },
  other: { name: 'أخرى', icon: '📌' },
};

/** حالة الالتزام: كم قسط انسدد، كم باقي، موعد الدفعة الجاية */
export function commitmentStatus(c, now = new Date()) {
  const day = c.day || 1;
  const today = midnight(now);
  let next = new Date(today.getFullYear(), today.getMonth(), Math.min(day, dim(today.getFullYear(), today.getMonth())));
  if (next < today) next = new Date(today.getFullYear(), today.getMonth() + 1, Math.min(day, dim(today.getFullYear(), today.getMonth() + 1)));
  const finite = (c.kind === 'installment' || c.kind === 'loan') && c.total > 0 && c.startDate;
  if (!finite) return { active: true, next, paid: null, remaining: null, remainingAmount: null };
  const s = new Date(c.startDate);
  let paid = 0;
  for (let i = 0; i < c.total; i++) {
    const due = new Date(s.getFullYear(), s.getMonth() + i, Math.min(s.getDate(), dim(s.getFullYear(), s.getMonth() + i)));
    if (due <= today) paid++;
  }
  const remaining = c.total - paid;
  const last = new Date(s.getFullYear(), s.getMonth() + c.total - 1, s.getDate());
  const nextDue = remaining > 0 ? new Date(s.getFullYear(), s.getMonth() + paid, Math.min(s.getDate(), dim(s.getFullYear(), s.getMonth() + paid))) : null;
  return { active: remaining > 0, next: nextDue, paid, remaining, remainingAmount: remaining * c.amount, endDate: last };
}

export function commitmentsTotal(commitments = [], now = new Date()) {
  return commitments.filter((c) => commitmentStatus(c, now).active).reduce((a, c) => a + (+c.amount || 0), 0);
}

// ---------------- التسليف ----------------
export const debtPaid = (d) => (d.payments || []).reduce((a, p) => a + (+p.amount || 0), 0);
export const debtRemaining = (d) => Math.max((+d.amount || 0) - debtPaid(d), 0);

/** لي = اللي سلّفته ولسا ما رجع، عليّ = اللي استلفته ولسا ما سدّدته */
export function debtSummary(debts = [], now = new Date()) {
  const open = debts.filter((d) => debtRemaining(d) > 0.004);
  const lent = open.filter((d) => d.direction === 'lent');
  const borrowed = open.filter((d) => d.direction === 'borrowed');
  const sum = (l) => l.reduce((a, d) => a + debtRemaining(d), 0);
  const overdue = open.filter((d) => d.dueDate && new Date(`${d.dueDate}T23:59:59`) < now);
  return {
    lent, borrowed, overdue, settled: debts.filter((d) => debtRemaining(d) <= 0.004),
    toMe: sum(lent), iOwe: sum(borrowed), net: sum(lent) - sum(borrowed),
  };
}

// ---------------- الاستثمار ----------------
/** اسم الدورة بشهر نزول الراتب (راتب ٢٧ نوفمبر = دورة نوفمبر، من ٢٧ نوفمبر لين ٢٦ ديسمبر) */
export function cycleKey(range) {
  if (range.key) return range.key;
  const d = range.start;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** تاريخ بداية الحسبة الفعلية: اللي قبله ما يدخل في الميزانية ولا التقارير */
export function startOf(state) {
  const b = state.settings?.budget;
  const s = b?.startDate;
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  // لو التاريخ المحفوظ هو يوم الراتب الاسمي (مثلاً ٢٧ وهو جمعة) نعتمد يوم النزول الفعلي (الخميس ٢٦)
  const pay = b.payday || 27;
  if (d.getDate() === pay) { const act = actualPayday(d.getFullYear(), d.getMonth(), pay); if (act < d) return act; }
  return d;
}
export function tracked(state, txs) {
  const st = startOf(state);
  return st ? txs.filter((t) => new Date(t.date) >= st) : txs;
}

/** المبلغ المخطط للمحفظة في دورة معيّنة: المبلغ المؤقت لو فيه، وإلا الثابت */
export function investAmount(inv, key) {
  if (inv.variable) return 0;
  const o = inv.overrides?.[key];
  return o != null && o !== '' ? +o : +inv.amount || 0;
}

export function investmentsPlanned(investments = [], key) {
  return investments.reduce((a, inv) => a + investAmount(inv, key), 0);
}

/** التحويلات الفعلية لكل محفظة في الدورة */
export function investedInRange(investments = [], txs, range, rates = {}) {
  const out = Object.fromEntries(investments.map((i) => [i.id, 0]));
  for (const t of txs) {
    const d = new Date(t.date);
    if (d < range.start || d >= range.end || t.type === 'income' || !t.investmentId || !(t.investmentId in out)) continue;
    out[t.investmentId] += sar(t, rates);
  }
  return out;
}

// ---------------- الخطة والحد اليومي ----------------
export function plan(state, now = new Date(), allTxs = state.txs || []) {
  const b = state.settings.budget || {};
  if (!(b.salary > 0)) return null;
  const cyc = cycleFor(now, b.payday || 27);
  const key = cycleKey(cyc);
  const commitmentsPlanned = commitmentsTotal(state.commitments, now);
  const investmentsPlannedTotal = investmentsPlanned(state.investments, key);
  // الالتزامات والمحافظ تنخصم من الميزانية لما تأكّد سدادها فقط (علامة صح أو عملية مربوطة)
  const rates = state.settings.rates;
  const txs = tracked(state, allTxs).filter((t) => { const d = new Date(t.date); return d >= cyc.start && d < cyc.end && !t.excluded; });
  let commitments = 0;
  for (const c of state.commitments || []) {
    const got = txs.filter((t) => matchCommitment(t, state.commitments)?.id === c.id).reduce((a, t) => a + sar(t, rates), 0);
    commitments += got > 0 ? got : c.paid?.[key] ? +c.amount || 0 : 0;
  }
  const gotInv = investedInRange(state.investments, txs, cyc, rates);
  let investments = 0;
  for (const i of state.investments || []) {
    if (i.variable) continue;
    investments += gotInv[i.id] > 0 ? gotInv[i.id] : i.done?.[key] ? investAmount(i, key) : 0;
  }
  const extraSavings = +b.savings || 0;
  const savings = extraSavings + investments;
  const monthlyBudget = 0; // ما فيه ميزانية شهرية للمشتريات: التطبيق يفهم عاداتك من التقارير
  const forDaily = b.salary - commitments - savings - monthlyBudget;
  const autoDaily = Math.max(forDaily / cyc.days, 0);
  const daily = b.dailyOverride > 0 ? +b.dailyOverride : autoDaily;
  return { ...cyc, key, salary: +b.salary, commitmentsPlanned, investmentsPlanned: investmentsPlannedTotal, commitments, savings, extraSavings, investments, monthlyBudget, forDaily, autoDaily, daily,
    manualDaily: b.dailyOverride > 0, rollover: b.rollover !== false };
}

/** وضع اليوم: الحد مع الترحيل، اللي انصرف، المتبقي، وكم باقي للدورة */
export function today(state, txs, now = new Date()) {
  const p = plan(state, now, txs);
  if (!p) return null;
  const st = startOf(state);
  if (st && now < st) {
    const sp = plan(state, st);
    return { pending: true, startDate: st, daysToStart: Math.ceil((st - midnight(now)) / DAY), plan: sp };
  }
  txs = tracked(state, txs);
  const rates = state.settings.rates;
  const n = p.days;
  const perDay = new Array(n).fill(0);
  let monthlySpent = 0, commitmentPaid = 0, total = 0, unplannedC = 0;
  for (const t of txs) {
    if (!counts(t)) continue;
    const d = new Date(t.date);
    if (d < p.start || d >= p.end) continue;
    const v = sar(t, rates);
    total += v;
    const bk = bucketOf(t, state);
    if (bk === 'daily') perDay[Math.floor((midnight(d) - p.start) / DAY)] += v;
    else if (bk === 'monthly') monthlySpent += v;
    else {
      commitmentPaid += v;
      // سداد التزام ما هو ضمن الخطة (قسط قديم، دفعة أخيرة…) ينقص من الحد اليومي
      const mc = matchCommitment(t, state.commitments);
      if (!mc) unplannedC += v;
    }
  }
  // تحويلات غير مخططة (مثل حساب الأوبشن): تطلع من الراتب، فتنقص الحد اليومي لباقي الدورة
  const variableIds = new Set((state.investments || []).filter((i) => i.variable).map((i) => i.id));
  let unplanned = unplannedC;
  for (const t of txs) {
    const d = new Date(t.date);
    if (d >= p.start && d < p.end && t.type !== 'income' && variableIds.has(t.investmentId)) unplanned += sar(t, rates);
  }
  if (unplanned > 0 && !p.manualDaily) {
    p.forDaily -= unplanned;
    p.autoDaily = Math.max(p.forDaily / n, 0);
    p.daily = p.autoDaily;
  }
  p.unplanned = unplanned;
  const idx = Math.min(Math.floor((midnight(now) - p.start) / DAY), n - 1);
  const spentBefore = perDay.slice(0, idx).reduce((a, x) => a + x, 0);
  const carry = p.rollover ? p.daily * idx - spentBefore : 0;
  const allowance = p.daily + carry;
  const spentToday = perDay[idx];
  const dailySpent = perDay.reduce((a, x) => a + x, 0);
  const daysLeft = n - idx; // مع اليوم
  const dailyLeft = p.daily * n - dailySpent;
  return {
    plan: p, idx, perDay, carry, allowance, spentToday, remainingToday: allowance - spentToday,
    over: spentToday > allowance, dailySpent, monthlySpent, commitmentPaid, total,
    // المتبقي من الشهر: الراتب ناقص الالتزامات والادخار والمصاريف كلها (اليومية + من ميزانية الشهر)
    monthRemaining: p.salary - p.commitments - p.savings - dailySpent - monthlySpent - (p.unplanned || 0),
    daysLeft, dailyLeft, suggestedDaily: Math.max((dailyLeft + spentToday) / daysLeft, 0),
    leftOfSalary: p.salary - total,
    daysOver: perDay.slice(0, idx + 1).filter((x) => x > p.daily).length,
  };
}

// ---------------- تقرير دورة ----------------
const TIME_SLOTS = [
  ['الصباح', 5, 12], ['الظهر والعصر', 12, 17], ['المساء', 17, 22], ['آخر الليل', 22, 29],
];
const slotOf = (h) => (TIME_SLOTS.find(([, a, b]) => (h >= a && h < b) || (h + 24 >= a && h + 24 < b)) || TIME_SLOTS[3])[0];
export const WEEKDAYS = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export function cycleReport(state, txs, range, dailyLimit = 0) {
  const rates = state.settings.rates;
  const list = tracked(state, txs).filter((t) => { const d = new Date(t.date); return d >= range.start && d < range.end; });
  const exp = list.filter(counts);
  const v = (t) => sar(t, rates);
  const total = exp.reduce((a, t) => a + v(t), 0);
  const income = list.filter((t) => t.type === 'income').reduce((a, t) => a + v(t), 0);

  const group = (keyFn, labelFn) => {
    const m = {};
    for (const t of exp) {
      const k = keyFn(t); if (k == null) continue;
      m[k] ??= { key: k, label: labelFn(t), total: 0, count: 0 };
      m[k].total += v(t); m[k].count++;
    }
    return Object.values(m).map((x) => ({ ...x, pct: total ? (x.total / total) * 100 : 0 })).sort((a, b) => b.total - a.total);
  };

  const byCategory = group((t) => t.category, (t) => t.category);
  const merchants = group((t) => normalizeMerchant(t.merchant) || null, (t) => t.merchant);
  for (const m of merchants) m.category = exp.find((t) => normalizeMerchant(t.merchant) === m.key)?.category;
  const byCard = group((t) => `${t.bank}|${t.card}`, (t) => t.card ? `${t.bank} •${t.card}` : t.bank);
  const byBucket = group((t) => bucketOf(t, state), (t) => bucketOf(t, state));

  const days = Math.round((range.end - range.start) / DAY);
  const perDay = new Array(days).fill(0);
  const perDayDaily = new Array(days).fill(0);
  const weekday = new Array(7).fill(0);
  const slots = Object.fromEntries(TIME_SLOTS.map(([n]) => [n, 0]));
  for (const t of exp) {
    const d = new Date(t.date);
    const i = Math.floor((midnight(d) - range.start) / DAY);
    perDay[i] += v(t);
    if (bucketOf(t, state) === 'daily') perDayDaily[i] += v(t);
    weekday[d.getDay()] += v(t);
    slots[slotOf(d.getHours())] += v(t);
  }
  const topIdx = perDay.reduce((best, x, i) => (x > perDay[best] ? i : best), 0);
  const topDay = total ? { date: new Date(range.start.getTime() + topIdx * DAY), total: perDay[topIdx], pct: (perDay[topIdx] / total) * 100 } : null;
  const wd = weekday.indexOf(Math.max(...weekday));
  const activeDays = perDay.filter((x) => x > 0).length;
  return {
    range, days, total, income, count: exp.length, byCategory, merchants, byCard, byBucket, perDay, topDay,
    topWeekday: total ? { name: WEEKDAYS[wd], total: weekday[wd], pct: (weekday[wd] / total) * 100 } : null,
    weekday, slots, avgPerDay: total / days, activeDays, noSpendDays: days - activeDays,
    daysOver: dailyLimit > 0 ? perDayDaily.filter((x) => x > dailyLimit).length : null,
  };
}

// ---------------- العادات ----------------
/** يطلع عادات متكررة من آخر ٩٠ يوم بجمل واضحة */
export function habits(state, txs, now = new Date(), CATS = {}) {
  const rates = state.settings.rates;
  const from = new Date(now - 90 * DAY);
  const exp = tracked(state, txs).filter((t) => counts(t) && new Date(t.date) >= from && t.type !== 'transfer');
  if (exp.length < 5) return [];
  const first = Math.min(...exp.map((t) => +new Date(t.date)));
  const weeks = Math.max((now - first) / (7 * DAY), 1);
  const months = weeks / 4.345;
  const out = [];
  const v = (t) => sar(t, rates);

  // تجار تزورهم كثير
  const m = {};
  for (const t of exp) {
    const k = normalizeMerchant(t.merchant); if (!k) continue;
    m[k] ??= { name: t.merchant, cat: t.category, n: 0, sum: 0 };
    m[k].n++; m[k].sum += v(t);
  }
  Object.values(m).filter((x) => x.n >= 4 && x.n / weeks >= 0.5).sort((a, b) => b.n - a.n).slice(0, 4).forEach((x) => {
    out.push({ icon: CATS[x.cat]?.icon || '📍', score: x.sum,
      text: `تزور «${x.name}» تقريباً ${fmt1(x.n / weeks)} مرة بالأسبوع، بمتوسط ${fmt0(x.sum / x.n)} ر.س — يعني ${fmt0(x.sum / months)} ر.س بالشهر` });
  });

  // تصنيفات متكررة
  const c = {};
  for (const t of exp) { c[t.category] ??= { n: 0, sum: 0 }; c[t.category].n++; c[t.category].sum += v(t); }
  for (const [k, x] of Object.entries(c)) {
    if (['restaurants', 'delivery'].includes(k) && x.n / weeks >= 2) {
      out.push({ icon: CATS[k]?.icon, score: x.sum,
        text: `${CATS[k]?.name}: ${fmt1(x.n / weeks)} مرة بالأسبوع (${fmt0(x.sum / months)} ر.س بالشهر). لو قللتها مرتين بالأسبوع توفّر تقريباً ${fmt0((x.sum / x.n) * 2 * 4.345)} ر.س بالشهر` });
    }
  }

  // مشتريات صغيرة متكررة
  const small = exp.filter((t) => v(t) <= 30);
  if (small.length >= 10) {
    const s = small.reduce((a, t) => a + v(t), 0);
    out.push({ icon: '🪙', score: s, text: `المشتريات الصغيرة (أقل من ٣٠ ر.س) تبان بسيطة، بس مجموعها ${fmt0(s / months)} ر.س بالشهر (${small.length} عملية)` });
  }

  // نهاية الأسبوع
  const we = exp.filter((t) => [4, 5, 6].includes(new Date(t.date).getDay()));
  const wdays = exp.filter((t) => ![4, 5, 6].includes(new Date(t.date).getDay()));
  const weAvg = we.reduce((a, t) => a + v(t), 0) / (weeks * 3);
  const wdAvg = wdays.reduce((a, t) => a + v(t), 0) / (weeks * 4);
  if (wdAvg > 0 && weAvg / wdAvg >= 1.3) out.push({ icon: '📅', score: weAvg, text: `صرفك اليومي في الويكند (خميس–سبت) أعلى بـ ${fmt0((weAvg / wdAvg - 1) * 100)}% من باقي الأسبوع` });

  // آخر الليل
  const late = exp.filter((t) => { const h = new Date(t.date).getHours(); return h >= 22 || h < 4; });
  if (late.length >= 5) {
    const s = late.reduce((a, t) => a + v(t), 0);
    out.push({ icon: '🌙', score: s, text: `${late.length} عملية بعد الساعة ١٠ بالليل بمجموع ${fmt0(s)} ر.س — غالباً طلبات وتسوق متأخر` });
  }

  // أول أسبوع بعد الراتب
  const b = state.settings.budget;
  if (b?.salary > 0) {
    let fwSum = 0, restSum = 0, fwDays = 0, restDays = 0;
    const inFirstWeek = (d) => (midnight(d) - cycleFor(d, b.payday || 27).start) / DAY < 7;
    for (let d = midnight(new Date(first)); d <= now; d = new Date(d.getTime() + DAY)) inFirstWeek(d) ? fwDays++ : restDays++;
    for (const t of exp) inFirstWeek(new Date(t.date)) ? (fwSum += v(t)) : (restSum += v(t));
    if (fwDays >= 7 && restDays >= 7 && fwSum / fwDays > 1.4 * (restSum / restDays)) {
      out.push({ icon: '💰', score: fwSum, text: `أول أسبوع بعد الراتب تصرف يومياً ${fmt0(fwSum / fwDays)} ر.س مقابل ${fmt0(restSum / restDays)} ر.س باقي الدورة — انتبه لـ«نشوة الراتب»` });
    }
  }
  return out.sort((a, b2) => b2.score - a.score);
}

const nf0 = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('ar-SA-u-nu-latn', { maximumFractionDigits: 1 });
const fmt0 = (n) => nf0.format(n);
const fmt1 = (n) => nf1.format(n);

/** يقترح التزامات من عمليات تابي/تمارا */
export function suggestInstallments(txs, commitments = []) {
  const have = new Set(commitments.map((c) => normalizeMerchant(c.keyword || c.name)));
  const out = {};
  for (const t of txs) {
    if (!/tabby|تابي|tamara|تمارا/i.test(`${t.merchant} ${t.raw || ''}`)) continue;
    const k = normalizeMerchant(t.merchant);
    if (!k || have.has(k) || out[k]) continue;
    out[k] = { name: t.merchant, amount: t.amount, provider: /tamara|تمارا/i.test(`${t.merchant} ${t.raw}`) ? 'تمارا' : 'تابي' };
  }
  return Object.values(out);
}

/** يتعرّف على الراتب من رسائل الإيداع */
export function detectSalary(txs) {
  const s = txs.filter((t) => t.type === 'income' && /راتب|salary|payroll|رواتب/i.test(`${t.raw || ''} ${t.merchant}`))
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
  return s ? { amount: s.amount, day: new Date(s.date).getDate() } : null;
}
export const normKey = normalizeMerchant;

// ---------------- أيقونة الالتزام وحالة هالدورة ----------------
const FAMILY = /ماما|الوالدة|والدتي|أمي|امي|أبوي|ابوي|بابا|والدي|الوالد|الأهل|الاهل/;
const PHONE = /جوال|موبايل|موبايلي|اتصالات|انترنت|إنترنت|\bstc\b|زين|mobily|zain/i;
/** الأيقونة تنحدد من النوع، أو من الاسم لو النوع عام (ماما ← قلب، موبايلي ← جوال) */
export function commitIcon(c) {
  const n = c.name || '';
  if (c.kind === 'family' || (['other', 'bill'].includes(c.kind) && FAMILY.test(n))) return '❤️';
  if (c.kind === 'phone' || (['other', 'bill'].includes(c.kind) && PHONE.test(n))) return '📱';
  return (COMMITMENT_KINDS[c.kind] || COMMITMENT_KINDS.other).icon;
}
export function commitTint(c) {
  const i = commitIcon(c);
  return i === '❤️' ? '#ff375f' : i === '📱' ? '#30b158' : '#ff8a00';
}
/** سُدّد هالدورة؟ علامة يدوية، أو رسالة سداد مربوطة */
export function commitmentDone(c, key, txs, commitments, cyc) {
  return !!c.paid?.[key] || paidInRange(c, txs, commitments, cyc).length > 0;
}
/** المحفظة تحوّلت هالدورة؟ علامة يدوية، أو تحويلات فعلية بقدر المبلغ */
export function investmentDone(inv, key, got) {
  const amt = investAmount(inv, key);
  return !!inv.done?.[key] || (amt > 0 && got >= amt);
}
