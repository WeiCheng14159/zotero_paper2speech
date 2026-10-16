# Development

## Build and test

Requires Node.js 22.8+; CI uses Node.js 24. Native speech tests require macOS and Zotero. The plugin has been tested with Zotero 10.0.6.

```sh
npm ci
npm run lint:check
npm test
npm run build
npm run verify:build
```

The installable plugin is `.scaffold/build/paper-2-speech.xpi`.

For native UI and speech tests, run `npm run test:integration` after building. It launches Zotero with a disposable profile and data directory, briefly speaks a generated PDF, and checks the icon, playback controls, preferences, and shutdown cleanup. Results and screenshots are saved under `.scaffold/integration-*/`.

## Local deployment

```sh
npm run deploy -- '/absolute/path/to/Zotero/profile' --restart
```

This quits Zotero, backs up the previous XPI, installs through Zotero's add-on manager, verifies initialization, and relaunches Zotero normally. It temporarily enables a localhost debugger and restores the prior debugger preferences afterward. Backups stay under `.scaffold/deploy-*/`; keep them private.

Find your profile in `~/Library/Application Support/Zotero/profiles.ini` on macOS. The profile directory is **not** the library data directory. Simply copying an XPI into an existing profile may not install it on Zotero 10.

For hot reload, copy `.env.example` to `.env`, configure a dedicated development profile and data directory, then run `npm start`. Close your regular Zotero session first: the scaffold runner can stop running Zotero processes.

## Releases

1. Update the version in `package.json` and `package-lock.json`.
2. Commit and push the changes.
3. Push a matching `vX.Y.Z` tag.

CI checks formatting, dependency vulnerabilities, unit tests, TypeScript, packaged icons, and update-feed checksums. After those checks pass, the release job publishes the XPI and refreshes `update.json` on the persistent `release` tag for Zotero's automatic updates. Native integration tests run locally, not in CI.

## Code layout

- `addon/`: lifecycle hooks, manifest, icons, defaults, and preferences markup.
- `src/index.ts` and `src/controls.ts`: menus and library/reader controls.
- `src/preferences.ts`: voice selection, speed, and persistence.
- `src/paper.ts`: local PDF resolution and full-text extraction.
- `src/speech.ts` and `src/native.ts`: cancellation-safe playback through `/usr/bin/say`.
- `scripts/` and `test/`: deployment, package verification, and tests.

## Credits

The build and lifecycle conventions are adapted from [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template), reference commit `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf`, under AGPL-3.0-or-later. [Zotero Local PDF Manager](https://github.com/WeiCheng14159/zotero-local-pdf-manager) informed menu integration and packaging; [zotero-md](https://github.com/WeiCheng14159/zotero-md) informed preferences registration. The monochrome document-and-speaker icon was created for this plugin.

[Back to README](README.md)
