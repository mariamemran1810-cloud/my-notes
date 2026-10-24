'use strict';
/**
 * خادم وهمي يحاكي GitHub API للاختبار المحلي فقط.
 * لا يُرفع إلى الإنتاج — للاختبار على dist-pages مع ?api=http://127.0.0.1:4174
 *
 * يدعم: GET /user · POST /user/repos · GET/PUT /repos/:login/mynotes-data/contents/notes.json
 */
const http = require('node:http');

const PORT = Number(process.env.PORT) || 4174;
const USER = { login: 'test-user', name: 'مستخدم تجريبي', email: 'test@example.com' };

/** حالة الذاكرة: { repoExists: bool, file: { content, sha } | null } */
const store = { repos: new Set(), files: new Map() };
let shaCounter = 0;
const nextSha = () => `sha-${++shaCounter}-${Date.now().toString(36)}`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type,Accept,X-GitHub-Api-Version',
};

function send(res, status, body) {
  const data = body === null ? '' : JSON.stringify(body);
  res.writeHead(status, { ...cors, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const method = req.method;

    if (method === 'OPTIONS') {
      res.writeHead(204, cors);
      return res.end();
    }

    // المصادقة: نتوقع أي رمز يبدأ بـ ghp_
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ghp_')) return send(res, 401, { message: 'Bad credentials' });

    // GET /user
    if (method === 'GET' && path === '/user') return send(res, 200, USER);

    // POST /user/repos
    if (method === 'POST' && path === '/user/repos') {
      const body = await readBody(req);
      if (store.repos.has(body.name)) return send(res, 422, { message: 'Repository already exists' });
      store.repos.add(body.name);
      return send(res, 201, { name: body.name, private: !!body.private });
    }

    // GET /repos/:login/:repo (للتحقق من وجود المستودع)
    const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)$/);
    if (method === 'GET' && repoMatch) {
      if (!store.repos.has(repoMatch[2])) return send(res, 404, { message: 'Not Found' });
      return send(res, 200, { name: repoMatch[2] });
    }

    // GET/PUT /repos/:login/:repo/contents/:file
    const fileMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)\/contents\/([^/]+)$/);
    if (fileMatch && fileMatch[2] === 'mynotes-data' && fileMatch[3] === 'notes.json') {
      if (method === 'GET') {
        const file = store.files.get('notes.json');
        if (!file) return send(res, 404, { message: 'Not Found' });
        return send(res, 200, { sha: file.sha, content: file.content });
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const cur = store.files.get('notes.json');
        if (cur && body.sha && body.sha !== cur.sha) {
          return send(res, 409, { message: 'sha mismatch' });
        }
        const sha = nextSha();
        store.files.set('notes.json', { sha, content: body.content });
        return send(res, 200, { content: { sha } });
      }
    }

    send(res, 404, { message: `Unhandled: ${method} ${path}` });
  })
  .listen(PORT, () => console.log(`mock github api: http://127.0.0.1:${PORT}`));
