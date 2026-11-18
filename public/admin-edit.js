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
    field('Survey title', textInput(S.title, '', 120, (v) => { S.title = v; const h = document.querySelector('.pv h4'); if (h) h.textContent = v || 'Your survey title'; })),
    field('Intro text (shown under the title)', area(S.subtitle, 2, 500, (v) => (S.subtitle = v))),
    field('Thank-you message (shown after submitting)', area(S.thanks, 2, 300, (v) => (S.thanks = v))),
  );
}

const TH = window.SurveyTheme;
const COLOUR_LABELS = { bg: 'Page background', card: 'Question cards', ink: 'Text', accent: 'Buttons & selected answers', heading: 'Title' };
function buildTheme() {
  const box = $('#theme'); box.textContent = '';
  box.append(el('h3', '', 'Colours'), el('p', 'muted', 'Choose a look for the page your audience sees. Pick a preset, then fine-tune any colour.'));
  const cur = () => TH.full(S.theme);
  const presets = el('div', 'presets');
  TH.PRESETS.forEach((pr) => {
    const b = el('button', 'preset'); b.type = 'button';
    const c = TH.full(pr.theme), sw = el('span', 'sw');
    [c.bg, c.accent, c.heading].forEach((x) => { const i = el('i'); i.style.background = x; sw.append(i); });
    b.append(sw, document.createTextNode(pr.name));
    const same = pr.theme ? S.theme && TH.KEYS.every((k) => (S.theme[k] || '').toLowerCase() === pr.theme[k]) : !S.theme;
    if (same) b.classList.add('on');
    b.onclick = () => { if (pr.theme) S.theme = { ...pr.theme }; else delete S.theme; mark(); buildTheme(); };
    presets.append(b);
  });
  box.append(presets);
  const grid = el('div', 'pickers');
  TH.KEYS.forEach((k) => {
    const i = el('input'); i.type = 'color'; i.value = cur()[k];
    i.oninput = () => { S.theme = { ...cur(), [k]: i.value }; mark(); paint(); presets.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); };
    const l = el('label', 'pick'); l.append(i, document.createTextNode(COLOUR_LABELS[k])); grid.append(l);
  });
  box.append(grid);
  const warns = el('p', 'warns');
  const pv = el('div', 'pv');
  pv.innerHTML = '<h4></h4><div class="pc"><p>How easy was the flow of the speech to follow?</p><div class="pchips"><span class="on">Easy</span><span>Moderate</span><span>Hard</span></div></div><div class="pb">Submit feedback</div>';
  pv.querySelector('h4').textContent = S.title || 'Your survey title';
  box.append(warns, el('p', 'muted', 'Preview'), pv);
  function paint() {
    const v = TH.themeVars(cur()), c = cur(), w = [];
    Object.entries(v).forEach(([k, x]) => k.startsWith('--') && pv.style.setProperty(k, x));
    if (TH.contrast(c.ink, c.card) < 4.5 || TH.contrast(c.ink, c.bg) < 4.5) w.push('The text colour may be hard to read on the background or cards.');
    if (TH.contrast(c.heading, c.bg) < 3) w.push('The title colour may be hard to see on the page background.');
    if (TH.contrast(c.accent, c.card) < 3) w.push('The button colour may be hard to see against the cards.');
    warns.textContent = w.join(' ');
  }
  paint();
}

const swap = (i, j) => { [S.questions[i], S.questions[j]] = [S.questions[j], S.questions[i]]; mark(); render(); };
const TYPE_NAMES = { text: 'Typed answer', choice: 'Choose one (e.g. Easy / Moderate / Hard)', multi: 'Choose several (tick all that apply)', rating: 'Rating 1–5' };

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
    if ((q.type === 'choice' || q.type === 'multi') && !q.options) q.options = ['Option 1', 'Option 2'];
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
  if (q.type === 'choice' || q.type === 'multi') {
    const isChoice = q.type === 'choice';
    const fuBox = el('div', 'fubox');
    const buildFu = () => {
      fuBox.textContent = '';
      const on = el('input'); on.type = 'checkbox'; on.checked = !!q.followUp;
      on.onchange = () => { if (on.checked) q.followUp = { type: 'text', label: '', placeholder: '', when: [] }; else delete q.followUp; mark(); buildFu(); };
      const l = el('label', 'check'); l.append(on, document.createTextNode(' Ask a follow-up question for some answers')); fuBox.append(l);
      if (!q.followUp) return;
      q.followUp.when = (q.followUp.when || []).filter((o) => q.options.includes(o));
      const fu = q.followUp, box = el('div', 'fuinner');
      fu.type = fu.type === 'choice' ? 'choice' : 'text';
      const ftype = el('select');
      [['text', 'Typed answer'], ['choice', 'Choose one']].forEach(([k, v]) => { const o = el('option', '', v); o.value = k; ftype.append(o); });
      ftype.value = fu.type;
      ftype.onchange = () => { fu.type = ftype.value; if (fu.type === 'choice' && !fu.options) fu.options = ['Option 1', 'Option 2']; mark(); buildFu(); };
      box.append(field('Follow-up wording', area(fu.label, 2, 300, (v) => (fu.label = v))), field('Follow-up answer type', ftype));
      if (fu.type === 'choice') box.append(field('Follow-up choices (one per line)', area((fu.options || []).join('\n'), 4, 700, (v) => (fu.options = v.split('\n').map((x) => x.trim()).filter(Boolean)))));
      else box.append(field('Hint inside the box (optional)', textInput(fu.placeholder, '', 150, (v) => (fu.placeholder = v))));
      const w = el('div', 'when'); w.append(el('span', '', 'Show it when the answer is:'));
      q.options.forEach((o) => {
        const cb = el('input'); cb.type = 'checkbox'; cb.checked = fu.when.includes(o);
        cb.onchange = () => { fu.when = q.options.filter((x) => (x === o ? cb.checked : fu.when.includes(x))); mark(); };
        const lb = el('label', 'check'); lb.append(cb, document.createTextNode(' ' + o)); w.append(lb);
      });
      box.append(w); fuBox.append(box);
    };
    const opts = area((q.options || []).join('\n'), 4, 700, (v) => (q.options = v.split('\n').map((x) => x.trim()).filter(Boolean)));
    opts.onchange = () => isChoice && buildFu();
    c.append(field('Choices (one per line)', opts)); if (isChoice) { c.append(fuBox); buildFu(); }
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
  buildMeta(); buildTheme(); render(); status('');
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
