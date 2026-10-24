'use strict';

/**
 * بناء نسخة GitHub Pages الكاملة (GitHub هو قاعدة البيانات).
 *
 * لماذا نسخة ثابتة؟
 *   GitHub Pages لا يشغّل خادمًا، لذا نبني هنا التطبيق كاملًا (هبوط + دخول + لوحة)
 *   بحيث تخزّن ملاحظات كل مستخدم في مستودعه الخاص عبر GitHub API:
 *     - الدخول برمز وصول شخصي (PAT) يُخزَّن في متصفح المستخدم فقط.
 *     - يُنشأ للمستخدم مستودع خاص mynotes-data تلقائيًا.
 *     - الملاحظات كلها في ملف notes.json واحد داخله.
 *
 * المخرجات: dist-pages/  ثم يرفعها GitHub Actions إلى Pages.
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const PAGES_APP = path.join(ROOT, 'pages-app');
const OUT = path.join(ROOT, 'dist-pages');

/** ملفات مشتركة (ثيم وأدوات واجهة) */
const COPY_SHARED = [
  ['public/css/base.css', 'css/base.css'],
  ['public/css/landing.css', 'css/landing.css'],
  ['public/css/auth.css', 'css/auth.css'],
  ['public/css/app.css', 'css/app.css'],
  ['public/js/ui.js', 'js/ui.js'],
  ['public/js/landing.js', 'js/landing.js'],
  ['public/favicon.svg', 'favicon.svg'],
];

/** ملفات نسخة Pages الخاصة (GitHub كقاعدة بيانات) */
const COPY_PAGES = [
  ['pages-app/js/github.js', 'js/github.js'],
  ['pages-app/js/login.js', 'js/login.js'],
  ['pages-app/js/app-github.js', 'js/app-github.js'],
  ['pages-app/login.html', 'login.html'],
  ['pages-app/app.html', 'app.html'],
];

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** تحويل المسارات المطلقة إلى نسبية حتى تعمل تحت مجلد المستودع على Pages */
function toRelative(html) {
  return html
    .replace(/(href|src)="\/(css|js|favicon|assets)\//g, '$1="./$2/')
    .replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"')
    .replace(/href="\/"/g, 'href="./"');
}

/**
 * تعديل صفحة الهبوط لتناسب نسخة Pages:
 *   - «تسجيل الدخول / ابدأ مجانًا» يقودان إلى صفحة الدخول المحلية برمز GitHub.
 *   - نصوص التسجيل بالبريد/كلمة المرور تُعاد صياغتها لتناسب نموذج الرمز.
 */
function adaptLanding(html) {
  let out = html;

  // 1) كل روابط الحساب → صفحة الدخول المحلية
  out = out.replace(/href="\/register"/g, 'href="./login.html"');
  out = out.replace(/href="\/login"/g, 'href="./login.html"');

  // 2) نصوص البطل
  out = out.replace(
    'خصوصية كاملة · تشفير لكل حساب',
    'خصوصية كاملة · ملاحظاتك في مستودعك الخاص'
  );
  out = out.replace(
    'انضم إلى منظّمي أفكارهم — حساب مجاني بالكامل، بدون بطاقة ائتمان.',
    'انضم إلى منظّمي أفكارهم — لا حاجة لحساب جديد: رمز GitHub واحد يكفي.'
  );

  // 3) شارة الهيرو: تسجيل بالبريد → دخول برمز GitHub
  out = out.replace(
    '<li><svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg> تسجيل بالبريد وكلمة المرور</li>',
    '<li><svg class="icon icon-sm" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg> دخول برمز GitHub شخصي</li>'
  );

  // 4) شريط التقنيات
  out = out.replace(
    '<span>تشفير Scrypt</span><span>جلسات آمنة HttpOnly</span><span>حماية CSRF</span>\n            <span>SQLite</span><span>Express</span><span>واجهة RTL</span>',
    '<span>GitHub API</span><span>مستودع خاص لكل مستخدم</span><span>سجل Git كامل</span>\n            <span>بدون خادم وسيط</span><span>حفظ تلقائي</span><span>واجهة RTL</span>'
  );

  // 5) قسم الخصوصية: صياغة تصف العزل عبر المستودعات
  out = out.replace(
    'صُمّمت المنصة بحيث تكون بيانات كل مستخدم معزولة تمامًا على مستوى قاعدة البيانات نفسها،\n            وليس مجرد إخفاء في الواجهة.',
    'صُمّمت المنصة بحيث تكون بيانات كل مستخدم في مستودع خاص به وحده على GitHub،\n            والرمز الذي يفتحه لا يملكه أحد غيرك — العزل يفرضه GitHub نفسه.'
  );
  out = out.replace(
    '<div><strong>عزل على مستوى الاستعلام</strong> — كل عملية قراءة أو تعديل أو حذف مقيّدة بمعرّف صاحب الجلسة.</div>',
    '<div><strong>مستودع خاص لكل مستخدم</strong> — ملاحظاتك في مستودعك أنت، ورمزك لا يصل إلى مستودعات الآخرين.</div>'
  );
  out = out.replace(
    '<div><strong>كلمات مرور مشفّرة</strong> — خوارزمية Scrypt مع ملح عشوائي، ولا تُخزَّن كلمة مرورك كنص أبدًا.</div>',
    '<div><strong>لا كلمات مرور</strong> — الدخول برمز وصول شخصي (PAT) من حسابك، تديره إعدادات GitHub أنت.</div>'
  );
  out = out.replace(
    '<div><strong>جلسات HttpOnly</strong> — الكوكي غير قابل للقراءة من الجافاسكريبت، مع رمز CSRF لكل طلب.</div>',
    '<div><strong>لا خادم وسيط</strong> — الصفحة تتحدّث مع GitHub مباشرة، ولا تمرر بياناتك بأي خادم ثالث.</div>'
  );
  out = out.replace(
    '<div><strong>حد لمحاولات الدخول</strong> — يُبطئ أي محاولة تخمين لكلمة المرور تلقائيًا.</div>',
    '<div><strong>سجل Git كامل</strong> — كل حفظة تعادل commit في مستودعك، فلك أرشيف زمني بكل تغيير.</div>'
  );
  out = out.replace(
    '<h3>عزل بيانات صارم</h3>\n                <p>مخطط قاعدة بيانات يربط كل ملاحظة بصاحبها إلزاميًا</p>',
    '<h3>عزل بيانات صارم</h3>\n                <p>ملف notes.json داخل مستودع خاص — لا يملك مفتاحه أحد سواك</p>'
  );
  out = out.replace(
    /<pre class="code-block"><code>[\s\S]*?<\/code><\/pre>/,
    `<pre class="code-block"><code><span class="s">mynotes-data/notes.json</span>
{
  <span class="k">"profile"</span>: { <span class="k">"name"</span>: "…" },
  <span class="k">"notes"</span>: [
    { <span class="k">"title"</span>: "…", <span class="k">"content"</span>: "…",
      <span class="k">"pinned"</span>: <span class="s">true</span> }
  ],
  <span class="k">"categories"</span>: [ … ]
}</code></pre>`
  );
  out = out.replace(
    '<span class="badge badge-brand">لا يوجد مسار API يتجاهل شرط الملكية</span>',
    '<span class="badge badge-brand">لا يملك أحد على مستودعك صلاحيات — إلا رمزك أنت</span>'
  );

  // 6) قسم «كيف يعمل»
  out = out.replace(
    '<h3>أنشئ حسابك</h3>\n            <p>اسمك وبريدك وكلمة مرور من 8 أحرف على الأقل — تستغرق أقل من دقيقة.</p>',
    '<h3>جهّز رمز GitHub</h3>\n            <p>أنشئ رمز وصول شخصي من إعدادات GitHub بصلاحية repo — دقيقة أو أقل.</p>'
  );
  out = out.replace(
    '<h3>سجّل دخولك</h3>\n            <p>ادخل ببريدك وكلمة مرورك من أي جهاز، وتظهر ملاحظاتك وحدها أمامك.</p>',
    '<h3>ألصق الرمز</h3>\n            <p>افتح صفحة الدخول وألصق رمزك — يُنشأ مستودع بياناتك تلقائيًا في أول مرة.</p>'
  );

  // 7) الأسئلة الشائعة
  out = out.replace(
    '<p>لا. كل استعلام في الخادم مقيّد بمعرّف حسابك، ولا يوجد أي مسار يتيح الوصول لملاحظات مستخدم آخر حتى لو عرف رقم الملاحظة.</p>',
    '<p>لا. ملاحظاتك داخل مستودع خاص على حسابك، وإمكانية الوصول إليه ممنوعة على الجميع — حتى مشرفو المنصة لا يملكون رمزك.</p>'
  );
  out = out.replace(
    '<summary>كيف تُحفظ كلمة المرور؟</summary>\n          <p>تُشفَّر بخوارزمية Scrypt مع ملح عشوائي لكل مستخدم، ولا تُخزَّن نصًا صريحًا في قاعدة البيانات إطلاقًا.</p>',
    '<summary>أين تُحفظ ملاحظاتي؟</summary>\n          <p>في مستودع خاص باسم mynotes-data على حساب GitHub الخاص بك، بملف notes.json واحد يُحدَّث مع كل عملية حفظ.</p>'
  );
  out = out.replace(
    '<p>نعم، إنشاء الحساب والمزايا الأساسية مجانية بالكامل دون بطاقة ائتمان.</p>',
    '<p>نعم، الاستضافة على GitHub Pages مجانية، وكل ما تحتاجه رمزًا مجانيًا من حساب GitHub الخاص بك.</p>'
  );

  // 8) التذييل
  out = out.replace(
    '<p>منصة ملاحظات شخصية عربية بواجهة RTL كاملة، تُدار بحساب مستقل لكل مستخدم.</p>',
    '<p>منصة ملاحظات شخصية عربية بواجهة RTL كاملة، تُخزَّن ملاحظات كل مستخدم في مستودعه الخاص على GitHub.</p>'
  );

  return out;
}

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
    <p>هذه الصفحة ليست موجودة.</p>
    <a href="./">العودة إلى الصفحة الرئيسية</a>
  </div>
</body>
</html>
`;

function main() {
  rmrf(OUT);
  ensureDir(OUT);

  // 1) نسخ الملفات المشتركة وملفات نسخة Pages
  for (const [src, dest] of [...COPY_SHARED, ...COPY_PAGES]) {
    const from = path.join(ROOT, src);
    const to = path.join(OUT, dest);
    ensureDir(path.dirname(to));
    fs.copyFileSync(from, to);
  }

  // 2) صفحة الهبوط — تُبنى من النسخة الخادمية مع إعادة صياغة الروابط والنصوص
  let landing = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  landing = adaptLanding(toRelative(landing));
  fs.writeFileSync(path.join(OUT, 'index.html'), landing, 'utf8');

  // 3) صفحات نسخة Pages تُنسخ كما هي (روابطها نسبية أصلًا)
  // (من COPY_PAGES أعلاه)

  // 4) ملفات مساعدة
  fs.writeFileSync(path.join(OUT, '404.html'), NOT_FOUND, 'utf8');
  fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');

  // 5) تحقق من عدم بقاء روابط مطلقة أو مسارات خادمية
  const problems = [];
  for (const name of ['index.html', 'login.html', 'app.html']) {
    const html = fs.readFileSync(path.join(OUT, name), 'utf8');
    const absolute = html.match(/(?:href|src)="\/(?!\/)/g);
    if (absolute) problems.push(`${name}: ${absolute.length} رابطًا مطلقًا`);
    if (/<form[^>]*action=/.test(html)) problems.push(`${name}: نموذج بعنوان action (مسار خادمي)`);
  }
  if (problems.length) {
    console.warn('⚠️  تنبيهات:');
    problems.forEach((p) => console.warn('   -', p));
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

  console.log('✅ تم بناء نسخة Pages الكاملة في dist-pages/');
  files.forEach((f) => console.log('   •', f));
}

main();
