'use strict';

/**
 * بناء نسخة ثابتة للواجهة التسويقية تصلح لـ GitHub Pages.
 *
 * لماذا نسخة ثابتة؟
 *   GitHub Pages لا يشغّل خادمًا ولا قاعدة بيانات، لذلك لا يمكنه استضافة التطبيق
 *   كاملاً. ننشر على Pages «صفحة الهبوط» (التعريف بالمنتج والمميزات) ونوجّه
 *   أزرار «تسجيل الدخول / إنشاء حساب» إلى عنوان التطبيق الحيّ المنشور على Render.
 *
 * المخرجات: dist-pages/  ثم يرفعها GitHub Actions إلى Pages.
 *
 * المتغيّرات:
 *   APP_URL — عنوان التطبيق الحيّ (افتراضيًا رابط Render الشائع)
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist-pages');

const APP_URL = (process.env.APP_URL || 'https://my-notes.onrender.com').replace(/\/+$/, '');

/** الملفات التي تُنسخ كما هي (الثيم والخطوط البصرية) */
const COPY = [
  ['css/base.css', 'css/base.css'],
  ['css/landing.css', 'css/landing.css'],
  ['js/ui.js', 'js/ui.js'],
  ['js/landing.js', 'js/landing.js'],
  ['favicon.svg', 'favicon.svg'],
];

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** تحويل المسارات المطلقة إلى نسبية حتى تعمل الصفحة تحت مجلد المستودع على Pages */
function toRelative(html) {
  return html
    .replace(/(href|src)="\/(css|js|favicon|assets)\//g, '$1="./$2/')
    .replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"')
    // روابط جذر الموقع (الشعار) تشير إلى مجلد المشروع لا جذر النطاق
    .replace(/href="\/"/g, 'href="./"');
}

/** توجيه روابط الحساب إلى التطبيق الحيّ */
function linkToApp(html) {
  return html
    .replace(/href="\/register"/g, `href="${APP_URL}/register"`)
    .replace(/href="\/login"/g, `href="${APP_URL}/login"`)
    .replace(/href="#(features|security|how|faq)"/g, 'href="#$1"');
}

/** إضافة تنبيه صغير يوضّح أن الأزرار تنقل إلى التطبيق الحيّ */
function annotate(html) {
  const banner = `    <p class="deploy-note">هذه صفحة تعريفية. التطبيق الحيّ يعمل على <a href="${APP_URL}">${APP_URL.replace(/^https?:\/\//, '')}</a></p>\n`;
  return html.replace(/(\s*<\/header>\s*<main>)/, `\n${banner}$1`);
}

const NOTE_CSS = `
/* تنبيه النشر — يظهر في نسخة GitHub Pages فقط */
.deploy-note {
  margin: 18px auto 0;
  padding: 10px 16px;
  max-width: min(1180px, 100% - 44px);
  font-size: 13.5px;
  font-weight: 600;
  text-align: center;
  color: var(--text-muted);
  background: var(--brand-50);
  border: 1px solid var(--brand-200);
  border-radius: var(--radius);
}
html[data-theme="dark"] .deploy-note {
  background: var(--brand-100);
  border-color: var(--brand-800);
  color: var(--brand-200);
}
.deploy-note a { color: var(--brand-600); font-weight: 700; }
html[data-theme="dark"] .deploy-note a { color: var(--brand-300); }
.deploy-note a:hover { text-decoration: underline; }
`;

const NOT_FOUND = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>404 — ملاحظاتي</title>
  <link rel="icon" href="./favicon.svg" type="image/svg+xml">
  <style>
    body{font-family:"Segoe UI",Tahoma,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#f7f8fb;color:#0f172a}
    .\boxed{text-align:center;padding:24px}
    h1{font-size:64px;margin:0;background:linear-gradient(100deg,#6366f1,#a855f7);-webkit-background-clip:text;background-clip:text;color:transparent}
    p{color:#5b6478;margin:8px 0 24px}
    a{display:inline-block;padding:12px 24px;border-radius:12px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700}
    a:hover{background:#4338ca}
  </style>
</head>
<body>
  <div class="box">
    <h1>404</h1>
    <p>هذه الصفحة ليست متاحة في النسخة التعريفية.</p>
    <a href="./">العودة إلى الصفحة الرئيسية</a>
  </div>
</body>
</html>
`;

function main() {
  rmrf(OUT);
  ensureDir(OUT);

  // 1) ملفات الأصول
  for (const [src, dest] of COPY) {
    const from = path.join(PUBLIC, src);
    const to = path.join(OUT, dest);
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
  }

  // 2) صفحة الهبوط — مُعاد كتابة روابطها لتناسب Pages
  let landing = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  landing = linkToApp(toRelative(landing));
  landing = annotate(landing);
  landing = landing.replace(
    '</head>',
    `  <style>${NOTE_CSS}</style>\n</head>`
  );
  fs.writeFileSync(path.join(OUT, 'index.html'), landing, 'utf8');

  // 3) ملفات مساعدة
  fs.writeFileSync(path.join(OUT, '404.html'), NOT_FOUND, 'utf8');
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');

  // 4) تنبيه بسيط: تحقق من عدم بقاء روابط مطلقة تشير إلى مسارات الخادم
  const leftovers = landing.match(/(?:href|src)="\/(?!\/)/g);  if (leftovers) {
    console.warn(`⚠️  تنبيه: وُجدت ${leftovers.length} رابطًا مطلقًا في index.html قد لا تعمل على Pages.`);
  }

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(OUT, full));
    }
  };
  walk(OUT);

  console.log(`✅ تم بناء نسخة Pages في dist-pages/  (APP_URL = ${APP_URL})`);
  files.forEach((f) => console.log('   •', f));
}

main();
