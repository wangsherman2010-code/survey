const $ = (s) => document.querySelector(s);
let slugTouched = false;
const slugify = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const prev = () => ($('#slugPrev').textContent = $('#nSlug').value || '…');
$('#nTitle').oninput = (e) => { if (!slugTouched) $('#nSlug').value = slugify(e.target.value); prev(); };
$('#nSlug').oninput = () => { slugTouched = true; prev(); };
$('#newForm').onsubmit = async (e) => {
  e.preventDefault(); $('#nErr').textContent = '';
  const r = await fetch('/api/admin/surveys', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: $('#nTitle').value, slug: $('#nSlug').value, copyFrom: $('#nFrom').value || undefined }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok) location.href = `/admin/s/${j.slug}/edit`; else $('#nErr').textContent = j.error || 'Could not create the survey.';
};
