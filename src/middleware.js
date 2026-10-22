'use strict';

/** ميدلير تحميل الجلسة — يُستخدم في الخادم قبل المسارات والـ API. */

const store = require('./db');

const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SESSION_MS = SESSION_DAYS * 86400000;
const SESSION_COOKIE = 'mynotes_sid';

function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    try {
      jar[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    } catch {
      /* تجاهل الكوكي التالف */
    }
  }
  return jar;
}

function cookieOptions(expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: new Date(expiresAt),
    maxAge: expiresAt - Date.now(),
  };
}

function loadSession(req, res, next) {
  const jar = parseCookies(req.headers.cookie);
  const sid = jar[SESSION_COOKIE];
  const session = store.getSession(sid);

  req.sessionId = sid || null;
  req.session = session;
  req.user = session
    ? { id: session.id, name: session.name, email: session.email, createdAt: session.created_at }
    : null;
  req.cookieOptions = cookieOptions;

  // تجديد تلقائي (انزلاق) للجلسة بعد مرور نصف مدتها
  if (session && session.expires_at - Date.now() < SESSION_MS / 2) {
    const expiresAt = Date.now() + SESSION_MS;
    store.touchSession(sid, expiresAt);
    res.cookie(SESSION_COOKIE, sid, cookieOptions(expiresAt));
  }
  next();
}

module.exports = { loadSession, SESSION_COOKIE, SESSION_MS, cookieOptions };
