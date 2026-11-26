// اختبارات التسليف: الربط بالعمليات، الاستبعاد من الصرف، المتبقي
const mem = {};
globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; } };
import assert from 'node:assert/strict';
const store = await import('../js/store.js');
const { debtSummary, debtRemaining, counts } = await import('../js/budget.js');
const { isExpense } = await import('../js/insights.js');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('✓', name); } catch (e) { fail++; console.log('✗', name, '—', e.message); } };
const S = () => store.getState();

const out = 'حوالة محلية صادرة\nمن: **2000\nإلى: SA03 8000 0000 6080 1016 7519\nمبلغ: SAR 500\nفي: 20-11-2026 09:00';
const back = 'حوالة واردة\nمن: أبو خالد\nمبلغ: SAR 200\nإيداع في حسابك **2000\nفي: 25-11-2026 10:00';

t('تسليف: العملية تنستبعد من الصرف', () => {
  const d = store.saveDebt({ direction: 'lent', person: 'أبو خالد', amount: 500, date: '2026-11-21T12:00:00.000Z' });
  const r = store.debtMessageTx(out); assert.ok(r.ok);
  // التحويل المطابق للدين ينربط ويستبعد تلقائياً بدون ما تلصق شي
  const tx = S().txs.find((x) => x.id === r.tx.id);
  assert.equal(S().debts[0].principalTxId, tx.id);
  assert.equal(isExpense(tx), false); assert.equal(counts(tx), false);
  assert.equal(tx.debtId, d.id);
});
t('سداد جزئي من رسالة بنك', () => {
  const d = S().debts[0];
  const r = store.debtMessageTx(back); assert.ok(r.ok);
  store.attachDebtTx(d.id, r.tx.id, 'payment');
  assert.equal(debtRemaining(S().debts[0]), 300);
});
t('سداد يدوي وتسوية', () => {
  const d = S().debts[0];
  store.addDebtPayment(d.id, { amount: 300, date: new Date().toISOString() });
  assert.equal(debtRemaining(S().debts[0]), 0);
  assert.equal(debtSummary(S().debts).settled.length, 1);
});
t('ملخص لي وعليّ والصافي', () => {
  store.saveDebt({ direction: 'lent', person: 'سعد', amount: 1000, date: new Date().toISOString() });
  store.saveDebt({ direction: 'borrowed', person: 'فهد', amount: 400, date: new Date().toISOString(), dueDate: '2020-01-01' });
  const sm = debtSummary(S().debts);
  assert.equal(sm.toMe, 1000); assert.equal(sm.iOwe, 400); assert.equal(sm.net, 600);
  assert.equal(sm.overdue.length, 1);
});
t('تسديد دين علي ينحسب التزام مو يومي', () => {
  const fahd = S().debts.find((d) => d.person === 'فهد');
  const r = store.debtMessageTx('حوالة محلية صادرة\nمن: **2000\nإلى: SA11 2000 0001 2345 6789 4455\nمبلغ: SAR 150\nفي: 26-11-2026 09:00');
  store.attachDebtTx(fahd.id, r.tx.id, 'payment');
  const tx = S().txs.find((x) => x.id === r.tx.id);
  assert.equal(tx.bucket, 'commitment'); assert.equal(isExpense(tx), true);
  assert.equal(debtRemaining(S().debts.find((d) => d.person === 'فهد')), 250);
});
t('حذف دين يرجّع العمليات لحالتها', () => {
  const abu = S().debts.find((d) => d.person === 'أبو خالد');
  const tx = S().txs.find((x) => x.debtId === abu.id && x.debtRole === 'principal');
  store.deleteDebt(abu.id);
  const after = S().txs.find((x) => x.id === tx.id);
  assert.equal(after.debtId, undefined); assert.equal(isExpense(after), true);
});
t('فك ربط عملية سداد يرجّع المتبقي', () => {
  const fahd = S().debts.find((d) => d.person === 'فهد');
  const p = fahd.payments.find((x) => x.txId);
  store.deleteDebtPayment(fahd.id, p.id);
  assert.equal(debtRemaining(S().debts.find((d) => d.person === 'فهد')), 400);
  assert.equal(S().txs.find((x) => x.id === p.txId).bucket, undefined);
});
t('دين جديد يلقى تحويل سابق مطابق ويستبعده', () => {
  const r = store.debtMessageTx('حوالة محلية صادرة\nمن: **2000\nإلى: **9090\nمبلغ: SAR 750\nفي: 22-11-2026 09:00');
  assert.equal(isExpense(S().txs.find((x) => x.id === r.tx.id)), true);
  const d = store.saveDebt({ direction: 'lent', person: 'خالد', amount: 750, date: new Date('2026-11-23').toISOString() });
  assert.equal(isExpense(S().txs.find((x) => x.id === r.tx.id)), false);
  assert.ok(S().debts.find((x) => x.id === d.id).principalTxId);
});
t('زر «تم السداد» يسوّي الدين ويرجّعه', () => {
  const d = S().debts.find((x) => x.person === 'خالد');
  assert.equal(store.toggleDebtSettled(d.id), true);
  assert.equal(debtRemaining(S().debts.find((x) => x.id === d.id)), 0);
  assert.equal(store.toggleDebtSettled(d.id), false);
  assert.equal(debtRemaining(S().debts.find((x) => x.id === d.id)), 750);
});
t('علامة تم السداد للالتزام والمحفظة بالدورة وترجع', () => {
  const c = store.saveCommitment({ kind: 'family', name: 'ماما', amount: 2000, day: 1 });
  store.toggleCommitmentPaid(c.id, '2026-11'); assert.equal(S().commitments.find((x) => x.id === c.id).paid['2026-11'], true);
  assert.equal(S().commitments.find((x) => x.id === c.id).paid['2026-12'], undefined); // الدورة الجاية تبدأ بدون علامة
  store.toggleCommitmentPaid(c.id, '2026-11'); assert.equal(S().commitments.find((x) => x.id === c.id).paid['2026-11'], undefined);
  const i = store.saveInvestment({ name: 'محفظة', amount: 1000, overrides: {} });
  store.toggleInvestmentDone(i.id, '2026-11'); assert.equal(S().investments.find((x) => x.id === i.id).done['2026-11'], true);
});
t('مسح الرسالة المتعلّمة يحذف العملية اللي انضافت بالغلط', () => {
  const i = store.saveInvestment({ name: 'تقنية', amount: 1200, overrides: {} });
  const before = S().txs.length;
  const r = store.linkInvestmentMessage(i.id, 'شراء إنترنت بـSR 18.5 \nعبر6196;فيزا\nلـKUDU\nرصيد:100 SR\n23/11/26 8:38');
  assert.ok(r.ok); assert.equal(S().txs.length, before + 1);
  store.clearLink('inv', i.id);
  assert.equal(S().txs.length, before); assert.equal(S().investments.find((x) => x.id === i.id).signature, undefined);
});
t('فك ربط عملية بمحفظة يرجّعها صرف عادي', () => {
  const i = S().investments.find((x) => x.name === 'تقنية');
  const r = store.linkInvestmentMessage(i.id, 'شراء إنترنت بـSR 33 \nعبر6196;فيزا\nلـNOON\nرصيد:100 SR\n23/11/26 9:38');
  assert.equal(isExpense(S().txs.find((x) => x.id === r.tx.id)), false);
  store.unlinkTx(r.tx.id);
  assert.equal(isExpense(S().txs.find((x) => x.id === r.tx.id)), true);
});
console.log(`\n${pass}/${pass + fail} نجحت`);
if (fail) process.exit(1);
