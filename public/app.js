const $ = (s) => document.querySelector(s);
const answers = {};
let survey;
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.textContent = h; return e; };

// Buttons for a choose-one or choose-several definition (a question or a follow-up).
// onChange gets a string (choose one) or an array in option order (choose several).
function choiceControl(def, card, onChange) {
  const multi = def.type === 'multi', row = el('div', 'choices'), picked = new Set();
  if (multi) card.append(el('p', 'hint', 'Select all that apply'));
  def.options.forEach((o) => {
    const b = el('button', 'chip', o); b.type = 'button'; b.setAttribute('aria-pressed', 'false');
    b.onclick = () => {
      if (multi) { picked.has(o) ? picked.delete(o) : picked.add(o); b.classList.toggle('on', picked.has(o)); }
      else { picked.clear(); picked.add(o); [...row.children].forEach((x) => x.classList.toggle('on', x === b)); }
      [...row.children].forEach((x) => x.setAttribute('aria-pressed', String(x.classList.contains('on'))));
      onChange(multi ? def.options.filter((x) => picked.has(x)) : o);
    };
    row.append(b);
  });
  row._clear = () => { picked.clear(); [...row.children].forEach((x) => { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }); };
  return row;
}

// Follow-up question under a card: hidden until one of the answers in `when` is given.
// Returns update(selectedAnswers), called whenever the main answer changes.
function followUpControl(f, card) {
  const box = el('div', 'followup'); box.hidden = true; box.append(el('h4', '', f.label));
  let reset = () => {};
  if (f.type === 'choice' || f.type === 'multi') {
    const row = choiceControl(f, box, (value) => (answers[f.id] = value)); box.append(row); reset = row._clear;
  } else {
    const t = el('textarea'); t.rows = 4; t.maxLength = 2000; t.placeholder = f.placeholder || '';
    t.oninput = () => (answers[f.id] = t.value); box.append(t); reset = () => (t.value = '');
  }
  card.append(box);
  return (selected) => {
    const show = selected.some((x) => f.when.includes(x));
    box.hidden = !show;
    if (!show) { answers[f.id] = ''; reset(); }
  };
}

const slug = location.pathname.split('/')[2];
fetch(`/api/survey/${slug}`).then((r) => r.json()).then((s) => {
  survey = s;
  document.title = s.title; $('#title').textContent = s.title; $('#subtitle').textContent = s.subtitle; $('#thanks').textContent = s.thanks;
  $('#reqnote').hidden = !s.questions.some((q) => q.required);
  s.questions.forEach((q, i) => {
    const c = el('section', 'card'); c.dataset.id = q.id;
    const h = el('h3', '', `${i + 1}. ${q.label}`);
    if (q.required) { const star = el('span', 'star', '\u00a0*'); star.setAttribute('aria-label', 'required'); star.title = 'Required'; h.append(star); }
    c.append(h);
    if (q.type === 'rating') {
      const row = el('div', 'rating');
      for (let n = 1; n <= 5; n++) { const b = el('button', 'dot', n); b.type = 'button'; b.setAttribute('aria-label', `${n} of 5`);
        b.onclick = () => { answers[q.id] = n; [...row.children].forEach((x, k) => x.classList.toggle('on', k + 1 === n)); }; row.append(b); }
      c.append(row); const l = el('div', 'ends'); l.append(el('span', '', q.low || ''), el('span', '', q.high || '')); c.append(l);
    } else if (q.type === 'multi' || q.type === 'choice') {
      let update = () => {};
      const sel = choiceControl(q, c, (value) => { answers[q.id] = value; update(Array.isArray(value) ? value : [value]); });
      c.append(sel);
      if (q.followUp) update = followUpControl(q.followUp, c);
    } else {
      const t = el('textarea'); t.rows = q.rows || 4; t.maxLength = 2000; t.placeholder = q.placeholder || '';
      t.oninput = () => (answers[q.id] = t.value); c.append(t);
    }
    $('#qs').append(c);
  });
});

$('#anon').onchange = (e) => { $('#nameWrap').hidden = e.target.checked; if (e.target.checked) $('#name').value = ''; };

$('#f').onsubmit = async (e) => {
  e.preventDefault(); $('#err').textContent = '';
  document.querySelectorAll('.card.bad').forEach((c) => c.classList.remove('bad'));
  const missing = survey.questions.find((q) => q.required && !(Array.isArray(answers[q.id]) ? answers[q.id].length : answers[q.id]));
  if (missing) { const c = document.querySelector(`[data-id=${missing.id}]`); c.classList.add('bad'); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#err').textContent = 'Please answer the highlighted question.'; return; }
  $('#go').disabled = true;
  const anonymous = $('#anon').checked;
  const r = await fetch(`/api/submit/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, anonymous, name: anonymous ? '' : $('#name').value }) });
  if (r.ok) { $('#f').hidden = true; $('#done').hidden = false; window.scrollTo(0, 0); }
  else { $('#err').textContent = (await r.json()).error || 'Something went wrong. Please try again.'; $('#go').disabled = false; }
};
