// Multi-survey server. Run: ADMIN_KEY=secret BASE_URL=https://survey.example.com node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const SURVEYS_DIR = path.join(__dirname, 'surveys');
const PUBLIC = path.join(__dirname, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });

const slugOk = (s) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(s || '');
const listSurveys = () => fs.readdirSync(SURVEYS_DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).filter(slugOk).sort();
const loadSurvey = (slug) => {
  const f = path.join(SURVEYS_DIR, slug + '.json');
  return slugOk(slug) && fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
};
const respFile = (slug) => path.join(DATA_DIR, slug + '.jsonl');
const loadResponses = (slug) =>
  fs.existsSync(respFile(slug)) ? fs.readFileSync(respFile(slug), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseUrl = (req) => (process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`).replace(/\/$/, '');
const isAdmin = (url) => {
  const k = Buffer.from(url.searchParams.get('key') || ''), a = Buffer.from(ADMIN_KEY);
  return k.length === a.length && crypto.timingSafeEqual(k, a);
};
const qrSvg = (text, margin = 2) => QRCode.toString(text, { type: 'svg', margin, errorCorrectionLevel: 'M' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 50000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

const clean = (v) => (v == null ? '' : String(v).trim().slice(0, 2000));

function validate(survey, body) {
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

// every answer column for a survey: [id, label]
const columns = (s) => s.questions.flatMap((q) => [[q.id, q.label], ...(q.followUp ? [[q.followUp.id, `${q.label} – ${q.followUp.label}`]] : [])]);
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const withKey = (key) => `key=${encodeURIComponent(key)}`;

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/style.css"></head><body class="admin"><main>${body}</main></body></html>`;

async function adminHome(req, key) {
  const cards = await Promise.all(listSurveys().map(async (slug) => {
    const s = loadSurvey(slug), url = `${baseUrl(req)}/s/${slug}`, n = loadResponses(slug).length;
    return `<section class="card qr"><div class="qrbox">${await qrSvg(url, 1)}</div><div>
      <h2>${esc(s.title)}</h2><p><a href="${esc(url)}">${esc(url)}</a></p><p class="muted">${n} response${n === 1 ? '' : 's'}</p>
      <p><a class="btn" href="/admin/s/${slug}?${withKey(key)}">View results</a>
      <a class="btn ghost" href="/qr/${slug}.svg" download="${slug}-qr.svg">Download QR</a>
      <a class="btn ghost" href="/admin/s/${slug}/export.csv?${withKey(key)}">CSV</a></p></div></section>`;
  }));
  return page('Surveys', `<h1>Your surveys</h1>${cards.join('') || '<p class="muted">No surveys yet. Add a file to the surveys folder.</p>'}
    <p class="muted">Add a survey: <code>node new-survey.js my-slug "My title"</code>, edit <code>surveys/my-slug.json</code>, restart the server.</p>`);
}

async function adminSurvey(req, slug, key) {
  const s = loadSurvey(slug), rs = loadResponses(slug), url = `${baseUrl(req)}/s/${slug}`;
  const cols = columns(s);
  const stats = s.questions.filter((q) => q.type === 'choice' || q.type === 'rating').map((q) => {
    const opts = q.type === 'choice' ? q.options : ['1', '2', '3', '4', '5'];
    const parts = opts.map((o) => `${esc(o)} <b>${rs.filter((r) => r.answers[q.id] === o).length}</b>`).join(' · ');
    return `<div class="stat"><span>${esc(q.label)}</span><p>${parts}</p></div>`;
  }).join('');
  const cards = rs.slice().reverse().map((r) => `<article class="card"><header><strong>${esc(r.name || 'Anonymous')}</strong><time>${new Date(r.at).toLocaleString()}</time></header>
    ${cols.map(([id, label]) => (r.answers[id] ? `<p><span>${esc(label)}</span>${esc(r.answers[id])}</p>` : '')).join('')}</article>`).join('');
  return page(`Results – ${s.title}`, `<p><a href="/admin?${withKey(key)}">← All surveys</a></p><h1>${esc(s.title)}</h1>
    <section class="card qr"><div class="qrbox">${await qrSvg(url, 1)}</div><div><h2>Scan to respond</h2><p><a href="${esc(url)}">${esc(url)}</a></p>
    <p><a class="btn" href="/admin/s/${slug}/export.csv?${withKey(key)}">Download CSV</a> <a class="btn ghost" href="/qr/${slug}.svg" download="${slug}-qr.svg">Download QR (SVG)</a></p></div></section>
    <h2>${rs.length} response${rs.length === 1 ? '' : 's'}</h2><div class="stats">${stats}</div>${cards || '<p class="muted">No responses yet.</p>'}
    <script>setTimeout(()=>location.reload(),30000)</script>`);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };
    let m;

    if (req.method === 'GET' && p === '/') {
      const all = listSurveys();
      if (all.length === 1) { res.writeHead(302, { Location: `/s/${all[0]}` }); return res.end(); }
      return send(200, page('Surveys', '<h1>Welcome</h1><p class="muted">Please use the link or QR code you were given.</p>'));
    }
    if (req.method === 'GET' && (m = p.match(/^\/s\/([^/]+)$/))) {
      if (!loadSurvey(m[1])) return send(404, page('Not found', '<h1>Survey not found</h1><p class="muted">Check the link or QR code.</p>'));
      return send(200, fs.readFileSync(path.join(PUBLIC, 'index.html')));
    }
    if (req.method === 'GET' && (m = p.match(/^\/api\/survey\/([^/]+)$/))) {
      const s = loadSurvey(m[1]);
      return s ? send(200, JSON.stringify(s), 'application/json') : send(404, '{"error":"Not found"}', 'application/json');
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/submit\/([^/]+)$/))) {
      const s = loadSurvey(m[1]);
      if (!s) return send(404, '{"error":"Survey not found"}', 'application/json');
      let body; try { body = JSON.parse(await readBody(req)); } catch { return send(400, '{"error":"Bad request"}', 'application/json'); }
      const { record, error } = validate(s, body);
      if (error) return send(400, JSON.stringify({ error }), 'application/json');
      fs.appendFileSync(respFile(m[1]), JSON.stringify(record) + '\n');
      return send(200, '{"ok":true}', 'application/json');
    }
    if (req.method === 'GET' && (m = p.match(/^\/qr\/([^/]+)\.svg$/))) {
      if (!loadSurvey(m[1])) return send(404, 'Not found', 'text/plain');
      return send(200, await qrSvg(`${baseUrl(req)}/s/${m[1]}`), 'image/svg+xml');
    }

    if (p === '/admin' || p.startsWith('/admin/')) {
      if (!isAdmin(url)) return send(401, 'Unauthorized – add ?key=YOUR_ADMIN_KEY', 'text/plain');
      const key = url.searchParams.get('key');
      if (p === '/admin') return send(200, await adminHome(req, key));
      if ((m = p.match(/^\/admin\/s\/([^/]+)$/))) return loadSurvey(m[1]) ? send(200, await adminSurvey(req, m[1], key)) : send(404, 'Not found', 'text/plain');
      if ((m = p.match(/^\/admin\/s\/([^/]+)\/export\.csv$/))) {
        const s = loadSurvey(m[1]); if (!s) return send(404, 'Not found', 'text/plain');
        const cols = columns(s);
        const head = ['Submitted', 'Name', ...cols.map((c) => c[1])].map(csvCell).join(',');
        const lines = loadResponses(m[1]).map((r) => [r.at, r.name || 'Anonymous', ...cols.map((c) => r.answers[c[0]])].map(csvCell).join(','));
        return send(200, '﻿' + [head, ...lines].join('\n'), 'text/csv; charset=utf-8', { 'Content-Disposition': `attachment; filename="${m[1]}-responses.csv"` });
      }
    }

    if (req.method === 'GET') {
      const file = path.join(PUBLIC, path.normalize(p));
      if (file.startsWith(PUBLIC + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile())
        return send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    send(404, 'Not found', 'text/plain');
  } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
});

server.listen(PORT, () => console.log(`Surveys on http://localhost:${PORT}  |  admin: /admin?key=${ADMIN_KEY}`));
