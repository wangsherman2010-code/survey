// Zero-framework survey server. Run: ADMIN_KEY=secret node server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'changeme';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'responses.jsonl');
fs.mkdirSync(DATA_DIR, { recursive: true });

const loadSurvey = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));
const loadResponses = () =>
  fs.existsSync(FILE)
    ? fs.readFileSync(FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const baseUrl = (req) => process.env.BASE_URL || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}`;
const isAdmin = (url) => {
  const k = Buffer.from(url.searchParams.get('key') || '');
  const a = Buffer.from(ADMIN_KEY);
  return k.length === a.length && crypto.timingSafeEqual(k, a);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > 50000) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}

function validate(survey, body) {
  const answers = {};
  for (const q of survey.questions) {
    let v = body.answers && body.answers[q.id];
    v = v == null ? '' : String(v).trim().slice(0, 2000);
    if (q.type === 'rating' && v && !/^[1-5]$/.test(v)) return { error: `Invalid answer for "${q.label}"` };
    if (q.type === 'choice' && v && !q.options.includes(v)) return { error: `Invalid answer for "${q.label}"` };
    if (q.required && !v) return { error: `Please answer: ${q.label}` };
    answers[q.id] = v;
  }
  // Anonymity is enforced server-side: when anonymous, the name is never stored.
  const anonymous = body.anonymous !== false;
  const name = anonymous ? '' : String(body.name || '').trim().slice(0, 80);
  return { record: { id: crypto.randomUUID(), at: new Date().toISOString(), name: name || null, answers } };
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function adminPage(survey, responses, qrSvg, url, key) {
  const rows = responses.slice().reverse().map((r) => `
    <article class="card"><header><strong>${esc(r.name || 'Anonymous')}</strong><time>${new Date(r.at).toLocaleString()}</time></header>
    ${survey.questions.map((q) => r.answers[q.id] ? `<p><span>${esc(q.label)}</span>${esc(r.answers[q.id])}${q.type === 'rating' ? ' / 5' : ''}</p>` : '').join('')}</article>`).join('');
  const stats = survey.questions.filter((q) => q.type === 'rating').map((q) => {
    const vals = responses.map((r) => +r.answers[q.id]).filter(Boolean);
    const avg = vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : '–';
    return `<div class="stat"><b>${avg}</b><span>${esc(q.label)}</span></div>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Results – ${esc(survey.title)}</title><link rel="stylesheet" href="/style.css"></head><body class="admin"><main>
<h1>${esc(survey.title)} – Results</h1>
<section class="card qr"><div class="qrbox">${qrSvg}</div><div><h2>Scan to respond</h2><p><a href="${esc(url)}">${esc(url)}</a></p>
<p><a class="btn" href="/admin/export.csv?key=${encodeURIComponent(key)}">Download CSV</a> <a class="btn ghost" href="/qr.svg" download="survey-qr.svg">Download QR (SVG)</a></p></div></section>
<h2>${responses.length} response${responses.length === 1 ? '' : 's'}</h2><div class="stats">${stats}</div>${rows || '<p class="muted">No responses yet.</p>'}
</main><script>setTimeout(()=>location.reload(),30000)</script></body></html>`;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const send = (code, body, type = 'text/html; charset=utf-8', extra = {}) => { res.writeHead(code, { 'Content-Type': type, ...extra }); res.end(body); };

    if (req.method === 'GET' && url.pathname === '/api/survey') return send(200, JSON.stringify(loadSurvey()), 'application/json');

    if (req.method === 'POST' && url.pathname === '/api/submit') {
      let body; try { body = JSON.parse(await readBody(req)); } catch { return send(400, '{"error":"Bad request"}', 'application/json'); }
      const { record, error } = validate(loadSurvey(), body);
      if (error) return send(400, JSON.stringify({ error }), 'application/json');
      fs.appendFileSync(FILE, JSON.stringify(record) + '\n');
      return send(200, '{"ok":true}', 'application/json');
    }

    if (req.method === 'GET' && url.pathname === '/qr.svg') {
      return send(200, await QRCode.toString(baseUrl(req) + '/', { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }), 'image/svg+xml');
    }

    if (req.method === 'GET' && url.pathname === '/admin') {
      if (!isAdmin(url)) return send(401, 'Unauthorized – add ?key=YOUR_ADMIN_KEY', 'text/plain');
      const qr = await QRCode.toString(baseUrl(req) + '/', { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
      return send(200, adminPage(loadSurvey(), loadResponses(), qr, baseUrl(req) + '/', url.searchParams.get('key')));
    }

    if (req.method === 'GET' && url.pathname === '/admin/export.csv') {
      if (!isAdmin(url)) return send(401, 'Unauthorized', 'text/plain');
      const s = loadSurvey();
      const head = ['Submitted', 'Name', ...s.questions.map((q) => q.label)].map(csvCell).join(',');
      const lines = loadResponses().map((r) => [r.at, r.name || 'Anonymous', ...s.questions.map((q) => r.answers[q.id])].map(csvCell).join(','));
      return send(200, [head, ...lines].join('\n'), 'text/csv', { 'Content-Disposition': 'attachment; filename="responses.csv"' });
    }

    if (req.method === 'GET') {
      const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      const file = path.join(__dirname, 'public', path.normalize(rel));
      if (file.startsWith(path.join(__dirname, 'public')) && fs.existsSync(file) && fs.statSync(file).isFile())
        return send(200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
    }
    send(404, 'Not found', 'text/plain');
  } catch (e) { console.error(e); res.writeHead(500); res.end('Server error'); }
});

server.listen(PORT, () => console.log(`Survey on http://localhost:${PORT}  |  results: /admin?key=${ADMIN_KEY}`));
