// اختبارات الميزانية: الدورة، الحد اليومي والترحيل، الالتزامات، التقارير
import assert from 'node:assert/strict';
import { cycleFor, today, commitmentStatus, cycleReport, bucketOf, habits } from '../js/budget.js';

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, '—', e.message); } };
const D = (s) => new Date(s);

t('الدورة: راتب ٢٧ واليوم ٢٣ نوفمبر ← من ٢٧ أكتوبر', () => {
  const c = cycleFor(D('2026-11-23T10:00'), 27);
  assert.equal(c.start.toDateString(), D('2026-10-27T00:00').toDateString());
  assert.equal(c.end.toDateString(), D('2026-11-27T00:00').toDateString());
  assert.equal(c.days, 31);
});
t('الدورة: يوم الراتب نفسه يبدأ دورة جديدة', () => {
  assert.equal(cycleFor(D('2026-11-27T08:00'), 27).start.getDate(), 27);
  assert.equal(cycleFor(D('2026-11-27T08:00'), 27).start.getMonth(), 10);
});
t('الدورة: راتب ٣١ في فبراير ← آخر يوم بالشهر', () => {
  const c = cycleFor(D('2027-03-05T10:00'), 31);
  assert.equal(c.start.toDateString(), D('2027-02-28T00:00').toDateString());
  assert.equal(c.end.toDateString(), D('2027-03-31T00:00').toDateString());
});
t('الدورة السابقة', () => {
  assert.equal(cycleFor(D('2026-11-23'), 27, -1).start.toDateString(), D('2026-09-27T00:00').toDateString());
});

const base = (extra = {}) => ({
  settings: { rates: { USD: 3.75 }, budget: { salary: 10000, payday: 27, savings: 1000, monthlyBudget: 1000, rollover: true, ...extra } },
  commitments: [{ id: 'c1', name: 'إيجار', amount: 2700, day: 1, kind: 'rent' }],
  bucketRules: {},
});
// الدورة ٢٧ أكتوبر – ٢٦ نوفمبر = ٣١ يوم ← (10000-2700-1000-1000)/31 = 170.97
t('الحد اليومي التلقائي والترحيل', () => {
  const st = base();
  const txs = [
    { type: 'purchase', amount: 100, date: '2026-10-27T12:00:00', merchant: 'KUDU', category: 'restaurants' }, // يوم ١: وفّر 70.97
    { type: 'purchase', amount: 300, date: '2026-10-28T12:00:00', merchant: 'IKEA', category: 'shopping', bucket: 'monthly' }, // شهري
    { type: 'purchase', amount: 50, date: '2026-10-29T12:00:00', merchant: 'KUDU', category: 'restaurants' },
  ];
  const r = today(st, txs, D('2026-10-29T18:00'));
  assert.equal(r.plan.days, 31);
  assert.ok(Math.abs(r.plan.daily - 5300 / 31) < 0.01);
  // الترحيل = حد يومين − 100 = 241.94
  assert.ok(Math.abs(r.carry - (2 * 5300 / 31 - 100)) < 0.01, 'carry ' + r.carry);
  assert.ok(Math.abs(r.remainingToday - (3 * 5300 / 31 - 150)) < 0.01);
  assert.equal(r.monthlySpent, 300);
});
t('بدون ترحيل', () => {
  const r = today(base({ rollover: false }), [{ type: 'purchase', amount: 10, date: '2026-10-27T12:00:00', merchant: 'X' }], D('2026-10-29T18:00'));
  assert.equal(r.carry, 0);
});
t('حد يومي يدوي', () => {
  assert.equal(today(base({ dailyOverride: 150 }), [], D('2026-11-01')).plan.daily, 150);
});
t('مستبعد وإيداع ما ينحسبون', () => {
  const r = today(base(), [
    { type: 'transfer', amount: 500, excluded: true, date: '2026-11-01T10:00:00' },
    { type: 'income', amount: 9000, date: '2026-11-01T10:00:00' },
  ], D('2026-11-01T12:00'));
  assert.equal(r.total, 0);
});
t('سداد تابي يطابق الالتزام', () => {
  const st = base(); st.commitments.push({ id: 'c2', name: 'جوال', amount: 400, kind: 'installment', keyword: 'tabby', total: 4, startDate: '2026-10-05', day: 5 });
  assert.equal(bucketOf({ type: 'purchase', merchant: 'Tabby' }, st), 'commitment');
  assert.equal(bucketOf({ type: 'purchase', merchant: 'KUDU' }, st), 'daily');
});
t('قاعدة نوع الصرف لتاجر', () => {
  const st = base(); st.bucketRules = { ikea: 'monthly' };
  assert.equal(bucketOf({ type: 'purchase', merchant: 'IKEA Riyadh' }, st), 'monthly');
});
t('حالة الأقساط', () => {
  const s = commitmentStatus({ kind: 'installment', amount: 250, total: 4, startDate: '2026-09-10' }, D('2026-11-23'));
  assert.equal(s.paid, 3); assert.equal(s.remaining, 1); assert.equal(s.remainingAmount, 250);
  assert.equal(s.next.getDate(), 10); assert.equal(s.next.getMonth(), 11);
  const done = commitmentStatus({ kind: 'loan', amount: 1000, total: 2, startDate: '2026-01-01' }, D('2026-11-23'));
  assert.equal(done.active, false);
});
t('تقرير الدورة: أكثر يوم وتاجر وبطاقة', () => {
  const range = cycleFor(D('2026-11-23'), 27);
  const txs = [
    { type: 'purchase', amount: 20, date: '2026-11-01T09:00:00', merchant: 'Barns 12', category: 'restaurants', bank: 'الإنماء', card: '4188' },
    { type: 'purchase', amount: 25, date: '2026-11-03T09:00:00', merchant: 'BARNS', category: 'restaurants', bank: 'الإنماء', card: '4188' },
    { type: 'purchase', amount: 300, date: '2026-11-05T20:00:00', merchant: 'Panda', category: 'groceries', bank: 'الراجحي', card: '6196' },
  ];
  const r = cycleReport(base(), txs, range, 170);
  assert.equal(r.total, 345);
  assert.equal(r.topDay.date.getDate(), 5);
  assert.equal(r.merchants.find((m) => m.key === 'barns').count, 2);
  assert.equal(r.byCard[0].label, 'الراجحي •6196');
  assert.equal(r.daysOver, 1);
});
t('العادات تطلع جمل', () => {
  const txs = [];
  for (let i = 0; i < 40; i++) txs.push({ type: 'purchase', amount: 18, date: new Date(D('2026-11-23') - i * 2 * 864e5).toISOString(), merchant: 'BARNS', category: 'restaurants' });
  const h = habits(base(), txs, D('2026-11-23'), { restaurants: { name: 'مطاعم', icon: '🍔' } });
  assert.ok(h.length >= 1); assert.ok(h.some((x) => x.text.includes('BARNS')));
});
console.log(`\n${pass}/${pass + fail} نجحت`);
if (fail) process.exit(1);
