import type {
  AiProvider,
  Application,
  ApplicationStatus,
  Job,
  JobFilter,
  Profile,
  Resume,
  SavedSearch,
} from "./types";
import type { Contact, ParsedContact } from "./contacts";

// The storage contract. Every backend (SQLite today, an HTTP/Postgres server
// later) implements this. Domain logic (JobService) depends ONLY on this
// interface, never on a concrete database. This is what keeps the core
// portable across the desktop app, a future server, and web/mobile clients.
//
// Methods are synchronous-or-async via Promise so a networked backend can
// implement them without changing callers.
export interface Storage {
  // Profile (single row)
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Omit<Profile, "id">): Promise<Profile>;

  // Jobs
  listJobs(): Promise<Job[]>;
  upsertJobs(jobs: Job[]): Promise<number>; // returns count newly added
  deleteJobs(ids: string[]): Promise<void>;

  // Applications / tracker
  listApplications(): Promise<Application[]>;
  setApplicationStatus(
    jobId: string,
    status: ApplicationStatus,
    notes?: string,
  ): Promise<Application>;
  setReminder(jobId: string, reminderAt: string | null): Promise<Application>;
  deleteApplication(jobId: string): Promise<void>;
  // Append-only history of status changes (for pipeline analytics). Ordered
  // oldest-first.
  listStatusHistory(): Promise<StatusHistoryEntry[]>;

  // Saved searches
  listSavedSearches(): Promise<SavedSearch[]>;
  createSavedSearch(
    name: string,
    filter: JobFilter,
    alert: boolean,
  ): Promise<SavedSearch>;
  deleteSavedSearch(id: number): Promise<void>;
  updateSavedSearchSeen(id: number, jobIds: string[]): Promise<void>;

  // Resume (single row)
  getResume(): Promise<Resume | null>;
  saveResume(fileName: string, text: string): Promise<Resume>;

  // Network contacts (LinkedIn connections import). Replace semantics on import
  // keep the set clean; individual rows can be removed.
  listContacts(): Promise<Contact[]>;
  replaceContacts(contacts: ParsedContact[]): Promise<number>; // returns count stored
  addContacts(contacts: ParsedContact[]): Promise<number>; // merge, returns count added
  deleteContact(id: number): Promise<void>;
  clearContacts(): Promise<void>;

  // AI config (non-secret parts only; keys live in the OS vault)
  getAiConfig(): Promise<AiConfigRow>;
  saveAiConfig(
    provider: AiProvider,
    model: string | null,
    baseUrl: string | null,
  ): Promise<void>;

  // Custom job sources the user adds (Phase 0 groundwork for "add other
  // sources later" — the UI can grow these without code changes).
  listJobSources(): Promise<StoredJobSource[]>;
  addJobSource(source: Omit<StoredJobSource, "id">): Promise<StoredJobSource>;
  deleteJobSource(id: number): Promise<void>;

  // Cached FX rates (base USD). Refreshed from a live source per job refresh,
  // cached so pay conversion is instant and works offline.
  getFxRates(): Promise<FxRates | null>;
  saveFxRates(rates: FxRates): Promise<void>;

  // Whole-database portability. These power backup/restore and the
  // "don't start over on another device" goal.
  exportAll(): Promise<ExportBundle>;
  importAll(bundle: ExportBundle, mode: ImportMode): Promise<ImportSummary>;
}

export interface AiConfigRow {
  provider: AiProvider;
  model: string | null;
  baseUrl: string | null;
}

// One recorded status transition for an application.
export interface StatusHistoryEntry {
  jobId: string;
  status: ApplicationStatus;
  changedAt: string; // ISO timestamp
}

// Exchange rates expressed as "units of currency per 1 USD" (base USD), e.g.
// { NGN: 1334.3, GBP: 0.79, ... }. `fetchedAt` is an ISO timestamp; `date` is
// the rate-source's own as-of date when provided.
export interface FxRates {
  base: "USD";
  rates: Record<string, number>;
  fetchedAt: string;
  date: string | null;
}

// A user-defined job source. For built-in providers (greenhouse, lever, …),
// `provider` names the adapter and `board` is the slug. For `provider:"custom"`
// the source is a user-configured RSS/Atom feed or JSON endpoint described by
// `custom` — this is how a user adds arbitrary compliant sources (web3 boards,
// RSS feeds) with no code.
export interface StoredJobSource {
  id: number;
  provider: string;
  board: string;
  label: string | null; // optional friendly name
  enabled: boolean;
  custom?: CustomSourceConfig | null;
}

export type CustomSourceFormat = "rss" | "json";

// Field mapping for a JSON endpoint: dot-paths into each job object telling the
// adapter which fields are the title, company, etc. For RSS, standard item
// fields are used and no mapping is needed.
export interface CustomJsonMapping {
  // Dot-path to the ARRAY of jobs within the response (empty = response is the
  // array itself). e.g. "jobs" or "data.results".
  itemsPath: string;
  title: string; // required
  company?: string;
  location?: string;
  url?: string;
  description?: string;
  postedAt?: string;
  id?: string; // unique id field; falls back to url/title if absent
}

export interface CustomSourceConfig {
  url: string;
  format: CustomSourceFormat;
  // Only for format === "json".
  mapping?: CustomJsonMapping;
  // Default work arrangement to assume for this source, when the feed doesn't
  // say (e.g. a "remote jobs" board → "remote").
  defaultWorkModel?: "onsite" | "hybrid" | "remote" | "unknown";
}

// ---- Portable export/import schema ----
// A versioned, device-neutral snapshot of everything the user owns. This is the
// canonical shape for backups and cross-device transfer. It deliberately does
// NOT include secrets (API keys) — those never leave the OS vault.

// v2 added `contacts`. Importers tolerate v1 files (contacts simply absent).
export const EXPORT_SCHEMA_VERSION = 2;

export interface ExportBundle {
  schemaVersion: number;
  exportedAt: string; // ISO timestamp
  app: "jobwell";
  appVersion: string;
  data: {
    profile: Profile | null;
    jobs: Job[];
    applications: Application[];
    savedSearches: SavedSearch[];
    resume: Resume | null;
    aiConfig: AiConfigRow; // provider/model/baseUrl only, never the key
    jobSources: StoredJobSource[];
    // Added in schema v2. Optional so v1 bundles still parse.
    contacts?: Contact[];
  };
}

// merge  = add/overlay imported data onto what's here (imported wins on conflict)
// replace = wipe local data first, then load the bundle
export type ImportMode = "merge" | "replace";

export interface ImportSummary {
  schemaVersion: number;
  jobsImported: number;
  applicationsImported: number;
  savedSearchesImported: number;
  profileImported: boolean;
  resumeImported: boolean;
  jobSourcesImported: number;
  contactsImported: number;
  notes: string[];
}
