#!/usr/bin/env node
// Zero-dependency static site generator.
// Usage: node build.js [--base /~userid] [--url https://host/~userid] [--out dist]
'use strict';
const fs = require('fs');
const path = require('path');
const { loadSnapshots, renderFigure } = require('./lib/figure.js');

const ROOT = __dirname;
const args = parseArgs(process.argv.slice(2));
const config = readJSON('site.config.json');
const BASE = (args.base ?? config.basePath ?? '').replace(/\/$/, '');
const SITE_URL = (args.url ?? config.url).replace(/\/$/, '');
const OUT = path.resolve(ROOT, args.out ?? 'dist');
const NOW = new Date();

const FONTS = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,300..600;1,6..72,300..500&display=swap';

const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
  moon: '<svg class="i-moon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M20 14.6A8.5 8.5 0 0 1 9.4 4 8.5 8.5 0 1 0 20 14.6Z"/></svg>',
  sun: '<svg class="i-sun" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>',
  arrow: '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 10h13M11.5 5l5 5-5 5"/></svg>',
  chevron: '<svg viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3 4.5 3 3 3-3"/></svg>',
  download: '<svg viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12"/></svg>',
};

// ---------- data ----------
const profile = readJSON('content/profile.json');
const papers = readJSON('content/papers.json').sort((a, b) => b.year - a.year);
const cv = readJSON('content/cv.json');
const software = fs.readdirSync(path.join(ROOT, 'content/software'))
  .filter(f => f.endsWith('.json'))
  .map(f => readJSON(path.join('content/software', f)))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
const notes = fs.readdirSync(path.join(ROOT, 'content/notes'))
  .filter(f => f.endsWith('.md'))
  .map(f => parseNote(f))
  .sort((a, b) => b.date.localeCompare(a.date));

// ---------- build ----------
rmrf(OUT);
fs.mkdirSync(OUT, { recursive: true });
copyDir(path.join(ROOT, 'assets'), path.join(OUT, 'assets'));

write('index.html', pageHome());
write('software/index.html', pageSoftwareIndex());
for (const s of software) {
  write(`software/${s.slug}/index.html`, pageSoftware(s));
  for (const d of appDocs(s)) write(`software/${s.slug}/${d.key}/index.html`, pageAppDoc(s, d));
}
write('papers/index.html', pagePapers());
write('cv/index.html', pageCV());
write('notes/index.html', pageNotesIndex());
for (const n of notes) write(`notes/${n.slug}/index.html`, pageNote(n));
write('search/index.html', pageSearch());
write('404.html', page404());
write('search.json', JSON.stringify(searchIndex()));
write('feed.xml', feed());
write('sitemap.xml', sitemap());
write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}${BASE}/sitemap.xml\n`);
write('.nojekyll', '');
if (config.customDomain) write('CNAME', config.customDomain + '\n');
console.log(`Built ${software.length} apps, ${papers.length} papers, ${notes.length} notes → ${path.relative(ROOT, OUT)}/ (base "${BASE || '/'}", url ${SITE_URL})`);

// ---------- pages ----------
function pageHome() {
  const featured = profile.featuredSoftware.map(slug => software.find(s => s.slug === slug)).filter(Boolean);
  const recent = papers.slice(0, 3);
  const about = `
<div class="prose">${profile.bio.map(p => `<p>${esc(p)}</p>`).join('')}</div>
<dl class="facts">
  <div><dt>Now</dt><dd>${esc(profile.nowText)}</dd></div>
  <div><dt>Interests</dt><dd><ul>${profile.interests.map(i => `<li>${esc(i)}</li>`).join('')}</ul></dd></div>
  <div><dt>Tools</dt><dd>${profile.skills.map(esc).join(', ')}</dd></div>
</dl>
${more('cv/', 'Curriculum vitae')}`;

  const body = `
<section class="intro" aria-labelledby="name">
  <p class="kicker reveal">${esc(config.author.department)} <span class="sep" aria-hidden="true">/</span> ${esc(config.author.affiliation)}</p>
  <h1 id="name" class="display reveal" style="--d:1">${esc(config.author.name)}</h1>
  <div class="head-body">
    <p class="lede reveal" style="--d:2">${esc(profile.headline)}</p>
    <p class="links reveal" style="--d:3">${profileLinks()}</p>
  </div>
</section>
${figureOne()}
${numbered([
    featured.length && { label: 'Software', body: `<ul class="apps">${featured.map(appRow).join('')}</ul>${more('software/', 'All software')}` },
    recent.length && { label: 'Research', body: `<ol class="papers">${recent.map(paperItem).join('')}</ol>${more('papers/', 'All papers')}` },
    { label: 'About', body: about },
  ])}`;
  return layout({ title: config.title, description: config.description, path: '', body, jsonld: personJsonLd() });
}

// Fig. 1: Kelvin–Helmholtz billows from the simulation snapshot in lib/figure-data (see scripts/simulate-kh.js).
function figureOne() {
  const sim = loadSnapshots(path.join(ROOT, 'lib/figure-data/kh-billows.json'));
  const snap = sim.snapshots[0];
  const { svg } = renderFigure(sim, snap);
  const P = sim.params;
  const num = v => String(v);
  const frac = (top, bottom) => `<span class="frac"><span>${top}</span><span>${bottom}</span></span>`;
  const u = '<b>u</b>';
  const equations = [
    [`∂u/∂t + (u·∇)u = −∇p + Ri θ e_z + (1/Re) ∇²u`,
      `${frac(`∂${u}`, '∂<i>t</i>')} + (${u}·∇)${u} = −∇<i>p</i> + <i>Ri</i>&thinsp;<i>θ</i>&thinsp;<b>e</b><sub><i>z</i></sub> + ${frac('1', '<i>Re</i>')}&thinsp;∇<sup>2</sup>${u}`],
    [`∇·u = 0`, `∇·${u} = 0`],
    [`∂θ/∂t + u·∇θ = (1/(Re Pr)) ∇²θ`,
      `${frac('∂<i>θ</i>', '∂<i>t</i>')} + ${u}·∇<i>θ</i> = ${frac('1', '<i>Re</i>&thinsp;<i>Pr</i>')}&thinsp;∇<sup>2</sup><i>θ</i>`],
  ];
  return `
<figure class="figure reveal" style="--d:3">
  <div class="figure-band">${svg}</div>
  <figcaption>
    <div class="figure-text">
      <p><span class="fig-num">Fig. 1</span>Kelvin–Helmholtz billows in a stably stratified shear layer, one of the shear instabilities that produce bursts of intermittent turbulence in the night-time atmospheric boundary layer. The lines are isentropes from a two-dimensional direct numerical simulation of the Boussinesq Navier–Stokes equations, at <i>Re</i> = ${num(P.Re)}, <i>Pr</i> = ${num(P.Pr)} and <i>Ri</i> = ${num(P.Ri)}, shown at <i>t</i> = ${num(snap.t)}. The dots follow instantaneous streamlines at the local flow speed.</p>
      <div class="equations" role="group" aria-label="Governing equations">
        ${equations.map(([text, html], k) => `<div class="eq"><span class="eq-body" role="img" aria-label="${esc(text)}">${html}</span><span class="eq-num" aria-hidden="true">(${k + 1})</span></div>`).join('\n        ')}
      </div>
    </div>
  </figcaption>
</figure>`;
}

function pageSoftwareIndex() {
  const counts = new Map();
  for (const s of software) for (const p of s.platforms) counts.set(p, (counts.get(p) || 0) + 1);
  const rank = p => { const i = ['macOS', 'iOS', 'watchOS', 'Android', 'Web'].indexOf(p); return i < 0 ? 99 : i; };
  const platforms = [...counts.keys()].sort((a, b) => rank(a) - rank(b));
  const filter = (value, label, n, pressed) =>
    `<button class="filter" type="button" data-filter="${esc(value)}" aria-pressed="${pressed}">${esc(label)}<span class="count">${n}</span></button>`;

  const body = `
<header class="head">
  <p class="kicker reveal">${software.length ? `${software.length} app${software.length === 1 ? '' : 's'} <span class="sep" aria-hidden="true">/</span> Free to use` : 'Catalogue'}</p>
  <h1 class="title reveal" style="--d:1">Software</h1>
  <div class="head-body">
    <p class="lede reveal" style="--d:2">Apps for Mac, iPhone, Apple Watch and Android, and tools for engineering simulation. Every one is free to use; the source code stays private.</p>
    ${software.length ? `<div class="filters reveal" style="--d:3" role="group" aria-label="Filter by platform" data-filter-group>
      ${filter('all', 'All', software.length, true)}
      ${platforms.map(p => filter(p, p, counts.get(p), false)).join('')}
    </div>` : ''}
  </div>
</header>
${software.length
    ? section({ label: 'All apps', body: `<ul class="apps" data-filter-target>${software.map(appRow).join('')}</ul>` })
    : section({ label: 'All apps', body: `<p class="empty">Nothing published yet. Releases will be listed here.</p>` })}`;
  return layout({ title: 'Software', description: 'Free apps and tools by ' + config.author.name, path: 'software/', body });
}

function pageSoftware(s) {
  // A download with no explicit url falls back to the app's GitHub releases page when one is
  // configured ("releases": "owner/repo"), and otherwise renders as a disabled "coming soon".
  const releasesUrl = s.releases ? `https://github.com/${s.releases}/releases/latest` : '';
  const downloads = s.downloads.map(d => {
    const href = d.url || releasesUrl;
    return href
      ? `<div class="dl"><a class="button" href="${esc(href)}">${ICON.download}${esc(d.label)}</a>${d.note ? `<span class="dl-note">${esc(d.note)}</span>` : ''}</div>`
      : `<div class="dl"><span class="button button--soon" aria-disabled="true">${esc(d.label)}</span><span class="dl-note">Coming soon${d.note ? ` · ${esc(d.note)}` : ''}</span></div>`;
  }).join('');
  const links = s.links.filter(l => l.url).map(l => `<div class="dl"><a class="button button--ghost" href="${esc(l.url)}">${esc(l.label)}</a></div>`).join('');
  const shots = s.screenshots.length
    ? `<div class="shots-row"><div class="shots">${s.screenshots.map(p => `<img src="${url(p)}" alt="${esc(s.name)} screenshot" loading="lazy" decoding="async">`).join('')}</div></div>`
    : '';
  const repo = s.githubRepo || s.releases;

  const body = `
<article>
  <header class="app-hero">
    <span class="icon icon--${esc(s.iconShape || 'macos')} app-hero-icon reveal"><img src="${url(s.icon)}" alt="" width="248" height="248"></span>
    <div class="app-hero-text">
      <p class="kicker reveal"><a href="${url('software/')}">Software</a><span class="sep" aria-hidden="true">/</span>${esc(s.platforms.join(' · '))}</p>
      <h1 class="title reveal" style="--d:1">${esc(s.name)}</h1>
      <p class="lede reveal" style="--d:2">${esc(s.tagline)}</p>
      <div class="downloads reveal" style="--d:3">${downloads}${links}</div>
      ${repo ? `<p class="release-meta" data-gh-repo="${esc(repo)}"></p>` : ''}
    </div>
  </header>
  ${shots}
  <section class="sec app-body" aria-label="About ${esc(s.name)}">
    <dl class="details">
      <div><dt>Status</dt><dd>${statusLabel(s.status)}</dd></div>
      <div><dt>Platforms</dt><dd>${esc(s.platforms.join(', '))}</dd></div>
      <div><dt>Year</dt><dd>${esc(String(s.year))}</dd></div>
      <div><dt>Built with</dt><dd>${esc(s.tech.join(', '))}</dd></div>
      <div><dt>Topics</dt><dd>${esc(s.tags.join(', '))}</dd></div>
    </dl>
    <div class="sec-body">
      <div class="prose">${md(s.description)}</div>
      <h2 class="subhead">Features</h2>
      <ul class="features">${s.features.map(f => `<li>${inline(f)}</li>`).join('')}</ul>
      <p class="feedback">Found a bug or have an idea? <a href="mailto:${esc(config.author.email)}?subject=${encodeURIComponent(s.name + ' feedback')}">Write to me</a>.</p>
      ${appDocs(s).length ? `<p class="feedback">${appDocs(s).map(d => `<a href="${url(`software/${s.slug}/${d.key}/`)}">${esc(d.title)}</a>`).join(' · ')}</p>` : ''}
    </div>
  </section>
</article>`;
  return layout({ title: s.name, description: s.tagline, path: `software/${s.slug}/`, body, image: s.icon, jsonld: softwareJsonLd(s) });
}

// Optional per-app documents: content/software/<slug>/privacy.md and support.md
// (App Store listings need a privacy policy URL and a support URL).
function appDocs(s) {
  const kinds = [['support', 'Support'], ['privacy', 'Privacy Policy']];
  return kinds.map(([key, title]) => {
    const file = path.join(ROOT, 'content/software', s.slug, `${key}.md`);
    return fs.existsSync(file) ? { key, title, body: fs.readFileSync(file, 'utf8') } : null;
  }).filter(Boolean);
}

function pageAppDoc(s, d) {
  const body = `
<article>
  <header class="head">
    <p class="kicker reveal"><a href="${url('software/')}">Software</a><span class="sep" aria-hidden="true">/</span><a href="${url(`software/${s.slug}/`)}">${esc(s.name)}</a></p>
    <h1 class="title reveal" style="--d:1">${esc(d.title)}</h1>
  </header>
  ${section({ label: s.name, body: `<div class="prose">${md(d.body)}</div>` })}
</article>`;
  return layout({ title: `${d.title} · ${s.name}`, description: `${d.title} for ${s.name}`, path: `software/${s.slug}/${d.key}/`, body });
}

function pagePapers() {
  const groups = [['journal', 'Journal articles'], ['conference', 'Conference talks'], ['thesis', 'Thesis']];
  const body = `
<header class="head">
  <p class="kicker reveal">Research</p>
  <h1 class="title reveal" style="--d:1">Papers</h1>
  <div class="head-body">
    <p class="lede reveal" style="--d:2">Flexible fibers settling through viscous flow, and turbulence in the stable atmospheric boundary layer. Every entry carries a BibTeX record.</p>
    <p class="links reveal" style="--d:3">${profileLinks(['scholar', 'researchgate', 'orcid'])}</p>
  </div>
</header>
${groups.map(([type, label]) => {
    const items = papers.filter(p => p.type === type);
    return items.length ? section({ label, body: `<ol class="papers">${items.map(paperItem).join('')}</ol>` }) : '';
  }).join('')}`;
  return layout({ title: 'Papers', description: 'Publications by ' + config.author.name, path: 'papers/', body, jsonld: papers.map(paperJsonLd) });
}

function pageCV() {
  const item = it => `
<div class="cv-item">
  <div class="cv-head"><h3 class="cv-title">${esc(it.title)}</h3>${it.period ? `<span class="cv-period">${esc(it.period)}</span>` : ''}</div>
  ${it.org ? `<p class="cv-org">${esc(it.org)}</p>` : ''}
  ${it.detail ? `<p class="cv-detail">${esc(it.detail)}</p>` : ''}
</div>`;
  const body = `
<header class="head">
  <p class="kicker reveal">${esc(config.author.legalName)} <span class="sep" aria-hidden="true">/</span> Preferred name ${esc(config.author.name.split(' ')[0])}</p>
  <h1 class="title reveal" style="--d:1">Curriculum vitae</h1>
  <div class="head-body">
    <p class="lede reveal" style="--d:2">Applied mathematics and mechanical engineering, from fiber suspensions to the atmospheric boundary layer.</p>
    <div class="downloads reveal" style="--d:3"><div class="dl"><a class="button" href="${url(cv.pdf)}">${ICON.download}Download PDF</a></div></div>
  </div>
</header>
${cv.sections
    .map(sec => ({ ...sec, items: sec.items.filter(it => it.title || it.org || it.detail || it.period) }))
    .filter(sec => sec.items.length)
    .map(sec => section({ label: sec.title, body: `<div class="cv">${sec.items.map(item).join('')}</div>` }))
    .join('') || section({ label: 'Sections', body: `<p class="empty">The CV is not filled in yet. The PDF above is the current version.</p>` })}`;
  return layout({ title: 'CV', description: 'Curriculum vitae of ' + config.author.name, path: 'cv/', body });
}

function pageNotesIndex() {
  const row = n => `
<li class="note-row"><a href="${url(`notes/${n.slug}/`)}">
  <time class="note-date" datetime="${esc(n.date)}">${fmtDate(n.date)}</time>
  <span><span class="note-title">${esc(n.title)}</span><span class="note-summary">${esc(n.summary)}</span></span>
</a></li>`;
  const body = `
<header class="head">
  <p class="kicker reveal">Writing</p>
  <h1 class="title reveal" style="--d:1">Notes</h1>
  <div class="head-body">
    <p class="lede reveal" style="--d:2">Short write-ups on simulation, tooling and building apps.</p>
    <p class="links reveal" style="--d:3"><a href="${url('feed.xml')}">RSS feed</a></p>
  </div>
</header>
${section({ label: 'All notes', body: `<ol class="notes-list">${notes.map(row).join('')}</ol>` })}`;
  return layout({ title: 'Notes', description: 'Notes by ' + config.author.name, path: 'notes/', body });
}

function pageNote(n) {
  const body = `
<article>
  <header class="head">
    <p class="kicker reveal"><a href="${url('notes/')}">Notes</a><span class="sep" aria-hidden="true">/</span><time datetime="${esc(n.date)}">${fmtDate(n.date)}</time></p>
    <h1 class="title reveal" style="--d:1">${esc(n.title)}</h1>
    ${n.summary ? `<div class="head-body"><p class="lede reveal" style="--d:2">${esc(n.summary)}</p></div>` : ''}
  </header>
  ${section({ label: n.tags.length ? n.tags.join(' · ') : 'Note', body: `<div class="prose">${md(n.body)}</div>` })}
</article>`;
  return layout({ title: n.title, description: n.summary, path: `notes/${n.slug}/`, body });
}

function pageSearch() {
  const body = `
<header class="head">
  <p class="kicker reveal">Site index</p>
  <h1 class="title reveal" style="--d:1">Search</h1>
  <div class="head-body">
    <label class="visually-hidden" for="q">Search apps, papers and notes</label>
    <input id="q" class="search-input reveal" style="--d:2" type="search" placeholder="Apps, papers, notes…" autocomplete="off" spellcheck="false" autofocus>
    <ol id="results" class="results" aria-live="polite"></ol>
  </div>
</header>`;
  return layout({ title: 'Search', description: 'Search this site', path: 'search/', body });
}

function page404() {
  const body = `
<header class="head">
  <p class="kicker">Error 404</p>
  <h1 class="title">Page not found</h1>
  <div class="head-body"><p class="lede">The link may be out of date, or the page has moved. Try the <a href="${url('')}">home page</a> or <a href="${url('search/')}">search</a>.</p></div>
</header>`;
  return layout({ title: 'Not found', description: '', path: '404.html', body });
}

// ---------- components ----------
function numbered(entries) {
  return entries.filter(Boolean)
    .map((e, i) => section({ num: String(i + 1).padStart(2, '0'), label: e.label, body: e.body }))
    .join('');
}

function section({ num, label, body }) {
  return `
<section class="sec" aria-label="${esc(label)}">
  <h2 class="sec-label">${num ? `<span class="sec-num">${num}</span>` : ''}${esc(label)}</h2>
  <div class="sec-body">${body}</div>
</section>`;
}

function more(href, label) {
  return `<p class="more"><a href="${url(href)}">${esc(label)}${ICON.arrow}</a></p>`;
}

function appRow(s) {
  return `
<li class="app" data-platforms="${esc(s.platforms.join('|'))}">
  <a class="app-link" href="${url(`software/${s.slug}/`)}">
    <span class="icon icon--${esc(s.iconShape || 'macos')}"><img src="${url(s.icon)}" alt="" width="112" height="112" loading="lazy" decoding="async"></span>
    <span class="app-text"><span class="app-name">${esc(s.name)}</span><span class="app-tagline">${esc(s.tagline)}</span></span>
    <span class="app-meta"><span>${esc(s.platforms.join(' · '))}</span>${statusLabel(s.status)}</span>
    <span class="app-go">${ICON.arrow}</span>
  </a>
</li>`;
}

function statusLabel(s) { return `<span class="status status--${esc(s)}">${esc(cap(s))}</span>`; }

function paperItem(p) {
  const id = esc(p.id);
  const actions = [];
  if (p.doi) actions.push(`<a class="action" href="https://doi.org/${esc(p.doi)}">DOI</a>`);
  if (p.pdf) actions.push(`<a class="action" href="${url(p.pdf)}">PDF</a>`);
  for (const l of p.links || []) actions.push(`<a class="action" href="${esc(l.url)}">${esc(l.label)}</a>`);
  if (p.abstract) actions.push(`<button class="action" type="button" aria-expanded="false" aria-controls="abs-${id}">Abstract${ICON.chevron}</button>`);
  actions.push(`<button class="action" type="button" aria-expanded="false" aria-controls="bib-${id}">BibTeX${ICON.chevron}</button>`);
  const venue = [
    esc(p.venue),
    p.volume ? `${esc(p.volume)}${p.number ? `(${esc(p.number)})` : ''}` : '',
    p.pages ? esc(p.pages) : '',
  ].filter(Boolean).join(', ');
  const state = p.status && p.status !== 'published' ? `<span class="paper-state">${esc(cap(p.status))}</span>` : '';
  const authors = p.authors.map(a => isMe(a) ? `<span class="me">${esc(a)}</span>` : esc(a)).join(', ');
  return `
<li class="paper" id="${id}">
  <span class="paper-year">${p.year}</span>
  <div class="paper-main">
    <h3 class="paper-title">${esc(p.title)}</h3>
    <p class="paper-authors">${authors}</p>
    <p class="paper-venue">${state}${venue}</p>
    <p class="paper-actions">${actions.join('')}</p>
    ${p.abstract ? `<div class="panel" id="abs-${id}" hidden><p>${esc(p.abstract)}</p></div>` : ''}
    <div class="panel" id="bib-${id}" hidden><pre><code>${esc(bibtex(p))}</code></pre><button class="action" type="button" data-copy="#bib-${id} code">Copy BibTeX</button></div>
  </div>
</li>`;
}

function bibtex(p) {
  const b = p.bibtex || {};
  const type = b.entryType || (p.type === 'journal' ? 'article' : p.type === 'thesis' ? 'mastersthesis' : 'inproceedings');
  const fields = { title: `{${p.title}}`, author: p.authors.join(' and '), year: String(p.year) };
  if (type === 'article') { fields.journal = b.journal || p.venue; if (p.volume) fields.volume = p.volume; if (p.number) fields.number = p.number; if (p.pages) fields.pages = p.pages; }
  if (type === 'inproceedings') fields.booktitle = b.booktitle || p.venue;
  if (type === 'mastersthesis' || type === 'phdthesis') { fields.school = b.school || ''; if (b.address) fields.address = b.address; }
  if (p.doi) fields.doi = p.doi;
  if (p.status && p.status !== 'published') fields.note = cap(p.status);
  if (p.pdf || (p.links && p.links[0])) fields.url = p.doi ? `https://doi.org/${p.doi}` : (p.pdf ? `${SITE_URL}${url(p.pdf)}` : p.links[0].url);
  const w = Math.max(...Object.keys(fields).map(k => k.length));
  return `@${type}{${p.id},\n` + Object.entries(fields).filter(([, v]) => v).map(([k, v]) => `  ${k.padEnd(w)} = {${v}},`).join('\n') + '\n}';
}

function profileLinks(keys = ['github', 'scholar', 'linkedin', 'researchgate', 'orcid', 'email']) {
  const names = { github: 'GitHub', scholar: 'Google Scholar', linkedin: 'LinkedIn', researchgate: 'ResearchGate', orcid: 'ORCID', email: 'Email' };
  return keys
    .map(k => [names[k], k === 'email' ? (config.author.email ? `mailto:${config.author.email}` : '') : config.links[k]])
    .filter(([, u]) => u)
    .map(([n, u]) => `<a href="${esc(u)}">${n}</a>`)
    .join('');
}

function isMe(a) { return /sepahi/i.test(a); }

// ---------- layout ----------
function layout({ title, description, path: p, body, image, jsonld }) {
  const full = p === '' ? config.title : `${title} · ${config.title}`;
  const canonical = `${SITE_URL}${url(p === '404.html' ? '' : p)}`;
  const img = image ? `${SITE_URL}${url(image)}` : '';
  const nav = [['Software', 'software/'], ['Papers', 'papers/'], ['Notes', 'notes/'], ['CV', 'cv/']];
  const plausible = config.analytics?.plausibleDomain ? `<script defer data-domain="${esc(config.analytics.plausibleDomain)}" src="https://plausible.io/js/script.js"></script>` : '';
  return `<!doctype html>
<html lang="${esc(config.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description || config.description)}">
<meta name="author" content="${esc(config.author.name)}">
<meta name="theme-color" content="#f6f4ee" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#131210" media="(prefers-color-scheme: dark)">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description || config.description)}">
<meta property="og:url" content="${canonical}">
${img ? `<meta property="og:image" content="${img}">\n<meta name="twitter:card" content="summary">` : ''}
<link rel="icon" href="${url('assets/favicon.svg')}" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="${esc(config.title)} notes" href="${url('feed.xml')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="${url('assets/css/style.css')}">
<script>try{var t=localStorage.getItem('theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
${plausible}
</head>
<body data-base="${esc(BASE)}/">
<a class="skip" href="#main">Skip to content</a>
<div class="page">
  <header class="masthead">
    <a class="wordmark" href="${url('')}">${esc(config.author.name)}</a>
    <nav class="nav" aria-label="Main">${nav.map(([n, h]) => `<a href="${url(h)}"${p.startsWith(h) ? ' aria-current="page"' : ''}>${n}</a>`).join('')}</nav>
    <div class="tools">
      <a class="tool" href="${url('search/')}" aria-label="Search" title="Search">${ICON.search}</a>
      <button class="tool" id="theme" type="button" aria-label="Switch between light and dark" title="Switch theme">${ICON.moon}${ICON.sun}</button>
    </div>
  </header>
</div>
<main id="main" class="page">${body}</main>
<footer class="colophon">
  <div class="page colophon-grid">
    <p class="colophon-name">${esc(config.author.name)}</p>
    <div>
      <p class="links">${profileLinks()}<a href="${url('feed.xml')}">RSS</a></p>
      <p class="colophon-note">© ${NOW.getFullYear()} ${esc(config.author.name)}. The apps are free to use and their source is private. Set in Newsreader and IBM Plex, generated from plain JSON by a small Node script, and hosted on GitHub Pages.</p>
    </div>
  </div>
</footer>
<script src="${url('assets/js/main.js')}" defer></script>
</body>
</html>`;
}

// ---------- structured data / feeds ----------
function personJsonLd() {
  return {
    '@context': 'https://schema.org', '@type': 'Person', name: config.author.name, alternateName: config.author.legalName,
    url: SITE_URL + url(''), email: config.author.email, affiliation: { '@type': 'Organization', name: config.author.affiliation },
    sameAs: Object.values(config.links).filter(Boolean)
  };
}
function softwareJsonLd(s) {
  return { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: s.name, description: s.tagline, operatingSystem: s.platforms.join(', '), applicationCategory: 'UtilitiesApplication', author: { '@type': 'Person', name: config.author.name }, offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, image: SITE_URL + url(s.icon) };
}
function paperJsonLd(p) {
  const o = { '@context': 'https://schema.org', '@type': p.type === 'thesis' ? 'Thesis' : 'ScholarlyArticle', headline: p.title, author: p.authors.map(a => ({ '@type': 'Person', name: a })), datePublished: String(p.year) };
  if (p.doi) o.sameAs = `https://doi.org/${p.doi}`;
  if (p.pdf) o.url = SITE_URL + url(p.pdf);
  return o;
}
function feed() {
  const items = notes.map(n => `<item><title>${esc(n.title)}</title><link>${SITE_URL}${url(`notes/${n.slug}/`)}</link><guid>${SITE_URL}${url(`notes/${n.slug}/`)}</guid><pubDate>${new Date(n.date).toUTCString()}</pubDate><description>${esc(n.summary)}</description></item>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${esc(config.title)} — Notes</title><link>${SITE_URL}${url('')}</link><description>${esc(config.description)}</description>${items}</channel></rss>`;
}
function sitemap() {
  const urls = ['', 'software/', ...software.flatMap(s => [`software/${s.slug}/`, ...appDocs(s).map(d => `software/${s.slug}/${d.key}/`)]), 'papers/', 'cv/', 'notes/', ...notes.map(n => `notes/${n.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE_URL}${url(u)}</loc></url>`).join('')}</urlset>`;
}
function searchIndex() {
  return [
    ...software.map(s => ({ t: s.name, k: 'App', u: url(`software/${s.slug}/`), d: s.tagline, x: [s.tags, s.platforms, s.tech].flat().join(' ') })),
    ...papers.map(p => ({ t: p.title, k: 'Paper', u: url(`papers/#${p.id}`), d: `${p.venue}, ${p.year}`, x: [p.authors, p.tags].flat().join(' ') })),
    ...notes.map(n => ({ t: n.title, k: 'Note', u: url(`notes/${n.slug}/`), d: n.summary, x: n.tags.join(' ') }))
  ];
}

// ---------- markdown-lite ----------
function md(src) {
  const lines = src.replace(/\r/g, '').split('\n');
  const out = []; let para = [], list = null, code = null;
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    if (code !== null) { if (raw.startsWith('```')) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw); continue; }
    const line = raw.trimEnd();
    let m;
    if (line.startsWith('```')) { flush(); code = []; }
    else if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flush(); const l = m[1].length + 1; out.push(`<h${l}>${inline(m[2])}</h${l}>`); }
    else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) { if (para.length) flush(); if (list !== 'ul') { if (list) out.push(`</${list}>`); out.push('<ul>'); list = 'ul'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (para.length) flush(); if (list !== 'ol') { if (list) out.push(`</${list}>`); out.push('<ol>'); list = 'ol'; } out.push(`<li>${inline(m[1])}</li>`); }
    else if ((m = line.match(/^>\s?(.*)$/))) { flush(); out.push(`<blockquote><p>${inline(m[1])}</p></blockquote>`); }
    else if (/^(-{3,}|\*{3,})$/.test(line)) { flush(); out.push('<hr>'); }
    else if (line === '') flush();
    else { if (list) { out.push(`</${list}>`); list = null; } para.push(line); }
  }
  flush();
  return out.join('\n');
}
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, u) => `<a href="${u.startsWith('http') || u.startsWith('mailto:') || u.startsWith('#') ? u : url(u)}">${t}</a>`);
}
function parseNote(file) {
  const raw = fs.readFileSync(path.join(ROOT, 'content/notes', file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const fm = {}; if (m) for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) fm[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  const slug = file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
  const tags = (fm.tags || '').replace(/^\[|\]$/g, '').split(',').map(t => t.trim()).filter(Boolean);
  return { slug, title: fm.title || slug, date: fm.date || file.slice(0, 10), summary: fm.summary || '', tags, body: m ? m[2] : raw };
}

// ---------- utils ----------
function url(p) { return `${BASE}/${String(p).replace(/^\//, '')}`; }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function cap(s) { s = String(s ?? ''); return s.charAt(0).toUpperCase() + s.slice(1); }
function fmtDate(d) { return new Date(d + 'T00:00:00Z').toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); }
function readJSON(p) { return JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8')); }
function write(rel, content) { const f = path.join(OUT, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); e.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }
function parseArgs(a) { const o = {}; for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) o[a[i].slice(2)] = a[i + 1]?.startsWith('--') || a[i + 1] === undefined ? true : a[++i]; return o; }
