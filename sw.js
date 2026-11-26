// يخلي التطبيق يشتغل بدون إنترنت. غيّر رقم النسخة لما تعدّل الملفات.
const CACHE = 'hisba-v48';
const ASSETS = ['./', 'index.html', 'styles.css', 'manifest.webmanifest', 'js/app.js', 'js/store.js', 'js/parser.js',
  'js/categories.js', 'js/insights.js', 'js/charts.js', 'js/budget.js', 'js/icons.js', 'js/rates.js', 'fonts/noto-arabic.woff2', 'fonts/noto-latin.woff2', 'icons/icon-512.png', 'icons/icon.svg', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// الشبكة أولاً (عشان التحديثات توصل)، والكاش لو ما فيه نت
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((r) => {
      const copy = r.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
