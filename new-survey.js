// Usage: node new-survey.js <slug> "<Title>"   -> creates surveys/<slug>.json (copy of speech.json, then edit it)
const fs = require('fs'), path = require('path');
const [slug, title] = process.argv.slice(2);
if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug || '')) { console.error('Slug: lowercase letters, numbers, hyphens. e.g. march-speech'); process.exit(1); }
const dest = path.join(__dirname, 'surveys', slug + '.json');
if (fs.existsSync(dest)) { console.error('Already exists: ' + dest); process.exit(1); }
const s = JSON.parse(fs.readFileSync(path.join(__dirname, 'surveys', 'speech.json'), 'utf8'));
s.title = title || slug;
fs.writeFileSync(dest, JSON.stringify(s, null, 2) + '\n');
console.log(`Created ${dest}\nEdit the questions, restart the server, then share /s/${slug}`);
