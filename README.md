# ملاحظاتي · My Notes

منصة ملاحظات شخصية وآمنة لكل مستخدم، بواجهة عربية كاملة **RTL** بتصميم عصري على نمط الشركات العالمية.

- ✅ تسجيل/دخول بالبريد الإلكتروني وكلمة المرور
- ✅ كل ملاحظاتك خاصة بك — عزل صارم على مستوى قاعدة البيانات (كل استعلام مقيد بـ `user_id`)
- ✅ قاعدة بيانات SQLite مدمجة (بدون تنصيب)
- ✅ تصنيفات وألوان · تثبيت · مفضلة · أرشفة · سلة مهملات (30 يومًا)
- ✅ بحث فوري · ترتيب · عرض شبكي/قائمة
- ✅ حفظ تلقائي أثناء الكتابة · تصدير JSON/Markdown
- ✅ مظهر فاتح وداكن · تصميم متجاوب بالكامل

---

## التشغيل محليًا

```bash
cd my-notes
npm install
npm start
```

ثم افتح <http://localhost:3000>

| الأمر | الوظيفة |
| --- | --- |
| `npm start` | تشغيل الخادم |
| `npm run dev` | تشغيل مع إعادة التشغيل التلقائي عند تعديل الملفات |
| `npm test` | تشغيل الاختبار الشامل (96 اختبارًا) |
| `npm run build:pages` | بناء نسخة ثابتة لصفحة الهبوط (لـ GitHub Pages) |

متطلب: Node.js ‏22.5 أو أحدث (لتوافر الوحدة المدمجة `node:sqlite`).

### متغيّرات البيئة (كلها اختيارية)

انسخ `.env.example` إلى `.env` وعدّل القيم:

| المتغيّر | الوصف | الافتراضي |
| --- | --- | --- |
| `PORT` | منفذ الخادم | `3000` |
| `SITE_NAME` | اسم الموقع في التصدير والصفحات | `ملاحظاتي` |
| `DB_PATH` | مسار ملف قاعدة البيانات | `./data/mynotes.db` |
| `SESSION_DAYS` | مدة صلاحية الجلسة بالأيام | `30` |
| `NODE_ENV` | `production` لتفعيل الكوكيز الآمنة وترويسات الحماية | `development` |

> ملاحظة: للقراءة الفعلية من `.env` عند النشر، ضع القيم في متغيّرات بيئة المنصة (Render/Railway/…). محليًا يمكن تمريرها مباشرة مثل `PORT=8080 npm start`.

---

## بنية المشروع

```
my-notes/
├── server.js            # الخادم: الصفحات + الحماية + التشغيل
├── render.yaml          # إعداد النشر على Render (Blueprint)
├── .github/workflows/
│   └── pages.yml        # سير نشر صفحة الهبوط على GitHub Pages
├── scripts/
│   └── pages-build.js   # بناء نسخة Pages الثابتة
├── src/
│   ├── db.js            # مخطط قاعدة البيانات والعمليات (SQLite)
│   ├── security.js      # تشفير كلمات المرور (Scrypt) + حد محاولات الدخول
│   ├── middleware.js     # الجلسات والكوكيز
│   └── api.js           # واجهة REST للـ API
├── public/
│   ├── index.html       # صفحة الهبوط
│   ├── login.html       # تسجيل الدخول
│   ├── register.html    # إنشاء حساب
│   ├── app.html         # لوحة الملاحظات (محمية)
│   ├── css/  (base, landing, auth, app)
│   ├── js/   (ui, api, landing, auth, app)
│   └── favicon.svg
├── test/smoke.js        # 96 اختبارًا آليًا (الخصوصية، CSRF، السلة…)
└── data/                # ملف قاعدة البيانات (غير مُرفع إلى Git)
```

---

## النشر

> **لماذا موقعان؟** GitHub Pages يستضيف ملفات ثابتة فقط ولا يستطيع تشغيل
> خادم Node.js أو قاعدة بيانات. لذلك نشرنا **التطبيق كاملًا** على Render
> (خادم + قاعدة بيانات)، و**صفحة الهبوط التعريفية** على GitHub Pages مع
> أزرار توجّه إلى التطبيق الحيّ.

### 1) نشر التطبيق على Render (الخطوة الأساسية)

1. افتح <https://dashboard.render.com> وسجّل الدخول بحساب GitHub.
2. اضغط **New + → Blueprint** واختر مستودع `my-notes`.
3. سيقرأ Render ملف `render.yaml` تلقائيًا ويبني الخادم. اضغط **Apply**.
4. بعد اكتمال النشر ستحصل على رابط مثل `https://my-notes-xxxx.onrender.com` —
   هذا هو **التطبيق الكامل**: التسجيل، الدخول، وقاعدة بيانات المستخدمين.

**حفظ البيانات دائمًا (مهم):** الخطة المجانية لا تدعم الأقراص الدائمة، لذا
تُعاد قاعدة البيانات عند كل إعادة نشر. لتفعيل التخزين الدائم:
`Settings → Disk → Add Disk` ثم غيّر `DB_PATH` في متغيّرات البيئة إلى
`/var/data/mynotes.db` (يتطابق مع `mountPath` في `render.yaml`).

### 2) نشر صفحة الهبوط على GitHub Pages

1. على صفحة المستودع: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. سيقوم سير `.github/workflows/pages.yml` بالبناء والنشر تلقائيًا مع كل دفع.
3. للربط الصحيح، أضف متغيّر بيئة في المستودع
   (**Settings → Secrets and variables → Actions → Variables**):
   `APP_URL` = رابطك على Render (مثال `https://my-notes-xxxx.onrender.com`).
   أزرار «تسجيل الدخول» و«إنشاء حساب» في صفحة الهبوط ستوجّه إليه.

لنشر الصفحة يدويًا محليًا:

```bash
APP_URL=https://your-app.onrender.com npm run build:pages
# النتيجة في dist-pages/ — ارفعها لأي استضافة ثابتة
```


---

## الأمان

| البند | التنفيذ |
| --- | --- |
| كلمات المرور | Scrypt ‏(N=16384) + ملح عشوائي 16 بايت، ولا تُخزَّن نصًا |
| الجلسات | كوكى `HttpOnly` + `SameSite=Lax` + `Secure` في الإنتاج، رمز CSRF لكل جلسة |
| عزل البيانات | كل استعلام قراءة/تعديل/حذف يحمل شرط `user_id = المستخدم الحالي` |
| CSRF | فحص `Origin` + رأس `X-CSRF-Token` على كل الطلبات غير الـ GET |
| Brute force | 10 محاولات دخول لكل بريد/IP كل 10 دقائق |
| التحقق | تحقق من صيغة البريد وطول كلمة المرور (8 أحرف فأكثر) على الخادم |
| الترويسات | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS في الإنتاج |

---

## واجهة الـ API

| الطريقة | المسار | الوصف |
| --- | --- | --- |
| `POST` | `/api/auth/register` | إنشاء حساب |
| `POST` | `/api/auth/login` | تسجيل الدخول |
| `POST` | `/api/auth/logout` | تسجيل الخروج |
| `GET` | `/api/auth/me` | المستخدم الحالي + الإحصاءات + رمز CSRF |
| `PATCH` | `/api/auth/profile` | تعديل الاسم/البريد/كلمة المرور |
| `GET` | `/api/notes` | قائمة الملاحظات (`scope`, `q`, `category`, `sort`) |
| `POST` | `/api/notes` | إنشاء ملاحظة |
| `GET` | `/api/notes/:id` | ملاحظة واحدة |
| `PATCH` | `/api/notes/:id` | تعديل/تثبيت/مفضلة/أرشفة |
| `DELETE` | `/api/notes/:id` | نقل إلى السلة (`?permanent=1` للحذف النهائي) |
| `POST` | `/api/notes/:id/restore` | استعادة من السلة |
| `POST` | `/api/notes/empty-trash` | تفريغ السلة |
| `GET/POST/PATCH/DELETE` | `/api/categories…` | إدارة التصنيفات |
| `GET` | `/api/export?format=json\|md` | تصدير الملاحظات |
