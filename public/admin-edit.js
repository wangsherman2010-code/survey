const slug = location.pathname.split('/')[3];
const $ = (s) => document.querySelector(s);
const el = (t, c, txt) => { const e = document.createElement(t); if (c) e.className = c; if (txt != null) e.textContent = txt; return e; };
let S, dirty = false;

const api = async (method, url, body) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/admin'; throw new Error('Please log in again.'); }
  if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
  return j;
};
const status = (msg, cls = '') => { const s = $('#status'); s.textContent = msg; s.className = 'status ' + cls; };
const mark = () => { dirty = true; status('Unsaved changes', 'warn'); };
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

const field = (label, node) => { const w = el('label', 'field'); w.append(el('span', '', label), node); return w; };
const textInput = (val, ph, max, on) => { const i = el('input'); i.type = 'text'; i.value = val || ''; i.placeholder = ph || ''; i.maxLength = max; i.oninput = () => { on(i.value); mark(); }; return i; };
const area = (val, rows, max, on) => { const t = el('textarea'); t.rows = rows; t.maxLength = max; t.value = val || ''; t.oninput = () => { on(t.value); mark(); }; return t; };
const mini = (txt, title, fn, disabled) => { const b = el('button', 'mini', txt); b.type = 'button'; b.title = title; b.disabled = !!disabled; b.onclick = fn; return b; };

function buildMeta() {
  const m = $('#meta'); m.textContent = '';
  m.append(
    field('Survey title', textInput(S.title, '', 120, (v) => (S.title = v))),
    field('Intro text (shown under the title)', area(S.subtitle, 2, 500, (v) => (S.subtitle = v))),
    field('Thank-you message (shown after submitting)', area(S.thanks, 2, 300, (v) => (S.thanks = v))),
  );
}

const swap = (i, j) => { [S.questions[i], S.questions[j]] = [S.questions[j], S.questions[i]]; mark(); render(); };
const TYPE_NAMES = { text: 'Typed answer', choice: 'Choose one (e.g. Easy / Moderate / Hard)', rating: 'Rating 1–5' };

function card(q, i) {
  const c = el('section', 'card q');
  const head = el('div', 'qhead'); head.append(el('strong', '', `Question ${i + 1}`));
  const act = el('div', 'qact');
  act.append(
    mini('↑', 'Move up', () => swap(i, i - 1), i === 0),
    mini('↓', 'Move down', () => swap(i, i + 1), i === S.questions.length - 1),
    mini('✕', 'Delete question', () => { if (confirm('Delete this question? Answers already collected are kept in the results and CSV.')) { S.questions.splice(i, 1); mark(); render(); } }),
  );
  head.append(act); c.append(head);
  c.append(field('Question wording', area(q.label, 2, 300, (v) => (q.label = v))));

  const row = el('div', 'qrow');
  const sel = el('select'); for (const [k, v] of Object.entries(TYPE_NAMES)) { const o = el('option', '', v); o.value = k; sel.append(o); }
  sel.value = q.type;
  sel.onchange = () => {
    q.type = sel.value;
    if (q.type === 'choice' && !q.options) q.options = ['Option 1', 'Option 2'];
    if (q.type !== 'choice') delete q.followUp;
    mark(); render();
  };
  const req = el('input'); req.type = 'checkbox'; req.checked = !!q.required; req.onchange = () => { q.required = req.checked; mark(); };
  const reqL = el('label', 'check'); reqL.append(req, document.createTextNode(' Required'));
  row.append(field('Answer type', sel), reqL); c.append(row);

  if (q.type === 'text') c.append(field('Hint shown inside the box (optional)', textInput(q.placeholder, '', 150, (v) => (q.placeholder = v))));
  if (q.type === 'rating') {
    const r = el('div', 'qrow');
    r.append(field('Label for 1 (optional)', textInput(q.low, 'e.g. Needs work', 40, (v) => (q.low = v))), field('Label for 5 (optional)', textInput(q.high, 'e.g. Excellent', 40, (v) => (q.high = v))));
    c.append(r);
  }
  if (q.type === 'choice') {
    const fuBox = el('div', 'fubox');
    const buildFu = () => {
      fuBox.textContent = '';
      const on = el('input'); on.type = 'checkbox'; on.checked = !!q.followUp;
      on.onchange = () => { if (on.checked) q.followUp = { label: '', placeholder: '', when: [] }; else delete q.followUp; mark(); buildFu(); };
      const l = el('label', 'check'); l.append(on, document.createTextNode(' Ask a follow-up question for some answers')); fuBox.append(l);
      if (!q.followUp) return;
      q.followUp.when = (q.followUp.when || []).filter((o) => q.options.includes(o));
      const fu = q.followUp, box = el('div', 'fuinner');
      box.append(field('Follow-up wording', area(fu.label, 2, 300, (v) => (fu.label = v))), field('Hint inside the box (optional)', textInput(fu.placeholder, '', 150, (v) => (fu.placeholder = v))));
      const w = el('div', 'when'); w.append(el('span', '', 'Show it when the answer is:'));
      q.options.forEach((o) => {
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = fu.when.includes(o);
        cb.onchange = () => { fu.when = q.options.filter((x) => (x === o ? cb.checked : fu.when.includes(x))); mark(); };
        const lb = el('label', 'check'); lb.append(cb, document.createTextNode(' ' + o)); w.append(lb);
      });
      box.append(w); fuBox.append(box);
    };
    const opts = area((q.options || []).join('\n'), 4, 700, (v) => (q.options = v.split('\n').map((x) => x.trim()).filter(Boolean)));
    opts.onchange = () => buildFu();
    c.append(field('Choices (one per line)', opts), fuBox); buildFu();
  }
  return c;
}

function render() {
  const box = $('#qs'); box.textContent = '';
  S.questions.forEach((q, i) => box.append(card(q, i)));
}

function load(j) {
  S = j.survey; dirty = false;
  $('#banner').textContent = j.count
    ? `${j.count} response${j.count === 1 ? '' : 's'} so far. Changing wording keeps existing answers. Deleted questions stay in the results and CSV marked “(removed)”.`
    : 'No responses yet, so you can change anything freely.';
  buildMeta(); render(); status('');
}

$('#add').onclick = () => { S.questions.push({ type: 'text', label: '', required: false }); mark(); render(); const qs = document.querySelectorAll('.q textarea'); qs[qs.length - 1].focus(); };
$('#save').onclick = async () => {
  $('#save').disabled = true; status('Saving…');
  try { const j = await api('PUT', `/api/admin/survey/${slug}`, S); load(j); status('Saved ✓ ' + new Date().toLocaleTimeString(), 'ok'); }
  catch (e) { status(e.message, 'bad'); }
  $('#save').disabled = false;
};
$('#del').onclick = async () => {
  if (!confirm('Delete this whole survey? Its link and QR code will stop working.')) return;
  try { await api('DELETE', `/api/admin/survey/${slug}`); dirty = false; location.href = '/admin'; } catch (e) { status(e.message, 'bad'); }
};
api('GET', `/api/admin/survey/${slug}`).then(load).catch((e) => status(e.message, 'bad'));
