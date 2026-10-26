import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { createRequire } from "node:module";
import type {
  Application,
  ApplicationStatus,
  Job,
  JobFilter,
  Profile,
  Resume,
  SavedSearch,
  AiProvider,
} from "@shared/types";
import {
  EXPORT_SCHEMA_VERSION,
  type AiConfigRow,
  type ExportBundle,
  type FxRates,
  type ImportMode,
  type ImportSummary,
  type Storage,
  type StoredJobSource,
  type StatusHistoryEntry,
} from "@shared/storage";
import type { Contact, ParsedContact } from "@shared/contacts";
import type { BindParams, Database, SqlJsStatic, SqlValue } from "sql.js";

// SQLite-backed Storage using sql.js (SQLite compiled to WebAssembly). Chosen
// because it runs on ANY Node/Electron version with no native build step and no
// large binary download — unlike node:sqlite (needs Node 22+, absent from
// Electron 33's bundled Node 20) or better-sqlite3 (needs a C++ toolchain).
//
// sql.js keeps the database in memory; we persist by serializing it to a file
// after every write. For a local, single-user job app the data is small enough
// that this is simple and fast. The async WASM init means construction goes
// through the static `create()` factory rather than `new`.
//
// Everything else in the app depends only on the Storage interface, so this
// swap touched just this file.

// Load sql.js via a runtime require so the Vite/test transform doesn't choke on
// its wasm/node resolution. Works in both the CommonJS main build (where a
// global `require` exists) and ESM contexts (vitest), via createRequire.
const req: NodeRequire =
  typeof require === "function"
    ? require
    : createRequire(process.cwd() + "/");

export class SqliteStorage implements Storage {
  private db: Database;
  private appVersion: string;
  private dbPath: string | null; // null = in-memory (tests)

  private constructor(db: Database, dbPath: string | null, appVersion: string) {
    this.db = db;
    this.dbPath = dbPath;
    this.appVersion = appVersion;
    this.migrate();
  }

  // Async factory: initializes the WASM engine, loads an existing DB file if
  // present, and runs migrations.
  static async create(opts: {
    dataDir?: string;
    memory?: boolean;
    appVersion?: string;
  }): Promise<SqliteStorage> {
    const initSqlJs = req("sql.js") as (config?: {
      locateFile?: (f: string) => string;
    }) => Promise<SqlJsStatic>;
    // Point the loader at the wasm file shipped inside the package. req.resolve
    // gives node_modules/sql.js/dist/sql-wasm.js; its folder holds the .wasm.
    //
    // In a packaged Electron app the code runs from inside app.asar, but the
    // .wasm must be read from the real filesystem (sql.js reads it with fs,
    // which can't see inside an asar). We asarUnpack sql.js (see
    // electron-builder config), so the real files live in app.asar.unpacked.
    // Rewriting the path segment points locateFile at that unpacked copy. In
    // dev/test there's no asar, so the replace is a no-op.
    const wasmDir = join(req.resolve("sql.js"), "..", "..", "dist").replace(
      `app.asar${sep}`,
      `app.asar.unpacked${sep}`,
    );
    const SQL = await initSqlJs({
      locateFile: (f: string) => join(wasmDir, f),
    });

    let dbPath: string | null = null;
    let db: Database;
    if (opts.memory) {
      db = new SQL.Database();
    } else {
      const dir = opts.dataDir ?? ".";
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      dbPath = join(dir, "jobwell.db");
      if (existsSync(dbPath)) {
        db = new SQL.Database(readFileSync(dbPath));
      } else {
        db = new SQL.Database();
      }
    }
    return new SqliteStorage(db, dbPath, opts.appVersion ?? "0.1.0");
  }

  // Write the in-memory DB out to disk. Called after every mutation.
  private persist(): void {
    if (!this.dbPath) return;
    const data = this.db.export();
    writeFileSync(this.dbPath, Buffer.from(data));
  }

  // sql.js: run a parameterized statement (no result needed).
  private run(sql: string, params: Record<string, unknown> = {}): void {
    const stmt = this.db.prepare(sql);
    stmt.run(normalizeParams(params));
    stmt.free();
  }

  // sql.js: fetch all rows as objects.
  private all(
    sql: string,
    params: Record<string, unknown> = {},
  ): Record<string, unknown>[] {
    const stmt = this.db.prepare(sql);
    stmt.bind(normalizeParams(params));
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  private get(
    sql: string,
    params: Record<string, unknown> = {},
  ): Record<string, unknown> | undefined {
    return this.all(sql, params)[0];
  }

  private migrate(): void {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        jobFunction TEXT NOT NULL,
        level TEXT NOT NULL,
        location TEXT NOT NULL,
        skills TEXT NOT NULL,
        industries TEXT NOT NULL,
        yearsExperience INTEGER NOT NULL,
        baseCountry TEXT NOT NULL DEFAULT '',
        workAuthorizations TEXT NOT NULL DEFAULT '[]',
        supplementaryFacts TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        board TEXT NOT NULL,
        company TEXT NOT NULL,
        title TEXT NOT NULL,
        location TEXT NOT NULL,
        workModel TEXT NOT NULL,
        url TEXT NOT NULL,
        postedAt TEXT,
        description TEXT NOT NULL,
        fetchedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        updatedAt TEXT NOT NULL,
        reminderAt TEXT
      );

      CREATE TABLE IF NOT EXISTS saved_searches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        filter TEXT NOT NULL,
        alert INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        lastSeenJobIds TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS resume (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        fileName TEXT NOT NULL,
        text TEXT NOT NULL,
        importedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS ai_config (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        provider TEXT NOT NULL DEFAULT 'none',
        model TEXT,
        baseUrl TEXT
      );

      CREATE TABLE IF NOT EXISTS job_sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        board TEXT NOT NULL,
        label TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(provider, board)
      );

      CREATE TABLE IF NOT EXISTS fx_rates (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        base TEXT NOT NULL,
        rates TEXT NOT NULL,      -- JSON map of currency -> units per 1 USD
        fetchedAt TEXT NOT NULL,
        date TEXT
      );

      -- Append-only log of application status changes, so pipeline analytics
      -- can report time-in-stage and progression over time going forward.
      CREATE TABLE IF NOT EXISTS status_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT NOT NULL,
        status TEXT NOT NULL,
        changedAt TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        firstName TEXT NOT NULL DEFAULT '',
        lastName TEXT NOT NULL DEFAULT '',
        company TEXT NOT NULL DEFAULT '',
        position TEXT NOT NULL DEFAULT '',
        profileUrl TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        connectedOn TEXT NOT NULL DEFAULT '',
        importedAt TEXT NOT NULL,
        -- Dedupe key: profile URL when present, else name+company lowercased.
        dedupeKey TEXT NOT NULL UNIQUE
      );
    `);

    // Additive migrations for databases created before these columns existed.
    this.addColumnIfMissing("profile", "baseCountry", "TEXT NOT NULL DEFAULT ''");
    this.addColumnIfMissing(
      "profile",
      "workAuthorizations",
      "TEXT NOT NULL DEFAULT '[]'",
    );
    // Custom-source config JSON (null for built-in providers).
    this.addColumnIfMissing("job_sources", "custom", "TEXT");
    // Follow-up reminder on an application (added after initial release).
    this.addColumnIfMissing("applications", "reminderAt", "TEXT");
    // Saved true facts about the user (guided gap-fill memory).
    this.addColumnIfMissing(
      "profile",
      "supplementaryFacts",
      "TEXT NOT NULL DEFAULT '[]'",
    );
    this.persist();
  }

  private addColumnIfMissing(table: string, column: string, decl: string): void {
    const cols = this.all(`PRAGMA table_info(${table})`);
    if (!cols.some((c) => String(c.name) === column)) {
      this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
    }
  }

  // ---- Profile ----
  async getProfile(): Promise<Profile | null> {
    const row = this.get("SELECT * FROM profile WHERE id = 1");
    if (!row) return null;
    return {
      id: 1,
      jobFunction: String(row.jobFunction),
      level: row.level as Profile["level"],
      location: String(row.location),
      skills: JSON.parse(String(row.skills)),
      industries: JSON.parse(String(row.industries)),
      yearsExperience: Number(row.yearsExperience),
      baseCountry: row.baseCountry ? String(row.baseCountry) : "",
      workAuthorizations: row.workAuthorizations
        ? JSON.parse(String(row.workAuthorizations))
        : [],
      supplementaryFacts: row.supplementaryFacts
        ? JSON.parse(String(row.supplementaryFacts))
        : [],
    };
  }

  async saveProfile(p: Omit<Profile, "id">): Promise<Profile> {
    this.run(
      `INSERT INTO profile (id, jobFunction, level, location, skills, industries, yearsExperience, baseCountry, workAuthorizations, supplementaryFacts)
       VALUES (1, :jobFunction, :level, :location, :skills, :industries, :yearsExperience, :baseCountry, :workAuthorizations, :supplementaryFacts)
       ON CONFLICT(id) DO UPDATE SET
         jobFunction=:jobFunction, level=:level, location=:location,
         skills=:skills, industries=:industries, yearsExperience=:yearsExperience,
         baseCountry=:baseCountry, workAuthorizations=:workAuthorizations,
         supplementaryFacts=:supplementaryFacts`,
      {
        jobFunction: p.jobFunction,
        level: p.level,
        location: p.location,
        skills: JSON.stringify(p.skills),
        industries: JSON.stringify(p.industries),
        yearsExperience: p.yearsExperience,
        baseCountry: p.baseCountry ?? "",
        workAuthorizations: JSON.stringify(p.workAuthorizations ?? []),
        supplementaryFacts: JSON.stringify(p.supplementaryFacts ?? []),
      },
    );
    this.persist();
    return { id: 1, ...p };
  }

  // ---- Jobs ----
  async listJobs(): Promise<Job[]> {
    return this.all("SELECT * FROM jobs ORDER BY fetchedAt DESC").map(rowToJob);
  }

  async upsertJobs(jobs: Job[]): Promise<number> {
    let added = 0;
    for (const j of jobs) {
      const before = this.get("SELECT 1 AS x FROM jobs WHERE id = :id", {
        id: j.id,
      });
      this.run(
        `INSERT INTO jobs (id, provider, board, company, title, location, workModel, url, postedAt, description, fetchedAt)
         VALUES (:id, :provider, :board, :company, :title, :location, :workModel, :url, :postedAt, :description, :fetchedAt)
         ON CONFLICT(id) DO NOTHING`,
        {
          id: j.id,
          provider: j.provider,
          board: j.board,
          company: j.company,
          title: j.title,
          location: j.location,
          workModel: j.workModel,
          url: j.url,
          postedAt: j.postedAt,
          description: j.description,
          fetchedAt: j.fetchedAt,
        },
      );
      if (!before) added++;
    }
    this.persist();
    return added;
  }

  async deleteJobs(ids: string[]): Promise<void> {
    for (const id of ids) this.run("DELETE FROM jobs WHERE id = :id", { id });
    this.persist();
  }

  // ---- Applications ----
  async listApplications(): Promise<Application[]> {
    return this.all("SELECT * FROM applications").map((r) => ({
      id: Number(r.id),
      jobId: String(r.jobId),
      status: r.status as ApplicationStatus,
      notes: String(r.notes),
      updatedAt: String(r.updatedAt),
      reminderAt: r.reminderAt ? String(r.reminderAt) : null,
    }));
  }

  async setApplicationStatus(
    jobId: string,
    status: ApplicationStatus,
    notes = "",
  ): Promise<Application> {
    const updatedAt = new Date().toISOString();
    // Log a transition only when the status actually changes (or it's the first
    // time this job is tracked), so notes-only edits don't pollute the history.
    const prev = this.get(
      "SELECT status FROM applications WHERE jobId = :jobId",
      { jobId },
    );
    const statusChanged = !prev || String(prev.status) !== status;
    // Preserve any existing reminder when only status/notes change.
    this.run(
      `INSERT INTO applications (jobId, status, notes, updatedAt)
       VALUES (:jobId, :status, :notes, :updatedAt)
       ON CONFLICT(jobId) DO UPDATE SET status=:status, notes=:notes, updatedAt=:updatedAt`,
      { jobId, status, notes, updatedAt },
    );
    if (statusChanged) {
      this.run(
        `INSERT INTO status_history (jobId, status, changedAt)
         VALUES (:jobId, :status, :changedAt)`,
        { jobId, status, changedAt: updatedAt },
      );
    }
    this.persist();
    const row = this.get("SELECT * FROM applications WHERE jobId = :jobId", {
      jobId,
    })!;
    return {
      id: Number(row.id),
      jobId,
      status,
      notes,
      updatedAt,
      reminderAt: row.reminderAt ? String(row.reminderAt) : null,
    };
  }

  // Remove a job from the tracker (deletes its application row and its status
  // history; the job itself stays in the feed).
  async deleteApplication(jobId: string): Promise<void> {
    this.run("DELETE FROM applications WHERE jobId = :jobId", { jobId });
    this.run("DELETE FROM status_history WHERE jobId = :jobId", { jobId });
    this.persist();
  }

  async listStatusHistory(): Promise<StatusHistoryEntry[]> {
    return this.all(
      "SELECT jobId, status, changedAt FROM status_history ORDER BY changedAt, id",
    ).map((r) => ({
      jobId: String(r.jobId),
      status: r.status as ApplicationStatus,
      changedAt: String(r.changedAt),
    }));
  }

  // Set or clear a follow-up reminder on an existing tracked application.
  async setReminder(
    jobId: string,
    reminderAt: string | null,
  ): Promise<Application> {
    this.run(
      "UPDATE applications SET reminderAt = :reminderAt WHERE jobId = :jobId",
      { reminderAt, jobId },
    );
    this.persist();
    const row = this.get("SELECT * FROM applications WHERE jobId = :jobId", {
      jobId,
    })!;
    return {
      id: Number(row.id),
      jobId: String(row.jobId),
      status: row.status as ApplicationStatus,
      notes: String(row.notes),
      updatedAt: String(row.updatedAt),
      reminderAt: row.reminderAt ? String(row.reminderAt) : null,
    };
  }

  // ---- Saved searches ----
  async listSavedSearches(): Promise<SavedSearch[]> {
    return this.all(
      "SELECT * FROM saved_searches ORDER BY createdAt DESC",
    ).map(rowToSavedSearch);
  }

  async createSavedSearch(
    name: string,
    filter: JobFilter,
    alert: boolean,
  ): Promise<SavedSearch> {
    const createdAt = new Date().toISOString();
    this.run(
      `INSERT INTO saved_searches (name, filter, alert, createdAt, lastSeenJobIds)
       VALUES (:name, :filter, :alert, :createdAt, '[]')`,
      {
        name,
        filter: JSON.stringify(filter),
        alert: alert ? 1 : 0,
        createdAt,
      },
    );
    this.persist();
    const row = this.get(
      "SELECT * FROM saved_searches WHERE rowid = last_insert_rowid()",
    )!;
    return {
      id: Number(row.id),
      name,
      filter,
      alert,
      createdAt,
      lastSeenJobIds: [],
    };
  }

  async deleteSavedSearch(id: number): Promise<void> {
    this.run("DELETE FROM saved_searches WHERE id = :id", { id });
    this.persist();
  }

  async updateSavedSearchSeen(id: number, jobIds: string[]): Promise<void> {
    this.run(
      "UPDATE saved_searches SET lastSeenJobIds = :ids WHERE id = :id",
      { ids: JSON.stringify(jobIds), id },
    );
    this.persist();
  }

  // ---- Resume ----
  async getResume(): Promise<Resume | null> {
    const row = this.get("SELECT * FROM resume WHERE id = 1");
    if (!row) return null;
    return {
      id: 1,
      fileName: String(row.fileName),
      text: String(row.text),
      importedAt: String(row.importedAt),
    };
  }

  async saveResume(fileName: string, text: string): Promise<Resume> {
    const importedAt = new Date().toISOString();
    this.run(
      `INSERT INTO resume (id, fileName, text, importedAt)
       VALUES (1, :fileName, :text, :importedAt)
       ON CONFLICT(id) DO UPDATE SET fileName=:fileName, text=:text, importedAt=:importedAt`,
      { fileName, text, importedAt },
    );
    this.persist();
    return { id: 1, fileName, text, importedAt };
  }

  // ---- Contacts (network) ----
  async listContacts(): Promise<Contact[]> {
    return this.all(
      "SELECT * FROM contacts ORDER BY connectedOn DESC, lastName, firstName",
    ).map((r) => ({
      id: Number(r.id),
      firstName: String(r.firstName ?? ""),
      lastName: String(r.lastName ?? ""),
      company: String(r.company ?? ""),
      position: String(r.position ?? ""),
      profileUrl: String(r.profileUrl ?? ""),
      email: String(r.email ?? ""),
      connectedOn: String(r.connectedOn ?? ""),
      importedAt: String(r.importedAt ?? ""),
    }));
  }

  // Replace the whole set (used on a fresh import so re-importing a bigger
  // export doesn't leave stale rows).
  async replaceContacts(contacts: ParsedContact[]): Promise<number> {
    this.db.run("DELETE FROM contacts");
    const n = await this.addContacts(contacts);
    return n;
  }

  // Merge contacts in, deduped by profile URL or name+company.
  async addContacts(contacts: ParsedContact[]): Promise<number> {
    const importedAt = new Date().toISOString();
    let added = 0;
    for (const c of contacts) {
      const key = dedupeKeyFor(c);
      const before = this.get(
        "SELECT 1 AS x FROM contacts WHERE dedupeKey = :k",
        { k: key },
      );
      this.run(
        `INSERT INTO contacts (firstName, lastName, company, position, profileUrl, email, connectedOn, importedAt, dedupeKey)
         VALUES (:firstName, :lastName, :company, :position, :profileUrl, :email, :connectedOn, :importedAt, :dedupeKey)
         ON CONFLICT(dedupeKey) DO UPDATE SET
           firstName=:firstName, lastName=:lastName, company=:company,
           position=:position, profileUrl=:profileUrl, email=:email,
           connectedOn=:connectedOn`,
        {
          firstName: c.firstName,
          lastName: c.lastName,
          company: c.company,
          position: c.position,
          profileUrl: c.profileUrl,
          email: c.email,
          connectedOn: c.connectedOn,
          importedAt,
          dedupeKey: key,
        },
      );
      if (!before) added++;
    }
    this.persist();
    return added;
  }

  async deleteContact(id: number): Promise<void> {
    this.run("DELETE FROM contacts WHERE id = :id", { id });
    this.persist();
  }

  async clearContacts(): Promise<void> {
    this.db.run("DELETE FROM contacts");
    this.persist();
  }

  // ---- AI config ----
  async getAiConfig(): Promise<AiConfigRow> {
    const row = this.get("SELECT * FROM ai_config WHERE id = 1");
    if (!row) return { provider: "none", model: null, baseUrl: null };
    return {
      provider: (row.provider as AiProvider) ?? "none",
      model: row.model ? String(row.model) : null,
      baseUrl: row.baseUrl ? String(row.baseUrl) : null,
    };
  }

  async saveAiConfig(
    provider: AiProvider,
    model: string | null,
    baseUrl: string | null,
  ): Promise<void> {
    this.run(
      `INSERT INTO ai_config (id, provider, model, baseUrl)
       VALUES (1, :provider, :model, :baseUrl)
       ON CONFLICT(id) DO UPDATE SET provider=:provider, model=:model, baseUrl=:baseUrl`,
      { provider, model, baseUrl },
    );
    this.persist();
  }

  // ---- Job sources ----
  async listJobSources(): Promise<StoredJobSource[]> {
    return this.all("SELECT * FROM job_sources ORDER BY id").map((r) => ({
      id: Number(r.id),
      provider: String(r.provider),
      board: String(r.board),
      label: r.label ? String(r.label) : null,
      enabled: Number(r.enabled) === 1,
      custom: r.custom ? JSON.parse(String(r.custom)) : null,
    }));
  }

  async addJobSource(
    s: Omit<StoredJobSource, "id">,
  ): Promise<StoredJobSource> {
    this.run(
      `INSERT INTO job_sources (provider, board, label, enabled, custom)
       VALUES (:provider, :board, :label, :enabled, :custom)
       ON CONFLICT(provider, board) DO UPDATE SET label=:label, enabled=:enabled, custom=:custom`,
      {
        provider: s.provider,
        board: s.board,
        label: s.label,
        enabled: s.enabled ? 1 : 0,
        custom: s.custom ? JSON.stringify(s.custom) : null,
      },
    );
    this.persist();
    const row = this.get(
      "SELECT id FROM job_sources WHERE provider = :p AND board = :b",
      { p: s.provider, b: s.board },
    );
    return { id: Number(row?.id ?? 0), ...s };
  }

  async deleteJobSource(id: number): Promise<void> {
    this.run("DELETE FROM job_sources WHERE id = :id", { id });
    this.persist();
  }

  // ---- FX rates (single-row cache) ----
  async getFxRates(): Promise<FxRates | null> {
    const row = this.get("SELECT * FROM fx_rates WHERE id = 1");
    if (!row) return null;
    return {
      base: "USD",
      rates: JSON.parse(String(row.rates)),
      fetchedAt: String(row.fetchedAt),
      date: row.date ? String(row.date) : null,
    };
  }

  async saveFxRates(fx: FxRates): Promise<void> {
    this.run(
      `INSERT INTO fx_rates (id, base, rates, fetchedAt, date)
       VALUES (1, :base, :rates, :fetchedAt, :date)
       ON CONFLICT(id) DO UPDATE SET base=:base, rates=:rates, fetchedAt=:fetchedAt, date=:date`,
      {
        base: fx.base,
        rates: JSON.stringify(fx.rates),
        fetchedAt: fx.fetchedAt,
        date: fx.date,
      },
    );
    this.persist();
  }

  // ---- Portable export / import ----
  async exportAll(): Promise<ExportBundle> {
    return {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: "jobwell",
      appVersion: this.appVersion,
      data: {
        profile: await this.getProfile(),
        jobs: await this.listJobs(),
        applications: await this.listApplications(),
        savedSearches: await this.listSavedSearches(),
        resume: await this.getResume(),
        aiConfig: await this.getAiConfig(),
        jobSources: await this.listJobSources(),
        contacts: await this.listContacts(),
      },
    };
  }

  async importAll(
    bundle: ExportBundle,
    mode: ImportMode,
  ): Promise<ImportSummary> {
    const notes: string[] = [];
    if (bundle.app !== "jobwell") {
      throw new Error("Not a JobWell export file.");
    }
    if (bundle.schemaVersion > EXPORT_SCHEMA_VERSION) {
      notes.push(
        `File is schema v${bundle.schemaVersion}; this app understands v${EXPORT_SCHEMA_VERSION}. Newer fields were ignored.`,
      );
    }

    const d = bundle.data;
    if (mode === "replace") {
      for (const t of [
        "profile",
        "jobs",
        "applications",
        "status_history",
        "saved_searches",
        "resume",
        "ai_config",
        "job_sources",
        "contacts",
      ]) {
        this.db.run(`DELETE FROM ${t}`);
      }
      this.persist();
      notes.push("Replaced all local data.");
    }

    let profileImported = false;
    if (d.profile) {
      await this.saveProfile(d.profile);
      profileImported = true;
    }
    const jobsImported = await this.upsertJobs(d.jobs ?? []);
    for (const a of d.applications ?? []) {
      await this.setApplicationStatus(a.jobId, a.status, a.notes);
    }
    for (const s of d.savedSearches ?? []) {
      await this.createSavedSearch(s.name, s.filter, s.alert);
    }
    let resumeImported = false;
    if (d.resume) {
      await this.saveResume(d.resume.fileName, d.resume.text);
      resumeImported = true;
    }
    if (d.aiConfig) {
      await this.saveAiConfig(
        d.aiConfig.provider,
        d.aiConfig.model,
        d.aiConfig.baseUrl,
      );
      notes.push("AI provider settings imported (API keys never travel in exports).");
    }
    let jobSourcesImported = 0;
    for (const src of d.jobSources ?? []) {
      await this.addJobSource({
        provider: src.provider,
        board: src.board,
        label: src.label,
        enabled: src.enabled,
      });
      jobSourcesImported++;
    }
    // Contacts (schema v2+). Merge in; dedupe handles overlap with existing.
    const contactsImported = await this.addContacts(d.contacts ?? []);

    return {
      schemaVersion: bundle.schemaVersion,
      jobsImported,
      applicationsImported: (d.applications ?? []).length,
      savedSearchesImported: (d.savedSearches ?? []).length,
      profileImported,
      resumeImported,
      jobSourcesImported,
      contactsImported,
      notes,
    };
  }
}

// Stable dedupe key for a connection: its LinkedIn profile URL when present
// (unique per person), otherwise lowercased name + company.
function dedupeKeyFor(c: ParsedContact): string {
  const url = c.profileUrl.trim().toLowerCase().replace(/\/+$/, "");
  if (url) return `url:${url}`;
  return `nc:${c.firstName.toLowerCase().trim()} ${c.lastName
    .toLowerCase()
    .trim()}@${c.company.toLowerCase().trim()}`;
}

// sql.js binds named params as an object keyed WITH the `:` prefix, and only
// accepts SqlValue types (string | number | null | Uint8Array). Coerce
// undefined to null and booleans to 0/1.
function normalizeParams(params: Record<string, unknown>): BindParams {
  const out: Record<string, SqlValue> = {};
  for (const [k, v] of Object.entries(params)) {
    let value: SqlValue;
    if (v === undefined || v === null) value = null;
    else if (typeof v === "boolean") value = v ? 1 : 0;
    else if (typeof v === "number" || typeof v === "string") value = v;
    else if (v instanceof Uint8Array) value = v;
    else value = String(v);
    out[`:${k}`] = value;
  }
  return out as unknown as BindParams;
}

function rowToJob(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    provider: String(row.provider),
    board: String(row.board),
    company: String(row.company),
    title: String(row.title),
    location: String(row.location),
    workModel: row.workModel as Job["workModel"],
    url: String(row.url),
    postedAt: row.postedAt ? String(row.postedAt) : null,
    description: String(row.description),
    fetchedAt: String(row.fetchedAt),
  };
}

function rowToSavedSearch(row: Record<string, unknown>): SavedSearch {
  return {
    id: Number(row.id),
    name: String(row.name),
    filter: JSON.parse(String(row.filter)) as JobFilter,
    alert: Number(row.alert) === 1,
    createdAt: String(row.createdAt),
    lastSeenJobIds: JSON.parse(String(row.lastSeenJobIds)) as string[],
  };
}
