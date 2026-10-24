'use strict';
/* تحقق سريع من مخرجات بناء Pages (يُحذف بعد الاستخدام) */
const fs = require('node:fs');
const path = require('node:path');
const OUT = path.join(__dirname, '..', 'dist-pages');

const read = (f) => fs.readFileSync(path.join(OUT, f), 'utf8');
const checks = [];
const t = (name, ok) => checks.push([name, ok]);

const index = read('index.html');
t('index: لا روابط Render', !index.includes('onrender'));
t('index: لا مسارات مطلقة', !/(?:href|src)="\/(?!\/)/.test(index));
t('index: نص دخول برمز GitHub', index.includes('دخول برمز GitHub شخصي'));
t('index: قسم mynotes-data', index.includes('mynotes-data/notes.json'));
t('index: لا Scrypt', !index.includes('Scrypt'));
t('index: لا HttpOnly', !index.includes('HttpOnly'));
t('index: خطوات الرمز', index.includes('جهّز رمز GitHub'));
t('index: سؤال التخزين', index.includes('أين تُحفظ ملاحظاتي؟'));

const login = read('login.html');
t('login: لا مسارات مطلقة', !/(?:href|src)="\/(?!\/)/.test(login));
t('login: يحمّل github.js', login.includes('./js/github.js'));
t('login: يحمّل login.js', login.includes('./js/login.js'));

const app = read('app.html');
t('app: لا مسارات مطلقة', !/(?:href|src)="\/(?!\/)/.test(app));
t('app: يحمّل app-github.js', app.includes('./js/app-github.js'));
t('app: لا setNewPw', !app.includes('setNewPw'));
t('app: قسم ghRepoLink', app.includes('ghRepoLink'));
t('app: زر تصدير JSON', app.includes('exportJsonBtn'));
t('app: لا /api/export', !app.includes('/api/export'));

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) failed++;
}
console.log(failed ? `\n${failed} فحص فاشل` : '\nكل الفحوصات ناجحة');
process.exit(failed ? 1 : 0);
