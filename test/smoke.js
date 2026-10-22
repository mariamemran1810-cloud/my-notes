/* اختبار شامل للـ API
   التشغيل:  احذف data/ ثم npm start ثم node test/smoke.js
*/
const BASE = process.env.BASE || 'http://127.0.0.1:3999';

let passed = 0;
let failed = 0;

const check = (name, cond, extra = '') => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${extra}`);
  }
};

/** عميل HTTP مستقل يحتفظ بكوكي ورمز CSRF الخاصين به */
function makeClient() {
  let cookie = null;
  let csrf = null;

  const client = async (path, opts = {}) => {
    const method = opts.method || 'GET';
    const headers = { Accept: 'application/json' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET' && csrf) headers['X-CSRF-Token'] = csrf;

    const res = await fetch(BASE + path, {
      method,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      redirect: 'manual',
    });

    const setC = res.headers.get('set-cookie');
    if (setC) cookie = setC.split(';')[0];

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* صفحة HTML */
    }
    if (json && json.csrfToken) csrf = json.csrfToken;

    return { status: res.status, json, text, headers: res.headers };
  };

  client.getCsrf = () => csrf;
  return client;
}

async function main() {
  const A = makeClient();
  const B = makeClient();
  const anon = makeClient();

  console.log('\n— الصفحات —');
  const home = await A('/');
  check('الصفحة الرئيسية 200', home.status === 200, `(${home.status})`);
  check('الصفحة عربية RTL', home.text.includes('lang="ar"') && home.text.includes('dir="rtl"'));
  check('عنوان الموقع', home.text.includes('ملاحظاتي'));
  check('لا inline scripts في HTML', !/<script(?![^>]*src=)/i.test(home.text));

  const login = await A('/login');
  check('صفحة الدخول 200', login.status === 200, `(${login.status})`);
  const reg = await A('/register');
  check('صفحة التسجيل 200', reg.status === 200, `(${reg.status})`);

  const appPage = await anon('/app');
  check(
    'التطبيق يحوّل غير المسجّل إلى /login',
    appPage.status === 302 && (appPage.headers.get('location') || '').includes('/login'),
    `(${appPage.status})`
  );

  check('ملفات CSS متاحة', (await A('/css/app.css')).status === 200);
  check('ملفات JS متاحة', (await A('/js/app.js')).status === 200);
  check('أيقونة الموقع متاحة', (await A('/favicon.svg')).status === 200);

  console.log('\n— التسجيل والدخول —');
  const stamp = Date.now();
  const emailA = `ali${stamp}@example.com`;
  const emailB = `sara${stamp}@example.com`;

  const bad = await anon('/api/auth/register', { method: 'POST', body: { name: 'X', email: 'nope', password: '123' } });
  check('رفض تسجيل غير صالح', bad.status === 422, `(${bad.status})`);

  const shortPw = await anon('/api/auth/register', {
    method: 'POST',
    body: { name: 'أحمد', email: `s${stamp}@example.com`, password: '123' },
  });
  check('رفض كلمة مرور قصيرة', shortPw.status === 422 && shortPw.json?.field === 'password', `(${shortPw.status})`);

  const r1 = await A('/api/auth/register', {
    method: 'POST',
    body: { name: 'علي أحمد', email: emailA, password: 'secret12345' },
  });
  check('تسجيل مستخدم A', r1.status === 201 && r1.json?.user?.email === emailA, `(${r1.status})`);
  check('استلام رمز CSRF', Boolean(A.getCsrf()));
  check('إنشاء تصنيفات افتراضية', (r1.json?.stats?.categories ?? 0) >= 4, `cats=${r1.json?.stats?.categories}`);
  const setCookie = r1.headers.get('set-cookie') || '';
  check('كوكي الجلسة HttpOnly', /mynotes_sid=/i.test(setCookie) && /HttpOnly/i.test(setCookie), setCookie);
  check('كوكي SameSite', /SameSite=Lax/i.test(setCookie), setCookie);

  const homeLoggedIn = await A('/');
  check('المسجّل يُحوَّل من الرئيسية إلى /app', homeLoggedIn.status === 302, `(${homeLoggedIn.status})`);
  const loginLoggedIn = await A('/login');
  check('المسجّل يُحوَّل من صفحة الدخول إلى /app', loginLoggedIn.status === 302, `(${loginLoggedIn.status})`);

  const dup = await anon('/api/auth/register', {
    method: 'POST',
    body: { name: 'علي', email: emailA, password: 'secret12345' },
  });
  check('رفض البريد المكرر', dup.status === 409, `(${dup.status})`);

  const r2 = await B('/api/auth/register', {
    method: 'POST',
    body: { name: 'سارة', email: emailB, password: 'secret12345' },
  });
  check('تسجيل مستخدم B', r2.status === 201, `(${r2.status})`);

  const wrong = await anon('/api/auth/login', { method: 'POST', body: { email: emailA, password: 'wrongpass99' } });
  check('رفض كلمة مرور خاطئة', wrong.status === 401, `(${wrong.status})`);

  const noSuch = await anon('/api/auth/login', { method: 'POST', body: { email: `ghost${stamp}@x.com`, password: 'whatever123' } });
  check('بريد غير مسجّل = 401 (لا كشف)', noSuch.status === 401, `(${noSuch.status})`);

  console.log('\n— إنشاء ملاحظات —');
  const catsA = await A('/api/categories');
  const firstCat = catsA.json?.categories?.[0];
  check('A يحصل على تصنيفاته', Array.isArray(catsA.json?.categories) && catsA.json.categories.length >= 4);

  const n1 = await A('/api/notes', {
    method: 'POST',
    body: { title: 'خطة العمل الأسبوعية', content: 'مراجعة التقرير الساعة العاشرة', color: 'indigo', categoryId: firstCat.id },
  });
  check('إنشاء ملاحظة بتصنيف ملك A', n1.status === 201 && n1.json?.note?.id, `(${n1.status})`);
  const idA1 = n1.json?.note?.id;

  const n2 = await A('/api/notes', {
    method: 'POST',
    body: { title: 'أفكار مشروع جديد', content: 'تطبيق لتنظيم المهام اليومية مع تذكيرات ذكية', color: 'emerald' },
  });
  check('إنشاء ملاحظة ثانية', n2.status === 201, `(${n2.status})`);
  const idA2 = n2.json?.note?.id;

  const n3 = await A('/api/notes', {
    method: 'POST',
    body: { title: 'قائمة التسوق', content: 'خبز، حليب، فواكه', color: 'amber', pinned: true },
  });
  check('إنشاء ملاحظة مثبّتة', n3.status === 201, `(${n3.status})`);
  const idA3 = n3.json?.note?.id;

  const nB = await B('/api/notes', {
    method: 'POST',
    body: { title: 'ملاحظة سرية لسارة', content: 'كلمة السر الخاصة بي 4588', color: 'rose' },
  });
  check('إنشاء ملاحظة للمستخدم B', nB.status === 201, `(${nB.status})`);
  const idB = nB.json?.note?.id;

  const empty = await A('/api/notes', { method: 'POST', body: { title: '', content: '' } });
  check('رفض الملاحظة الفارغة', empty.status === 422, `(${empty.status})`);

  const badColor = await A('/api/notes', { method: 'POST', body: { title: 'لون', content: 'x', color: 'javascript:alert(1)' } });
  check('رفض لون غير معروف (يُستبدل بالافتراضي)', badColor.status === 201 && badColor.json?.note?.color === 'slate', `(${badColor.status})`);
  await A(`/api/notes/${badColor.json?.note?.id}`, { method: 'DELETE' }); // تنظيف ملاحظة الاختبار
  await A(`/api/notes/${badColor.json?.note?.id}?permanent=1`, { method: 'DELETE' });

  const catB = await A('/api/categories', { method: 'POST', body: { name: 'مؤقت', color: 'sky' } });
  const foreignCat = await B('/api/notes', {
    method: 'POST',
    body: { title: 'محاولة', content: 'x', categoryId: catB.json?.category?.id },
  });
  check('B لا يستطيع استخدام تصنيف A (422)', foreignCat.status === 422, `(${foreignCat.status})`);
  await A(`/api/categories/${catB.json?.category?.id}`, { method: 'DELETE' });

  console.log('\n— عزل البيانات (الأهم) —');
  const listA = await A('/api/notes');
  check('A يرى 3 ملاحظات فقط', listA.json?.notes?.length === 3, `len=${listA.json?.notes?.length}`);
  check('A لا يرى ملاحظة B', !JSON.stringify(listA.json).includes('سرية لسارة'));

  const listB = await B('/api/notes');
  check('B يرى ملاحظته فقط', listB.json?.notes?.length === 1, `len=${listB.json?.notes?.length}`);
  check('B لا يرى ملاحظات A', !JSON.stringify(listB.json).includes('خطة العمل'));

  const stealGet = await B(`/api/notes/${idA1}`);
  check('B لا يقرأ ملاحظة A (404)', stealGet.status === 404, `(${stealGet.status})`);

  const stealPatch = await B(`/api/notes/${idA1}`, { method: 'PATCH', body: { title: 'تمت السرقة!' } });
  check('B لا يعدّل ملاحظة A (404)', stealPatch.status === 404, `(${stealPatch.status})`);

  const stealDel = await B(`/api/notes/${idA1}`, { method: 'DELETE' });
  check('B لا يحذف ملاحظة A (404)', stealDel.status === 404, `(${stealDel.status})`);

  const stealRestore = await B(`/api/notes/${idA1}/restore`, { method: 'POST' });
  check('B لا يستعيد ملاحظة A (404)', stealRestore.status === 404, `(${stealRestore.status})`);

  const stillThere = await A(`/api/notes/${idA1}`);
  check('ملاحظة A سليمة بعد محاولات B', stillThere.status === 200 && stillThere.json?.note?.title === 'خطة العمل الأسبوعية');
  check('بقيت ملك A', stillThere.json?.note?.user_id !== undefined && listB.json.notes.every((n) => n.id !== idA1));

  const anonList = await anon('/api/notes');
  check('زائر بلا جلسة لا يرى بيانات (401)', anonList.status === 401, `(${anonList.status})`);

  const anonSteal = await anon(`/api/notes/${idA1}`, { method: 'DELETE' });
  check('زائر لا يحذف ملاحظة (401)', anonSteal.status === 401, `(${anonSteal.status})`);

  console.log('\n— CSRF —');
  const noCsrf = await fetch(BASE + `/api/notes/${idA2}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: r1.headers.get('set-cookie').split(';')[0] },
    body: JSON.stringify({ title: 'hack' }),
  }).catch(() => null);
  check('طلب بلا رمز CSRF مرفوض', !noCsrf || noCsrf.status >= 400, noCsrf && `(${noCsrf.status})`);

  const crossOrigin = await fetch(BASE + '/api/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example', 'X-CSRF-Token': A.getCsrf() },
    body: JSON.stringify({ title: 'x', content: 'y' }),
  });
  check('رفض Origin مشبوه', crossOrigin.status === 403, `(${crossOrigin.status})`);

  const verifyAfter = await A(`/api/notes/${idA2}`);
  check('ملاحظة A لم تتغيّر بعد محاولات التزوير', verifyAfter.json?.note?.title === 'أفكار مشروع جديد');

  console.log('\n— عمليات الملاحظات —');
  const pin = await A(`/api/notes/${idA2}`, { method: 'PATCH', body: { pinned: true } });
  check('تثبيت ملاحظة', pin.json?.note?.pinned === 1);

  const fav = await A(`/api/notes/${idA2}`, { method: 'PATCH', body: { favorite: true } });
  check('إضافة للمفضلة', fav.json?.note?.favorite === 1);

  const arch = await A(`/api/notes/${idA2}`, { method: 'PATCH', body: { archived: true } });
  check('أرشفة ملاحظة', arch.json?.note?.archived === 1);

  const archivedList = await A('/api/notes?scope=archived');
  check('نطاق الأرشيف يعرضها', archivedList.json?.notes?.length === 1, `len=${archivedList.json?.notes?.length}`);

  const activeList = await A('/api/notes');
  check('المؤرشفة خارج النشطة', activeList.json?.notes?.length === 2, `len=${activeList.json?.notes?.length}`);

  const pinnedList = await A('/api/notes?scope=pinned');
  check('نطاق المثبّتة', pinnedList.json?.notes?.length === 1, `len=${pinnedList.json?.notes?.length}`);

  const search = await A('/api/notes?q=' + encodeURIComponent('التسوق'));
  check('البحث يجد ملاحظة', search.json?.notes?.length === 1, `len=${search.json?.notes?.length}`);

  const searchNone = await A('/api/notes?q=' + encodeURIComponent('غير موجود إطلاقًا'));
  check('البحث بلا نتائج', searchNone.json?.notes?.length === 0);

  const searchContent = await A('/api/notes?q=' + encodeURIComponent('التقرير'));
  check('البحث داخل النص', searchContent.json?.notes?.length === 1, `len=${searchContent.json?.notes?.length}`);

  const searchInjection = await A('/api/notes?q=' + encodeURIComponent("%' OR 1=1 --"));
  check('البحث آمن ضد حقن SQL', searchInjection.status === 200 && searchInjection.json?.notes?.length === 0, `(${searchInjection.status}) len=${searchInjection.json?.notes?.length}`);

  const edit = await A(`/api/notes/${idA3}`, { method: 'PATCH', body: { title: 'قائمة التسوق المحدّثة', content: 'خبز، زيت، تمر' } });
  check('تعديل ملاحظة', edit.json?.note?.title === 'قائمة التسوق المحدّثة');

  // الترتيب: المثبّت أولًا ثم أبجديًا
  const sortTitle = await A('/api/notes?sort=title');
  const titles = (sortTitle.json?.notes || []).map((n) => n.title);
  check('ترتيب بالعنوان (المثبّت أولًا)', titles[0] === 'قائمة التسوق المحدّثة' && titles[1] === 'خطة العمل الأسبوعية', JSON.stringify(titles));
  const sortCreated = await A('/api/notes?sort=created');
  check('ترتيب بالإنشاء', (sortCreated.json?.notes || []).length >= 2, `len=${sortCreated.json?.notes?.length}`);
  const sortBad = await A('/api/notes?sort=' + encodeURIComponent('<script>'));
  check('ترتيب غير معروف يسقط للافتراضي', sortBad.status === 200, `(${sortBad.status})`);

  console.log('\n— السلة والاستعادة —');
  const del = await A(`/api/notes/${idA3}`, { method: 'DELETE' });
  check('نقل إلى السلة', del.status === 200 && del.json?.stats?.trash === 1, `(${del.status})`);

  const trash = await A('/api/notes?scope=trash');
  check('عرض السلة', trash.json?.notes?.length === 1);

  const activeAfter = await A('/api/notes');
  check('السلة خارج القائمة النشطة', activeAfter.json?.notes?.length === 1, `len=${activeAfter.json?.notes?.length}`);

  const restore = await A(`/api/notes/${idA3}/restore`, { method: 'POST' });
  check('استعادة من السلة', restore.status === 200 && restore.json?.note?.deleted_at === null, `(${restore.status})`);

  const permanentBlocked = await A(`/api/notes/${idA3}?permanent=1`, { method: 'DELETE' });
  check('حذف نهائي مرفوض خارج السلة', permanentBlocked.status === 400, `(${permanentBlocked.status})`);

  await A(`/api/notes/${idA3}`, { method: 'DELETE' });
  const purgeBlockedByB = await B(`/api/notes/${idA3}?permanent=1`, { method: 'DELETE' });
  check('B لا يحذف نهائيًا ملاحظة A المحذوفة', purgeBlockedByB.status === 404, `(${purgeBlockedByB.status})`);

  const permanent = await A(`/api/notes/${idA3}?permanent=1`, { method: 'DELETE' });
  check('حذف نهائي من السلة', permanent.status === 200 && permanent.json?.stats?.trash === 0, `(${permanent.status})`);

  const gone = await A(`/api/notes/${idA3}`);
  check('الملاحظة المحذوفة لم تعد موجودة', gone.status === 404, `(${gone.status})`);

  console.log('\n— التصنيفات —');
  const cat = await A('/api/categories', { method: 'POST', body: { name: 'سفر', color: 'sky' } });
  check('إنشاء تصنيف', cat.status === 201, `(${cat.status})`);
  const catId = cat.json?.category?.id;

  const dupeCat = await A('/api/categories', { method: 'POST', body: { name: 'سفر', color: 'sky' } });
  check('رفض تصنيف مكرر', dupeCat.status === 409, `(${dupeCat.status})`);

  const withCat = await A('/api/notes', { method: 'POST', body: { title: 'مخطط رحلة', content: 'الحجز مسبقًا', categoryId: catId } });
  check('ملاحظة بتصنيف', withCat.status === 201 && withCat.json?.note?.category_name === 'سفر', `(${withCat.status})`);

  const filter = await A(`/api/notes?category=${catId}`);
  check('تصفية حسب التصنيف', filter.json?.notes?.length === 1, `len=${filter.json?.notes?.length}`);

  const catSteal = await B(`/api/categories/${catId}`, { method: 'PATCH', body: { name: 'muh' } });
  check('B لا يعدّل تصنيف A (404)', catSteal.status === 404, `(${catSteal.status})`);

  const catDelByB = await B(`/api/categories/${catId}`, { method: 'DELETE' });
  check('B لا يحذف تصنيف A (404)', catDelByB.status === 404, `(${catDelByB.status})`);

  const catDel = await A(`/api/categories/${catId}`, { method: 'DELETE' });
  check('حذف تصنيف', catDel.status === 200, `(${catDel.status})`);

  const orphan = await A('/api/notes');
  check('الملاحظات تبقى بعد حذف التصنيف', orphan.json?.notes?.length >= 2, `len=${orphan.json?.notes?.length}`);

  console.log('\n— الإحصاءات والتصدير —');
  const stats = await A('/api/stats');
  const s = stats.json?.stats;
  check('إحصاءات صحيحة', s && s.total === s.active + s.archived + s.trash, JSON.stringify(s));

  const exp = await A('/api/export?format=json');
  check('تصدير JSON', exp.status === 200 && Array.isArray(exp.json?.notes), `(${exp.status})`);
  check('التصدير يحوي Content-Disposition', /attachment/i.test(exp.headers.get('content-disposition') || ''));

  const expMd = await A('/api/export?format=md');
  check('تصدير Markdown', expMd.status === 200 && expMd.text.includes('# '), `(${expMd.status})`);

  const expB = await B('/api/export?format=json');
  check('تصدير B يحوي ملاحظته فقط', expB.json?.notes?.length === 1 && !expB.text.includes('خطة العمل'), `len=${expB.json?.notes?.length}`);

  console.log('\n— الحساب والإعدادات —');
  const me = await A('/api/auth/me');
  check('/api/auth/me يعيد المستخدم', me.json?.user?.email === emailA);

  const anonMe = await anon('/api/auth/me');
  check('/api/auth/me يرفض الزائر', anonMe.status === 401, `(${anonMe.status})`);

  const noPw = await A('/api/auth/profile', { method: 'PATCH', body: { name: 'علي الجديد', email: emailA } });
  check('تعديل بلا كلمة مرور حالية مرفوض', noPw.status === 401, `(${noPw.status})`);

  const withPw = await A('/api/auth/profile', {
    method: 'PATCH',
    body: { name: 'علي الجديد', email: emailA, currentPassword: 'secret12345' },
  });
  check('تعديل الاسم بكلمة المرور', withPw.status === 200 && withPw.json?.user?.name === 'علي الجديد', `(${withPw.status})`);

  const pwChange = await A('/api/auth/profile', {
    method: 'PATCH',
    body: { newPassword: 'newsecret999', currentPassword: 'secret12345' },
  });
  check('تغيير كلمة المرور', pwChange.status === 200, `(${pwChange.status})`);

  const relogin = await anon('/api/auth/login', { method: 'POST', body: { email: emailA, password: 'newsecret999' } });
  check('الدخول بكلمة المرور الجديدة', relogin.status === 200, `(${relogin.status})`);

  const oldPw = await anon('/api/auth/login', { method: 'POST', body: { email: emailA, password: 'secret12345' } });
  check('كلمة المرور القديمة لم تعد تعمل', oldPw.status === 401, `(${oldPw.status})`);

  console.log('\n— تسجيل الخروج —');
  const out = await A('/api/auth/logout', { method: 'POST' });
  check('تسجيل الخروج', out.status === 200, `(${out.status})`);
  const afterOut = await A('/api/notes');
  check('بعد الخروج تُرفض الطلبات', afterOut.status === 401, `(${afterOut.status})`);

  const outPage = await A('/app');
  check('بعد الخروج يُحوَّل /app إلى /login', outPage.status === 302, `(${outPage.status})`);

  console.log('\n— الأخطاء والحدود —');
  const nf = await anon('/api/whatever');
  check('مسار API غير موجود 404', nf.status === 404, `(${nf.status})`);
  const nfPage = await anon('/totally-missing-page');
  check('صفحة غير موجودة 404', nfPage.status === 404, `(${nfPage.status})`);
  const badNoteId = await B('/api/notes/999999');
  check('ملاحظة غير موجودة 404', badNoteId.status === 404, `(${badNoteId.status})`);
  const badJson = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{broken json',
  });
  check('JSON تالف مرفوض 400', badJson.status === 400, `(${badJson.status})`);

  const zxcv = await anon('/api/auth/login', { method: 'POST', body: { email: `r${stamp}@x.com`, password: 'badbadbad' } });
  const locked = [];
  for (let i = 0; i < 12; i++) {
    const res = await anon('/api/auth/login', { method: 'POST', body: { email: `r${stamp}@x.com`, password: 'badbadbad' } });
    locked.push(res.status);
  }
  check('حد محاولات الدخول (429)', locked.includes(429), JSON.stringify([...new Set(locked)]));

  console.log(`\n===============================\n  ناجح: ${passed}   فاشل: ${failed}\n===============================`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('خطأ في الاختبار:', e);
  process.exit(1);
});
