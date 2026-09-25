/* Studio: talks to scripts/studio.js, which writes the content files and rebuilds the site. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const el = (tag, props, ...children) => {
    const node = document.createElement(tag);
    const { dataset, ...rest } = props || {};
    Object.assign(node, rest);                        // dataset is read-only, so copy its keys
    if (dataset) for (const [key, value] of Object.entries(dataset)) node.dataset[key] = value;
    for (const child of children.flat()) if (child != null) node.append(child);
    return node;
  };
  const lines = value => String(value || '').split('\n').map(s => s.trim()).filter(Boolean);
  const commas = value => String(value || '').split(',').map(s => s.trim()).filter(Boolean);
  const slugify = value => String(value).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '')
    .trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');

  let state = null;
  let editing = null;        // slug being edited, or null for a new entry
  let icon = '';
  let shots = [];
  let shapeChosenByHand = false;

  // ---------- plumbing ----------
  async function call(route, body) {
    const res = await fetch(route, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : {});
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || res.statusText);
    return data;
  }

  let toastTimer;
  function toast(message, bad) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.toggle('bad', !!bad);
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { node.hidden = true; }, bad ? 6000 : 2600);
  }

  async function withBusy(button, task) {
    if (button) button.disabled = true;
    try { return await task(); }
    catch (error) { toast(error.message, true); throw error; }
    finally { if (button) button.disabled = false; }
  }

  const readFile = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });

  async function refresh() {
    state = await call('/api/state');
    renderAppList();
    renderPublish();
  }

  // ---------- tabs ----------
  $('#tabs').addEventListener('click', event => {
    const button = event.target.closest('[data-tab]');
    if (!button) return;
    $$('#tabs .tab-link').forEach(b => b.toggleAttribute('aria-current', b === button));
    $$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== button.dataset.tab; });
    if (button.dataset.tab === 'cv') renderCV();
    if (button.dataset.tab === 'profile') fillProfile();
    if (button.dataset.tab === 'publish') renderPublish();
  });

  // ---------- software ----------
  function renderAppList() {
    const list = $('#app-list');
    list.replaceChildren(...state.apps.map(app => el('li', {}, el('button', {
      type: 'button',
      onclick: () => loadApp(app.slug),
    },
      el('span', { className: 'name', textContent: app.name }),
      el('span', { className: 'meta', textContent: `${app.platforms.join(' · ') || 'no platform'} · ${app.status}` }),
    ))));
    $$('#app-list button').forEach((b, i) => b.toggleAttribute('aria-current', state.apps[i].slug === editing));
    $('#app-count').textContent = state.apps.length
      ? `${state.apps.length} on the site`
      : 'Nothing yet. Add your first application.';
  }

  function rowFor(kind, value) {
    const remove = el('button', { type: 'button', className: 'row-remove', title: 'Remove', textContent: '×',
      onclick: event => event.target.closest('.row').remove() });
    if (kind === 'download') {
      return el('div', { className: 'row' },
        el('input', { placeholder: 'Download for macOS', value: value?.label || '', dataset: { key: 'label' } }),
        el('input', { placeholder: 'https://… (leave empty for “coming soon”)', value: value?.url || '', dataset: { key: 'url' } }),
        el('input', { placeholder: 'macOS 14 or later', value: value?.note || '', dataset: { key: 'note' } }),
        remove);
    }
    return el('div', { className: 'row two' },
      el('input', { placeholder: 'Documentation', value: value?.label || '', dataset: { key: 'label' } }),
      el('input', { placeholder: 'https://…', value: value?.url || '', dataset: { key: 'url' } }),
      remove);
  }

  function readRows(container) {
    return $$('.row', container).map(row => {
      const out = {};
      $$('input', row).forEach(input => { out[input.dataset.key] = input.value.trim(); });
      return out;
    });
  }

  function renderShots() {
    $('#shots').replaceChildren(...shots.map(pathname => el('div', { className: 'shot' },
      el('img', { src: `/${pathname}?v=${Date.now()}`, alt: '' }),
      el('button', {
        type: 'button', title: 'Remove', textContent: '×',
        onclick: () => { shots = shots.filter(s => s !== pathname); renderShots(); },
      }))));
  }

  function setIcon(pathname) {
    icon = pathname || '';
    const preview = $('#icon-preview');
    preview.hidden = !icon;
    $('#icon-hint').hidden = !!icon;
    if (icon) preview.src = `/${icon}?v=${Date.now()}`;
  }

  function loadApp(slug) {
    const form = $('#app-form');
    const app = state.apps.find(a => a.slug === slug) || null;
    editing = app ? app.slug : null;
    shapeChosenByHand = false;

    form.name.value = app?.name || '';
    form.slug.value = app?.slug || '';
    form.tagline.value = app?.tagline || '';
    form.status.value = app?.status || 'beta';
    form.year.value = app?.year || new Date().getFullYear();
    form.order.value = app?.order ?? (state.apps.length + 1);
    form.description.value = app?.description || '';
    form.features.value = (app?.features || []).join('\n');
    form.tech.value = (app?.tech || []).join(', ');
    form.tags.value = (app?.tags || []).join(', ');
    form.releases.value = app?.releases || '';
    form.iconShape.value = app?.iconShape || 'ios';
    form.featured.checked = (state.profile.featuredSoftware || []).includes(app?.slug);

    const known = state.platforms;
    $('#platforms').replaceChildren(...known.map(platform => el('label', {},
      el('input', { type: 'checkbox', value: platform, checked: (app?.platforms || []).includes(platform) }),
      el('span', { textContent: platform }))));
    form.platformsExtra.value = (app?.platforms || []).filter(p => !known.includes(p)).join(', ');

    $('#downloads').replaceChildren(...(app?.downloads?.length ? app.downloads : [null]).map(d => rowFor('download', d)));
    $('#links').replaceChildren(...(app?.links || []).map(l => rowFor('link', l)));
    shots = (app?.screenshots || []).slice();
    renderShots();
    setIcon(app?.icon || '');

    $('#editor-title').textContent = app ? app.name : 'New application';
    $('#delete-app').hidden = !app;
    updateUrlHint();
    renderAppList();
  }

  function updateUrlHint() {
    const slug = $('#app-form').slug.value.trim();
    $('#editor-url').textContent = slug ? `Page address: /software/${slug}/` : 'The page address is made from the name.';
    $('#open-page').href = slug ? `/software/${slug}/` : '/software/';
  }

  $('#app-form').name.addEventListener('input', event => {
    const form = $('#app-form');
    if (!editing && (!form.slug.value || form.slug.dataset.auto !== 'off')) {
      form.slug.value = slugify(event.target.value);
      form.slug.dataset.auto = 'on';
    }
    updateUrlHint();
  });
  $('#app-form').slug.addEventListener('input', event => {
    event.target.dataset.auto = 'off';
    updateUrlHint();
  });
  $('#app-form').iconShape.addEventListener('change', () => { shapeChosenByHand = true; });

  $('#app-form').addEventListener('click', event => {
    const add = event.target.closest('[data-add]');
    if (!add) return;
    const kind = add.dataset.add;
    $(kind === 'download' ? '#downloads' : '#links').append(rowFor(kind));
  });

  $('#new-app').addEventListener('click', () => loadApp(null));

  // Icon and screenshot uploads
  async function uploadAsset(kind, file) {
    const slug = $('#app-form').slug.value.trim();
    if (kind !== 'cv' && !slug) throw new Error('Give the application a name first');
    const dataUrl = await readFile(file);
    return call('/api/asset', { kind, slug, dataUrl });
  }

  $('#icon-drop').addEventListener('click', () => $('#icon-file').click());
  $('#icon-drop').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#icon-file').click(); } });
  $('#icon-drop').addEventListener('dragover', e => { e.preventDefault(); $('#icon-drop').classList.add('over'); });
  $('#icon-drop').addEventListener('dragleave', () => $('#icon-drop').classList.remove('over'));
  $('#icon-drop').addEventListener('drop', async e => {
    e.preventDefault();
    $('#icon-drop').classList.remove('over');
    if (e.dataTransfer.files[0]) await handleIcon(e.dataTransfer.files[0]);
  });
  $('#icon-file').addEventListener('change', async e => { if (e.target.files[0]) await handleIcon(e.target.files[0]); e.target.value = ''; });

  async function handleIcon(file) {
    try {
      const saved = await uploadAsset('icon', file);
      setIcon(saved.path);
      if (saved.shape && !shapeChosenByHand) {
        $('#app-form').iconShape.value = saved.shape;
        $('#icon-note').textContent = saved.shape === 'macos'
          ? 'This looks like a Mac icon with its own shape, so it is shown as it is.'
          : 'This looks like a full-square icon, so it is shown with rounded corners. Choose Circle for a watch-only app.';
      }
      toast('Icon saved. Save the application to use it.');
    } catch (error) { toast(error.message, true); }
  }

  $('#add-shot').addEventListener('click', () => $('#shot-file').click());
  $('#shot-file').addEventListener('change', async e => {
    for (const file of e.target.files) {
      try { shots.push((await uploadAsset('screenshot', file)).path); }
      catch (error) { toast(error.message, true); }
    }
    e.target.value = '';
    renderShots();
  });

  $('#app-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const platforms = $$('#platforms input:checked').map(i => i.value).concat(commas(form.platformsExtra.value));
    const app = {
      slug: form.slug.value.trim(),
      name: form.name.value.trim(),
      tagline: form.tagline.value.trim(),
      icon,
      iconShape: form.iconShape.value,
      platforms,
      status: form.status.value,
      order: Number(form.order.value) || 99,
      tags: commas(form.tags.value),
      tech: commas(form.tech.value),
      year: Number(form.year.value) || new Date().getFullYear(),
      description: form.description.value,
      features: lines(form.features.value),
      downloads: readRows($('#downloads')),
      links: readRows($('#links')),
      screenshots: shots,
      releases: form.releases.value.trim(),
    };
    await withBusy(form.querySelector('[type=submit]'), async () => {
      const saved = await call('/api/app', { app, featured: form.featured.checked });
      editing = saved.app.slug;
      await refresh();
      loadApp(editing);
      toast(saved.build.ok ? 'Saved, and the site was rebuilt' : 'Saved, but the build failed', !saved.build.ok);
    });
  });

  $('#delete-app').addEventListener('click', async event => {
    if (!editing || !confirm(`Delete ${editing}? The page and its images are removed from the site.`)) return;
    await withBusy(event.target, async () => {
      await call('/api/app/delete', { slug: editing });
      editing = null;
      await refresh();
      loadApp(null);
      toast('Deleted');
    });
  });

  // ---------- cv ----------
  function cvItem(item) {
    return el('div', { className: 'cv-item' },
      el('input', { placeholder: 'Title, for example M.Math., Applied Mathematics', value: item?.title || '', dataset: { key: 'title' } }),
      el('input', { placeholder: 'Organisation', value: item?.org || '', dataset: { key: 'org' } }),
      el('input', { placeholder: '2023 – 2026', value: item?.period || '', dataset: { key: 'period' } }),
      el('button', { type: 'button', className: 'row-remove', title: 'Remove', textContent: '×',
        onclick: e => e.target.closest('.cv-item').remove() }),
      el('textarea', { placeholder: 'Detail, optional', rows: 2, value: item?.detail || '', dataset: { key: 'detail' } }));
  }

  function cvSection(section) {
    const items = el('div', { className: 'cv-items' }, (section?.items || [null]).map(cvItem));
    return el('div', { className: 'cv-section' },
      el('div', { className: 'cv-section-head' },
        el('label', { className: 'field' },
          el('span', { textContent: 'Section' }),
          el('input', { value: section?.title || '', placeholder: 'Education', dataset: { key: 'sectionTitle' } })),
        el('button', { type: 'button', className: 'btn small', textContent: 'Add entry', onclick: () => items.append(cvItem()) }),
        el('button', { type: 'button', className: 'btn small danger', textContent: 'Remove section',
          onclick: e => e.target.closest('.cv-section').remove() })),
      items);
  }

  function renderCV() {
    $('#cv-sections').replaceChildren(...(state.cv.sections || []).map(cvSection));
    $('#cv-pdf-path').textContent = state.cv.pdf ? `Current file: ${state.cv.pdf}` : 'No PDF yet.';
  }

  $('#add-section').addEventListener('click', () => $('#cv-sections').append(cvSection()));
  $('#cv-pdf-btn').addEventListener('click', () => $('#cv-pdf-file').click());
  $('#cv-pdf-file').addEventListener('change', async e => {
    if (!e.target.files[0]) return;
    try {
      const saved = await uploadAsset('cv', e.target.files[0]);
      state.cv.pdf = saved.path;
      $('#cv-pdf-path').textContent = `Current file: ${saved.path} (save to apply)`;
      toast('PDF uploaded. Save the CV to apply it.');
    } catch (error) { toast(error.message, true); }
    e.target.value = '';
  });

  $('#cv-form').addEventListener('submit', async event => {
    event.preventDefault();
    const sections = $$('.cv-section').map(node => ({
      title: $('[data-key=sectionTitle]', node).value.trim(),
      items: $$('.cv-item', node).map(row => {
        const item = {};
        $$('[data-key]', row).forEach(input => { item[input.dataset.key] = input.value.trim(); });
        return item;
      }),
    })).filter(section => section.title);
    await withBusy(event.target.querySelector('[type=submit]'), async () => {
      const saved = await call('/api/cv', { cv: { pdf: state.cv.pdf, sections } });
      await refresh();
      renderCV();
      toast(saved.build.ok ? 'CV saved' : 'Saved, but the build failed', !saved.build.ok);
    });
  });

  // ---------- profile & site ----------
  function fillProfile() {
    const form = $('#profile-form'), p = state.profile, c = state.config;
    form.authorName.value = c.author.name || '';
    form.legalName.value = c.author.legalName || '';
    form.department.value = c.author.department || '';
    form.affiliation.value = c.author.affiliation || '';
    form.email.value = c.author.email || '';
    form.location.value = c.author.location || '';
    form.headline.value = p.headline || '';
    form.bio.value = (p.bio || []).join('\n\n');
    form.nowText.value = p.nowText || '';
    form.interests.value = (p.interests || []).join('\n');
    form.skills.value = (p.skills || []).join(', ');
    form.url.value = c.url || '';
    form.customDomain.value = c.customDomain || '';
    for (const key of ['github', 'scholar', 'linkedin', 'researchgate', 'orcid']) {
      form[`link_${key}`].value = (c.links || {})[key] || '';
    }
  }

  $('#profile-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.target;
    const profile = {
      ...state.profile,
      headline: form.headline.value.trim(),
      bio: form.bio.value.split(/\n{2,}/).map(s => s.trim()).filter(Boolean),
      nowText: form.nowText.value.trim(),
      interests: lines(form.interests.value),
      skills: commas(form.skills.value),
    };
    const config = {
      ...state.config,
      url: form.url.value.trim(),
      customDomain: form.customDomain.value.trim(),
      author: {
        ...state.config.author,
        name: form.authorName.value.trim(),
        legalName: form.legalName.value.trim(),
        department: form.department.value.trim(),
        affiliation: form.affiliation.value.trim(),
        email: form.email.value.trim(),
        location: form.location.value.trim(),
      },
      links: Object.fromEntries(['github', 'scholar', 'linkedin', 'researchgate', 'orcid']
        .map(key => [key, form[`link_${key}`].value.trim()])),
    };
    await withBusy(form.querySelector('[type=submit]'), async () => {
      const saved = await call('/api/profile', { profile, config });
      await refresh();
      toast(saved.build.ok ? 'Saved' : 'Saved, but the build failed', !saved.build.ok);
    });
  });

  // ---------- publish ----------
  function renderPublish() {
    const g = state.git;
    const live = state.config.customDomain ? `https://${state.config.customDomain}` : state.config.url;
    $('#git-status').replaceChildren(
      el('dt', { textContent: 'GitHub' }), el('dd', { textContent: g.remote || 'not connected yet' }),
      el('dt', { textContent: 'Branch' }), el('dd', { textContent: g.branch }),
      el('dt', { textContent: 'Saved versions' }), el('dd', { textContent: String(g.commits) }),
      el('dt', { textContent: 'Waiting to publish' }), el('dd', { textContent: g.changes ? `${g.changes} changed file${g.changes === 1 ? '' : 's'}` : 'nothing' }),
      el('dt', { textContent: 'Live address' }), el('dd', { textContent: live || 'set it under Profile & site' }),
    );
    $('#publish-ready').hidden = !g.remote;
    $('#publish-setup').hidden = !!g.remote;
    if (!g.remote) setupCommands();
  }

  function setupCommands() {
    const user = ($('#gh-user')?.value || '').trim() || 'YOUR-GITHUB-USERNAME';
    $('#setup-commands').textContent = [
      'gh auth login',
      `gh repo create ${user}.github.io --public --source . --remote origin --push`,
      `gh api --method POST repos/${user}/${user}.github.io/pages -f build_type=workflow`,
    ].join('\n');
  }

  $('#gh-user').addEventListener('input', setupCommands);

  $('#publish-btn').addEventListener('click', async event => {
    await withBusy(event.target, async () => {
      const result = await call('/api/publish', { message: $('#commit-message').value });
      const log = $('#publish-log');
      log.hidden = false;
      log.textContent = result.steps.join('\n\n');
      state.git = result.git;
      renderPublish();
      toast(result.pushed ? 'Published. GitHub Pages and Cloudflare rebuild in about a minute.' : 'Push failed, see the log', !result.pushed);
    });
  });

  // ---------- start ----------
  refresh().then(() => loadApp(null)).catch(error => toast(error.message, true));
})();
