(function () {
  'use strict';
  var root = document.documentElement;
  var base = document.body.dataset.base || '/';

  // Theme: follow the system until the visitor chooses, then remember the choice.
  var themeButton = document.getElementById('theme');
  if (themeButton) themeButton.addEventListener('click', function () {
    var current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    root.dataset.theme = current === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  });

  // Disclosure buttons (abstract, BibTeX) and copy buttons.
  document.addEventListener('click', function (event) {
    var toggle = event.target.closest('button[aria-controls]');
    if (toggle) {
      var panel = document.getElementById(toggle.getAttribute('aria-controls'));
      if (panel) {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
      }
      return;
    }
    var copy = event.target.closest('[data-copy]');
    if (copy && navigator.clipboard) {
      var source = document.querySelector(copy.dataset.copy);
      if (!source) return;
      navigator.clipboard.writeText(source.textContent).then(function () {
        var label = copy.textContent;
        copy.textContent = 'Copied';
        setTimeout(function () { copy.textContent = label; }, 1600);
      });
    }
  });

  // A link to papers/#id opens that paper's abstract.
  if (location.hash.length > 1) {
    var target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    var opener = target && target.querySelector('button[aria-controls^="abs-"]');
    if (opener) opener.click();
  }

  // Platform filter on the software index.
  var group = document.querySelector('[data-filter-group]');
  var list = document.querySelector('[data-filter-target]');
  if (group && list) group.addEventListener('click', function (event) {
    var button = event.target.closest('[data-filter]');
    if (!button) return;
    group.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === button)); });
    var platform = button.dataset.filter;
    var visible = [];
    list.querySelectorAll('.app').forEach(function (row) {
      var show = platform === 'all' || row.dataset.platforms.split('|').indexOf(platform) !== -1;
      row.hidden = !show;
      row.style.borderTop = '';
      if (show) visible.push(row);
    });
    // The first visible row never carries a divider.
    visible.forEach(function (row, i) {
      if (i === 0) row.style.borderTop = '0';
      row.firstElementChild.style.paddingTop = i === 0 ? '0' : '';
    });
  });

  // Latest release and stars for apps with a public distribution repo.
  document.querySelectorAll('[data-gh-repo]').forEach(function (el) {
    var repo = el.dataset.ghRepo;
    fetch('https://api.github.com/repos/' + repo + '/releases/latest')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (release) {
        var parts = [];
        if (release && release.tag_name) {
          parts.push('Latest release ' + release.tag_name + ', ' + new Date(release.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
        }
        return fetch('https://api.github.com/repos/' + repo)
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (info) {
            if (info && info.stargazers_count > 0) parts.push(info.stargazers_count + ' stars on GitHub');
            if (parts.length) el.textContent = parts.join(' · ');
          });
      })
      .catch(function () {});
  });

  // Client-side search over search.json. Results are built with DOM methods only.
  var input = document.getElementById('q');
  var results = document.getElementById('results');
  if (!input || !results) return;

  var index = null;
  fetch(base + 'search.json')
    .then(function (r) { return r.json(); })
    .then(function (data) { index = data; render(); });
  input.addEventListener('input', render);

  function render() {
    if (!index) return;
    var terms = input.value.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = terms.length
      ? index.filter(function (item) {
          var haystack = (item.t + ' ' + item.d + ' ' + item.x).toLowerCase();
          return terms.every(function (term) { return haystack.indexOf(term) !== -1; });
        })
      : index;

    results.replaceChildren();
    if (!hits.length) {
      var empty = document.createElement('li');
      empty.className = 'results-empty';
      empty.textContent = 'Nothing matches “' + input.value.trim() + '”.';
      results.appendChild(empty);
      return;
    }
    hits.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'result';
      var a = document.createElement('a');
      a.href = item.u;
      var kind = document.createElement('span');
      kind.className = 'result-kind';
      kind.textContent = item.k;
      var text = document.createElement('span');
      var title = document.createElement('span');
      title.className = 'result-title';
      title.textContent = item.t;
      var desc = document.createElement('span');
      desc.className = 'result-desc';
      desc.textContent = item.d;
      text.append(title, desc);
      a.append(kind, text);
      li.appendChild(a);
      results.appendChild(li);
    });
  }
})();
