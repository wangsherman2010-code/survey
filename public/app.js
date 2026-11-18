const $ = (s) => document.querySelector(s);
const answers = {};
let survey;
const el = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.textContent = h; return e; };

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
    } else if (q.type === 'choice') {
      const row = el('div', 'choices');
      q.options.forEach((o) => { const b = el('button', 'chip', o); b.type = 'button';
        b.onclick = () => { answers[q.id] = o; [...row.children].forEach((x) => x.classList.toggle('on', x === b));
          if (q.followUp) { const show = q.followUp.when.includes(o); fu.hidden = !show; if (!show) { answers[q.followUp.id] = ''; fu.querySelector('textarea').value = ''; } } }; row.append(b); });
      c.append(row);
      var fu = el('div', 'followup'); fu.hidden = true;
      if (q.followUp) { fu.append(el('h4', '', q.followUp.label)); const ft = el('textarea'); ft.rows = q.rows || 4; ft.maxLength = 2000; ft.placeholder = q.followUp.placeholder || '';
        ft.oninput = () => (answers[q.followUp.id] = ft.value); fu.append(ft); c.append(fu); }
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
  const missing = survey.questions.find((q) => q.required && !answers[q.id]);
  if (missing) { const c = document.querySelector(`[data-id=${missing.id}]`); c.classList.add('bad'); c.scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#err').textContent = 'Please answer the highlighted question.'; return; }
  $('#go').disabled = true;
  const anonymous = $('#anon').checked;
  const r = await fetch(`/api/submit/${slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answers, anonymous, name: anonymous ? '' : $('#name').value }) });
  if (r.ok) { $('#f').hidden = true; $('#done').hidden = false; window.scrollTo(0, 0); }
  else { $('#err').textContent = (await r.json()).error || 'Something went wrong. Please try again.'; $('#go').disabled = false; }
};
