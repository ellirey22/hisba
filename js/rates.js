// أسعار العملات تلقائية: جدول احتياطي مدمج (الريال مربوط بالدولار)، وتحديث صامت مرة باليوم لو فيه إنترنت.
// الطلب ما يرسل أي بيانات عنك — بس يجيب أسعار عامة.
export const DEFAULT_RATES = {
  SAR: 1, USD: 3.75, EUR: 4.35, GBP: 5.05, AED: 1.021, KWD: 12.2, BHD: 9.95, QAR: 1.03, OMR: 9.74, JOD: 5.29,
  EGP: 0.077, TRY: 0.09, INR: 0.044, PKR: 0.0134, CAD: 2.72, AUD: 2.45, CHF: 4.65, JPY: 0.025, CNY: 0.52, MYR: 0.85, SGD: 2.9,
};
const URL_ = 'https://open.er-api.com/v6/latest/USD';
const DAY = 864e5;

export async function refreshRates(getState, update) {
  const st = getState().settings;
  if (st.ratesUpdated && Date.now() - st.ratesUpdated < DAY) return;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(URL_, { signal: ctl.signal, cache: 'no-store' }); clearTimeout(t);
    if (!res.ok) return;
    const j = await res.json(); const r = j.rates; if (!r || !(r.SAR > 0)) return;
    const next = { ...st.rates };
    for (const c of Object.keys(DEFAULT_RATES)) if (r[c] > 0) next[c] = r.SAR / r[c];
    next.SAR = 1;
    update({ rates: next, ratesUpdated: Date.now() });
  } catch { /* بدون إنترنت: نكمّل بالأسعار المحفوظة */ }
}
