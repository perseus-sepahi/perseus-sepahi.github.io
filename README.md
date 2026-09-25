# Personal website

Static site for software, apps and papers. No framework, no npm dependencies: one Node script
(`build.js`) turns JSON and Markdown in `content/` into plain HTML in `dist/`.

Related documents:

- [PUBLISHING.md](PUBLISHING.md) — how to release closed-source apps on GitHub, what the site costs, domains and limits.
- [READINESS.md](READINESS.md) — per-app audit: which apps can legally ship as closed-source binaries today.
- [templates/](templates/) — end-user licence, third-party notices, and a README for each app's public distribution repo.

## Studio: add things without touching files

```bash
npm run studio
```

Then open http://localhost:8080/studio/. It has four tabs:

- **Software** adds, edits and deletes applications. Fill in the name and the summary, tick the
  platforms, drop in an icon, list the features one per line, add download buttons, and press Save.
  The icon's shape (Mac icon, rounded square or circle) is detected from the image. A download with
  no address shows "coming soon"; with a releases repository set, it points at your newest release.
- **CV** holds the sections and entries. Everything is blank until you fill it, and empty entries
  never reach the page. You can also replace the PDF here.
- **Profile & site** is the home-page wording and every address the site links to.
- **Publish** sends everything to GitHub with one button.

Saving rebuilds the site immediately, and the same address serves the real site, so
http://localhost:8080/ always shows the current result. The studio runs on your machine only. It is
never part of the published site and has no login, because nothing outside your Mac can reach it.

## Edit content by hand

The studio writes plain files, so you can also edit them directly:

| What | Where | Notes |
| --- | --- | --- |
| Name, tagline, links, site URL | `site.config.json` | Set `url` to your GitHub Pages URL; fill `links.github`. |
| Bio, interests, featured apps | `content/profile.json` | `featuredSoftware` lists slugs shown on the home page. |
| An app | `content/software/<slug>.json` | Copy an existing file. Set `releases` to the app's public distribution repo (`"owner/repo"`): empty download URLs then point at its latest release, and the page shows the current version. Without it, empty URLs render as "coming soon". |
| Papers | `content/papers.json` | BibTeX is generated from the fields. `pdf` points into `assets/files/`. `status` may be `published` (default), `in preparation`, `submitted`, `under review` or `in press`; anything but `published` shows a badge and adds a BibTeX `note`. |
| CV | `content/cv.json` + `assets/files/Perseus_Sepahi_CV.pdf` | Replace the PDF when you update your CV. |
| Notes (blog) | `content/notes/YYYY-MM-DD-slug.md` | Front matter: title, date, tags, summary. |
| Icons and screenshots | `assets/icons/`, `assets/screens/` | Reference them by path from the JSON. Set `iconShape` per app: `macos` for icons that already carry their own shape and margin, `ios` for full-bleed squares (masked to a rounded square), `watch` for full-bleed squares shown as a circle. |

## Design

Paper, ink and one vermilion accent, on an editorial grid: a narrow margin column for labels, years
and metadata, and a main column for content. Type is Newsreader (reading) with IBM Plex Sans and
Mono (interface and code), loaded from Google Fonts with system fallbacks. Colours are CSS variables
at the top of `assets/css/style.css`, with a matching dark palette.

The home-page figure is a real simulation. `scripts/simulate-kh.js` solves the two-dimensional
Boussinesq Navier–Stokes equations for a stably stratified shear layer (Fourier pseudo-spectral,
fourth-order Runge–Kutta, about a minute on a laptop) and saves a snapshot of potential temperature
and streamfunction to `lib/figure-data/kh-billows.json`. At build time `lib/figure.js` traces the
isentropes, tiles the periodic domain, and adds tracer dots that follow the instantaneous
streamlines at the simulated flow speed. The caption's Re, Pr, Ri and t are read from the data file.
Motion is disabled for visitors who prefer reduced motion.

To rerun the simulation (for example after changing its parameters in `package.json`):

```bash
npm run figure
```

The solver is deterministic, so the same parameters reproduce the same billows.

## Build and preview

```bash
npm run serve
```

Then open http://localhost:8080. `npm run build` alone writes `dist/`.

## Publish

The site is plain static files, so any static host serves it exactly as designed.

### GitHub Pages

1. Create a free account at [github.com](https://github.com). The username you choose becomes your
   web address, so pick it carefully.
2. Install the GitHub command line tool and sign in. The first command opens your browser:

   ```bash
   brew install gh && gh auth login
   ```

3. Create the repository and push. Replace `USERNAME` with yours; the name must match it exactly:

   ```bash
   gh repo create USERNAME.github.io --public --source . --remote origin --push
   gh api --method POST repos/USERNAME/USERNAME.github.io/pages -f build_type=workflow
   ```

The included workflow builds and deploys on every push. The site appears at
`https://USERNAME.github.io` about a minute later. From then on, the studio's Publish button is all
you need.

### Cloudflare Pages

Optional, and worth it for unlimited traffic and a faster network.

1. Create a free account at [cloudflare.com](https://cloudflare.com) and open Workers & Pages.
2. Choose Create → Pages → Connect to Git, authorise GitHub, and pick the repository.
3. Set the build command to `node build.js` and the output directory to `dist`. Leave the rest alone.

Both hosts then rebuild from the same repository on every push.

### Custom domain

Buy the domain, put it in the studio under Profile & site, and publish. The build writes the `CNAME`
file automatically. Then point the domain at whichever host you prefer, following that host's DNS
instructions.

## Mirror to a university web space

`scripts/deploy-uwaterloo.sh` rebuilds the site with a `/~userid` path prefix and rsyncs it over SSH:

```bash
UW_USER=yourid ./scripts/deploy-uwaterloo.sh
```

Override `UW_HOST`, `UW_PATH`, `UW_BASE` or `UW_URL` if your faculty's server differs.

## Search, feed, SEO

`build.js` also writes `search.json` (used by `/search/`), `feed.xml` (RSS for notes), `sitemap.xml`,
`robots.txt`, and JSON-LD structured data for you, each app and each paper.
