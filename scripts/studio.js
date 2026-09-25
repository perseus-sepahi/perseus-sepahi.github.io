#!/usr/bin/env node
// Studio: a local editor for the site's content.
//
//   npm run studio   →  http://localhost:8080/studio/
//
// It serves the built site on the same port, so saving a change and looking at the result is one
// click. Everything is written straight into content/ and assets/, then `node build.js` runs again.
// The server binds to localhost only and is never part of the published site (dist/ does not
// contain it), so there is no login and nothing is exposed to the internet.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.STUDIO_PORT || 8080);
const MAX_BODY = 25 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const IMAGE_EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'application/pdf': '.pdf' };

// ---------- helpers ----------
const rel = p => path.join(ROOT, p);
const readJSON = p => JSON.parse(fs.readFileSync(rel(p), 'utf8'));
const writeJSON = (p, value) => fs.writeFileSync(rel(p), JSON.stringify(value, null, 2) + '\n');
const isSlug = s => typeof s === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(s) && s.length <= 60;
const listApps = () => fs.readdirSync(rel('content/software')).filter(f => f.endsWith('.json'))
  .map(f => readJSON(path.join('content/software', f)))
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

function build() {
  const out = spawnSync(process.execPath, [rel('build.js')], { cwd: ROOT, encoding: 'utf8' });
  return { ok: out.status === 0, output: ((out.stdout || '') + (out.stderr || '')).trim() };
}

function git(args) {
  const out = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { ok: out.status === 0, output: ((out.stdout || '') + (out.stderr || '')).trim() };
}

function gitInfo() {
  const remote = git(['remote', 'get-url', 'origin']);
  const status = git(['status', '--porcelain']);
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const commits = git(['rev-list', '--count', 'HEAD']);
  return {
    remote: remote.ok ? remote.output : '',
    branch: branch.ok ? branch.output : 'main',
    changes: status.ok ? status.output.split('\n').filter(Boolean).length : 0,
    commits: commits.ok ? Number(commits.output) : 0,
  };
}

/** Corner transparency of a PNG, which tells a macOS-style icon from a full-bleed one. */
function pngShape(buffer) {
  try {
    if (buffer.readUInt32BE(0) !== 0x89504e47) return null;
    let pos = 8, idat = [], w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
    while (pos < buffer.length) {
      const len = buffer.readUInt32BE(pos), type = buffer.toString('ascii', pos + 4, pos + 8);
      if (type === 'IHDR') {
        w = buffer.readUInt32BE(pos + 8); h = buffer.readUInt32BE(pos + 12);
        depth = buffer[pos + 16]; colour = buffer[pos + 17]; interlace = buffer[pos + 20];
      } else if (type === 'IDAT') idat.push(buffer.subarray(pos + 8, pos + 8 + len));
      else if (type === 'IEND') break;
      pos += 12 + len;
    }
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colour];
    if (!channels || depth !== 8 || interlace !== 0 || (colour !== 4 && colour !== 6)) return null;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * channels;
    const prev = Buffer.alloc(stride), line = Buffer.alloc(stride);
    let offset = 0, transparent = 0, sampled = 0;
    for (let y = 0; y < h; y++) {
      const filter = raw[offset];
      raw.copy(line, 0, offset + 1, offset + 1 + stride);
      offset += 1 + stride;
      for (let x = 0; x < stride; x++) {
        const a = x >= channels ? line[x - channels] : 0, b = prev[x], c = x >= channels ? prev[x - channels] : 0;
        if (filter === 1) line[x] = (line[x] + a) & 255;
        else if (filter === 2) line[x] = (line[x] + b) & 255;
        else if (filter === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
        else if (filter === 4) {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
        }
      }
      line.copy(prev);
      if (y === 0 || y === h - 1) {                       // sample the top and bottom corners
        for (const x of [0, w - 1]) { if (line[x * channels + channels - 1] < 8) transparent++; sampled++; }
      }
    }
    return sampled && transparent === sampled ? 'macos' : 'ios';
  } catch { return null; }
}

function saveDataUrl(dataUrl, dir, base) {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,([\s\S]+)$/);
  if (!m) throw new Error('Expected a base64 data URL');
  const ext = IMAGE_EXT[m[1]];
  if (!ext) throw new Error(`Unsupported file type: ${m[1]}`);
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length > MAX_BODY) throw new Error('File is too large');
  fs.mkdirSync(rel(dir), { recursive: true });
  const file = `${base}${ext}`;
  fs.writeFileSync(rel(path.join(dir, file)), buffer);
  return { path: `${dir}/${file}`, bytes: buffer.length, shape: ext === '.png' ? pngShape(buffer) : null };
}

/** Keep one field order so the saved JSON files stay readable and diff cleanly. */
function normaliseApp(input) {
  if (!isSlug(input.slug)) throw new Error('Slug must be lower case letters, numbers and dashes');
  const list = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(x => String(x).trim()).filter(Boolean);
  return {
    slug: input.slug,
    name: String(input.name || '').trim() || input.slug,
    tagline: String(input.tagline || '').trim(),
    icon: String(input.icon || ''),
    iconShape: ['macos', 'ios', 'watch'].includes(input.iconShape) ? input.iconShape : 'ios',
    platforms: list(input.platforms),
    status: ['stable', 'beta', 'experimental'].includes(input.status) ? input.status : 'beta',
    order: Number.isFinite(+input.order) ? +input.order : 99,
    tags: list(input.tags),
    tech: list(input.tech),
    year: Number.isFinite(+input.year) ? +input.year : new Date().getFullYear(),
    description: String(input.description || '').trim(),
    features: (input.features || []).map(f => String(f).trim()).filter(Boolean),
    downloads: (input.downloads || [])
      .map(d => ({ label: String(d.label || '').trim(), url: String(d.url || '').trim(), note: String(d.note || '').trim() }))
      .filter(d => d.label),
    links: (input.links || [])
      .map(l => ({ label: String(l.label || '').trim(), url: String(l.url || '').trim() }))
      .filter(l => l.label && l.url),
    screenshots: (input.screenshots || []).map(String).filter(Boolean),
    releases: String(input.releases || '').trim(),
    sourceAvailable: !!input.sourceAvailable,
  };
}

// ---------- API ----------
const api = {
  'GET /api/state': () => ({
    apps: listApps(),
    profile: readJSON('content/profile.json'),
    cv: readJSON('content/cv.json'),
    config: readJSON('site.config.json'),
    git: gitInfo(),
    platforms: ['macOS', 'iOS', 'iPadOS', 'watchOS', 'visionOS', 'Android', 'Windows', 'Linux', 'Web'],
  }),

  'POST /api/app': body => {
    const app = normaliseApp(body.app || {});
    writeJSON(path.join('content/software', `${app.slug}.json`), app);
    if (body.featured !== undefined) {
      const profile = readJSON('content/profile.json');
      const set = new Set(profile.featuredSoftware || []);
      body.featured ? set.add(app.slug) : set.delete(app.slug);
      profile.featuredSoftware = listApps().map(a => a.slug).filter(s => set.has(s));
      writeJSON('content/profile.json', profile);
    }
    return { app, build: build() };
  },

  'POST /api/app/delete': body => {
    if (!isSlug(body.slug)) throw new Error('Bad slug');
    const app = (() => { try { return readJSON(path.join('content/software', `${body.slug}.json`)); } catch { return null; } })();
    fs.rmSync(rel(path.join('content/software', `${body.slug}.json`)), { force: true });
    for (const asset of [app?.icon, ...(app?.screenshots || [])]) {
      if (asset && /^assets\/(icons|screens)\//.test(asset)) fs.rmSync(rel(asset), { force: true });
    }
    const profile = readJSON('content/profile.json');
    profile.featuredSoftware = (profile.featuredSoftware || []).filter(s => s !== body.slug);
    writeJSON('content/profile.json', profile);
    return { build: build() };
  },

  'POST /api/asset': body => {
    const kinds = {
      icon: { dir: 'assets/icons', base: () => body.slug },
      screenshot: { dir: 'assets/screens', base: () => `${body.slug}-${Date.now().toString(36)}` },
      cv: { dir: 'assets/files', base: () => 'CV' },
    };
    const kind = kinds[body.kind];
    if (!kind) throw new Error('Unknown asset kind');
    if (body.kind !== 'cv' && !isSlug(body.slug)) throw new Error('Give the app a name first');
    return saveDataUrl(body.dataUrl, kind.dir, kind.base());
  },

  'POST /api/cv': body => { writeJSON('content/cv.json', body.cv); return { build: build() }; },
  'POST /api/profile': body => {
    writeJSON('content/profile.json', body.profile);
    if (body.config) writeJSON('site.config.json', body.config);
    return { build: build() };
  },
  'POST /api/build': () => ({ build: build() }),

  'POST /api/publish': body => {
    const info = gitInfo();
    if (!info.remote) throw new Error('No git remote yet. Follow the steps under Publish to create one.');
    const message = String(body.message || '').trim() || 'Update site content';
    const log = [];
    log.push(git(['add', '-A']).output);
    const nothingStaged = git(['diff', '--cached', '--quiet']).ok;
    if (!nothingStaged) log.push(git(['commit', '-m', message]).output);
    const push = git(['push', '-u', 'origin', info.branch]);
    log.push(push.output);
    return { steps: log.filter(Boolean), git: gitInfo(), pushed: push.ok };
  },
};

// ---------- server ----------
function serveFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  if (url.pathname.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { res.writeHead(413).end('Too large'); req.destroy(); }
    });
    req.on('end', () => {
      const handler = api[route];
      const send = (code, value) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (!handler) return send(404, { error: `No route ${route}` });
      try {
        send(200, handler(body ? JSON.parse(body) : {}) ?? {});
      } catch (error) {
        send(400, { error: String(error.message || error) });
      }
    });
    return;
  }

  // Studio UI, then the built site.
  if (url.pathname === '/studio' || url.pathname === '/studio/') return serveFile(res, rel('studio/index.html'));
  if (url.pathname.startsWith('/studio/')) {
    const file = path.normalize(path.join(ROOT, 'studio', url.pathname.slice('/studio/'.length)));
    if (!file.startsWith(path.join(ROOT, 'studio'))) return res.writeHead(403).end('Forbidden');
    return serveFile(res, file);
  }
  const target = path.normalize(path.join(ROOT, 'dist', decodeURIComponent(url.pathname)));
  if (!target.startsWith(path.join(ROOT, 'dist'))) return res.writeHead(403).end('Forbidden');
  serveFile(res, fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, 'index.html') : target);
});

if (!fs.existsSync(rel('dist/index.html'))) build();
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Studio   http://localhost:${PORT}/studio/`);
  console.log(`Site     http://localhost:${PORT}/`);
  console.log('Press Control-C to stop.');
});
