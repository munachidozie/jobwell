# JobWell

A private, local-first job-search app for **Windows**. Inspired by the
job-search app category (e.g. the macOS app *jobleft* and services like
*jobright*), JobWell is an original, independent implementation.

Everything stays on your machine: your profile, the jobs you pull, and your
application tracker all live in a local SQLite database under
`%APPDATA%/jobwell`. Nothing is uploaded.

## What it does (first milestone)

- **Feed** — pulls real postings from public employer boards (Greenhouse and
  Lever to start), stored locally.
- **Match scores** — a transparent 0–100 score with a band (Strong / Good /
  Fair / Weak). Three weighted factors: level (35), skills (45), industry (20).
  Every score shows its reasons and is **deterministic** — the same profile and
  job always produce the same score.
- **Tracker** — mark jobs Applied / Interviewing / Offer / Rejected / Archived.
- **Profile** — your function, level, skills, industries and experience. Used
  only to rank jobs locally.

## Stack

- Electron + React + TypeScript
- SQLite via `sql.js` (SQLite compiled to WebAssembly — no native build step,
  runs on any Node/Electron version)
- Vite for the renderer, `tsc` + `tsc-alias` for the main/preload processes
- electron-builder for packaging the Windows installer

## Privacy

- Each board request sends a plain `jobwell/<version>` User-Agent and no
  personal data.
- Requests are made one board at a time with a one-second delay between hosts.
- No analytics, no telemetry.

## Develop

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm test        # run the match-scoring tests
pnpm build       # compile renderer + main
pnpm start       # build then launch the Electron app
```

## Package a Windows installer

```bash
pnpm icon        # (re)generate build/icon.ico + build/icon.png from the placeholder
pnpm dist        # build, then produce release/JobWell Setup <version>.exe (NSIS)
pnpm dist:dir    # build an unpacked app under release/win-unpacked (no installer)
```

The installer and app shortcuts use `build/icon.ico`; the running window/taskbar
uses `build/icon.png`. Both are a **placeholder "JW" monogram** — replace
`build/icon.svg` with real artwork and re-run `pnpm icon` (or drop in your own
`.ico`/`.png`) to rebrand.

Notes:

- The app is **not code-signed**, so Windows SmartScreen will warn on first run
  ("More info → Run anyway"). Signing needs a certificate.
- The packaged `.exe` keeps Electron's default file icon in Explorer because
  embedding a custom exe icon (via `rcedit`) requires symlink-creation
  privileges the build host may lack (Developer Mode / admin). The installer,
  Start-menu/desktop shortcuts, and the running window still show the JobWell
  icon. Enabling Developer Mode and setting `win.signAndEditExecutable` back to
  `true` would embed the exe icon too.
- `sql.js`'s WebAssembly file is `asarUnpack`-ed so it can be read from disk at
  runtime inside the packaged app.

## Roadmap

- More board providers (Ashby, Workable, Recruitee, …)
- Filters and saved searches with alerts
- Resume import, readability grading, keyword-gap and tailoring
- Optional, pluggable AI (local Ollama / LM Studio, or your own key)
- A form-fill browser extension

## Licence

MIT. JobWell is original work and does not copy or redistribute any other
product's code.
