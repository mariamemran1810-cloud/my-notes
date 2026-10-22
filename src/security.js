'use strict';

/** أدوات الحماية: تشفير كلمات المرور، رموز الجلسات، وتحديد محاولات الدخول. */

const crypto = require('node:crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LEN = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_PARAMS).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, salt, expected] = String(stored || '').split('$');
    if (scheme !== 'scrypt' || !salt || !expected) return false;
    const actual = crypto.scryptSync(String(password), salt, KEY_LEN, SCRYPT_PARAMS);
    const expectedBuf = Buffer.from(expected, 'hex');
    if (actual.length !== expectedBuf.length) return false;
    return crypto.timingSafeEqual(actual, expectedBuf);
  } catch {
    return false;
  }
}

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/* --------------------------------------------------- حدّ محاولات الدخول (Anti-Brute Force) */

const attempts = new Map();
const WINDOW_MS = 10 * 60 * 1000; // 10 دقائق
const MAX_ATTEMPTS = 10;

function rateKey(...parts) {
  return parts.join('|').toLowerCase();
}

/** يعيد true إذا كان المتاح ضمن الحد المسموح */
function rateCheck(key) {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= MAX_ATTEMPTS;
}

function rateReset(key) {
  attempts.delete(key);
}

// تنظيف دوري للذاكرة
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of attempts) if (entry.resetAt < now) attempts.delete(key);
}, 60000).unref();

/** تحقق من تطابق Origin مع المضيف لمنع هجمات CSRF */
function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // طلبات same-origin بعضها بدون Origin
  try {
    const host = req.headers.host;
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  randomToken,
  safeEqual,
  rateCheck,
  rateReset,
  originAllowed,
  rateKey,
};
