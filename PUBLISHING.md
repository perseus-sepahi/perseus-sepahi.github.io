# Publishing guide

How to put the apps and this website online, keeping the source code private.

---

## 1. Closed-source apps on GitHub

GitHub does not require you to publish source code. The standard pattern is **two repositories per app**:

| Repository | Visibility | Contains |
| --- | --- | --- |
| `chisel` | **private** | All source code. Nobody but you can see it. Private repos are unlimited and free. |
| `chisel-app` | **public** | No source. A README, screenshots, an end-user licence, the issue tracker, and the compiled binaries attached to **Releases**. |

Users download from the public repo's Releases page. The code never leaves the private one.

### Why Releases rather than committing the binary

Release assets are stored outside the repository. They do not count against the repository size,
GitHub does not limit their total size or download bandwidth, and each file may be up to 2 GiB.
Committing a 200 MB `.app` into git instead would bloat the repo forever.

### Setting it up once per app

```bash
gh repo create <you>/chisel --private --source=. --remote=origin --push
gh repo create <you>/chisel-app --public --description "Chisel — text-to-CAD for engineers"
```

In the public repo, commit only: `README.md`, `LICENSE.md` (your end-user licence, not an open-source
licence), and a `screenshots/` folder. Turn on Issues so users can report bugs; turn off everything else.

### Cutting a release

Build locally, then attach the artifacts:

```bash
gh release create v1.0.0 --repo <you>/chisel-app \
  --title "Chisel 1.0.0" --notes-file CHANGELOG-1.0.0.md \
  dist/Chisel-1.0.0.dmg
```

The website picks this up automatically: set `"releases": "<you>/chisel-app"` in
`content/software/chisel.json` and every download button with an empty `url` points at
`https://github.com/<you>/chisel-app/releases/latest`, which always resolves to the newest version.
The app page also shows the latest tag and date, fetched at page load.

### Do not build private repos on GitHub Actions

Actions minutes are free and unlimited for **public** repos only. Private repos get 2,000 minutes per
month, and macOS runners burn them **10× faster**, so ~200 real minutes. Build the apps on your own
Mac and upload. Only the website repo (public, Linux, a few seconds per build) should use Actions.

### A licence file is still needed

"Not open source" still needs a licence, otherwise users have no legal permission to run the binary.
A short end-user licence in the public repo is enough: free for personal use, no redistribution, no
reverse engineering, no warranty. This is not legal advice; for anything commercial, get a lawyer.

---

## 2. What each platform actually requires

| Platform | How users install | Apple/Google account needed | Cost |
| --- | --- | --- | --- |
| macOS (outside App Store) | Download `.dmg` from GitHub Releases | Developer ID certificate to avoid Gatekeeper warnings | $99/yr (Apple Developer Program) |
| macOS (App Store) | App Store | Yes | $99/yr |
| iOS / watchOS | **App Store or TestFlight only** | Yes, no exceptions | $99/yr |
| Android | Download `.apk` from GitHub Releases | No | Free (Play Store is $25 once) |

### The macOS signing reality

Without a Developer ID certificate and notarization, macOS shows *"Apple could not verify this app is
free of malware"* and users must open System Settings → Privacy & Security → Open Anyway. Many give
up there. With the $99 program:

```bash
codesign --deep --force --options runtime --timestamp \
  --sign "Developer ID Application: Your Name (TEAMID)" dist/Chisel.app
xcrun notarytool submit Chisel.dmg --apple-id you@example.com --team-id TEAMID --wait
xcrun stapler staple Chisel.dmg
```

Until then, ship ad-hoc signed builds and document the workaround on the app page:

> Right-click the app → Open → Open. Or run `xattr -dr com.apple.quarantine /Applications/Chisel.app`.

### iOS and watchOS have no free path

There is no way to give an iPhone or Apple Watch app to the public without the $99/yr Apple Developer
Program. TestFlight still requires it, caps external testers at 10,000, expires builds after 90 days,
and external test groups go through App Review anyway.

---

## 3. The website

### Domain

| Option | Address | Cost |
| --- | --- | --- |
| GitHub Pages user site | `https://<username>.github.io` | Free forever |
| GitHub Pages project site | `https://<username>.github.io/<repo>` | Free forever |
| Custom domain | `https://yourname.dev` etc. | ~$12–15/yr, or **free for one year** with the GitHub Student Developer Pack (`.me` via Namecheap) |
| University web space | `https://www.student.math.uwaterloo.ca/~<watiam-id>` | Free, but disappears when you graduate |

Pick the username carefully: `perseussepahi.github.io` reads better on a CV than a nickname. The
repository must be named exactly `<username>.github.io` to get the root URL.

A custom domain is worth it for one reason: it survives. If GitHub Pages is replaced in five years you
re-point the DNS and every link you ever printed still works.

### Space and limits

| Limit | Value |
| --- | --- |
| Published site size | 1 GB (soft) |
| Repository size | 1 GB recommended |
| Bandwidth | 100 GB per month (soft) |
| Builds | 10 per hour (soft) |
| Release assets (app downloads) | 2 GiB per file, **no total size or bandwidth limit** |

This site is currently under 10 MB, so the 1 GB limit is not a practical concern. App binaries go to
Releases, not into the site, which is why the site stays small.

### Public or private website repo?

GitHub Pages works from a private repository only on GitHub Pro. Students get Pro free through the
Student Developer Pack. But the published site is publicly visible either way, and this repo contains
nothing secret, so keep it **public** and do not depend on the Pro benefit.

### Publishing

1. Fill in `url` and `links.github` in `site.config.json`.
2. Create `<username>.github.io` on GitHub and push this folder to `main`.
3. Repository → Settings → Pages → Source: **GitHub Actions**.
4. Every push rebuilds and deploys in about 40 seconds.

For a custom domain, set `customDomain` in `site.config.json` (the build writes the `CNAME` file), then
add the DNS records from GitHub's custom-domain documentation and enable Enforce HTTPS.

---

## 4. Order of operations

1. Publish the website first. It costs nothing and gives every app a home page to link to.
2. Fix the licensing blockers listed in `READINESS.md` before any binary goes out.
3. Ship the Mac apps from GitHub Releases, ad-hoc signed, with the quarantine workaround documented.
4. Join the Apple Developer Program when you are ready for the iPhone and Watch apps, then notarize
   the Mac builds with the same membership.
