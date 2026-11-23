// اختبارات الميزانية: الدورة، الحد اليومي والترحيل، الالتزامات، التقارير
import assert from 'node:assert/strict';
import { cycleKey, investAmount, investmentsPlanned, cycleFor, today, commitmentStatus, cycleReport, bucketOf, habits, matchCommitment, commitmentSignature, extractTarget } from '../js/budget.js';
import { parseSMS } from '../js/parser.js';

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
// بصمة رسائل الالتزامات
const P = (t, sender = 'alinma') => ({ ...parseSMS(t, { sender }), id: Math.random() });
t('بصمة الإيجار من المستفيد (حوالة)', () => {
  const nov = P('حوالة محلية صادرة\nمن: **2000\nإلى: SA03 8000 0000 6080 1016 7519\nالمستفيد: أبو فهد العقارية\nمبلغ: SAR 2,500\nفي: 01-11-2026 09:12');
  const rent = { id: 'r', name: 'إيجار', signature: commitmentSignature(nov) };
  assert.equal(extractTarget(nov.raw), '7519');
  const dec = P('حوالة محلية صادرة\nمن: **2000\nإلى: SA03 8000 0000 6080 1016 7519\nالمستفيد: أبو فهد العقارية\nمبلغ: SAR 2,500\nفي: 01-12-2026 10:40');
  assert.equal(matchCommitment(dec, [rent])?.id, 'r');
  const other = P('حوالة محلية صادرة\nمن: **2000\nإلى: SA44 2000 0001 2345 6789 1111\nمبلغ: SAR 2,500');
  assert.equal(matchCommitment(other, [rent]), null);
});
t('بصمة القسط من اسم التاجر', () => {
  const nov = P('شراء إنترنت بـSR 250\nعبر6196;فيزا\nلـTABBY\nرصيد:100 SR', 'AlRajhiBank');
  const c = { id: 't', name: 'قسط الجوال', signature: commitmentSignature(nov) };
  const dec = P('شراء إنترنت بـSR 250\nعبر6196;فيزا\nلـTabby\nرصيد:50 SR', 'AlRajhiBank');
  assert.equal(matchCommitment(dec, [c])?.id, 't');
  assert.equal(matchCommitment(P('شراء إنترنت بـSR 250\nعبر6196;فيزا\nلـNOON', 'AlRajhiBank'), [c]), null);
});
t('بصمة القرض من المبلغ والبنك', () => {
  const nov = P('خصم قسط تمويل\nمبلغ: SAR 1,830.50\nمن حساب: **2000\nفي: 27-11-2026');
  const c = { id: 'l', name: 'قرض', signature: commitmentSignature(nov) };
  assert.equal(matchCommitment(P('خصم قسط تمويل\nمبلغ: SAR 1,830.50\nمن حساب: **2000\nفي: 27-12-2026'), [c])?.id, 'l');
  assert.equal(matchCommitment(P('خصم قسط تمويل\nمبلغ: SAR 900\nمن حساب: **2000'), [c]), null);
  assert.equal(matchCommitment(P('خصم قسط تمويل\nمبلغ: SAR 1,830.50', 'AlRajhiBank'), [c]), null);
});
// الاستثمار
const invs = [
  { id: 'a', name: 'العالية', amount: 1600, overrides: { '2026-11': 1200, '2026-12': 1200 } },
  { id: 'b', name: 'المغامرة', amount: 1300, overrides: { '2026-11': 900, '2026-12': 900 } },
  { id: 'o', name: 'أوبشن', amount: 0, variable: true },
];
t('اسم الدورة بشهر نزول الراتب', () => {
  assert.equal(cycleKey(cycleFor(D('2026-11-23'), 27)), '2026-10');
  assert.equal(cycleKey(cycleFor(D('2026-11-27T09:00'), 27)), '2026-11');
  assert.equal(cycleKey(cycleFor(D('2026-12-20'), 27)), '2026-11');
  assert.equal(cycleKey(cycleFor(D('2026-12-28'), 27)), '2026-12');
  assert.equal(cycleKey(cycleFor(D('2027-01-27'), 27)), '2027-01');
});
t('المبالغ المؤقتة لنوفمبر وديسمبر ثم ترجع', () => {
  assert.equal(investmentsPlanned(invs, '2026-11'), 2100);
  assert.equal(investmentsPlanned(invs, '2026-12'), 2100);
  assert.equal(investmentsPlanned(invs, '2027-01'), 2900);
});
t('الاستثمار ينخصم قبل الحد اليومي، والتحويلات ما تنحسب صرف', () => {
  const st = base({ savings: 0, monthlyBudget: 0 }); st.investments = invs;
  const txs = [{ type: 'transfer', amount: 1200, investmentId: 'a', date: '2026-11-28T10:00:00' }];
  const r = today(st, txs, D('2026-11-29T12:00'));
  assert.equal(r.plan.investments, 2100);
  assert.equal(r.plan.days, 30);
  assert.ok(Math.abs(r.plan.daily - (10000 - 2700 - 2100) / 30) < 0.01);
  assert.equal(today(st, [], D('2027-01-28T12:00')).plan.investments, 2900);
  assert.equal(r.total, 0);
});
t('تحويل الأوبشن ينقص الحد اليومي', () => {
  const st = base({ savings: 0, monthlyBudget: 0 }); st.investments = invs;
  const r = today(st, [{ type: 'transfer', amount: 620, investmentId: 'o', date: '2026-11-28T10:00:00' }], D('2026-11-29T12:00'));
  assert.equal(r.plan.unplanned, 620);
  assert.ok(Math.abs(r.plan.daily - (10000 - 2700 - 2100 - 620) / 30) < 0.01);
  assert.equal(r.total, 0);
});
t('قبل بداية الحسبة: انتظار، والعمليات القديمة ما تنحسب', () => {
  const st = base({ startDate: '2026-11-27' });
  const r0 = today(st, [], D('2026-11-23T12:00'));
  assert.equal(r0.pending, true); assert.equal(r0.daysToStart, 4);
  const r = today(st, [
    { type: 'purchase', amount: 999, date: '2026-11-20T10:00:00', merchant: 'OLD' },
    { type: 'purchase', amount: 50, date: '2026-11-27T10:00:00', merchant: 'NEW' },
  ], D('2026-11-27T12:00'));
  assert.equal(r.total, 50);
});
console.log(`\n${pass}/${pass + fail} نجحت`);
if (fail) process.exit(1);
