// تحليلات: تجميع الصرف حسب الفترة والتصنيف، واكتشاف الاشتراكات المتكررة
import { normalizeMerchant, KNOWN_SUBSCRIPTION } from './categories.js';

const DAY = 864e5;

export const isExpense = (tx) => tx.type !== 'income' && !tx.excluded && !tx.investmentId;

export function startOfWeek(d) {
  // الأسبوع يبدأ يوم الأحد
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - x.getDay());
  return x;
}

export function periodRange(kind, offset = 0, ref = new Date()) {
  if (kind === 'week') {
    const s = startOfWeek(ref);
    s.setDate(s.getDate() + offset * 7);
    const e = new Date(s); e.setDate(e.getDate() + 7);
    return { start: s, end: e };
  }
  const s = new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
  const e = new Date(ref.getFullYear(), ref.getMonth() + offset + 1, 1);
  return { start: s, end: e };
}

export function inRange(txs, { start, end }) {
  return txs.filter((t) => { const d = new Date(t.date); return d >= start && d < end; });
}

// المبلغ بالريال (للعملات الأجنبية نستخدم سعر تقريبي يقدر المستخدم يغيّره)
export function sar(tx, rates = {}) {
  if (!tx.currency || tx.currency === 'SAR') return tx.amount;
  return tx.amount * (rates[tx.currency] || 1);
}

export function totalsByCategory(txs, rates) {
  const map = {};
  for (const t of txs) if (isExpense(t)) map[t.category] = (map[t.category] || 0) + sar(t, rates);
  return Object.entries(map).map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}

export function dailySeries(txs, { start, end }, rates) {
  const days = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) days.push({ date: new Date(d), total: 0 });
  for (const t of txs) {
    if (!isExpense(t)) continue;
    const i = Math.floor((new Date(t.date) - start) / DAY);
    if (days[i]) days[i].total += sar(t, rates);
  }
  return days;
}

export function monthlyTrend(txs, months = 6, ref = new Date(), rates) {
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const r = periodRange('month', -i, ref);
    const total = inRange(txs, r).filter(isExpense).reduce((s, t) => s + sar(t, rates), 0);
    out.push({ start: r.start, total });
  }
  return out;
}

export function topMerchants(txs, n = 5, rates) {
  const map = {};
  for (const t of txs) {
    if (!isExpense(t) || !t.merchant) continue;
    const k = normalizeMerchant(t.merchant) || t.merchant;
    map[k] ??= { name: t.merchant, total: 0, count: 0 };
    map[k].total += sar(t, rates); map[k].count++;
  }
  return Object.values(map).sort((a, b) => b.total - a.total).slice(0, n);
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * يكتشف الاشتراكات: نفس التاجر + مبلغ متقارب (±15%) + فاصل منتظم (أسبوعي/شهري/سنوي).
 * التجار المعروفين كاشتراكات (Netflix, Shahid, ...) يكفيهم عمليتين، وغيرهم لازم ٣.
 */
export function detectSubscriptions(txs, now = new Date(), dismissed = []) {
  const groups = {};
  for (const t of txs) {
    if (t.type !== 'purchase' && t.type !== 'bill') continue;
    const k = normalizeMerchant(t.merchant);
    if (!k || dismissed.includes(k)) continue;
    (groups[k] ??= []).push(t);
  }
  const subs = [];
  for (const [key, list] of Object.entries(groups)) {
    const known = KNOWN_SUBSCRIPTION.test(list[0].merchant) || list.some((t) => t.category === 'subscriptions');
    if (list.length < (known ? 2 : 3)) continue;
    list.sort((a, b) => new Date(a.date) - new Date(b.date));
    // نأخذ أكبر مجموعة مبالغ متقاربة
    const amounts = list.map((t) => t.amount);
    const typical = median(amounts);
    const similar = list.filter((t) => Math.abs(t.amount - typical) <= typical * 0.15 + 0.5);
    if (similar.length < (known ? 2 : 3)) continue;
    const gaps = [];
    for (let i = 1; i < similar.length; i++) gaps.push((new Date(similar[i].date) - new Date(similar[i - 1].date)) / DAY);
    const g = median(gaps);
    let period = null;
    if (g >= 6 && g <= 8) period = 'weekly';
    else if (g >= 26 && g <= 35) period = 'monthly';
    else if (g >= 85 && g <= 95) period = 'quarterly';
    else if (g >= 350 && g <= 380) period = 'yearly';
    if (!period) continue;
    // كل الفواصل لازم تكون قريبة من الوسيط (نسمح بشهر مفقود)
    const regular = gaps.every((x) => Math.abs(x - g) <= Math.max(4, g * 0.2) || Math.abs(x - 2 * g) <= Math.max(5, g * 0.2));
    if (!regular) continue;
    const last = similar[similar.length - 1];
    const next = new Date(new Date(last.date).getTime() + g * DAY);
    const perMonth = { weekly: 52 / 12, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 }[period];
    const stale = (now - new Date(last.date)) / DAY > g * 1.8; // يمكن ألغيته
    subs.push({
      key, name: last.merchant, amount: typical, currency: last.currency || 'SAR', period,
      monthlyCost: typical * perMonth, lastDate: last.date, nextDate: next.toISOString(),
      count: similar.length, stale, category: last.category,
    });
  }
  return subs.sort((a, b) => b.monthlyCost - a.monthlyCost);
}
