'use strict';

/**
 * ملاحظاتي — خادم التطبيق
 * تشغيل:  npm start        (أو npm run dev للمتابعة التلقائية)
 */

const path = require('node:path');
const express = require('express');
const api = require('./src/api');
const store = require('./src/db');
const { loadSession } = require('./src/middleware');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SITE_NAME = process.env.SITE_NAME || 'ملاحظاتي';
const PUBLIC_DIR = path.join(__dirname, 'public');
const IS_PROD = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.disable('x-powered-by');

/* ------------------------------------------------------------- الأمان */

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (IS_PROD) {
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(loadSession);

/* ------------------------------------------------------ المسارات (Pages) */

/** إرسال صفحة من مجلد public (يُمرَّر root صراحة لتفادي مشاكل المسارات المطلقة) */
const sendPage = (file) => (req, res) => res.sendFile(file, { root: PUBLIC_DIR });

app.get('/', (req, res) => {
  if (req.user) return res.redirect('/app');
  return sendPage('index.html')(req, res);
});

app.get(['/login', '/signin'], (req, res) => {
  if (req.user) return res.redirect('/app');
  return sendPage('login.html')(req, res);
});

app.get(['/register', '/signup'], (req, res) => {
  if (req.user) return res.redirect('/app');
  return sendPage('register.html')(req, res);
});

app.get('/app', (req, res) => {
  if (!req.user) return res.redirect('/login');
  return sendPage('app.html')(req, res);
});

// صفحات ثابتة (الواجهة)
app.use(
  express.static(PUBLIC_DIR, {
    index: false,
    etag: true,
    maxAge: IS_PROD ? '1h' : 0,
    setHeaders(res, filePath) {
      if (/\.(html)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// الـ API
app.use('/api', api);

/* ------------------------------------------------------------ الأخطاء */

app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'المسار غير موجود' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ ok: false, error: 'حجم البيانات كبير جدًا' });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ ok: false, error: 'صيغة الطلب غير صالحة' });
  }
  console.error('[error]', req.method, req.url, err);
  return res.status(500).json({ ok: false, error: 'حدث خطأ غير متوقع في الخادم' });
});

app.use((req, res) => {
  res.status(404).type('html').send(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
     <title>404 — ${SITE_NAME}</title>
     <style>body{font-family:system-ui,'Segoe UI',Tahoma,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f8fafc;color:#0f172a}
     .box{text-align:center}a{color:#4f46e5;text-decoration:none;font-weight:700}</style></head>
     <body><div class="box"><h1>404</h1><p>الصفحة غير موجودة</p><a href="/">العودة للرئيسية</a></div></body></html>`
  );
});

/* -------------------------------------------------------------- التشغيل */

// تنظيف الجلسات المنتهية كل ساعة
setInterval(() => {
  try {
    store.purgeExpiredSessions();
  } catch (e) {
    console.error('[cleanup]', e);
  }
}, 3600000).unref();

// احتفظ بسلّة المهملات 30 يومًا ثم احذفها نهائيًا
setInterval(() => {
  try {
    for (const user of store.db.prepare('SELECT DISTINCT user_id FROM notes WHERE deleted_at IS NOT NULL').all()) {
      store.purgeTrashOlderThan(user.user_id, 30);
    }
  } catch (e) {
    console.error('[cleanup trash]', e);
  }
}, 6 * 3600000).unref();

app.listen(PORT, () => {
  console.log(`✅ ${SITE_NAME} يعمل على http://localhost:${PORT}`);
  console.log(`   قاعدة البيانات: ${process.env.DB_PATH || path.join(__dirname, 'data', 'mynotes.db')}`);
  console.log(`   الوضع: ${IS_PROD ? 'إنتاج' : 'تطوير'}`);
});
