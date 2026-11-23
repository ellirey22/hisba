// تصنيفات حِسبة + قاموس التجار + منطق التصنيف الذكي والتعلّم

export const CATEGORIES = {
  restaurants: { name: 'مطاعم وكافيهات', icon: '🍔', color: '#ff9500' },
  delivery:    { name: 'تطبيقات توصيل',  icon: '🛵', color: '#ff5e3a' },
  groceries:   { name: 'بقالة وسوبرماركت', icon: '🛒', color: '#34c759' },
  transport:   { name: 'مواصلات ووقود',  icon: '⛽', color: '#007aff' },
  shopping:    { name: 'تسوق',           icon: '🛍️', color: '#af52de' },
  entertainment:{ name: 'ترفيه',         icon: '🎬', color: '#ff2d55' },
  subscriptions:{ name: 'اشتراكات',       icon: '🔁', color: '#5856d6' },
  health:      { name: 'صحة وصيدليات',   icon: '💊', color: '#30b0c7' },
  bills:       { name: 'فواتير واتصالات', icon: '🧾', color: '#a2845e' },
  travel:      { name: 'سفر وفنادق',      icon: '✈️', color: '#32ade6' },
  education:   { name: 'تعليم',           icon: '📚', color: '#e6a700' },
  government:  { name: 'حكومي ورسوم',     icon: '🏛️', color: '#8e8e93' },
  transfers:   { name: 'تحويلات',         icon: '💸', color: '#00b8ae' },
  cash:        { name: 'سحب نقدي',        icon: '🏧', color: '#6e7ca0' },
  other:       { name: 'أخرى',            icon: '📦', color: '#a1a1a6' },
};

// كلمات مفتاحية لتجار معروفين (حروف صغيرة، تطابق جزئي)
const MERCHANTS = {
  transfers: ['barq', 'برق', 'urpay', 'يورباي', 'stc pay', 'stcpay', 'd360', 'wise', 'western union', 'ويسترن يونيون', 'enjaz', 'إنجاز', 'tiqmo', 'friendipay'],
  delivery: ['hungerstation', 'هنقرستيشن', 'هنقر', 'jahez', 'جاهز', 'mrsool', 'مرسول', 'thechefz', 'chefz', 'ذا شفز',
    'toyou', 'تويو', 'keeta', 'كيتا', 'talabat', 'طلبات', 'ninja', 'نينجا', 'nana', 'نعناع', 'careem food', 'lugmety', 'لقمتي', 'shgardi', 'شقردي'],
  restaurants: ['mcdonald', 'ماكدونالدز', 'kfc', 'كنتاكي', 'albaik', 'al baik', 'البيك', 'kudu', 'كودو', 'herfy', 'هرفي',
    'burger', 'برجر', 'pizza', 'بيتزا', 'starbucks', 'ستاربكس', 'dunkin', 'دانكن', 'tim hortons', 'تيم هورتنز', 'barns', 'بارنز',
    'dr.cafe', 'dr cafe', 'د.كيف', 'half million', 'هاف مليون', 'caribou', 'كاريبو', 'costa', 'كوستا', 'shawarma', 'شاورما',
    'subway', 'صب واي', 'hardees', 'هارديز', 'popeyes', 'بوبايز', 'domino', 'دومينوز', 'papa john', 'شاورمر', 'shawarmer',
    'maestro', 'مايسترو', 'little caesars', 'texas chicken', 'شاورما هاوس', 'restaurant', 'مطعم', 'مطاعم', 'cafe', 'café', 'كافيه',
    'coffee', 'كوفي', 'قهوة', 'roast', 'bakery', 'مخبز', 'مخابز', 'grill', 'مشويات', 'كافتيريا', 'cafeteria', 'بوفية', 'kitchen',
    'مندي', 'mandi', 'steak', 'sushi', 'سوشي', 'donut', 'دونات', 'juice', 'عصير', 'عصائر', 'crepe', 'كريب', 'shake shack',
    'five guys', 'fuddruckers', 'applebee', 'chili', 'nandos', 'ناندوز', 'joe & the juice', 'brew', 'espresso', 'اسبريسو',
    'tea', 'شاي', 'كرك', 'karak', 'dessert', 'حلويات', 'sweets', 'baskin', 'باسكن', 'cinnabon', 'سينابون', 'krispy', 'كرسبي'],
  groceries: ['panda', 'بنده', 'هايبر بنده', 'tamimi', 'التميمي', 'danube', 'الدانوب', 'carrefour', 'كارفور', 'othaim', 'العثيم',
    'lulu', 'لولو', 'manuel', 'مانويل', 'farm', 'المزرعة', 'nesto', 'نستو', 'bindawood', 'بن داود', 'grand hyper', 'hyper',
    'هايبر', 'market', 'ماركت', 'سوبرماركت', 'supermarket', 'بقالة', 'بقاله', 'grocery', 'تموينات', 'minimarket', 'ميني ماركت',
    'خضار', 'vegetables', 'لحوم', 'meat', 'ملحمة', 'دواجن', 'tamr', 'تمور', 'dates', 'سبار', 'spar', 'aldrees market'],
  transport: ['uber', 'أوبر', 'اوبر', 'careem', 'كريم', 'bolt', 'بولت', 'jeeny', 'جيني', 'aldrees', 'الدريس', 'sasco', 'ساسكو',
    'petromin', 'بترومين', 'naft', 'نفط', 'محطة', 'محطات', 'station', 'fuel', 'وقود', 'بنزين', 'gas', 'petrol', 'aramco', 'أرامكو',
    'parking', 'مواقف', 'باركن', 'saptco', 'سابتكو', 'riyadh metro', 'مترو', 'darb', 'درب', 'car wash', 'مغسلة سيارات', 'غسيل',
    'tire', 'كفرات', 'زيوت', 'oil change', 'yelo', 'يلو', 'theeb', 'ذيب', 'budget', 'hertz', 'تأجير سيارات', 'ejar car', 'kayan'],
  shopping: ['amazon', 'أمازون', 'امازون', 'noon', 'نون', 'shein', 'شي ان', 'namshi', 'نمشي', 'ikea', 'ايكيا', 'jarir', 'جرير',
    'extra', 'اكسترا', 'saco', 'ساكو', 'centrepoint', 'سنتربوينت', 'max', 'ماكس', 'h&m', 'zara', 'زارا', 'nike', 'نايكي', 'adidas',
    'redtag', 'ريد تاغ', 'home centre', 'هوم سنتر', 'mall', 'مول', 'aliexpress', 'temu', 'تيمو', 'trendyol', 'ترينديول',
    'apple store', 'virgin megastore', 'فيرجن', 'abyat', 'أبيات', 'bath & body', 'sephora', 'سيفورا', 'faces', 'فيسز', 'niceone',
    'نايس ون', 'golden scent', 'قولدن سنت', 'perfume', 'عطور', 'العربية للعود', 'arabian oud', 'abdul samad', 'عبدالصمد',
    'blackbox', 'بلاك بوكس', 'store', 'متجر', 'shop', 'محل', 'boutique', 'أزياء', 'fashion', 'electronics', 'الكترونيات',
    'salla', 'سلة', 'zid', 'زد', 'tamara', 'تمارا', 'tabby', 'تابي'],
  entertainment: ['vox', 'ڤوكس', 'فوكس', 'muvi', 'موفي', 'amc', 'cinema', 'سينما', 'empire', 'boulevard', 'بوليفارد', 'riyadh season',
    'موسم الرياض', 'webook', 'ويبوك', 'playstation', 'بلايستيشن', 'xbox', 'steam', 'nintendo', 'pubg', 'ببجي', 'gaming', 'ألعاب',
    'sparky', 'سباركيز', 'bowling', 'بولينج', 'theme park', 'ملاهي', 'fun', 'ticket', 'تذاكر', 'snow city', 'winter wonderland',
    'gym', 'جيم', 'نادي', 'fitness', 'فتنس', 'leejam', 'لياقة', 'padel', 'بادل'],
  subscriptions: ['netflix', 'نتفلكس', 'نتفليكس', 'shahid', 'شاهد', 'spotify', 'سبوتيفاي', 'anghami', 'أنغامي', 'osn', 'starzplay',
    'ستارز', 'disney', 'ديزني', 'youtube', 'يوتيوب', 'apple.com/bill', 'apple.com', 'itunes', 'icloud', 'google storage',
    'google one', 'google *', 'chatgpt', 'openai', 'anthropic', 'claude', 'microsoft', 'office 365', 'adobe', 'canva', 'prime video',
    'amazon prime', 'tod', 'جوي', 'jawwy tv', 'stc tv', 'tv', 'patreon', 'linkedin', 'duolingo', 'notion', 'dropbox', 'zoom'],
  health: ['pharmacy', 'صيدلية', 'صيدليات', 'nahdi', 'النهدي', 'aldawaa', 'al dawaa', 'الدواء', 'whites', 'وايتس', 'hospital',
    'مستشفى', 'clinic', 'عيادة', 'عيادات', 'مجمع طبي', 'medical', 'طبي', 'dental', 'أسنان', 'اسنان', 'lab', 'مختبر', 'optic',
    'بصريات', 'سليمان الحبيب', 'habib', 'dallah', 'دله', 'mouwasat', 'المواسط', 'المواساة', 'care', 'كير', 'seha', 'صحة'],
  bills: ['stc', 'اس تي سي', 'mobily', 'موبايلي', 'zain', 'زين', 'virgin mobile', 'lebara', 'ليبارا', 'salam', 'سلام', 'redbull mobile',
    'sadad', 'سداد', 'كهرباء', 'electricity', 'sec', 'water', 'المياه', 'مياه', 'nwc', 'internet', 'انترنت', 'إنترنت', 'فاتورة',
    'bill', 'شحن رصيد', 'recharge', 'friendi', 'فرندي', 'ejar', 'إيجار', 'ايجار', 'rent'],
  travel: ['saudia', 'السعودية للطيران', 'الخطوط السعودية', 'flynas', 'ناس', 'flyadeal', 'أديل', 'airline', 'طيران', 'airways',
    'emirates', 'qatar airways', 'booking.com', 'بوكينج', 'agoda', 'أقودا', 'airbnb', 'expedia', 'almosafer', 'المسافر', 'flyin',
    'فلاي إن', 'tajawal', 'تجوال', 'hotel', 'فندق', 'فنادق', 'resort', 'منتجع', 'marriott', 'hilton', 'hyatt', 'شقق', 'gathern',
    'جاذر إن', 'sar train', 'قطار', 'haramain', 'الحرمين', 'airport', 'مطار', 'duty free'],
  education: ['school', 'مدرسة', 'مدارس', 'university', 'جامعة', 'academy', 'أكاديمية', 'اكاديمية', 'institute', 'معهد', 'udemy',
    'coursera', 'kindle', 'مكتبة', 'library', 'book', 'كتب', 'training', 'تدريب', 'تعليم', 'nursery', 'حضانة', 'روضة'],
  government: ['absher', 'أبشر', 'ابشر', 'moi', 'وزارة', 'ministry', 'gov', 'حكومي', 'رسوم', 'fees', 'مرور', 'traffic', 'jawazat',
    'الجوازات', 'balady', 'بلدي', 'najiz', 'ناجز', 'zakat', 'الزكاة', 'gosi', 'muqeem', 'مقيم', 'qiwa', 'قوى', 'mudad', 'مدد',
    'tamm', 'تم', 'saher', 'ساهر', 'مخالفة', 'efaa', 'إيفاء'],
};

// إشارات عامة بأوزان أقل (لما ما نلقى تاجر معروف)
const HINTS = [
  [/(restaurant|مطعم|cafe|café|كافي|coffee|كوفي|قهوة|bakery|مخبز|grill|food|burger|pizza)/i, 'restaurants'],
  [/(market|ماركت|بقال|تموين|hyper|هايبر|grocery)/i, 'groceries'],
  [/(pharm|صيدل|clinic|عياد|hospital|مستشف|medical|طبي)/i, 'health'],
  [/(petrol|fuel|station|محطة|وقود|parking|مواقف)/i, 'transport'],
  [/(hotel|فندق|air|طيران|travel|سفر)/i, 'travel'],
  [/(cinema|سينما|game|ألعاب|ticket|تذكر)/i, 'entertainment'],
];

// تطبيع اسم التاجر: يشيل الأرقام والفروع والمدن عشان التعلّم يشمل كل الفروع
const NOISE = /\b(llc|co|company|est|ltd|inc|branch|br|ksa|sa|saudi|arabia|riyadh|jeddah|jiddah|dammam|khobar|makkah|mecca|madinah|medina|mekkah|abha|taif|qassim|buraidah|tabuk|hail|jubail|ahsa|hofuf|yanbu|najran|jazan|kingdom|of|the|al)\b|شركة|مؤسسة|فرع|الرياض|جدة|جده|الدمام|الخبر|مكة|المدينة|المنورة|ابها|أبها|الطائف|القصيم|بريدة|تبوك|حائل|الجبيل|الأحساء|ينبع|نجران|جازان|المملكة|العربية|السعودية/gi;

export function normalizeMerchant(name = '') {
  return String(name)
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // تشكيل وتطويل
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة\b/g, 'ه')
    .replace(/[0-9#*_\-.,/\\|:;()[\]{}'"`~!@$%^&+=?<>]+/g, ' ')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function norm(s) {
  return s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة\b/g, 'ه');
}

const MERCHANT_INDEX = Object.entries(MERCHANTS).flatMap(([cat, words]) =>
  words.map((w) => ({ w: norm(w), cat })),
).sort((a, b) => b.w.length - a.w.length); // الأطول أولاً عشان "careem food" قبل "careem"

const isLetter = (c) => !!c && /[\p{L}\p{N}]/u.test(c);

function matchesWord(hay, w) {
  // الكلمات القصيرة لازم تكون كلمة مستقلة (عشان "تم" ما تطابق "تميمي")، والطويلة يكفي إنها بداية كلمة
  const strict = w.replace(/\s/g, '').length <= 4;
  let i = hay.indexOf(w);
  while (i >= 0) {
    const okBefore = !isLetter(hay[i - 1]) || !isLetter(w[0]);
    const okAfter = !strict || !isLetter(hay[i + w.length]) || !isLetter(w[w.length - 1]);
    if (okBefore && okAfter) return true;
    i = hay.indexOf(w, i + 1);
  }
  return false;
}

/**
 * يصنّف العملية. الأولوية: قاعدة تعلّمها التطبيق من المستخدم ← تاجر معروف ← إشارة عامة ← نوع العملية.
 * يرجع { category, source } حيث source = learned | known | hint | type | default
 */
export function categorize(tx, learnedRules = {}) {
  if (tx.type === 'transfer') return { category: 'transfers', source: 'type' };
  if (tx.type === 'withdrawal') return { category: 'cash', source: 'type' };

  const key = normalizeMerchant(tx.merchant);
  if (key && learnedRules[key]) return { category: learnedRules[key], source: 'learned' };

  // تطابق جزئي مع القواعد المتعلّمة (مثلاً "starbucks olaya" يطابق "starbucks")
  if (key) {
    for (const [ruleKey, cat] of Object.entries(learnedRules)) {
      if (ruleKey.length >= 4 && (key.startsWith(ruleKey + ' ') || key.includes(' ' + ruleKey))) {
        return { category: cat, source: 'learned' };
      }
    }
  }

  const hay = norm(` ${tx.merchant || ''} `);
  for (const { w, cat } of MERCHANT_INDEX) {
    if (matchesWord(hay, w)) return { category: cat, source: 'known' };
  }
  // البنوك تقصّ أسماء التجار أحياناً (HUNGERSTA بدل HUNGERSTATION): نطابق بداية الاسم
  const words = norm(tx.merchant || '').split(/[^a-z\u0600-\u06ff]+/).filter((x) => x.length >= 6);
  for (const word of words) {
    const hit = MERCHANT_INDEX.find(({ w }) => w.length > word.length && w.startsWith(word));
    if (hit) return { category: hit.cat, source: 'known' };
  }
  for (const [re, cat] of HINTS) {
    if (re.test(tx.merchant || '')) return { category: cat, source: 'hint' };
  }
  if (tx.type === 'bill') return { category: 'bills', source: 'type' };
  if (tx.channel === 'online' && /apple|google|itunes/i.test(tx.merchant || '')) {
    return { category: 'subscriptions', source: 'hint' };
  }
  return { category: 'other', source: 'default' };
}

export const KNOWN_SUBSCRIPTION = new RegExp(MERCHANTS.subscriptions
  .filter((w) => w.length > 3 && w !== 'microsoft').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
