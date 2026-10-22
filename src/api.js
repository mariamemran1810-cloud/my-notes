'use strict';

/**
 * واجهة التطبيق البرمجية (REST API)
 * قاعدة الأساس: كل استعلام مقيد بـ user_id الخاص بصاحب الجلسة —
 * لا يمكن لأي مستخدم قراءة أو تعديل أو حذف ملاحظات مستخدم آخر.
 */

const express = require('express');
const store = require('./db');
const { SESSION_COOKIE, cookieOptions } = require('./middleware');
const {
  hashPassword,
  verifyPassword,
  randomToken,
  safeEqual,
  rateCheck,
  rateReset,
  originAllowed,
  rateKey,
} = require('./security');

const router = express.Router();

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SESSION_MS = SESSION_DAYS * 86400000;
const TRASH_KEEP_DAYS = 30;
const SITE_NAME = process.env.SITE_NAME || 'ملاحظاتي';

// كل الطلبات الواردة يجب أن تمر بفحص المصدر/CSRF
router.use(csrfGuard);

/* ------------------------------------------------------------- أدوات مساعدة */

const ok = (res, data = {}, status = 200) => res.status(status).json({ ok: true, ...data });
const fail = (res, status, error, field = null) =>
  res.status(status).json({ ok: false, error, ...(field ? { field } : {}) });

const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalize = (v) => String(v == null ? '' : v).trim();

function validEmail(email) {
  return emailRe.test(email) && email.length <= 254;
}

function validPassword(pw) {
  return typeof pw === 'string' && pw.length >= 8 && pw.length <= 200;
}

function sanitizeText(value, max, fallback = '') {
  const text = normalize(value).replace(/\r\n/g, '\n');
  if (!text) return fallback;
  return text.slice(0, max);
}

/* ---------------------------------------------------------- ميدلير الحماية */

/** يفرض تسجيل الدخول على مسارات /api المحمية */
function requireAuth(req, res, next) {
  if (!req.user) return fail(res, 401, 'يجب تسجيل الدخول للوصول إلى بياناتك');
  next();
}

/** يرفض الطلبات العابرة بالمواقع (CSRF) */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!originAllowed(req)) return fail(res, 403, 'طلب غير موثوق (تحقق من المصدر)');
  if (!req.user) return next(); // تسجيل الدخول/التسجيل لا تتطلب جلسة بعد
  const token = req.get('x-csrf-token') || req.body?.csrfToken;
  if (!token || !safeEqual(token, req.session.csrf)) return fail(res, 403, 'انتهت صلاحية الجلسة، يرجى إعادة تحميل الصفحة');
  next();
}

/* -------------------------------------------------------------- الجلسات */

function startSession(req, res, userId, userAgent) {
  const sid = randomToken(32);
  const csrf = randomToken(24);
  const expiresAt = Date.now() + SESSION_MS;
  store.createSession({ sessionId: sid, userId, csrf, expiresAt, userAgent });
  res.cookie(SESSION_COOKIE, sid, cookieOptions(expiresAt));
  return csrf;
}

function endSession(req, res) {
  if (req.sessionId) store.destroySession(req.sessionId);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(Date.now()), maxAge: undefined, expires: new Date(0) });
}

/* --------------------------------------------------------------- الحساب */

function authPayload(req) {
  return {
    user: req.user,
    csrfToken: req.session ? req.session.csrf : null,
    stats: req.user ? store.getStats(req.user.id) : null,
  };
}

router.post('/auth/register', (req, res) => {
  const ip = req.ip || 'unknown';
  if (!rateCheck(rateKey('register', ip))) {
    return fail(res, 429, 'عدد كبير من المحاولات، حاول مجددًا بعد 10 دقائق');
  }

  const name = sanitizeText(req.body?.name, 60);
  const email = normalize(req.body?.email).toLowerCase();
  const password = req.body?.password;

  if (name.length < 2) return fail(res, 422, 'يرجى إدخال اسمك (حرفان على الأقل)', 'name');
  if (!validEmail(email)) return fail(res, 422, 'البريد الإلكتروني غير صالح', 'email');
  if (!validPassword(password)) return fail(res, 422, 'كلمة المرور يجب ألا تقل عن 8 أحرف', 'password');

  if (store.findUserByEmail(email)) {
    return fail(res, 409, 'هذا البريد الإلكتروني مسجّل مسبقًا', 'email');
  }

  const userId = store.createUser({ name, email, passwordHash: hashPassword(password) });
  store.seedDefaultCategories(userId);
  rateReset(rateKey('register', ip));

  const csrf = startSession(req, res, userId, req.get('user-agent'));
  store.markLogin(userId);
  req.session = { csrf };
  req.user = store.findUserById(userId);
  return ok(res, { ...authPayload(req) }, 201);
});

router.post('/auth/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const email = normalize(req.body?.email).toLowerCase();
  const password = req.body?.password || '';
  const key = rateKey('login', ip, email);

  if (!rateCheck(key)) {
    return fail(res, 429, 'عدد كبير من محاولات الدخول، حاول مجددًا بعد 10 دقائق');
  }
  if (!validEmail(email) || !password) {
    return fail(res, 422, 'يرجى إدخال البريد الإلكتروني وكلمة المرور', !email ? 'email' : 'password');
  }

  const user = store.findUserByEmail(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return fail(res, 401, 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
  }

  rateReset(key);
  // إنهاء الجلسات السابقة لهذا الجهاز ثم بدء جلسة جديدة
  const csrf = startSession(req, res, user.id, req.get('user-agent'));
  store.markLogin(user.id);
  req.session = { csrf };
  req.user = store.findUserById(user.id);
  return ok(res, authPayload(req));
});

router.post('/auth/logout', (req, res) => {
  endSession(req, res);
  return ok(res, { message: 'تم تسجيل الخروج' });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return fail(res, 401, 'غير مسجّل الدخول');
  return ok(res, authPayload(req));
});

router.patch('/auth/profile', requireAuth, (req, res) => {
  const { currentPassword, name, email, newPassword } = req.body || {};
  const user = store.db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);

  // لأي تعديل حساس نطلب كلمة المرور الحالية
  if (!verifyPassword(currentPassword || '', user.password_hash)) {
    return fail(res, 401, 'كلمة المرور الحالية غير صحيحة', 'currentPassword');
  }

  const patch = {};
  if (name !== undefined) {
    const clean = sanitizeText(name, 60);
    if (clean.length < 2) return fail(res, 422, 'الاسم قصير جدًا', 'name');
    patch.name = clean;
  }
  if (email !== undefined) {
    const clean = normalize(email).toLowerCase();
    if (!validEmail(clean)) return fail(res, 422, 'البريد الإلكتروني غير صالح', 'email');
    const taken = store.findUserByEmail(clean);
    if (taken && taken.id !== req.user.id) return fail(res, 409, 'البريد مستخدم في حساب آخر', 'email');
    patch.email = clean;
  }
  if (newPassword !== undefined && newPassword !== '') {
    if (!validPassword(newPassword)) return fail(res, 422, 'كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف', 'newPassword');
    store.updatePassword(req.user.id, hashPassword(newPassword));
  }

  if (patch.name || patch.email) store.updateProfile(req.user.id, patch);
  if (newPassword) store.destroyUserSessionsExcept(req.user.id, req.sessionId);

  req.user = store.findUserById(req.user.id);
  return ok(res, authPayload(req));
});

/* ---------------------------------------------------------------- الملاحظات */

router.get('/notes', requireAuth, (req, res) => {
  const scope = ['all', 'pinned', 'favorite', 'archived', 'trash'].includes(req.query.scope) ? req.query.scope : 'all';
  const sort = ['updated', 'created', 'title'].includes(req.query.sort) ? req.query.sort : 'updated';
  const { rows, total } = store.listNotes(req.user.id, {
    scope,
    q: sanitizeText(req.query.q, 120),
    category: req.query.category ?? '',
    sort,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  return ok(res, { notes: rows, total, stats: store.getStats(req.user.id) });
});

router.post('/notes', requireAuth, (req, res) => {
  const body = req.body || {};
  const title = sanitizeText(body.title, 200);
  const content = sanitizeText(body.content, 200000);
  if (!title && !content) return fail(res, 422, 'الملاحظة فارغة', 'content');

  const categoryId = body.categoryId ? Number(body.categoryId) : null;
  if (categoryId && !store.findCategory(req.user.id, categoryId)) {
    return fail(res, 422, 'التصنيف غير موجود', 'categoryId');
  }

  const id = store.createNote(req.user.id, {
    title: title || 'بدون عنوان',
    content,
    color: store.NOTE_COLORS.includes(body.color) ? body.color : 'slate',
    categoryId,
    pinned: !!body.pinned,
    favorite: !!body.favorite,
  });
  return ok(res, { note: store.findNote(req.user.id, id), stats: store.getStats(req.user.id) }, 201);
});

router.get('/notes/:id', requireAuth, (req, res) => {
  const note = store.findNote(req.user.id, Number(req.params.id));
  if (!note) return fail(res, 404, 'الملاحظة غير موجودة');
  return ok(res, { note });
});

router.patch('/notes/:id', requireAuth, (req, res) => {
  const noteId = Number(req.params.id);
  const existing = store.findNote(req.user.id, noteId);
  if (!existing) return fail(res, 404, 'الملاحظة غير موجودة');

  const body = req.body || {};
  const patch = {};

  if ('title' in body) patch.title = sanitizeText(body.title, 200, 'بدون عنوان');
  if ('content' in body) patch.content = sanitizeText(body.content, 200000);
  if ('color' in body) {
    if (!store.NOTE_COLORS.includes(body.color)) return fail(res, 422, 'لون غير صالح', 'color');
    patch.color = body.color;
  }
  if ('categoryId' in body) {
    const catId = body.categoryId ? Number(body.categoryId) : null;
    if (catId && !store.findCategory(req.user.id, catId)) return fail(res, 422, 'التصنيف غير موجود', 'categoryId');
    patch.categoryId = catId;
  }
  for (const flag of ['pinned', 'favorite', 'archived']) {
    if (flag in body) patch[flag] = body[flag] ? 1 : 0;
  }

  const changes = store.updateNote(req.user.id, noteId, patch);
  if (changes) store.touchNote(req.user.id, noteId);

  return ok(res, { note: store.findNote(req.user.id, noteId), stats: store.getStats(req.user.id) });
});

router.post('/notes/:id/restore', requireAuth, (req, res) => {
  const noteId = Number(req.params.id);
  if (!store.restoreNote(req.user.id, noteId)) return fail(res, 404, 'الملاحظة غير موجودة في السلة');
  return ok(res, { note: store.findNote(req.user.id, noteId), stats: store.getStats(req.user.id) });
});

router.delete('/notes/:id', requireAuth, (req, res) => {
  const noteId = Number(req.params.id);
  const note = store.findNote(req.user.id, noteId);
  if (!note) return fail(res, 404, 'الملاحظة غير موجودة');

  if (req.query.permanent === '1') {
    if (!note.deleted_at) return fail(res, 400, 'انقل الملاحظة إلى السلة أولًا');
    store.purgeNote(req.user.id, noteId);
    return ok(res, { message: 'تم حذف الملاحظة نهائيًا', stats: store.getStats(req.user.id) });
  }

  store.softDeleteNote(req.user.id, noteId);
  return ok(res, { message: 'تم نقل الملاحظة إلى سلة المهملات', stats: store.getStats(req.user.id) });
});

router.post('/notes/empty-trash', requireAuth, (req, res) => {
  const count = store.emptyTrash(req.user.id);
  return ok(res, { message: `تم حذف ${count} ملاحظة نهائيًا`, stats: store.getStats(req.user.id) });
});

/* --------------------------------------------------------------- التصنيفات */

router.get('/categories', requireAuth, (req, res) => {
  return ok(res, { categories: store.listCategories(req.user.id) });
});

router.post('/categories', requireAuth, (req, res) => {
  const name = sanitizeText(req.body?.name, 40);
  if (name.length < 2) return fail(res, 422, 'اسم التصنيف قصير جدًا', 'name');
  const color = store.CATEGORY_COLORS.includes(req.body?.color) ? req.body.color : 'indigo';
  if (store.listCategories(req.user.id).some((c) => c.name.toLowerCase() === name.toLowerCase())) {
    return fail(res, 409, 'هذا التصنيف موجود مسبقًا', 'name');
  }
  if (store.listCategories(req.user.id).length >= 30) return fail(res, 422, 'الحد الأقصى 30 تصنيفًا');
  const id = store.createCategory(req.user.id, { name, color });
  return ok(res, { category: store.listCategories(req.user.id).find((c) => c.id === id) }, 201);
});

router.patch('/categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!store.findCategory(req.user.id, id)) return fail(res, 404, 'التصنيف غير موجود');
  const name = sanitizeText(req.body?.name, 40);
  if (name.length < 2) return fail(res, 422, 'اسم التصنيف قصير جدًا', 'name');
  const color = store.CATEGORY_COLORS.includes(req.body?.color) ? req.body.color : 'indigo';
  store.updateCategory(req.user.id, id, { name, color });
  return ok(res, { categories: store.listCategories(req.user.id) });
});

router.delete('/categories/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  if (!store.deleteCategory(req.user.id, id)) return fail(res, 404, 'التصنيف غير موجود');
  return ok(res, { categories: store.listCategories(req.user.id), stats: store.getStats(req.user.id) });
});

/* -------------------------------------------------------- الإحصاءات والتصدير */

router.get('/stats', requireAuth, (req, res) => ok(res, { stats: store.getStats(req.user.id) }));

router.get('/export', requireAuth, (req, res) => {
  const notes = store.exportNotes(req.user.id);
  const format = req.query.format === 'md' ? 'md' : 'json';

  if (format === 'md') {
    const parts = notes.map((n) => {
      const meta = [
        n.category_name ? `**التصنيف:** ${n.category_name}` : null,
        `**آخر تعديل:** ${new Date(n.updated_at).toLocaleString('ar')}`,
        n.pinned ? '**مثبّتة**' : null,
        n.favorite ? '**مفضلة**' : null,
      ].filter(Boolean);
      return [`# ${n.title}`, '', ...meta, '', n.content || '_(بدون نص)_', '', '---', ''].join('\n');
    });
    const doc = `# ملاحظاتي — تصدير ${new Date().toLocaleDateString('ar')}\n\nإجمالي: ${notes.length} ملاحظة\n\n${parts.join('\n')}`;
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="my-notes.md"');
    return res.send(doc);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="my-notes.json"');
  return res.send(JSON.stringify({ app: SITE_NAME, exportedAt: new Date().toISOString(), notes }, null, 2));
});

module.exports = router;
