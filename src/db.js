'use strict';

/**
 * طبقة قاعدة البيانات — SQLite (عبر الوحدة المدمجة node:sqlite)
 * كل جدول ملاحظات/تصنيفات مرتبط بالمستخدم صاحبه (user_id) فلا يستطيع أحد الوصول لبيانات غيره.
 */

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'mynotes.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    email         TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT    PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf       TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    user_agent TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS categories (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT 'indigo',
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, name COLLATE NOCASE)
  );
  CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);

  CREATE TABLE IF NOT EXISTS notes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT    NOT NULL DEFAULT '',
    content     TEXT    NOT NULL DEFAULT '',
    color       TEXT    NOT NULL DEFAULT 'slate',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    favorite    INTEGER NOT NULL DEFAULT 0,
    archived    INTEGER NOT NULL DEFAULT 0,
    deleted_at  INTEGER,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notes_user   ON notes(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notes_del    ON notes(user_id, deleted_at);
  CREATE INDEX IF NOT EXISTS idx_notes_cat    ON notes(user_id, category_id);
`);

/** أنواع الألوان المتاحة للملاحظات والتصنيفات */
const NOTE_COLORS = ['slate', 'indigo', 'violet', 'emerald', 'amber', 'rose', 'sky'];
const CATEGORY_COLORS = ['indigo', 'violet', 'emerald', 'amber', 'rose', 'sky', 'slate'];

const now = () => Date.now();

const asBool = (v) => (v ? 1 : 0);

/* ----------------------------------------------------------------- المستخدمون */

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email).trim());
}

function findUserById(id) {
  return db.prepare('SELECT id, name, email, created_at, updated_at, last_login_at FROM users WHERE id = ?').get(id);
}

function createUser({ name, email, passwordHash }) {
  const t = now();
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(String(name).trim(), String(email).trim().toLowerCase(), passwordHash, t, t);
  return Number(info.lastInsertRowid);
}

function updateProfile(userId, { name, email }) {
  db.prepare('UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?').run(
    String(name).trim(),
    String(email).trim().toLowerCase(),
    now(),
    userId
  );
}

function updatePassword(userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(passwordHash, now(), userId);
}

function markLogin(userId) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
}

/* ------------------------------------------------------------------- الجلسات */

function createSession({ sessionId, userId, csrf, expiresAt, userAgent }) {
  db.prepare(
    'INSERT INTO sessions (id, user_id, csrf, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(sessionId, userId, csrf, now(), expiresAt, String(userAgent || '').slice(0, 250));
}

function getSession(sessionId) {
  if (!sessionId) return null;
  const row = db
    .prepare(
      `SELECT s.id AS session_id, s.csrf, s.expires_at,
              u.id, u.name, u.email, u.created_at, u.updated_at, u.last_login_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = ?`
    )
    .get(sessionId);
  if (!row) return null;
  if (row.expires_at < now()) {
    destroySession(sessionId);
    return null;
  }
  return row;
}

function touchSession(sessionId, expiresAt) {
  db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, sessionId);
}

function destroySession(sessionId) {
  if (sessionId) db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function destroyUserSessions(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/** إلغاء كل جلسات المستخدم عدا الجلسة الحالية (يُستخدم عند تغيير كلمة المرور) */
function destroyUserSessionsExcept(userId, keepSessionId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSessionId || '');
}

function purgeExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());
}

/* ---------------------------------------------------------------- التصنيفات */

function listCategories(userId) {
  return db
    .prepare(
      `SELECT c.id, c.name, c.color, c.created_at,
              (SELECT COUNT(*) FROM notes n
                WHERE n.category_id = c.id AND n.deleted_at IS NULL) AS notes_count
         FROM categories c
        WHERE c.user_id = ?
        ORDER BY c.created_at ASC`
    )
    .all(userId);
}

function findCategory(userId, categoryId) {
  return db.prepare('SELECT * FROM categories WHERE id = ? AND user_id = ?').get(categoryId, userId);
}

function createCategory(userId, { name, color }) {
  const info = db
    .prepare('INSERT INTO categories (user_id, name, color, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, String(name).trim(), color, now());
  return Number(info.lastInsertRowid);
}

function updateCategory(userId, categoryId, { name, color }) {
  return db
    .prepare('UPDATE categories SET name = ?, color = ? WHERE id = ? AND user_id = ?')
    .run(String(name).trim(), color, categoryId, userId).changes;
}

function deleteCategory(userId, categoryId) {
  return db.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').run(categoryId, userId).changes;
}

function seedDefaultCategories(userId) {
  const insert = db.prepare('INSERT INTO categories (user_id, name, color, created_at) VALUES (?, ?, ?, ?)');
  const t = now();
  const defaults = [
    ['عمل', 'indigo'],
    ['شخصية', 'emerald'],
    ['أفكار', 'violet'],
    ['مذاكرة', 'amber'],
  ];
  for (const [name, color] of defaults) insert.run(userId, name, color, t + 1);
}

/* ------------------------------------------------------------------ الملاحظات */

const NOTE_SELECT = `
  SELECT n.id, n.user_id, n.title, n.content, n.color, n.category_id,
         n.pinned, n.favorite, n.archived, n.deleted_at, n.created_at, n.updated_at,
         c.name AS category_name, c.color AS category_color
    FROM notes n
    LEFT JOIN categories c ON c.id = n.category_id AND c.user_id = n.user_id
`;

const SCOPES = {
  all: 'n.deleted_at IS NULL AND n.archived = 0',
  pinned: 'n.deleted_at IS NULL AND n.archived = 0 AND n.pinned = 1',
  favorite: 'n.deleted_at IS NULL AND n.archived = 0 AND n.favorite = 1',
  archived: 'n.deleted_at IS NULL AND n.archived = 1',
  trash: 'n.deleted_at IS NOT NULL',
};

const SORTS = {
  updated: 'n.pinned DESC, n.updated_at DESC',
  created: 'n.pinned DESC, n.created_at DESC',
  title: "n.pinned DESC, n.title COLLATE NOCASE ASC",
};

function listNotes(userId, opts = {}) {
  const { scope = 'all', q = '', category = '', sort = 'updated', limit = 500, offset = 0 } = opts;
  const where = ['n.user_id = ?', SCOPES[scope] || SCOPES.all];
  const params = [userId];

  if (q) {
    where.push('(n.title LIKE ? ESCAPE \'\\\' OR n.content LIKE ? ESCAPE \'\\\')');
    const like = `%${escapeLike(String(q))}%`;
    params.push(like, like);
  }
  if (category !== '' && category !== 'all') {
    where.push('n.category_id = ?');
    params.push(Number(category));
  }

  const sql = `${NOTE_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sort] || SORTS.updated} LIMIT ? OFFSET ?`;
  params.push(Math.min(Number(limit) || 500, 1000), Math.max(Number(offset) || 0, 0));

  const rows = db.prepare(sql).all(...params);
  const countSql = `SELECT COUNT(*) AS total FROM notes n WHERE ${where.join(' AND ')}`;
  const total = db.prepare(countSql).get(...params.slice(0, params.length - 2)).total;

  return { rows, total };
}

function findNote(userId, noteId) {
  return db.prepare(`${NOTE_SELECT} WHERE n.id = ? AND n.user_id = ?`).get(noteId, userId);
}

function createNote(userId, data) {
  const t = now();
  const info = db
    .prepare(
      `INSERT INTO notes (user_id, title, content, color, category_id, pinned, favorite, archived, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      userId,
      data.title,
      data.content,
      data.color,
      data.categoryId,
      asBool(data.pinned),
      asBool(data.favorite),
      t,
      t
    );
  return Number(info.lastInsertRowid);
}

const UPDATABLE = {
  title: 'title',
  content: 'content',
  color: 'color',
  categoryId: 'category_id',
  pinned: 'pinned',
  favorite: 'favorite',
  archived: 'archived',
};

function updateNote(userId, noteId, patch) {
  const sets = [];
  const params = [];
  for (const [key, column] of Object.entries(UPDATABLE)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    params.push(typeof patch[key] === 'boolean' || typeof patch[key] === 'number' ? asBool(patch[key]) : patch[key]);
  }
  if (!sets.length) return 0;
  sets.push('updated_at = ?');
  params.push(now(), noteId, userId);
  return db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`).run(...params).changes;
}

function touchNote(userId, noteId) {
  db.prepare('UPDATE notes SET updated_at = ? WHERE id = ? AND user_id = ?').run(now(), noteId, userId);
}

function softDeleteNote(userId, noteId) {
  return db
    .prepare('UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL')
    .run(now(), now(), noteId, userId).changes;
}

function restoreNote(userId, noteId) {
  return db
    .prepare('UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL')
    .run(now(), noteId, userId).changes;
}

function purgeNote(userId, noteId) {
  return db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL').run(noteId, userId).changes;
}

function emptyTrash(userId) {
  return db.prepare('DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL').run(userId).changes;
}

function purgeTrashOlderThan(userId, days) {
  const cutoff = now() - days * 86400000;
  return db.prepare('DELETE FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL AND deleted_at < ?').run(userId, cutoff)
    .changes;
}

function getStats(userId) {
  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN deleted_at IS NULL AND archived = 0 THEN 1 ELSE 0 END) AS active,
         SUM(CASE WHEN deleted_at IS NULL AND archived = 0 AND pinned = 1 THEN 1 ELSE 0 END) AS pinned,
         SUM(CASE WHEN deleted_at IS NULL AND archived = 0 AND favorite = 1 THEN 1 ELSE 0 END) AS favorite,
         SUM(CASE WHEN deleted_at IS NULL AND archived = 1 THEN 1 ELSE 0 END) AS archived,
         SUM(CASE WHEN deleted_at IS NOT NULL THEN 1 ELSE 0 END) AS trash,
         COUNT(*) AS total
       FROM notes WHERE user_id = ?`
    )
    .get(userId);
  return {
    active: row.active || 0,
    pinned: row.pinned || 0,
    favorite: row.favorite || 0,
    archived: row.archived || 0,
    trash: row.trash || 0,
    total: row.total || 0,
    categories: listCategories(userId).length,
  };
}

function exportNotes(userId) {
  return db
    .prepare(
      `${NOTE_SELECT} WHERE n.user_id = ? AND n.deleted_at IS NULL ORDER BY n.updated_at DESC`
    )
    .all(userId);
}

function escapeLike(value) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

module.exports = {
  db,
  now,
  asBool,
  NOTE_COLORS,
  CATEGORY_COLORS,
  findUserByEmail,
  findUserById,
  createUser,
  updateProfile,
  updatePassword,
  markLogin,
  createSession,
  getSession,
  touchSession,
  destroySession,
  destroyUserSessions,
  destroyUserSessionsExcept,
  purgeExpiredSessions,
  listCategories,
  findCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  seedDefaultCategories,
  listNotes,
  findNote,
  createNote,
  updateNote,
  touchNote,
  softDeleteNote,
  restoreNote,
  purgeNote,
  emptyTrash,
  purgeTrashOlderThan,
  getStats,
  exportNotes,
};
