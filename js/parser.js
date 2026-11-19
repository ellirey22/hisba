// محلّل رسائل البنوك: يستخرج المبلغ والتاجر والبطاقة والبنك ونوع العملية من نص الرسالة
// مصمّم بصيغ عامة تغطي البنوك السعودية الشائعة (عربي وإنجليزي)، ويتعرّف على البنك تلقائياً.

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function normalizeText(t = '') {
  return String(t)
    .replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d))
    .replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',')
    .replace(/ |‏|‎|‪|‫|‬|؜/g, ' ')
    .replace(/：/g, ':')
    .replace(/\r/g, '');
}

// ---------- البنك ----------
const BANKS = [
  ['الراجحي', /al\s*-?\s*rajhi|alrajhi|الراجحي|rajhi/i],
  ['البنك الأهلي', /\bsnb\b|alahli|al\s*ahli|الأهلي|الاهلي|ncb/i],
  ['بنك STC', /stc\s*bank|stc\s*pay|stcpay|بنك\s*stc|اس\s*تي\s*سي\s*باي/i],
  ['الإنماء', /alinma|الإنماء|الانماء|inma/i],
  ['بنك الرياض', /riyad\s*bank|riyadbank|بنك\s*الرياض/i],
  ['ساب', /\bsab\b|sabb|^ساب(?=\s|$)|البنك\s*الأول/i],
  ['البنك العربي', /\banb\b|arab\s*national|العربي\s*الوطني|البنك\s*العربي/i],
  ['بنك البلاد', /albilad|bank\s*albilad|البلاد/i],
  ['بنك الجزيرة', /aljazira|bank\s*aljazira|الجزيرة/i],
  ['السعودي الفرنسي', /\bbsf\b|fransi|الفرنسي/i],
  ['السعودي للاستثمار', /\bsaib\b|للاستثمار/i],
  ['D360', /\bd360\b/i],
  ['urpay', /urpay|يور\s*باي/i],
  ['بنك ميم', /\bmeem\b|ميم/i],
  ['بنك الإمارات دبي', /emirates\s*nbd|الإمارات\s*دبي/i],
  ['تابي', /\btabby\b|تابي/i],
  ['تمارا', /\btamara\b|تمارا/i],
  ['برق', /\bbarq\b|برق/i],
];

export function detectBank(text, sender = '') {
  for (const [name, re] of BANKS) if (re.test(sender)) return name;
  // نبحث في النص بس في أول وآخر سطر عشان ما نخلط اسم البنك مع اسم تاجر
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const edges = [lines[0], lines[lines.length - 1]].join(' ');
  for (const [name, re] of BANKS) if (re.test(edges)) return name;
  const s = sender.trim();
  if (s && !/^\+?\d{6,}$/.test(s)) return s; // اسم المرسل نفسه (مثل "AlRajhiBank")
  return 'غير معروف';
}

// ---------- نوع العملية ----------
const IGNORE = /(رمز\s*(التحقق|التفعيل|الدخول|سري)|كلمة\s*المرور|\botp\b|verification\s*code|one[-\s]?time|مرفوض|رفض|declined|rejected|insufficient|غير\s*كاف|محاولة|attempt|تسجيل\s*دخول|login|تنبيه\s*أمني|لا\s*تشارك|do\s*not\s*share)/i;
const INCOME = /(استرداد|استرجاع|مسترد|refund|reversal|reversed|عكس|إيداع|ايداع|deposit|راتب|salary|payroll|credited|\bcredit\b(?!\s*card)|حوالة\s*(واردة|داخلية\s*واردة)|incoming|received|واردة|استلام|cashback|كاش\s*باك)/i;
const TRANSFER = /(حوالة|حواله|تحويل|transfer|sent\s*to|outgoing|صادرة|سداد\s*بطاقة)/i;
const WITHDRAW = /(سحب|withdraw|atm|صراف)/i;
const BILL = /(سداد|sadad|فاتورة|bill\s*payment|مدفوعات\s*حكومية|government)/i;
const PURCHASE = /(شراء|purchase|\bpos\b|نقاط\s*البيع|مشتريات|خصم|debit|debited|دفع|paid|payment|pay|apple\s*pay|ابل\s*باي|mada\s*pay|online|انترنت|إنترنت|spent|charged)/i;

// تحويل بين حساباتك أو تعبئة بطاقتك (مثل بطاقة المسافر): مو صرف، ينستبعد من الإحصائيات تلقائياً
const OWN_TRANSFER = /(بين\s*حساباتك|بين\s*حساباتي|own\s*accounts?|إلى\s*بطاقة|الى\s*بطاقة|to\s*(?:your\s*)?card|تعبئة\s*(?:رصيد\s*)?بطاقة|شحن\s*بطاقة|card\s*top[-\s]?up)/i;

function detectType(t) {
  if (IGNORE.test(t)) return null;
  if (OWN_TRANSFER.test(t)) return 'internal';
  if (/(استرداد|refund|reversal|cashback)/i.test(t)) return 'income';
  // "شراء" لها الأولوية على "واردة" وغيرها
  if (/(شراء|purchase|\bpos\b|نقاط\s*البيع)/i.test(t)) return 'purchase';
  if (WITHDRAW.test(t) && !/سحب\s*من\s*(حساب|رصيد)/.test(t)) return 'withdrawal';
  if (INCOME.test(t)) return 'income';
  if (BILL.test(t)) return 'bill';
  if (TRANSFER.test(t)) return 'transfer';
  if (PURCHASE.test(t)) return 'purchase';
  return 'unknown';
}

function detectChannel(t) {
  if (/(apple\s*pay|ابل\s*باي|أبل\s*باي|mada\s*pay|stc\s*pay|google\s*pay|samsung\s*pay|wallet)/i.test(t)) return 'wallet';
  if (/(انترنت|إنترنت|internet|online|e-?commerce|اونلاين|أونلاين)/i.test(t)) return 'online';
  if (/(نقاط\s*البيع|\bpos\b|مدى|mada)/i.test(t)) return 'pos';
  return '';
}

// ---------- المبلغ ----------
const CUR = '(?:SAR|SR|S\\.R|ريال(?:\\s*سعودي)?|ر\\.?\\s?س\\.?|USD|\\$|US\\$|دولار|EUR|€|يورو|GBP|£|AED|درهم|KWD|BHD|QAR|EGP|جنيه|TRY|ليرة)';
const NUM = '(\\d{1,3}(?:,\\d{3})+(?:\\.\\d{1,3})?|\\d+(?:\\.\\d{1,3})?)';
const BALANCE_LABEL = '(?:الرصيد\\s*(?:المتاح|المتبقي|الحالي)?|رصيدك|رصيد|balance|bal\\.?|avail(?:able)?(?:\\s*(?:balance|limit|bal))?|المتاح|الحد\\s*المتاح|limit|المتبقي)';

function toNumber(s) {
  return parseFloat(String(s).replace(/,/g, ''));
}

function currencyCode(c = '') {
  c = c.trim().toLowerCase();
  if (!c || /sar|sr|s\.r|ريال|ر\.?\s?س/.test(c)) return 'SAR';
  if (/usd|\$|دولار/.test(c)) return 'USD';
  if (/eur|€|يورو/.test(c)) return 'EUR';
  if (/gbp|£/.test(c)) return 'GBP';
  if (/aed|درهم/.test(c)) return 'AED';
  if (/egp|جنيه/.test(c)) return 'EGP';
  if (/try|ليرة/.test(c)) return 'TRY';
  return c.toUpperCase();
}

function stripBalances(t) {
  return t
    .replace(new RegExp(`${BALANCE_LABEL}\\s*[:\\-]?\\s*${CUR}?\\s*${NUM}\\s*${CUR}?`, 'gi'), ' ')
    .replace(new RegExp(`(?:رسوم|fees?|vat|ضريبة)\\s*[:\\-]?\\s*${CUR}?\\s*${NUM}\\s*${CUR}?`, 'gi'), ' ');
}

export function extractAmount(t) {
  const s = stripBalances(t);
  const pats = [
    // "مبلغ: SAR 45.50" / "Amount: 45.50 SAR" / "بمبلغ 50 ريال" / "بـ 25 SAR"
    new RegExp(`(?:المبلغ|مبلغ|بمبلغ|amount|amt|قيمة|بقيمة|value|بـ|ب)\\s*[:\\-]?\\s*(${CUR})\\s*${NUM}`, 'i'),
    new RegExp(`(?:المبلغ|مبلغ|بمبلغ|amount|amt|قيمة|بقيمة|value)\\s*[:\\-]?\\s*${NUM}\\s*(${CUR})?`, 'i'),
    new RegExp(`(?:^|\\s)(?:بـ|ب)\\s*${NUM}\\s*(${CUR})`, 'i'),
    // "SAR 45.50" أو "45.50 ريال"
    new RegExp(`(${CUR})\\s*${NUM}`, 'i'),
    new RegExp(`${NUM}\\s*(${CUR})`, 'i'),
  ];
  for (let i = 0; i < pats.length; i++) {
    const m = s.match(pats[i]);
    if (!m) continue;
    let amount, cur;
    if (i === 0 || i === 3) { cur = m[1]; amount = m[2]; } else { amount = m[1]; cur = m[2]; }
    const n = toNumber(amount);
    // نتجاهل أرقام البطاقات/السنين اللي تطلع بالغلط مع "ب"
    if (!isFinite(n) || n <= 0) continue;
    if (i === 1 && !cur && (/^\d{4}$/.test(amount) && n > 1900 && n < 2100)) continue;
    return { amount: n, currency: currencyCode(cur) };
  }
  return null;
}

// ---------- البطاقة ----------
export function extractCard(t) {
  const pats = [
    /(?:بطاقة|البطاقة|card|كارت|مدى|mada|visa|فيزا|master\s*card|ماستر\s*كارد|ائتمانية|credit|debit|ending(?:\s*with)?|المنتهية\s*ب|تنتهي\s*ب|رقم)[^\d\n]{0,15}?[*xX•.]*\s*(\d{4})\b(?!\s*[-/]\d)/i,
    /عبر\s*[:\-]?\s*[*xX•]*\s*(\d{4})\b/,
    /[*xX•]{1,}\s*(\d{4})\b(?!\s*[-/.]\d)/,
    /\b(\d{4})\s*[*xX•]{2,}/,
    /(?:حساب|account|acc|a\/c|من)[^\d\n]{0,10}?[*xX•]*\s*(\d{4})\b(?!\s*[-/]\d)/i,
  ];
  for (const re of pats) {
    const m = t.match(re);
    if (m) return m[1];
  }
  return '';
}

// ---------- التاجر ----------
const STOP = '(?=\\s+(?:في|on|at\\s+\\d|بتاريخ|تاريخ|date|الساعة|time|بمبلغ|مبلغ|amount|رصيد|balance|من\\s+(?:بطاقة|حساب)|via|عبر|using|بواسطة|بطاقة|card)(?=[\\s:،,.]|$)|\\s*[,،;|]|\\s+\\d{1,4}[-/]\\d{1,2}[-/]\\d{1,4}|\\s+\\d{1,2}:\\d{2}|\\n|$)';
const MERCHANT_LABELS = [
  `(?:لـ|ل(?=[A-Za-z]))`,
  // الأقوى أولاً
  `(?:لدى|لـدى|عند|التاجر|المتجر|اسم\\s*التاجر|المفوتر|الجهة|biller|merchant|merchant\\s*name|at|@)`,
  `(?:من\\s*عند|إلى|الى|to|for|لصالح|المستفيد|beneficiary|payee)`,
  `(?:من|from)`,
];

function cleanMerchant(m) {
  return m
    .replace(/^[\s:：\-–—.]+/, '')
    .replace(/[\s.:,،;\-–—]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function looksLikeMerchant(m) {
  if (!m || m.length < 2) return false;
  if (/^[\d\s*xX•.,:/\-]+$/.test(m)) return false; // أرقام بس
  if (/^(بطاقة|البطاقة|حساب|الحساب|card|account|مدى|mada|visa|فيزا|ائتمانية|رصيد|SAR|ريال|خلال|apple\s*pay|ابل\s*باي)(?=[\s:،,.]|$)/i.test(m)) return false;
  if (new RegExp(`^${CUR}\\s*\\d`, 'i').test(m)) return false;
  return true;
}

export function extractMerchant(t) {
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const label of MERCHANT_LABELS) {
    // 1) صيغة السطور: "لدى: HUNGERSTATION"
    const lineRe = new RegExp(`^${label}\\s*[:\\-]\\s*(.+)$`, 'i');
    for (const line of lines) {
      const m = line.match(lineRe);
      if (m) {
        const v = cleanMerchant(m[1].replace(new RegExp(STOP.replace('(?=', '(?:') + '[\\s\\S]*$'), ''));
        if (looksLikeMerchant(v)) return v;
      }
    }
    // 2) داخل الجملة: "... لدى ALDREES في 2024-..."
    const inlineRe = new RegExp(`(?:^|[\\s:،,])${label}\\s*[:\\-]?\\s*(.+?)${STOP}`, 'gim');
    let m;
    while ((m = inlineRe.exec(t))) {
      const v = cleanMerchant(m[1]);
      if (looksLikeMerchant(v) && v.length <= 60) return v;
    }
  }
  // 3) بعض البنوك تحط اسم التاجر بسطر لحاله بدون عنوان: نختار سطر لاتيني بدون أرقام كثيرة
  const candidates = lines.slice(1).filter((l) =>
    !/[:：]/.test(l) && /[A-Za-z]{3,}/.test(l) && !/\d{2}[:/-]\d{2}/.test(l)
    && !new RegExp(`${CUR}|\\d+\\.\\d{2}`, 'i').test(l)
    && !/(apple\s*pay|mada|visa|card|purchase|pos|balance|bank|stc\s*pay)/i.test(l));
  if (candidates.length) return cleanMerchant(candidates[0]);
  return '';
}

// ---------- التاريخ ----------
export function extractDate(t, now = new Date()) {
  let time = t.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm|ص|م)?/i);
  let hh = 12, mm = 0;
  if (time) {
    hh = +time[1]; mm = +time[2];
    const ap = (time[3] || '').toLowerCase();
    if ((ap === 'pm' || ap === 'م') && hh < 12) hh += 12;
    if ((ap === 'am' || ap === 'ص') && hh === 12) hh = 0;
  }
  const candidates = [];
  let m = t.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  if (m) candidates.push([+m[1], +m[2], +m[3]]);
  m = !candidates.length && t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/);
  if (m) candidates.push([+m[3], +m[2], +m[1]]);
  m = !candidates.length && t.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/);
  if (m) {
    // غامض: dd/mm/yy أو yy/mm/dd — نجرّب الاحتمالين ونختار الأقرب لليوم (وما يكون بالمستقبل)
    candidates.push([2000 + +m[3], +m[2], +m[1]]);
    candidates.push([2000 + +m[1], +m[2], +m[3]]);
  }
  const valid = candidates
    .map(([y, mo, d]) => new Date(y, mo - 1, d, hh, mm))
    .filter((d) => !isNaN(d) && d.getMonth() >= 0 && d <= new Date(now.getTime() + 864e5))
    .sort((a, b) => Math.abs(now - a) - Math.abs(now - b));
  return valid[0] || null;
}

// ---------- الدالة الرئيسية ----------
/**
 * @param {string} raw نص الرسالة
 * @param {{sender?: string, receivedAt?: Date}} opts
 * @returns {object|null} العملية، أو null لو الرسالة مو عملية مالية (رمز تحقق، عملية مرفوضة، ...)
 */
export function parseSMS(raw, opts = {}) {
  const text = normalizeText(raw).trim();
  if (!text) return null;
  const now = opts.receivedAt || new Date();
  const type = detectType(text);
  if (!type) return null;
  const amt = extractAmount(text);
  if (!amt) return null;

  const date = extractDate(text, now);
  // لو التاريخ المستخرج بعيد جداً عن وقت الاستلام والرسالة جاية من الاختصار، نعتمد وقت الاستلام
  const useDate = date && (!opts.receivedAt || Math.abs(now - date) < 3 * 864e5) ? date : now;

  if (type === 'internal') {
    const to = text.match(/(?:إلى|الى|to)\s*[:\-]?\s*(بطاقة[^:\n]*|[^\n:]*card[^:\n]*)?[:\s]*[*xX•]*\s*(\d{4})/i);
    return {
      type: 'transfer', internal: true, excluded: true, amount: amt.amount, currency: amt.currency,
      merchant: to ? `تحويل لـ${(to[1] || 'حسابك').trim()} •${to[2]}` : 'تحويل بين حساباتك',
      card: extractCard(text), bank: detectBank(text, opts.sender || ''), channel: '',
      date: useDate.toISOString(), raw: String(raw).trim(), confidence: 'high',
    };
  }
  return {
    type: type === 'unknown' ? 'purchase' : type,
    amount: amt.amount,
    currency: amt.currency,
    merchant: extractMerchant(text) || (type === 'withdrawal' ? 'صراف آلي' : ''),
    card: extractCard(text),
    bank: detectBank(text, opts.sender || ''),
    channel: detectChannel(text),
    date: useDate.toISOString(),
    raw: String(raw).trim(),
    confidence: type === 'unknown' ? 'low' : 'high',
  };
}

// يقسم ملف فيه رسائل كثيرة (من اختصار "إلحاق بملف") إلى رسائل منفصلة مع وقت الاستلام
export function splitBatch(content) {
  const text = normalizeText(content);
  const parts = text.split(/^\s*(?:####|====+|-----+)\s*(.*)$/m);
  const out = [];
  if (parts.length === 1) {
    // ما فيه فواصل: نفصل على الأسطر الفاضية المزدوجة
    return text.split(/\n\s*\n\s*\n|\n\s*\n(?=\S)/).map((s) => ({ text: s.trim() })).filter((x) => x.text);
  }
  if (parts[0].trim()) out.push({ text: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const header = (parts[i] || '').trim();
    const body = (parts[i + 1] || '').trim();
    if (!body) continue;
    const [stamp, sender] = header.split('|').map((s) => s && s.trim());
    const d = stamp ? new Date(stamp) : null;
    out.push({ text: body, receivedAt: d && !isNaN(d) ? d : undefined, sender: sender || '' });
  }
  return out;
}
