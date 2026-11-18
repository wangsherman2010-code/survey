// Shared by the server (injects colours into the survey page) and the editor (live preview).
(function (root) {
  var DEFAULT = { bg: '#f4f1ec', card: '#ffffff', ink: '#1f2430', accent: '#c8553d', heading: '#2b4162' };
  var KEYS = Object.keys(DEFAULT);
  var PRESETS = [
    { name: 'Warm (default)', theme: null },
    { name: 'Toastmasters', theme: { bg: '#f3f5f7', card: '#ffffff', ink: '#1b2a35', accent: '#772432', heading: '#004165' } },
    { name: 'Ocean', theme: { bg: '#eef5f8', card: '#ffffff', ink: '#12303b', accent: '#0b7a9e', heading: '#0b3c5d' } },
    { name: 'Forest', theme: { bg: '#eff4ee', card: '#ffffff', ink: '#1d2b20', accent: '#2f7d4f', heading: '#1f4d33' } },
    { name: 'Plum', theme: { bg: '#f6f0f6', card: '#ffffff', ink: '#2a1f2e', accent: '#8e3b8e', heading: '#4a2250' } },
    { name: 'Midnight', theme: { bg: '#12151c', card: '#1c2029', ink: '#eceff4', accent: '#f08a4b', heading: '#ffffff' } },
  ];
  var isHex = function (v) { return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v); };
  var rgb = function (h) { return [1, 3, 5].map(function (i) { return parseInt(h.substr(i, 2), 16); }); };
  var hex = function (c) { return '#' + c.map(function (v) { return Math.round(v).toString(16).padStart(2, '0'); }).join(''); };
  var mix = function (a, b, t) { var x = rgb(a), y = rgb(b); return hex(x.map(function (v, i) { return v * t + y[i] * (1 - t); })); };
  var lum = function (h) {
    var c = rgb(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  var contrast = function (a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  // complete a (possibly partial / invalid) theme with defaults
  var full = function (t) { var o = {}; KEYS.forEach(function (k) { o[k] = t && isHex(t[k]) ? t[k].toLowerCase() : DEFAULT[k]; }); return o; };
  var onAccent = function (accent) { return contrast(accent, '#ffffff') >= contrast(accent, '#1f2430') ? '#ffffff' : '#1f2430'; };
  // CSS variables for a theme (null when the survey uses the default look)
  var themeVars = function (t) {
    if (!t || typeof t !== 'object') return null;
    var c = full(t);
    return {
      '--bg': c.bg, '--card': c.card, '--ink': c.ink, '--muted': mix(c.ink, c.card, 0.6), '--line': mix(c.ink, c.card, 0.15),
      '--accent': c.accent, '--accent2': c.heading, '--heading': c.heading, '--on-accent': onAccent(c.accent),
      'color-scheme': lum(c.bg) < 0.25 ? 'dark' : 'light',
    };
  };
  var api = { DEFAULT: DEFAULT, KEYS: KEYS, PRESETS: PRESETS, isHex: isHex, full: full, contrast: contrast, themeVars: themeVars };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SurveyTheme = api;
})(this);
