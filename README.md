# JobWell

JobWell is a local-first, privacy-focused desktop job-search assistant built with Electron, React, TypeScript, and SQLite via `sql.js`. It helps a job seeker discover jobs from ATS boards and public remote feeds, rank them against a profile, assess work-location eligibility, track applications, analyze and tailor resumes, generate AI-assisted cover letters and interview prep, manage LinkedIn contacts for outreach, compute pipeline analytics, and export/import encrypted backups.

A companion browser extension can fill visible application fields from JobWell data. **The extension never submits a form** — there is no code path that calls `form.submit()` or clicks a submit button.

**Main entry point:** `src/main/main.ts`  
**Preload bridge:** `src/preload/preload.ts`  
**Renderer root:** `src/renderer`  
**Shared pure logic:** `src/shared`  
**App version referenced in code:** `0.1.0`

---

## Architecture at a Glance

```text
src/
  main/          Electron main process, IPC, storage, scrapers, AI, local server
  preload/       Context-isolated bridge exposing window.jobwell
  renderer/      React/Vite renderer
  shared/        Pure, deterministic domain logic and shared types
extension/       Chrome/Edge MV3-style extension scripts
```

- The **renderer** talks to the main process only through the typed `window.jobwell` API.
- `JobService` contains the portable application core. It depends on a `Storage` interface and injected collaborators, not directly on Electron.
- `SqliteStorage` implements `Storage` using `sql.js` (SQLite compiled to WebAssembly), persisting the database to `jobwell.db` after every write.
- Pure domain modules in `src/shared` handle matching, filtering, eligibility, parsing, truth checking, contacts, analytics, deduplication, and crawl policy.
- AI providers are routed through `src/main/ai.ts`. API keys are stored in the OS key store via Electron `safeStorage`, never in SQLite and never returned to the renderer.
- A loopback-only HTTP server (`127.0.0.1`) lets the paired browser extension fetch form-fill data using a per-launch token.

---

## Installation

### Prerequisites

- Node.js 20+ recommended (the code comments reference Electron 33’s bundled Node 20).
- `pnpm` is used in project comments; `npm` or `yarn` should also work if the repository’s `package.json` is configured accordingly.
- Chrome or Edge for loading the extension.

### Install dependencies

The provided code imports the following packages. The repository is expected to declare them in `package.json`; install with your package manager.

```bash
pnpm install
```

Inferred runtime dependencies:

| Package | Purpose |
|---|---|
| `electron` | Desktop shell, IPC, dialogs, `safeStorage` |
| `react`, `react-dom` | Renderer UI |
| `sql.js` | SQLite compiled to WebAssembly |
| `pdfkit` | PDF generation |
| `docx` | DOCX generation |
| `mammoth` | DOCX text extraction |
| `pdf-parse` | PDF text extraction |

Inferred development dependencies:

| Package | Purpose |
|---|---|
| `vite` | Renderer build/dev server |
| `@vitejs/plugin-react` | React support in Vite |
| `typescript` | Type checking |
| `vitest` | Unit tests |

Node built-ins used: `node:fs`, `node:path`, `node:crypto`, `node:http`, `node:module`, `node:net`.

### Run the app

```bash
# Development: starts Vite dev server and Electron with JOBWELL_DEV=1
pnpm dev

# Production-style local run: builds renderer to dist/renderer and loads it
pnpm start
```

The Vite dev server runs on port `5273` and uses `strictPort: true`.

### Run tests

```bash
pnpm test
```

`vitest.config.ts` scans `src/**/*.{test,spec}.{ts,tsx}`, uses the `node` environment, and maps `@shared` to `src/shared`.

### Load the browser extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose “Load unpacked” and select the `extension/` directory.
4. In JobWell, retrieve the pairing port and token via the `extension:pairing` IPC/API.
5. In the extension popup, enter the port and token and click **Pair**.

---

## Usage

### Desktop workflow

1. **Configure your profile** — job function, level, location, skills, industries, years of experience, base country, and work authorizations. These drive matching and eligibility.
2. **Import a resume** — supports `.pdf`, `.docx`, and `.txt`. Text is extracted and stored locally.
3. **Manage job sources** — default sources are seeded on first run: RemoteOK, Remotive, Stripe (Greenhouse), Netflix (Lever), and Ramp (Ashby). Add or remove sources from the Sources tab. Custom RSS/Atom or JSON sources are supported.
4. **Refresh jobs** — fetches enabled sources, caches FX rates, and upserts jobs.
5. **Filter and rank** — free-text search, location, work model, provider, minimum match percent, posting age, eligibility, sponsorship, and minimum annual USD pay.
6. **Track applications** — set status, notes, and follow-up reminders. Status transitions are logged for analytics.
7. **Use AI features** — cover letters, assistant Q&A, outreach drafts, and interview prep. AI output is checked by the truth gate against resume/profile facts.
8. **Analyze pipeline** — funnel conversion, status counts, interview/offer/rejection rates, breakdowns by eligibility/work model/source, and time-in-stage.
9. **Back up** — export a plain JSON backup or an encrypted `.jobwell` file with a passphrase. Import supports both formats.

### Browser extension workflow

1. Pair the extension with JobWell using the port and token.
2. Open a supported application page — the popup mentions Greenhouse, Lever, Ashby, and Workable.
3. Click **Fill**.
4. Review every filled field.
5. Submit the form yourself. The extension never submits.

### Example: renderer API usage

```ts
// In the renderer, window.jobwell is typed by src/preload/preload.ts
const jobs = await window.jobwell.listJobs();
const eligible = jobs.filter(
  (j) => j.eligibility?.verdict === "eligible",
);
```

### Example: refresh enabled job sources

```ts
const result = await window.jobwell.refreshJobs();
console.log(`Added ${result.added} new jobs; total ${result.total}`);
```

---

## API Reference

### 1. Build and Test Configuration

#### `vite.config.ts`

Configures the renderer build.

| Setting | Value |
|---|---|
| `root` | `src/renderer` |
| `base` | `"./"` — relative asset paths so `file://` loading works in production |
| Plugin | `@vitejs/plugin-react` |
| Alias | `@shared` → `src/shared` |
| Build output | `dist/renderer`, `emptyOutDir: true` |
| Dev server | port `5273`, `strictPort: true` |

#### `vitest.config.ts`

Separate Vitest config so tests scan the whole `src` tree, not just the renderer root.

| Setting | Value |
|---|---|
| Alias | `@shared` → `src/shared` |
| Test root | project root |
| Include | `src/**/*.{test,spec}.{ts,tsx}` |
| Environment | `node` |
| Special handling | `node:sqlite` is externalized/excluded from Vite transforms |

---

### 2. Electron Main Entry and IPC

#### `src/main/main.ts`

**Description:** Electron main-process entry point. Creates the `JobService`, registers IPC handlers, starts the loopback server, seeds default job sources, and opens the main window.

**Key functions and lifecycle:**

| Function / export | Description |
|---|---|
| `createService(): Promise<JobService>` | Builds `SqliteStorage` under `app.getPath("userData")` and constructs `JobService` with concrete collaborators. |
| `iconPath(): string` | Resolves the window icon from packaged resources or `build/icon.png` in development. |
| `createWindow(): void` | Creates the `BrowserWindow` with context isolation, preload script, and dev-server or built-file loading. |
| `registerIpc(): void` | Registers all IPC handlers. Handlers are thin adapters that forward to `JobService`. |
| `DEFAULT_SOURCES` | Default seeded sources: RemoteOK, Remotive, Stripe, Netflix, Ramp. |
| `app.whenReady()` | Creates service, seeds sources, registers IPC, starts local server, registers `extension:pairing`, opens window. |
| `app.on("window-all-closed")` | Stops the local server and quits on non-macOS. |

**Dev-server behavior:** `useDevServer` is true only when `process.env.JOBWELL_DEV === "1"`. `pnpm start` builds the renderer and loads `dist/renderer/index.html`, not the dev server.

**IPC channel reference:**

| Group | Channels |
|---|---|
| Profile | `profile:get`, `profile:save`, `profile:addFact`, `profile:removeFact` |
| Jobs | `jobs:list`, `jobs:refresh` |
| Status / FX | `status:history`, `fx:status` |
| Applications | `application:set`, `application:reminder`, `application:untrack` |
| Saved searches | `savedSearch:list`, `savedSearch:create`, `savedSearch:delete`, `savedSearch:markSeen` |
| Resume | `resume:import`, `resume:get`, `resume:analyze`, `resume:tailor` |
| Contacts | `contacts:import`, `contacts:importText`, `contacts:list`, `contacts:whoToMessage`, `contacts:delete`, `contacts:clear`, `contacts:draftOutreach` |
| Interview prep | `interview:prep` |
| AI | `ai:getConfig`, `ai:setConfig`, `ai:coverLetter`, `ai:ask` |
| Sources | `sources:list`, `sources:add`, `sources:delete`, `sources:validateCustom` |
| Backup / delete | `data:export`, `data:import`, `data:deleteAll` |
| Document export | `doc:export` |
| Extension pairing | `extension:pairing` |

**Example: export data with optional encryption**

```ts
const result = await window.jobwell.exportData("my strong passphrase");
// result: { saved: boolean, path?: string, encrypted?: boolean }
```

**Example: import data; prompt for passphrase if needed**

```ts
const result = await window.jobwell.importData("merge");
if (result && "needsPassphrase" in result && result.needsPassphrase) {
  const passphrase = prompt("Enter backup passphrase");
  await window.jobwell.importData("merge", passphrase);
}
```

---

#### `src/preload/preload.ts`

**Description:** Exposes a narrow, typed API to the renderer as `window.jobwell`. No Node or `ipcRenderer` access leaks to the page.

**Exposed API type:** `JobWellApi` from `src/shared/types.ts`.

**Example:**

```ts
const profile = await window.jobwell.getProfile();
await window.jobwell.saveProfile({
  jobFunction: "Software Engineer",
  level: "senior",
  location: "Remote",
  skills: ["typescript", "react"],
  industries: ["fintech"],
  yearsExperience: 6,
  baseCountry: "nigeria",
  workAuthorizations: [],
  supplementaryFacts: [],
});
```

#### `src/renderer/global.d.ts`

Declares the global `window.jobwell: JobWellApi` type for the renderer.

---

### 3. Core Application Service — `src/main/JobService.ts`

**Description:** The portable application core. `JobService` coordinates storage, scraping, matching, eligibility, AI, resume analysis, contacts, analytics-adjacent data, and portability. It is intentionally free of Electron-specific code so it can run on a server or another shell.

#### `ServiceDeps`

| Dependency | Description |
|---|---|
| `storage: Storage` | Persistence backend. |
| `fetchBoards(boards: BoardRef[])` | Fetch jobs from built-in board providers. |
| `chat(params)` | AI chat entry point. |
| `secrets` | `hasApiKey`, `storeApiKey`, `clearApiKey`. |
| `pickAndExtractResume()` | Open a file dialog and extract resume text. |
| `pickAndParseContactsCsv()` | Open a file dialog and parse LinkedIn CSV. |
| `fetchFxRates()` | Fetch live FX rates. |
| `fetchCustom(cfg, sourceKey)` | Fetch a custom RSS/JSON source. |

#### `class JobService`

| Method | Description | Returns |
|---|---|---|
| `constructor(deps)` | Stores collaborators. | — |
| `buildJobsWithMatch()` | Decorates stored jobs with match score, application, eligibility, and parsed pay. | `Promise<JobWithMatch[]>` |
| `getProfile()` | Read profile. | `Promise<Profile \| null>` |
| `saveProfile(p)` | Save profile. | `Promise<Profile>` |
| `addSupplementaryFact(fact)` | Add a true fact; trims, ignores blanks, dedupes repeats. | `Promise<Profile \| null>` |
| `removeSupplementaryFact(fact)` | Remove a saved fact. | `Promise<Profile \| null>` |
| `listJobs()` | Same as `buildJobsWithMatch`. | `Promise<JobWithMatch[]>` |
| `listStatusHistory()` | Raw application status log, oldest-first. | `Promise<StatusHistoryEntry[]>` |
| `getFxStatus()` | Cached FX date/fetch timestamp. | `Promise<{ date, fetchedAt } \| null>` |
| `refreshJobs(boards?)` | Fetch FX, then enabled sources or explicit boards; upsert jobs. | `Promise<{ added: number; total: number }>` |
| `setApplicationStatus(jobId, status, notes?)` | Track/update application. | `Promise<Application>` |
| `setReminder(jobId, reminderAt)` | Set/clear follow-up reminder. | `Promise<Application>` |
| `untrack(jobId)` | Delete application and status history. | `Promise<void>` |
| `listSavedSearches()` | Saved searches with match/new counts. | `Promise<SavedSearchWithCount[]>` |
| `createSavedSearch(name, filter, alert)` | Create saved search. | `Promise<SavedSearch>` |
| `deleteSavedSearch(id)` | Delete saved search. | `Promise<void>` |
| `markSavedSearchSeen(id)` | Record currently matching job IDs as seen. | `Promise<void>` |
| `importResume()` | Pick and import resume. | `Promise<Resume \| null>` |
| `getResume()` | Read stored resume. | `Promise<Resume \| null>` |
| `analyzeResume()` | Readability + keyword gaps against top jobs. | `Promise<ResumeAnalysis \| null>` |
| `tailorForJob(jobId)` | Truthful, non-fabricating tailoring suggestions. | `Promise<TailorResult \| null>` |
| `importContacts(mode)` | Pick and import LinkedIn CSV. | `Promise<(ContactImportResult & { stored: number }) \| null>` |
| `importContactsFromText(csvText, mode)` | Import CSV text from drag-and-drop. | `Promise<ContactImportResult & { stored: number }>` |
| `listContacts()` | List stored contacts. | `Promise<Contact[]>` |
| `deleteContact(id)` | Delete one contact. | `Promise<void>` |
| `clearContacts()` | Delete all contacts. | `Promise<void>` |
| `whoToMessage()` | Rank contacts against pursued companies and target role. | `Promise<RankedContact[]>` |
| `draftOutreach(contactId)` | Draft honest outreach message via AI and truth gate. | `Promise<AiResult>` |
| `prepInterview(jobId)` | Generate interview questions and honest talking points. | `Promise<InterviewPrep \| null>` |
| `getAiConfig()` | AI config with `hasKey` flag. | `Promise<AiConfigPublic>` |
| `setAiConfig(config)` | Save provider/model/base URL and optionally API key. | `Promise<AiConfigPublic>` |
| `generateCoverLetter(jobId, gapFacts?)` | Generate cover letter with truth-gate check. | `Promise<AiResult>` |
| `askAssistant(question)` | Answer using job/resume context and truth gate. | `Promise<AiResult>` |
| `listJobSources()` | List stored sources. | `Promise<StoredJobSource[]>` |
| `addJobSource(source)` | Add/update source. | `Promise<StoredJobSource>` |
| `deleteJobSource(id)` | Delete source. | `Promise<void>` |
| `validateCustomSource(cfg)` | Validate custom RSS/JSON config. | `Promise<{ ok: boolean; error: string \| null }>` |
| `seedDefaultSourcesIfEmpty(defaults)` | Seed only when no sources exist; never overwrites user changes. | `Promise<void>` |
| `getActiveBoards()` | Enabled stored sources as `BoardRef[]`. | `Promise<BoardRef[]>` |
| `exportAll()` | Export full bundle. | `Promise<ExportBundle>` |
| `importAll(bundle, mode)` | Import bundle. | `Promise<ImportSummary>` |
| `deleteAllData()` | Import empty bundle in replace mode and clear AI key. | `Promise<void>` |

**Error behavior:** Storage and fetch errors generally propagate. `refreshJobs` catches FX-fetch failures and custom-source failures so one failure does not abort the refresh. AI methods return `AiResult` with `ok: false` for expected failures rather than throwing.

**Example: generate a cover letter with user-supplied gap facts**

```ts
const result = await service.generateCoverLetter(jobId, [
  "Built a Rust CLI for log parsing.",
]);

if (!result.ok) {
  console.error(result.text);
} else if (result.truthViolations?.length) {
  console.warn("Truth-gate findings:", result.truthViolations);
} else {
  console.log(result.text);
}
```

#### `parseInterviewJson(text)`

**Description:** Defensively parses model output into interview questions and talking points. Extracts the first `{...}` block, validates shape, defaults unknown question kinds to `"role-specific"`, drops empty questions, and filters non-string talking points.

**Parameters:**

| Name | Type | Description |
|---|---|---|
| `text` | `string` | Raw model response, possibly wrapped in prose or markdown fences. |

**Returns:** `{ questions: InterviewQuestion[]; talkingPoints: string[] } | null`

**Returns `null` when:** no JSON block exists, JSON is malformed, or both arrays are empty.

---

### 4. Persistence — `src/main/SqliteStorage.ts`

**Description:** SQLite-backed `Storage` implementation using `sql.js`. The database is held in memory and serialized to disk after every mutation. The async WASM initialization is handled by the static `create()` factory.

#### `class SqliteStorage implements Storage`

| Method | Description | Returns / Notes |
|---|---|---|
| `static create(opts)` | Initialize WASM, load existing DB or create in-memory DB, run migrations. | `Promise<SqliteStorage>` |
| `getProfile()` | Read single-row profile. | `Promise<Profile \| null>` |
| `saveProfile(p)` | Upsert profile. | `Promise<Profile>` |
| `listJobs()` | List jobs by `fetchedAt DESC`. | `Promise<Job[]>` |
| `upsertJobs(jobs)` | Insert new jobs; duplicates by ID ignored. | `Promise<number>` newly added |
| `deleteJobs(ids)` | Delete jobs by ID. | `Promise<void>` |
| `listApplications()` | List tracked applications. | `Promise<Application[]>` |
| `setApplicationStatus(jobId, status, notes?)` | Upsert application; logs status transition only when status changes. Preserves reminder. | `Promise<Application>` |
| `deleteApplication(jobId)` | Delete application and its status history. | `Promise<void>` |
| `listStatusHistory()` | List status transitions oldest-first. | `Promise<StatusHistoryEntry[]>` |
| `setReminder(jobId, reminderAt)` | Set/clear reminder on existing application. | `Promise<Application>` |
| `listSavedSearches()` | List saved searches newest-first. | `Promise<SavedSearch[]>` |
| `createSavedSearch(name, filter, alert)` | Insert saved search. | `Promise<SavedSearch>` |
| `deleteSavedSearch(id)` | Delete saved search. | `Promise<void>` |
| `updateSavedSearchSeen(id, jobIds)` | Store last-seen job IDs. | `Promise<void>` |
| `getResume()` | Read single-row resume. | `Promise<Resume \| null>` |
| `saveResume(fileName, text)` | Upsert resume. | `Promise<Resume>` |
| `listContacts()` | List contacts ordered by connected date/name. | `Promise<Contact[]>` |
| `replaceContacts(contacts)` | Delete all contacts, then add. | `Promise<number>` stored |
| `addContacts(contacts)` | Merge contacts, deduped by profile URL or name+company. | `Promise<number>` newly added |
| `deleteContact(id)` | Delete one contact. | `Promise<void>` |
| `clearContacts()` | Delete all contacts. | `Promise<void>` |
| `getAiConfig()` | Read non-secret AI config. | `Promise<AiConfigRow>` |
| `saveAiConfig(provider, model, baseUrl)` | Save non-secret AI config. | `Promise<void>` |
| `listJobSources()` | List sources. | `Promise<StoredJobSource[]>` |
| `addJobSource(source)` | Upsert source by `(provider, board)`. | `Promise<StoredJobSource>` |
| `deleteJobSource(id)` | Delete source. | `Promise<void>` |
| `getFxRates()` | Read cached FX rates. | `Promise<FxRates \| null>` |
| `saveFxRates(fx)` | Save cached FX rates. | `Promise<void>` |
| `exportAll()` | Build versioned export bundle. | `Promise<ExportBundle>` |
| `importAll(bundle, mode)` | Import merge/replace; validates app and schema. | `Promise<ImportSummary>` |

**Exceptions:**

- `importAll` throws `Error("Not a JobWell export file.")` when `bundle.app !== "jobwell"`.
- Newer schema versions are tolerated with a note in `ImportSummary.notes`.
- `create` can reject if `sql.js` WASM initialization or file loading fails.
- `replaceContacts` deletes all existing contacts before adding.

**Schema and migrations:** Tables include `profile`, `jobs`, `applications`, `saved_searches`, `resume`, `ai_config`, `job_sources`, `fx_rates`, `status_history`, and `contacts`. Additive migrations add missing columns such as `baseCountry`, `workAuthorizations`, `custom`, `reminderAt`, and `supplementaryFacts`.

**Helpers:**

- `dedupeKeyFor(contact)` — profile URL normalized, else lowercased name+company.
- `normalizeParams(params)` — coerces values for `sql.js` named parameters.
- `rowToJob(row)`, `rowToSavedSearch(row)` — row mappers.

**Example: in-memory storage for tests**

```ts
const storage = await SqliteStorage.create({
  memory: true,
  appVersion: "test",
});
```

---

### 5. AI, Secrets, Backups, Document Export, FX, Local Server

#### `src/main/ai.ts`

**Description:** Routes AI chat requests to the configured provider. API keys are encrypted with Electron `safeStorage` and stored in `ai.key.enc` under `app.getPath("userData")`.

| Function | Description | Returns / Exceptions |
|---|---|---|
| `hasApiKey()` | Whether an encrypted key file exists. | `boolean` |
| `storeApiKey(key)` | Encrypt and store key; empty key clears. | `void`; throws if OS secure storage unavailable |
| `clearApiKey()` | Delete stored key. | `void` |
| `chat(params)` | Route to provider and return normalized result. | `Promise<AiResult>`; catches provider/network errors into `ok: false` |

**`ChatParams`:**

```ts
interface ChatParams {
  provider: AiProvider;
  model: string | null;
  baseUrl: string | null;
  system: string;
  user: string;
}
```

**Supported providers:**

| Provider | Default base URL | Default model | Needs key? |
|---|---|---|---|
| `none` | — | — | — |
| `ollama` | `http://127.0.0.1:11434` | `llama3` | No |
| `lmstudio` | `http://127.0.0.1:1234` | `local-model` | No |
| `openai` | `https://api.openai.com` | `gpt-4o-mini` | Yes |
| `deepseek` | `https://api.deepseek.com` | `deepseek-chat` | Yes |
| `anthropic` | `https://api.anthropic.com` | `claude-3-5-haiku-latest` | Yes |

OpenAI-compatible providers use `/v1/chat/completions`. Anthropic uses `/v1/messages`.

---

#### `src/main/cryptoBackup.ts`

**Description:** Passphrase-based encryption for portable backups using Node’s built-in `crypto`. Uses `scrypt` for key derivation and AES-256-GCM for authenticated encryption. Each backup gets a random salt and IV.

| Function | Description | Returns / Exceptions |
|---|---|---|
| `encryptBackup(data, passphrase)` | Encrypt JSON-serializable data into an envelope. | `EncryptedEnvelope`; throws if passphrase < 6 chars |
| `isEncryptedEnvelope(obj)` | Type guard for JobWell encrypted backup envelopes. | `boolean` |
| `decryptBackup(envelope, passphrase)` | Decrypt envelope back to original value. | `unknown`; throws on wrong passphrase/tamper/not JobWell |
| `safeEqual(a, b)` | Constant-time string comparison. | `boolean` |

**Example:**

```ts
const envelope = encryptBackup({ app: "jobwell", data: {} }, "strong passphrase");
const restored = decryptBackup(envelope, "strong passphrase");
```

---

#### `src/main/documentExport.ts`

**Description:** Renders plain text to PDF or DOCX buffers using pure-JS libraries loaded through runtime `require`.

| Function | Description | Returns |
|---|---|---|
| `renderPdf(title, body)` | Render an A4 PDF with bold title and paragraphs. | `Promise<Buffer>` |
| `renderDocx(title, body)` | Render a DOCX with heading and paragraphs. | `Promise<Buffer>` |
| `renderDocument(format, title, body)` | Dispatch to PDF or DOCX. | `Promise<Buffer>` |

`ExportFormat` is `"pdf" | "docx"`.

---

#### `src/main/fx.ts`

**Description:** Fetches USD-based exchange rates from `open.er-api.com`. Returns `null` on failure so callers can use cached or fallback rates.

| Function | Description | Returns |
|---|---|---|
| `fetchFxRates()` | Fetch rates in “units per 1 USD” shape. | `Promise<FxRates \| null>` |

No exceptions are thrown for network/API failures; failures return `null`.

---

#### `src/main/localServer.ts`

**Description:** Minimal loopback-only HTTP server used by the paired browser extension. It binds to `127.0.0.1` only, never a public interface. CORS is restricted to extension origins.

| Function | Description | Returns |
|---|---|---|
| `startLocalServer(service)` | Generate token, bind random port on `127.0.0.1`, start server. | `Promise<number>` bound port |
| `stopLocalServer()` | Close server. | `void` |
| `getPairingToken()` | Current per-launch token. | `string` |
| `getLocalPort()` | Bound port. | `number` |

**Endpoints:**

| Endpoint | Token required? | Response |
|---|---|---|
| `OPTIONS *` | No | `204` with CORS headers |
| `/ping` | No | `{ ok: true, app: "jobwell" }` |
| `/fill-data` | Yes, `x-jobwell-token` | Profile location/job function and resume file name |
| Other paths | Yes for non-`/ping` | `401 unauthorized` or `404` |

**Example request from extension:**

```js
const res = await fetch(`http://127.0.0.1:${port}/fill-data`, {
  headers: { "x-jobwell-token": token },
});
```

---

#### `src/main/resume.ts`

| Function | Description | Returns / Exceptions |
|---|---|---|
| `pickAndExtractResume()` | Open file dialog for `.pdf`, `.docx`, `.txt`, extract text. | `Promise<{ fileName, text } \| null>`; `null` on cancel |
| `extractText(filePath)` | Extract text by extension. | `Promise<string>`; throws on unsupported format or parse failure |

---

#### `src/main/contacts.ts`

| Function | Description | Returns |
|---|---|---|
| `pickAndParseContactsCsv()` | Open CSV dialog and parse LinkedIn `Connections.csv`. | `Promise<ContactImportResult \| null>`; `null` on cancel |

---

### 6. Job Scrapers — `src/main/scrapers/`

#### `src/main/scrapers/index.ts`

**Description:** Central scraper dispatcher and crawl-safety guard. It checks a never-contact host list and `robots.txt` before fetching, normalizes work models, and fetches boards sequentially with a polite delay.

| Export | Description |
|---|---|
| `USER_AGENT` | `"jobwell/0.1.0"` |
| `mayFetch(origin, path)` | Refuse never-contact hosts and honor robots.txt. Returns `{ ok, reason? }`. |
| `inferWorkModel(text)` | Uses shared `parseWorkModel`; falls back to `"onsite"` when text exists but no remote/hybrid signal. |
| `politeDelay(ms = 1000)` | Delay between board fetches. |
| `fetchBoard(ref)` | Guard provider origin, dispatch to provider scraper. Returns `[]` on guard skip or unknown provider; provider HTTP errors propagate. |
| `fetchBoards(refs)` | Fetch boards sequentially, catching per-board errors and delaying between calls. |

**Robots behavior:** `robots.txt` is cached per origin. A 404/empty robots file allows; a 5xx response is treated conservatively as disallow for that run.

#### Provider scrapers

| File | Function | Endpoint / Notes |
|---|---|---|
| `greenhouse.ts` | `fetchGreenhouse(board)` | `https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true`; strips HTML from descriptions. |
| `lever.ts` | `fetchLever(board)` | `https://api.lever.co/v0/postings/{board}?mode=json`; maps `createdAt` epoch to ISO. |
| `ashby.ts` | `fetchAshby(board)` | `https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true`; handles `isRemote`. |
| `workable.ts` | `fetchWorkable(board)` | `https://apply.workable.com/api/v1/widget/accounts/{board}?details=true`; joins city/state/country. |
| `recruitee.ts` | `fetchRecruitee(board)` | `https://{board}.recruitee.com/api/offers/`; handles remote and location fields. |
| `remoteok.ts` | `fetchRemoteOk()` | `https://remoteok.com/api`; drops first legal-notice object; all roles remote. |
| `remotive.ts` | `fetchRemotive()` | `https://remotive.com/api/remote-jobs`; preserves `candidate_required_location`. |
| `custom.ts` | `fetchCustom(cfg, sourceKey)` | Fetches user RSS/JSON source after `mayFetch` guard; returns `[]` on invalid URL or guard failure; throws on HTTP error. |

**Example:**

```ts
const jobs = await fetchBoards([
  { provider: "greenhouse", board: "stripe" },
  { provider: "remoteok", board: "feed" },
]);
```

---

### 7. Shared Domain Modules — `src/shared/`

#### 7.1 Types and Storage Contracts

##### `src/shared/types.ts`

Defines the shared domain types used by main, preload, and renderer, including:

- `WorkModel`, `Job`, `Profile`, `JobLevel`
- `MatchScore`, `MatchReason`, `MatchBand`
- `Application`, `ApplicationStatus`, `StatusHistoryEntryDTO`
- `EligibilityInfo`, `PayDisplay`, `JobWithMatch`
- `JobFilter`, `SavedSearch`, `SavedSearchWithCount`, `Resume`
- `JobWellApi`
- `CustomSourceConfigDTO`, `JobSourceDTO`, `ImportSummaryDTO`
- `ResumeAnalysis`, `TailorResult`
- `InterviewQuestionKind`, `InterviewQuestion`, `InterviewPrep`
- `AiProvider`, `AiConfigInput`, `AiConfigPublic`, `AiResult`, `TruthViolationDTO`
- `BoardProvider`, `FEED_PROVIDERS`, `isFeedProvider`, `BoardRef`

`isFeedProvider(provider)` returns whether a provider is a global feed (`remoteok`, `remotive`) rather than a per-company ATS board.

##### `src/shared/storage.ts`

Defines the `Storage` interface and portability types.

Key exports:

| Export | Description |
|---|---|
| `Storage` | Contract implemented by SQLite or future backends. |
| `AiConfigRow` | Non-secret AI config. |
| `StatusHistoryEntry` | Status transition record. |
| `FxRates` | USD-based FX cache. |
| `StoredJobSource` | Stored source with optional custom config. |
| `CustomSourceFormat` | `"rss" \| "json"` |
| `CustomJsonMapping` | Dot-path mapping for JSON sources. |
| `CustomSourceConfig` | Custom source configuration. |
| `EXPORT_SCHEMA_VERSION` | Currently `2`. |
| `ExportBundle` | Versioned device-neutral snapshot. |
| `ImportMode` | `"merge" \| "replace"` |
| `ImportSummary` | Import counts and notes. |

---

#### 7.2 Matching and Synonyms

##### `src/shared/matching.ts`

| Function | Description | Returns |
|---|---|---|
| `inferLevelFromTitle(title)` | Infer `JobLevel` from title words. | `JobLevel` |
| `scoreJob(profile, job)` | Deterministic weighted score: role 30, skills 35, level 20, industry 15. | `MatchScore` |

**Behavior:** Every factor produces a `MatchReason` with points, weight, and detail. The total `percent` is the sum of reason points. Skill matching is synonym-aware via `mentionsRelated`; role matching uses `roleSimilarity`.

**Example:**

```ts
const score = scoreJob(profile, job);
console.log(score.percent, score.band);
for (const reason of score.reasons) {
  console.log(reason.factor, reason.points, reason.detail);
}
```

##### `src/shared/synonyms.ts`

| Function | Description | Returns |
|---|---|---|
| `relatedTerms(term)` | Return synonym group including the term, or `[term]` if unknown. | `string[]` |
| `mentionsRelated(haystack, term)` | True if text contains the term or a related term. | `boolean` |
| `containsTerm(haystack, term)` | Word-boundary-aware containment; phrases use inclusion. | `boolean` |
| `roleSimilarity(jobFunction, title)` | 0..1 token-overlap similarity with abbreviation expansion. | `number` |

---

#### 7.3 Filtering

##### `src/shared/filtering.ts`

| Function | Description | Returns |
|---|---|---|
| `parseQueryTerms(query)` | Split free text into terms, honoring quoted phrases and preserving special chars. | `string[]` |
| `applyFilter(items, filter)` | Pure filter with AND semantics across criteria. | `JobWithMatch[]` |
| `isEmptyFilter(filter)` | Whether a filter has no active criteria. | `boolean` |
| `sortByEligibilityThenMatch(items)` | Eligible first, then higher match percent. | `T[]` |

**Filter behavior:**

- `text` requires every parsed term to appear in title/company/description.
- `onlyEligible` keeps `eligible` and `eligible-with-sponsorship`.
- `onlySponsorship` keeps only `eligible-with-sponsorship`.
- `minAnnualUsd` hides jobs with stated pay below the floor but keeps jobs with no stated pay.
- `postedWithinDays` only excludes jobs with a parseable `postedAt` older than the limit.

**Example:**

```ts
const filtered = applyFilter(jobs, {
  text: '"machine learning" python',
  onlyEligible: true,
  minMatchPercent: 60,
  minAnnualUsd: 80000,
});
```

---

#### 7.4 Eligibility and Posting Parsers

##### `src/shared/eligibility.ts`

| Function | Description | Returns |
|---|---|---|
| `classifyEligibility(title, description, location, knownWorkModel?)` | Classify remote scope, locations, sponsorship, country lock, evidence. | `EligibilityFacts` |
| `assessEligibility(facts, ctx)` | Compute verdict relative to user base country and authorizations. | `EligibilityAssessment` |

**Types:**

- `RemoteScope`: `"worldwide" | "region" | "country" | "onsite" | "unknown"`
- `EligibilityVerdict`: `"eligible" | "eligible-with-sponsorship" | "likely-ineligible" | "unclear"`
- `UserEligibilityContext`: `{ baseCountry: string; workAuthorizations: string[] }`

**Important behavior:** Work arrangement is derived from authoritative title/location and known work model, not stray description marketing copy. An on-site San Francisco role is not classified as worldwide-remote just because the description says “global team.”

**Example:**

```ts
const facts = classifyEligibility(
  "Senior Software Engineer",
  "Visa sponsorship available.",
  "Berlin, Germany",
  "onsite",
);
const assessment = assessEligibility(facts, {
  baseCountry: "nigeria",
  workAuthorizations: [],
});
// assessment.verdict === "eligible-with-sponsorship"
```

##### `src/shared/parsers.ts`

| Function | Description | Returns |
|---|---|---|
| `parsePay(text, liveRates?)` | Extract salary candidate, period, currency, annualized USD. | `PayInfo` |
| `formatPay(pay)` | Format pay for display, e.g. `₦400k/mo (≈ $3.1k/yr)`. | `string \| null` |
| `parseLevel(title, description?)` | Infer seniority level. | `JobLevel` |
| `parseYearsRequired(text)` | Extract minimum/maximum years required. | `YearsRequired` |
| `parseWorkModel(text)` | Classify remote/hybrid/onsite. | `WorkModel` |
| `parseWorkAuth(text)` | Detect clearance, US citizenship, sponsorship offered/not. | `WorkAuthFacts` |
| `parsePosting(title, description)` | Run all parsers over title + description. | `ParsedPosting` |

**Pay parsing behavior:** Ignores piecework rates like “$1k per task,” bonuses, stipends, and other non-salary context. Prefers explicit salary periods. Converts non-USD pay to annual USD using live rates when provided, otherwise fallback rates, and flags approximate FX.

**Example:**

```ts
const pay = parsePay("₦400,000 per month");
console.log(formatPay(pay)); // "₦400k/mo (≈ $3.1k/yr)"
```

---

#### 7.5 Resume Analysis and Truth Gate

##### `src/shared/resume.ts`

| Function | Description | Returns |
|---|---|---|
| `readability(text)` | Flesch–Kincaid grade, word/sentence counts, note. | `ReadabilityResult` |
| `extractKeywords(text, limit = 40)` | Extract frequent keywords excluding stopwords. | `string[]` |
| `keywordGap(resumeText, job)` | Compare job keywords against resume keywords. | `KeywordGap` |
| `tailorTruthfully(resumeText, job)` | Rank existing resume lines by job keyword overlap; never invents or rewords. | `TailoringSuggestion` |

**Truthful tailoring:** `prioritizedLines` are verbatim resume lines. `gapsToConsider` are missing job keywords surfaced honestly, not inserted. The disclaimer states nothing was invented or reworded.

##### `src/shared/truthGate.ts`

| Function | Description | Returns |
|---|---|---|
| `checkTruth(draft, sources)` | Check AI draft for unsupported numbers, percentages, years, skills, or proper nouns. | `TruthResult` |

**Types:**

- `TruthSources`: resume text, profile skills/industries, job function, years experience, optional job title/company.
- `ViolationKind`: `"number" | "percentage" | "year" | "skill" | "proper-noun"`

**Behavior:** The gate does not rewrite text. It returns violations. Skills are synonym-aware, so `k8s` in sources covers a draft mentioning `kubernetes`. The job’s own company/title may appear without being flagged. User-supplied gap-fill facts are appended to the resume text before checking.

**Example:**

```ts
const check = checkTruth(
  "I improved performance by 40% using Kubernetes.",
  sources,
);
if (!check.ok) {
  console.warn(check.violations);
}
```

---

#### 7.6 Contacts and Outreach

##### `src/shared/contacts.ts`

| Function | Description | Returns |
|---|---|---|
| `parseCsvLine(line)` | RFC-4180-ish CSV line splitter handling quotes, commas, escaped quotes. | `string[]` |
| `parseLinkedInCsv(text)` | Parse LinkedIn `Connections.csv`, tolerating Notes preamble and skipping bad rows. | `ContactImportResult` |
| `normalizeDate(raw)` | Normalize parseable dates to `yyyy-mm-dd` using local components; otherwise keep raw. | `string` |
| `displayName(contact)` | Join first/last name, trimming blanks. | `string` |
| `rankContacts(contacts, ctx)` | Rank contacts for outreach against target companies and role. | `RankedContact[]` |

**Ranking signals:**

- Target company match: +55
- Recruiter/talent title: +25
- Leadership title: +15
- Role overlap with target function: +10
- Score capped at 100; contacts with score 0 are dropped.
- Ties break by most recently connected, then name.

**Example:**

```ts
const ranked = rankContacts(contacts, {
  targetCompanies: ["stripe", "ramp"],
  jobFunction: "software engineer",
});
console.log(ranked[0].contact, ranked[0].reasons);
```

---

#### 7.7 Analytics

##### `src/shared/analytics.ts`

| Function / export | Description | Returns |
|---|---|---|
| `PIPELINE_STAGES` | `["Applied","Interviewing","Offer","Rejected","Archived"]` | `ApplicationStatus[]` |
| `computePipelineAnalytics(jobs)` | Status counts, funnel, rates, breakdowns by eligibility/work model/source. | `PipelineAnalytics` |
| `formatRate(rate)` | Format 0..1 as rounded percentage. | `string` |
| `computeStageTimeline(history, nowIso?)` | Build per-job stage spans and durations. | `JobTimeline[]` |
| `computeStageDurations(history)` | Average completed time-in-stage across jobs. | `StageDurationStat[]` |
| `formatDays(days)` | Human-readable day count. | `string` |

**Important honesty note:** Funnel and breakdowns use each application’s current status. Time-in-stage is computed separately from recorded transition history and only reflects transitions captured since logging was added. Nothing is back-filled or invented.

**Example:**

```ts
const analytics = computePipelineAnalytics(jobs);
console.log(analytics.totalTracked, formatRate(analytics.interviewRate));
console.log(analytics.funnel);
```

---

#### 7.8 Crawl Policy

##### `src/shared/crawlPolicy.ts`

| Function / export | Description | Returns |
|---|---|---|
| `isNeverContactHost(urlOrHost)` | Block LinkedIn, Indeed, Glassdoor, ZipRecruiter, Monster and subdomains. | `boolean` |
| `parseRobots(text)` | Parse a practical robots.txt subset: groups, Allow/Disallow, `*`, `$`, Crawl-delay. | `RobotsPolicy` |
| `isPathAllowed(policy, path)` | Longest-match-wins; Allow breaks ties; default allow. | `boolean` |
| `decideClosures(storedJobIdsForBoard, outcome)` | Decide which absent jobs are safe to close after a crawl. | `CloseDecision` |
| `MAX_CLOSE_SHARE` | `0.5` — never close more than half a board in one sweep. | `number` |

**Proof-of-coverage rules:** Do not close jobs if the crawl was incomplete, had errors, saw too few postings, or absent count exceeds the safety cap.

---

#### 7.9 Custom Sources

##### `src/shared/customSource.ts`

| Function | Description | Returns |
|---|---|---|
| `parseRssJobs(xml, cfg, sourceKey, now)` | Parse RSS 2.0 / Atom items into jobs. | `Job[]` |
| `parseJsonJobs(data, cfg, sourceKey, now)` | Map JSON items by dot-path mapping into jobs. | `Job[]` |
| `validateCustomConfig(cfg)` | Validate URL, format, and required JSON mapping. | `string \| null` — error or `null` |
| `parseCustomSource(cfg, payload, sourceKey, now?)` | Dispatch by format. | `Job[]` |

**Validation rules:** URL must start with `https://`; format must be `rss` or `json`; JSON sources need a mapping with at least `title`.

**Example:**

```ts
const jobs = parseCustomSource(
  {
    url: "https://api.example/jobs",
    format: "json",
    mapping: { itemsPath: "data.results", title: "name" },
  },
  { json: response },
  "my-source",
);
```

---

#### 7.10 Deduplication

##### `src/shared/dedup.ts`

| Function | Description | Returns |
|---|---|---|
| `dedupeJobs(items)` | Collapse same company + normalized title across boards. | `DedupedJob[]` |

`DedupedJob` extends `JobWithMatch` with:

- `sources: string[]` — every provider the role was seen on.
- `duplicateCount: number` — how many raw postings collapsed.

**Representative selection:** Longest description wins, tie-broken by better eligibility, then higher match percent. Company normalization removes suffixes like Inc/LLC/Ltd/GmbH. Title normalization removes seniority words, parentheses, and punctuation.

**Example:**

```ts
const deduped = dedupeJobs(jobs);
console.log(deduped[0].duplicateCount, deduped[0].sources);
```

---

### 8. Browser Extension

#### `extension/content.js`

**Description:** Content script that fills visible form fields from JobWell data. It never submits a form.

| Function | Description |
|---|---|
| `setValue(el, value)` | Set value via native setter and dispatch `input`/`change` events so React/Angular forms retain it. Returns `boolean`. |
| `findField(keywords)` | Find an input/textarea by matching name, id, placeholder, aria-label, or label text against keywords. |
| `fillFrom(data)` | Fill location and current title fields from profile data. Returns filled field names. |
| `chrome.runtime.onMessage` listener | Handles `{ type: "jobwell-fill", data }`, responds with `{ ok, filled, note }` or `{ ok: false, error }`. |

**Hard rule:** There is no code path that calls `form.submit()` or clicks a submit button.

**Example message:**

```js
chrome.tabs.sendMessage(
  tab.id,
  { type: "jobwell-fill", data },
  (response) => {
    if (response?.ok) {
      console.log(response.note);
    }
  },
);
```

#### `extension/popup.js`

**Description:** Popup UI for pairing with JobWell and triggering form fill.

| Function / handler | Description |
|---|---|
| `setStatus(text, color)` | Update popup status text/color. |
| `chrome.storage.local.get(["port","token"], ...)` | Restore saved pairing and enable Fill button. |
| `base()` | Build `http://127.0.0.1:{port}`. |
| Pair button handler | Validate port/token, call `/ping`, verify `data.app === "jobwell"`, save pairing. |
| Fill button handler | Fetch `/fill-data` with `x-jobwell-token`, send message to active tab, display result. |

**Error handling:** If no content script responds, the popup advises opening a supported application page.

---

### 9. Tests

The provided tests cover core behavior and regression cases:

| Test file | Coverage |
|---|---|
| `src/main/JobService.sources.test.ts` | Default source seeding, active board resolution, add/remove sources. |
| `src/main/SqliteStorage.test.ts` | Profile, supplementary facts, job upsert dedupe, application status, reminders, status history, contacts, FX cache, export/import round-trip. |
| `src/main/cryptoBackup.test.ts` | Encryption round-trip, random salt/IV, wrong passphrase, tamper detection, passphrase length. |
| `src/main/interviewPrep.test.ts` | Defensive interview JSON parsing. |
| `src/shared/analytics.test.ts` | Pipeline counts, funnel conversion, eligibility/work model/source breakdowns, stage timelines/durations. |
| `src/shared/contacts.test.ts` | CSV parsing, LinkedIn import, ranking, display names. |
| `src/shared/crawlPolicy.test.ts` | Never-contact hosts, robots parsing, path matching, closure safety caps. |
| `src/shared/customSource.test.ts` | Custom config validation, RSS parsing, JSON mapping. |
| `src/shared/dedup.test.ts` | Cross-board dedupe and representative selection. |
| `src/shared/eligibility.test.ts` | Remote scope classification, Nigeria-based eligibility, onsite-SF regression. |
| `src/shared/filtering.test.ts` | Filters, eligibility sort, query terms, pay floor. |
| `src/shared/matching.test.ts` | Level inference, deterministic scoring, factor explanations. |
| `src/shared/parsers.test.ts` | Pay parsing/conversion, level, years, work model, work auth, combined posting parsing. |
| `src/shared/resume.test.ts` | Readability, keyword gaps, truthful tailoring. |
| `src/shared/synonyms.test.ts` | Word-boundary matching, related terms, role similarity. |
| `src/shared/truthGate.test.ts` | Numbers, percentages, years, skills, proper nouns, synonyms, gap-fill facts. |

Run all tests:

```bash
pnpm test
```

---

## Contributing

No `CONTRIBUTING.md` was provided, so the following are inferred guidelines based on the codebase.

1. **Keep pure logic in `src/shared`.** Matching, filtering, eligibility, parsing, truth checking, contacts, analytics, deduplication, and crawl policy should remain deterministic and testable without Electron or network access.
2. **Keep Electron-specific code in `src/main`.** IPC handlers should stay thin and forward to `JobService`.
3. **Respect the `Storage` interface.** Do not couple domain logic to SQLite directly.
4. **Add tests for behavior changes.** The project relies heavily on Vitest unit tests and regression cases.
5. **Never add automatic form submission.** The extension must only fill fields and leave submission to the user.
6. **Respect crawl policy.** Do not bypass `isNeverContactHost`, `mayFetch`, or robots.txt checks.
7. **Never log or expose secrets.** API keys must stay in the OS vault and must not be returned to the renderer or included in exports.
8. **Preserve truthfulness guarantees.** AI-generated content must pass through the truth gate where applicable; do not weaken fabrication checks.
9. **Run the test suite before submitting changes:**

```bash
pnpm test
```

---

## License

No license file or license header was detected in the provided code. The project license is **not specified**.

Unless a `LICENSE` file is added, treat the code as proprietary/all rights reserved. Third-party dependencies (`electron`, `react`, `sql.js`, `pdfkit`, `docx`, `mammoth`, `pdf-parse`, etc.) remain under their respective licenses.
