// اختبارات المحلّل على صيغ رسائل شائعة (الأرقام والتجار تجريبية)
import assert from 'node:assert/strict';
import { parseSMS, splitBatch } from '../js/parser.js';
import { categorize } from '../js/categories.js';
import { detectSubscriptions } from '../js/insights.js';

const now = new Date('2026-11-19T12:00:00');
const cases = [
  {
    name: 'الراجحي - نقاط البيع (سطور)',
    sender: 'AlRajhiBank',
    text: 'شراء عبر نقاط البيع\nبطاقة:4321;مدى-ابل باي\nمبلغ:SAR 45.50\nلدى:HUNGERSTATION\nفي:2026-11-18 21:30',
    expect: { type: 'purchase', amount: 45.5, merchant: 'HUNGERSTATION', card: '4321', bank: 'الراجحي', category: 'delivery' },
  },
  {
    name: 'الراجحي - شراء إنترنت',
    sender: 'AlRajhiBank',
    text: 'شراء إنترنت\nبطاقة: 1234 ;ائتمانية\nمن: 5678\nمبلغ: 56.99 SAR\nلدى: NETFLIX.COM\nفي: 26/11/17 10:20',
    expect: { type: 'purchase', amount: 56.99, merchant: 'NETFLIX.COM', card: '1234', category: 'subscriptions' },
  },
  {
    name: 'الأهلي - صيغة "بـ / من"',
    sender: 'SNB-AlAhli',
    text: 'شراء عبر نقاط البيع\nبـ 25.00 SAR\nمن TAMIMI MARKETS\nمدى *9876\nفي 10:22 17/11/26',
    expect: { type: 'purchase', amount: 25, merchant: 'TAMIMI MARKETS', card: '9876', bank: 'البنك الأهلي', category: 'groceries' },
  },
  {
    name: 'بنك STC - إنجليزي',
    sender: 'STCBank',
    text: 'Purchase\nAmount: 30.00 SAR\nCard: **1111\nMerchant: Starbucks Olaya\nDate: 2026-11-19 08:15\nBalance: 1,250.40 SAR',
    expect: { type: 'purchase', amount: 30, merchant: 'Starbucks Olaya', card: '1111', bank: 'بنك STC', category: 'restaurants' },
  },
  {
    name: 'الإنماء - جملة واحدة',
    sender: 'alinma',
    text: 'عملية شراء بمبلغ 120.75 ريال من بطاقة مدى رقم ****2222 لدى ALDREES 4 في 2026-11-15 18:40 رصيدك 3,400.00 ريال',
    expect: { type: 'purchase', amount: 120.75, merchant: 'ALDREES 4', card: '2222', bank: 'الإنماء', category: 'transport' },
  },
  {
    name: 'بنك الرياض - ر.س',
    sender: 'RiyadBank',
    text: 'شراء عبر نقاط البيع\nمبلغ: 89.00 ر.س\nلدى: النهدي الطبية\nبطاقة: 3333\nالرصيد المتاح: 5000.00 ر.س',
    expect: { type: 'purchase', amount: 89, merchant: 'النهدي الطبية', card: '3333', bank: 'بنك الرياض', category: 'health' },
  },
  {
    name: 'أرقام عربية + عملة أجنبية',
    sender: 'AlRajhiBank',
    text: 'شراء إنترنت\nبطاقة: ٤٤٤٤\nمبلغ: USD ١٢٫٩٩\nلدى: SPOTIFY',
    expect: { type: 'purchase', amount: 12.99, currency: 'USD', card: '4444', category: 'subscriptions' },
  },
  {
    name: 'English PoS "By/At"',
    sender: 'SAB',
    text: 'PoS Purchase\nBy: mada Card 5555\nAmount: SAR 64.00\nAt: CAREEM\nDate: 19/11/2026 09:10',
    expect: { type: 'purchase', amount: 64, merchant: 'CAREEM', card: '5555', bank: 'ساب', category: 'transport' },
  },
  {
    name: 'استرداد',
    sender: 'AlRajhiBank',
    text: 'استرداد مبلغ\nبطاقة: 1234\nمبلغ: 45.50 SAR\nمن: AMAZON SA',
    expect: { type: 'income', amount: 45.5, merchant: 'AMAZON SA' },
  },
  {
    name: 'حوالة صادرة',
    sender: 'SNB-AlAhli',
    text: 'حوالة داخلية صادرة\nمن: 7788\nمبلغ: SAR 500\nإلى: محمد أحمد',
    expect: { type: 'transfer', amount: 500, merchant: 'محمد أحمد', category: 'transfers' },
  },
  {
    name: 'سحب صراف',
    sender: 'alinma',
    text: 'سحب نقدي صراف آلي بمبلغ 300 ريال من بطاقة ****2222',
    expect: { type: 'withdrawal', amount: 300, category: 'cash' },
  },
  { name: 'رمز تحقق (يتجاهل)', sender: 'AlRajhiBank', text: 'رمز التحقق: 4821 لعملية شراء بمبلغ 99 SAR لدى NOON. لا تشاركه مع أحد', expect: null },
  { name: 'عملية مرفوضة (يتجاهل)', sender: 'STCBank', text: 'Purchase declined\nAmount: 30 SAR\nMerchant: NOON', expect: null },
  {
    name: 'سداد فاتورة',
    sender: 'RiyadBank',
    text: 'سداد فاتورة\nالمفوتر: STC\nمبلغ: 230.00 SAR\nمن حساب: **6060',
    expect: { type: 'bill', amount: 230, category: 'bills' },
  },
  // رسائل حقيقية من المستخدم (الأرقام مخفية جزئياً)
  {
    name: 'حقيقي - شراء دولي بطاقة المسافر',
    sender: 'AlRajhiBank',
    text: 'شراء دولي إنترنت\nبطاقة المسافر:*4188\nرقم الحساب:*2000\nمبلغ:USD 23\nمن:ANTHROPIC* CLAUDE SUB\nالدولة:الولايات المتحدة\nفي:2026-11-04 10:34\nرسوم العملية:USD 0\nسعر الصرف:1\nالرصيد المتبقي:USD 0.91',
    expect: { type: 'purchase', amount: 23, currency: 'USD', merchant: 'ANTHROPIC* CLAUDE SUB', card: '4188', category: 'subscriptions' },
  },
  {
    name: 'حقيقي - بـSR / عبر / لـ',
    sender: 'AlRajhiBank',
    text: 'شراء إنترنت بـSR 151.55 \nعبر6196;فيزا\nلـAmazon sa\nرصيد:4275.59 SR\n؜19/11/26 13:57',
    expect: { type: 'purchase', amount: 151.55, currency: 'SAR', merchant: 'Amazon sa', card: '6196', category: 'shopping' },
  },
  {
    name: 'حقيقي - اسم تاجر مقصوص HUNGERSTA',
    sender: 'AlRajhiBank',
    text: 'شراء إنترنت بـSR 32.5 \nعبر6196;فيزا-ابل باي\nلـHUNGERSTA\nرصيد:3981.18 SR\n؜18/11/26 8:38',
    expect: { type: 'purchase', amount: 32.5, merchant: 'HUNGERSTA', card: '6196', channel: 'wallet', category: 'delivery' },
  },
  {
    name: 'حقيقي - شحن محفظة برق بآلاف',
    sender: 'AlRajhiBank',
    text: 'شراء إنترنت\nبطاقة المسافر:**4188\nعبر: apple pay\nمبلغ:SAR 1,000\nمن:barq\nفي:12:29 2026-11-19\nالرصيد المتبقي:SAR 1',
    expect: { type: 'purchase', amount: 1000, merchant: 'barq', card: '4188', category: 'transfers' },
  },
  {
    name: 'حقيقي - تعبئة بطاقة المسافر (تحويل داخلي مستبعد)',
    sender: 'alinma',
    text: 'خصم مبلغ: SAR 3.84\nمن حساب: **2000\nإلى بطاقة المسافر: **4188\nفي: 19-11-2026 15:45:17\nالرصيد المتبقي: SAR 4.84',
    expect: { type: 'transfer', excluded: true, amount: 3.84, bank: 'الإنماء', category: 'transfers' },
  },
  {
    name: 'حقيقي - حوالة بين حساباتك',
    sender: 'alinma',
    text: 'حوالة بين حساباتك\nمن:*2001\nإلى:*2000\nمبلغ SAR 1,000\nفي 19-11-26 12:12',
    expect: { type: 'transfer', excluded: true, amount: 1000 },
  },
];

let pass = 0;
for (const c of cases) {
  const tx = parseSMS(c.text, { sender: c.sender, receivedAt: now });
  try {
    if (c.expect === null) {
      assert.equal(tx, null);
    } else {
      assert.ok(tx, 'ما انقرأت الرسالة');
      tx.category = categorize(tx).category;
      for (const [k, v] of Object.entries(c.expect)) assert.equal(tx[k], v, `${k}: ${tx[k]} ≠ ${v}`);
    }
    pass++;
    console.log('✓', c.name);
  } catch (e) {
    console.log('✗', c.name, '—', e.message, '\n   ', JSON.stringify(tx));
  }
}

// تقسيم ملف الدفعات
const batch = splitBatch('#### 2026-11-18T10:00:00+03:00 | AlRajhiBank\nشراء\nمبلغ: 10 SAR\nلدى: KUDU\n#### 2026-11-18T12:00:00+03:00 | STCBank\nPurchase\nAmount: 20 SAR\nMerchant: Jahez');
try { assert.equal(batch.length, 2); assert.equal(batch[1].sender, 'STCBank'); pass++; console.log('✓ splitBatch'); }
catch (e) { console.log('✗ splitBatch', e.message, batch); }

// اكتشاف الاشتراكات
const subs = detectSubscriptions([
  { id: 1, type: 'purchase', merchant: 'NETFLIX.COM', amount: 56.99, date: '2026-08-17T10:00:00Z', category: 'subscriptions' },
  { id: 2, type: 'purchase', merchant: 'NETFLIX.COM', amount: 56.99, date: '2026-09-17T10:00:00Z', category: 'subscriptions' },
  { id: 3, type: 'purchase', merchant: 'Netflix.com 123', amount: 56.99, date: '2026-10-17T10:00:00Z', category: 'subscriptions' },
  { id: 4, type: 'purchase', merchant: 'KUDU', amount: 30, date: '2026-10-01T10:00:00Z', category: 'restaurants' },
  { id: 5, type: 'purchase', merchant: 'KUDU', amount: 47, date: '2026-10-03T10:00:00Z', category: 'restaurants' },
], now);
try {
  assert.equal(subs.length, 1); assert.equal(subs[0].period, 'monthly'); pass++; console.log('✓ detectSubscriptions');
} catch (e) { console.log('✗ detectSubscriptions', e.message, JSON.stringify(subs)); }

const total = cases.length + 2;
console.log(`\n${pass}/${total} نجحت`);
if (pass !== total) process.exit(1);
