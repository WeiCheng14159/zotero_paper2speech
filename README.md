# Paper2Speech for Zotero

<img src="addon/content/icons/icon.svg" width="64" height="64" alt="Paper2Speech: a document with a speaker" />

Read a selected paper aloud using Apple's built-in macOS speech engine. PDF text extraction and speech run locally; no API key, cloud service, Python environment, or external PDF converter is needed.

Built with the scaffold and lifecycle structure from [windingwind/zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template), using [Zotero Local PDF Manager](https://github.com/WeiCheng14159/zotero-local-pdf-manager) as the reference for Zotero menu integration and XPI packaging. Template reference: commit `306d4e2a0959a7b2f5e44bb38169fb25f841dbaf`.

## Install

Download `paper-2-speech.xpi` from the [latest release](https://github.com/WeiCheng14159/zotero_paper2speech/releases/latest). In Zotero, open **Tools → Plugins**, then the gear menu → **Install Plugin From File…**. Select the XPI. Playback requires macOS.

## Use

1. Select one paper (with a downloaded PDF) or a PDF attachment in Zotero.
2. Click the **Play triangle** in the library toolbar, beside the search box.
3. Click the **Stop square** to stop reading. Stop is disabled when idle.

The same Play/Stop icons appear near the right side of the **PDF reader toolbar**, and work directly on that PDF. Both sets of controls stay in sync. Each icon has a tooltip and an accessible label. The right-click and Tools menu commands remain available.

**Tools → Paper2Speech → Read Current Paper Aloud** reads the open PDF tab, or the selected library item when the library tab is active. Starting another reading stops the previous one. Stop also cancels a pending extraction. Disabling the plugin or quitting Zotero stops its speech process.

Open **Zotero → Settings → Paper2Speech** to choose an installed macOS voice and set the reading speed with a slider or number input (80–450 words per minute; default: 180). **Tools → Paper2Speech → Settings…** opens the same panel. Changes save automatically and apply to the next reading. Existing voice and speed preferences are preserved. Choose **System default** to use your macOS voice; additional voices can be installed through macOS Accessibility settings. The panel follows the registration pattern used by `zotero-md`.

The menu shows whether PDF extraction or reading is in progress. The entire PDF is extracted, independent of Zotero's full-text indexing page limit. Scanned PDFs need OCR; missing local PDFs must be downloaded first. Text follows the PDF's extraction order, so columns, equations, headers, and references may not sound natural. This version supports start/stop, not pause/resume or word highlighting.

## Build and install

Requires Node.js 22.8+ (CI uses Node.js 24). Playback requires macOS. Manifest compatibility: Zotero 7–10; verified with Zotero 10.0.6 on macOS.

```sh
npm ci
npm test
npm run build
npm run verify:build
```

`npm run test:integration` then launches Zotero with a disposable profile and data directory, imports a generated two-page PDF fixture, exercises the actual library and reader toolbar buttons, and verifies the plugin icon, preference saving, validation, synchronized Stop state, and shutdown cleanup. It briefly produces audible speech and saves screenshots of the preferences, library, and reader. Seven unit tests and twenty-four integration checks passed on Zotero 10.0.6.

The installable `.xpi` is in `.scaffold/build/`. In Zotero, open **Tools → Plugins** (called Add-ons in some versions), choose the gear menu → **Install Plugin From File…**, and select the XPI.

For local development deployment:

```sh
npm run deploy -- '/absolute/path/to/Zotero/profile' --restart
```

This gracefully quits Zotero, backs up any previous Paper2Speech XPI, installs through Zotero's add-on manager, verifies live initialization and menu registration, and relaunches Zotero normally. The installer briefly enables a localhost debugger, then restores the previous preferences and removes its temporary installer on restart. Deployment backups are kept under `.scaffold/deploy-*/`. This avoids Zotero 10's default behavior of ignoring newly copied XPIs in an existing profile. To find your profile, read `~/Library/Application Support/Zotero/profiles.ini` on macOS. The profile directory is separate from the library data directory.

For scaffold hot reload, copy `.env.example` to `.env`, configure a dedicated development profile/data directory, and run `npm start`. The scaffold runner can stop running Zotero processes; use it only when your regular Zotero session is closed.

## Structure

- `addon/bootstrap.js`: template-style startup, window, and shutdown hooks.
- `src/index.ts`: menus, toolbar registration, selected/open paper handling.
- `src/controls.ts`: themed SVG playback buttons in the PDF reader.
- `src/preferences.ts`: voice list, speed controls, validation, and persistence.
- `addon/content/preferences.xhtml`: native Zotero preferences panel.
- `src/paper.ts`: PDF resolution and Zotero full-text extraction.
- `src/speech.ts`: text cleanup and cancellation-safe playback state.
- `src/native.ts`: `/usr/bin/say` with text over stdin and owned-process termination.
- `scripts/deploy.mjs`: repeatable local deployment with backup and active-status verification.
- `test/`: cancellation, replacement, errors, argument validation, and text normalization tests.

CI checks formatting, unit tests, TypeScript, the packaged monochrome SVG icon, and update-feed checksums, then uploads the XPI and update metadata as artifacts. Native speech and UI integration tests run locally on macOS with Zotero installed.

To release, bump the version in `package.json` and `package-lock.json`, commit, and push a matching `vX.Y.Z` tag. Only after CI passes does the release job publish the versioned XPI and refresh `update.json` on the persistent `release` tag, which Zotero uses for automatic updates. The original monochrome document-and-speaker icon is bundled with the plugin and shared by the plugin manager and preferences panel.

## License

AGPL-3.0-or-later. The template lifecycle/build conventions are adapted from windingwind's AGPL-licensed Zotero Plugin Template. See [LICENSE](LICENSE).
