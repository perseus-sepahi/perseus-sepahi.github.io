# {{APP_NAME}}

{{TAGLINE}}

**[Download the latest version]({{RELEASES_URL}})** · [Website]({{SITE_URL}})

![{{APP_NAME}}](screenshots/hero.png)

## What it does

{{DESCRIPTION}}

## Install

### macOS

1. Download the `.dmg` from [Releases]({{RELEASES_URL}}) and drag the app to Applications.
2. The first launch shows *"Apple could not verify this app is free of malware."* This build is not
   yet notarized. Right-click the app, choose **Open**, then **Open** again. You only do this once.

   Alternatively, in Terminal:

   ```bash
   xattr -dr com.apple.quarantine /Applications/{{APP_NAME}}.app
   ```

### Android

Download the `.apk`, then allow installs from your browser when Android prompts.

## Requirements

{{REQUIREMENTS}}

## Reporting bugs

Open an [issue]({{ISSUES_URL}}). Include your OS version, the app version, and the steps that
reproduce the problem.

## Source code

{{APP_NAME}} is free to use but not open source. This repository holds the releases, the issue
tracker, and the documentation only.

## Licence

See [LICENSE.md](LICENSE.md). Third-party components and their licences are listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
