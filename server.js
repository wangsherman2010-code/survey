// Multi-survey server with admin editor.
// Run: ADMIN_KEY=secret BASE_URL=https://survey.example.com node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SURVEYS_DIR = path.join(DATA_DIR, 'surveys');
const DELETED_DIR = path.join(DATA_DIR, 'deleted');
const SEED_DIR = path.join(__dirname, 'seed-surveys');
const PUBLIC = path.join(__dirname, 'public');

if (ADMIN_KEY === 'changeme' && (process.env.BASE_URL || process.env.NODE_ENV === 'production')) {
  console.error('Refusing to start: set a real ADMIN_KEY (not "changeme") when running in production.');
  process.exit(1);
}
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(DELETED_DIR, { recursive: true });
if (!fs.existsSync(SURVEYS_DIR)) { // first run: seed the starter survey(s)
  fs.mkdirSync(SURVEYS_DIR, { recursive: true });
  for (const f of fs.existsSync(SEED_DIR) ? fs.readdirSync(SEED_DIR) : []) fs.copyFileSync(path.join(SEED_DIR, f), path.join(SURVEYS_DIR, f));
}

// ---------- storage ----------
const slugOk = (s) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(s || '');
const surveyFile = (slug) => path.join(SURVEYS_DIR, slug + '.json');
const respFile = (slug) => path.join(DATA_DIR, slug + '.jsonl');
const listSurveys = () => fs.readdirSync(SURVEYS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter(slugOk).sort();
const loadSurvey = (slug) => (slugOk(slug) && fs.existsSync(surveyFile(slug)) ? JSON.parse(fs.readFileSync(surveyFile(slug), 'utf8')) : null);
const saveSurvey = (slug, s) => { const t = surveyFile(slug) + '.tmp'; fs.writeFileSync(t, JSON.stringify(s, null, 2) + '\n'); fs.renameSync(t, surveyFile(slug)); };
const loadResponses = (slug) =>
  fs.existsSync(respFile(slug)) ? fs.readFileSync(respFile(slug), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

// ---------- helpers ----------
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseUrl = (req) => (process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/$/, '');
const qrSvg = (text, margin = 2) => QRCode.toString(text, { type: 'svg', margin, errorCorrectionLevel: 'M' });
const clean = (v) => (v == null ? '' : String(v).trim().slice(0, 2000));
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function readBody(req, limit = 50000) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ---------- admin auth (key -> signed cookie) ----------
const sessionToken = crypto.createHmac('sha256', ADMIN_KEY).update('survey-admin-session-v1').digest('hex');
const safeEq = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const isAdmin = (req) => {
  const c = (req.headers.cookie || '').split(/;\s*/).find((p) => p.startsWith('adm='));
  return !!c && safeEq(c.slice(4), sessionToken);
};
const sameOrigin = (req) => { // CSRF defence on top of SameSite=Strict
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
};
const attempts = new Map(); // ip -> {n, reset}
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const tooMany = (ip) => { const a = attempts.get(ip); return a && a.reset > Date.now() && a.n >= 10; };
const fail = (ip) => { const a = attempts.get(ip); if (!a || a.reset < Date.now()) attempts.set(ip, { n: 1, reset: Date.now() + 15 * 60000 }); else a.n++; };

// ---------- survey validation ----------
const columns = (s) => [
  ...s.questions.flatMap((q) => [[q.id, q.label], ...(q.followUp ? [[q.followUp.id, `${q.label} – ${q.followUp.label}`]] : [])]),
  ...(s.retired || []).map((r) => [r.id, `${r.label} (removed)`]),
];

function normalizeSurvey(input, old) {
  const err = (error) => ({ error });
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  if (!input || typeof input !== 'object') return err('Invalid survey.');
  const title = str(input.title, 120);
  if (!title) return err('Please enter a survey title.');
  if (!Array.isArray(input.questions) || !input.questions.length) return err('Add at least one question.');
  if (input.questions.length > 30) return err('A survey can have at most 30 questions.');

  const oldQs = (old && old.questions) || [];
  const oldQ = new Map(oldQs.map((q) => [q.id, q]));
  const oldF = new Map(oldQs.filter((q) => q.followUp).map((q) => [q.followUp.id, q]));
  const used = new Set();
  let n = 0;
  const see = (id) => { const m = /\d+/.exec(id || ''); if (m) n = Math.max(n, +m[0]); };
  oldQs.forEach((q) => { see(q.id); if (q.followUp) see(q.followUp.id); });
  ((old && old.retired) || []).forEach((r) => see(r.id));
  const takeId = (id, pool) => {
    if (typeof id === 'string' && pool.has(id) && !used.has(id)) { used.add(id); return id; }
    let nid; do { nid = 'q' + ++n; } while (used.has(nid));
    used.add(nid); return nid;
  };

  const questions = [];
  for (const [i, q] of input.questions.entries()) {
    const num = i + 1;
    if (!q || typeof q !== 'object') return err(`Question ${num} is invalid.`);
    if (!['text', 'choice', 'rating'].includes(q.type)) return err(`Question ${num}: unknown type.`);
    const label = str(q.label, 300);
    if (!label) return err(`Question ${num} needs some wording.`);
    const out = { id: takeId(q.id, oldQ), type: q.type, label, required: !!q.required };
    if (q.type === 'text') {
      const ph = str(q.placeholder, 150); if (ph) out.placeholder = ph;
      if (Number.isInteger(q.rows) && q.rows >= 1 && q.rows <= 10) out.rows = q.rows;
    } else if (q.type === 'rating') {
      out.low = str(q.low, 40); out.high = str(q.high, 40);
    } else {
      const options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o) => str(o, 60)).filter(Boolean))];
      if (options.length < 2 || options.length > 10) return err(`Question ${num}: give between 2 and 10 different choices.`);
      out.options = options;
      if (q.followUp && typeof q.followUp === 'object') {
        const fl = str(q.followUp.label, 300);
        if (!fl) return err(`Question ${num}: the follow-up question needs some wording.`);
        const when = options.filter((o) => Array.isArray(q.followUp.when) && q.followUp.when.includes(o));
        if (!when.length) return err(`Question ${num}: choose which answers should show the follow-up.`);
        out.followUp = { id: takeId(q.followUp.id, oldF), label: fl, when };
        const ph = str(q.followUp.placeholder, 150); if (ph) out.followUp.placeholder = ph;
      }
    }
    questions.push(out);
  }

  // questions removed from the survey keep their answers: remember their ids and labels
  const kept = new Set(questions.flatMap((q) => [q.id, ...(q.followUp ? [q.followUp.id] : [])]));
  const retired = new Map(((old && old.retired) || []).map((r) => [r.id, r]));
  for (const q of oldQs) {
    if (!kept.has(q.id)) retired.set(q.id, { id: q.id, label: q.label });
    if (q.followUp && !kept.has(q.followUp.id)) retired.set(q.followUp.id, { id: q.followUp.id, label: `${q.label} – ${q.followUp.label}` });
  }
  return {
    survey: {
      title, subtitle: str(input.subtitle, 500), thanks: str(input.thanks, 300) || 'Thank you! Your response has been received.',
      questions, retired: [...retired.values()],
    },
  };
}

function validateAnswers(survey, body) {
  const answers = {}, given = (body && body.answers) || {};
  for (const q of survey.questions) {
    const v = clean(given[q.id]);
    if (q.type === 'rating' && v && !/^[1-5]$/.test(v)) return { error: `Invalid answer for "${q.label}"` };
    if (q.type === 'choice' && v && !q.options.includes(v)) return { error: `Invalid answer for "${q.label}"` };
    if (q.required && !v) return { error: `Please answer: ${q.label}` };
    answers[q.id] = v;
    if (q.followUp) answers[q.followUp.id] = q.followUp.when.includes(v) ? clean(given[q.followUp.id]) : '';
  }
  // Anonymity is enforced server-side: when anonymous, the name is never stored.
  const anonymous = body.anonymous !== false;
  const name = anonymous ? '' : String(body.name || '').trim().slice(0, 80);
  return { record: { id: crypto.randomUUID(), at: new Date().toISOString(), name: name || null, answers } };
}

// ---------- admin pages ----------
const page = (title, body, { nav = true, script = '' } = {}) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head><body class="admin"><main>
${nav ? '<nav class="top"><a href="/admin">All surveys</a><form method="post" action="/admin/logout"><button class="link">Log out</button></form></nav>' : ''}
${body}</main>${script}</body></html>`;

const loginPage = (error) => page('Admin login', `<form method="post" action="/admin/login" class="card login"><h1>Admin login</h1>
  <label for="key">Admin key</label><input id="key" name="key" type="password" autocomplete="current-password" autofocus required>
  <p class="err">${esc(error || '')}</p><button class="btn" type="submit">Log in</button></form>`, { nav: false });

async function adminHome(req) {
  const slugs = listSurveys();
  const cards = await Promise.all(slugs.map(async (slug) => {
    const s = loadSurvey(slug), url = `${baseUrl(req)}/s/${slug}`, n = loadResponses(slug).length;
    return `<section class="card qr"><div class="qrbox">${await qrSvg(url, 1)}</div><div>
      <h2>${esc(s.title)}</h2><p><a href="${esc(url)}">${esc(url)}</a></p><p class="muted">${n} response${n === 1 ? '' : 's'}</p>
      <p><a class="btn" href="/admin/s/${slug}">Results</a> <a class="btn ghost" href="/admin/s/${slug}/edit">Edit questions</a>
      <a class="btn ghost" href="/qr/${slug}.svg" download="${slug}-qr.svg">Download QR</a>
      <a class="btn ghost" href="/admin/s/${slug}/export.csv">CSV</a></p></div></section>`;
  }));
  const opts = slugs.map((s) => `<option value="${s}">${esc(loadSurvey(s).title)}</option>`).join('');
  return page('Surveys', `<h1>Your surveys</h1>
    <section class="card"><h2>New survey</h2><form id="newForm" class="newform">
      <label>Title<input id="nTitle" maxlength="120" placeholder="e.g. March Speech" required></label>
      <label>Link name<input id="nSlug" maxlength="60" placeholder="march-speech" required><small>${esc(baseUrl(req))}/s/<b id="slugPrev">…</b></small></label>
      <label>Start from<select id="nFrom"><option value="">A blank survey</option>${opts}</select></label>
      <p class="err" id="nErr"></p><button class="btn" type="submit">Create and edit</button></form></section>
    ${cards.join('') || '<p class="muted">No surveys yet.</p>'}`, { script: '<script src="/admin-home.js"></script>' });
}

async function adminSurvey(req, slug) {
  const s = loadSurvey(slug), rs = loadResponses(slug), url = `${baseUrl(req)}/s/${slug}`, cols = columns(s);
  const stats = s.questions.filter((q) => q.type === 'choice' || q.type === 'rating').map((q) => {
    const opts = q.type === 'choice' ? q.options : ['1', '2', '3', '4', '5'];
    const parts = opts.map((o) => `${esc(o)} <b>${rs.filter((r) => r.answers[q.id] === o).length}</b>`).join(' · ');
    return `<div class="stat"><span>${esc(q.label)}</span><p>${parts}</p></div>`;
  }).join('');
  const cards = rs.slice().reverse().map((r) => `<article class="card"><header><strong>${esc(r.name || 'Anonymous')}</strong><time>${new Date(r.at).toLocaleString()}</time></header>
    ${cols.map(([id, label]) => (r.answers[id] ? `<p><span>${esc(label)}</span>${esc(r.answers[id])}</p>` : '')).join('')}</article>`).join('');
  return page(`Results – ${s.title}`, `<h1>${esc(s.title)}</h1>
    <section class="card qr"><div class="qrbox">${await qrSvg(url, 1)}</div><div><h2>Scan to respond</h2><p><a href="${esc(url)}">${esc(url)}</a></p>
    <p><a class="btn" href="/admin/s/${slug}/edit">Edit questions</a> <a class="btn ghost" href="/admin/s/${slug}/export.csv">Download CSV</a>
    <a class="btn ghost" href="/qr/${slug}.svg" download="${slug}-qr.svg">Download QR (SVG)</a></p></div></section>
    <h2>${rs.length} response${rs.length === 1 ? '' : 's'}</h2><div class="stats">${stats}</div>${cards || '<p class="muted">No responses yet.</p>'}
    <script>setTimeout(()=>location.reload(),30000)</script>`);
}

const adminEditPage = (slug, s) => page(`Edit – ${s.title}`, `<h1>Edit survey</h1>
  <p id="banner" class="note"></p>
  <section class="card" id="meta"></section>
  <div id="qs"></div>
  <button class="btn ghost addq" id="add" type="button">+ Add question</button>
  <div class="savebar"><span id="status" class="status"></span><a class="btn ghost" id="preview" href="/s/${slug}" target="_blank" rel="noopener">Preview</a><button class="btn" id="save" type="button">Save changes</button></div>
  <section class="card danger"><h3>Delete this survey</h3><p class="muted">The survey and its link stop working. Its responses are archived on the server, not shown anywhere.</p><button class="btn danger" id="del" type="button">Delete survey</button></section>`,
  { script: '<script src="/admin-edit.js"></script>' });

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
    const json = (code, obj) => send(code, JSON.stringify(obj), 'application/json');
    const redirect = (to, extra = {}) => { res.writeHead(302, { Location: to, ...extra }); res.end(); };
    const jsonBody = async (limit) => { try { return JSON.parse(await readBody(req, limit)); } catch { return null; } };
    let m;

    if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return send(403, 'Forbidden', 'text/plain');

    // ----- public -----
    if (req.method === 'GET' && p === '/') {
      const all = listSurveys();
      if (all.length === 1) return redirect(`/s/${all[0]}`);
      return send(200, page('Surveys', '<h1>Welcome</h1><p class="muted">Please use the link or QR code you were given.</p>', { nav: false }));
    }
    if (req.method === 'GET' && (m = p.match(/^\/s\/([^/]+)$/))) {
      if (!loadSurvey(m[1])) return send(404, page('Not found', '<h1>Survey not found</h1><p class="muted">Check the link or QR code.</p>', { nav: false }));
      return send(200, fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/survey\/([^/]+)$/))) {
      const s = loadSurvey(m[1]);
      if (!s) return json(404, { error: 'Not found' });
      const { retired, ...pub } = s;
      return json(200, pub);
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/submit\/([^/]+)$/))) {
      const s = loadSurvey(m[1]);
      if (!s) return json(404, { error: 'Survey not found' });
      const body = await jsonBody();
      if (!body) return json(400, { error: 'Bad request' });
      const { record, error } = validateAnswers(s, body);
      if (error) return json(400, { error });
      fs.appendFileSync(respFile(m[1]), JSON.stringify(record) + '\n');
      return json(200, { ok: true });
    }
    if (req.method === 'GET' && (m = p.match(/^\/qr\/([^/]+)\.svg$/))) {
      if (!loadSurvey(m[1])) return send(404, 'Not found', 'text/plain');
      return send(200, await qrSvg(`${baseUrl(req)}/s/${m[1]}`), 'image/svg+xml');
    }

    // ----- admin: login / logout -----
    if (req.method === 'POST' && p === '/admin/login') {
      const ip = clientIp(req);
      if (tooMany(ip)) return send(429, loginPage('Too many attempts. Try again in 15 minutes.'));
      const key = new URLSearchParams(await readBody(req, 2000)).get('key') || '';
      if (!safeEq(crypto.createHash('sha256').update(key).digest('hex'), crypto.createHash('sha256').update(ADMIN_KEY).digest('hex'))) {
        fail(ip); return send(401, loginPage('That key is not correct.'));
      }
      attempts.delete(ip);
      const secure = baseUrl(req).startsWith('https') ? '; Secure' : '';
      return redirect('/admin', { 'Set-Cookie': `adm=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${secure}` });
    }
    if (req.method === 'POST' && p === '/admin/logout') return redirect('/admin', { 'Set-Cookie': 'adm=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });

    // ----- admin: everything else needs the cookie -----
    if (p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin/')) {
      const authed = isAdmin(req);
      if (p.startsWith('/api/admin/') && !authed) return json(401, { error: 'Please log in again.' });
      if (p === '/admin' && !authed) return send(200, loginPage());
      if (!authed) return redirect('/admin');

      if (req.method === 'GET' && p === '/admin') return send(200, await adminHome(req));
      if (req.method === 'GET' && (m = p.match(/^\/admin\/s\/([^/]+)$/))) return loadSurvey(m[1]) ? send(200, await adminSurvey(req, m[1])) : send(404, 'Not found', 'text/plain');
      if (req.method === 'GET' && (m = p.match(/^\/admin\/s\/([^/]+)\/edit$/))) return loadSurvey(m[1]) ? send(200, adminEditPage(m[1], loadSurvey(m[1]))) : send(404, 'Not found', 'text/plain');
      if (req.method === 'GET' && (m = p.match(/^\/admin\/s\/([^/]+)\/export\.csv$/))) {
        const s = loadSurvey(m[1]); if (!s) return send(404, 'Not found', 'text/plain');
        const cols = columns(s);
        const head = ['Submitted', 'Name', ...cols.map((c) => c[1])].map(csvCell).join(',');
        const lines = loadResponses(m[1]).map((r) => [r.at, r.name || 'Anonymous', ...cols.map((c) => r.answers[c[0]])].map(csvCell).join(','));
        return send(200, '﻿' + [head, ...lines].join('\n'), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${m[1]}-responses.csv"` });
      }

      if (req.method === 'GET' && (m = p.match(/^\/api\/admin\/survey\/([^/]+)$/))) {
        const s = loadSurvey(m[1]); return s ? json(200, { survey: s, count: loadResponses(m[1]).length }) : json(404, { error: 'Not found' });
      }
      if (req.method === 'PUT' && (m = p.match(/^\/api\/admin\/survey\/([^/]+)$/))) {
        const old = loadSurvey(m[1]); if (!old) return json(404, { error: 'Not found' });
        const body = await jsonBody(300000); if (!body) return json(400, { error: 'Bad request' });
        const { survey, error } = normalizeSurvey(body, old);
        if (error) return json(400, { error });
        saveSurvey(m[1], survey);
        return json(200, { survey, count: loadResponses(m[1]).length });
      }
      if (req.method === 'DELETE' && (m = p.match(/^\/api\/admin\/survey\/([^/]+)$/))) {
        if (!loadSurvey(m[1])) return json(404, { error: 'Not found' });
        const stamp = Date.now();
        fs.renameSync(surveyFile(m[1]), path.join(DELETED_DIR, `${m[1]}-${stamp}.json`));
        if (fs.existsSync(respFile(m[1]))) fs.renameSync(respFile(m[1]), path.join(DELETED_DIR, `${m[1]}-${stamp}.jsonl`));
        return json(200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/admin/surveys') {
        const body = await jsonBody(); if (!body) return json(400, { error: 'Bad request' });
        const slug = String(body.slug || '');
        if (!slugOk(slug)) return json(400, { error: 'Link name: use lowercase letters, numbers and hyphens only.' });
        if (loadSurvey(slug) || fs.existsSync(respFile(slug))) return json(409, { error: 'That link name is already used. Choose another.' });
        const title = String(body.title || '').trim();
        if (!title) return json(400, { error: 'Please enter a title.' });
        let base;
        if (body.copyFrom) {
          base = loadSurvey(String(body.copyFrom));
          if (!base) return json(400, { error: 'The survey to copy was not found.' });
          base = { ...base, title, retired: [] };
        } else {
          base = { title, subtitle: '', thanks: '', questions: [{ id: 'q1', type: 'text', label: 'What is your main takeaway?', required: false }] };
        }
        const { survey, error } = normalizeSurvey(base, null);
        if (error) return json(400, { error });
        saveSurvey(slug, survey);
        return json(200, { slug });
      }
      return send(404, 'Not found', 'text/plain');
    }

    // ----- static files -----
    if (req.method === 'GET') {
      const file = path.join(PUBLIC, path.normalize(p));
      if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile())
        return send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    send(404, 'Not found', 'text/plain');
  } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
});

server.listen(PORT, () => console.log(`Surveys on http://localhost:${PORT}  |  admin: /admin`));
