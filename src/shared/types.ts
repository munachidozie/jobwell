// Shared domain types used by the main process, preload bridge, and renderer.
import type { Contact, ContactImportResult, RankedContact } from "./contacts";

export type WorkModel = "onsite" | "hybrid" | "remote" | "unknown";

export interface Job {
  id: string; // stable id: `${provider}:${board}:${externalId}`
  provider: string; // e.g. "greenhouse", "lever"
  board: string; // employer board slug, e.g. "stripe"
  company: string;
  title: string;
  location: string;
  workModel: WorkModel;
  url: string;
  postedAt: string | null; // ISO date when known
  description: string;
  fetchedAt: string; // ISO date this record was stored
}

export interface Profile {
  id: number; // single-row table, always 1
  // Target role(s) you're open to, e.g. ["Software Engineer", "Backend Engineer"].
  // Match scoring takes the BEST-matching role per job, so being open to several
  // titles never dilutes a strong match. A single-element list behaves like one
  // role. Older single-string profiles are migrated to a one-element array.
  jobFunction: string[];
  level: JobLevel;
  location: string;
  skills: string[]; // normalized lowercase keywords
  industries: string[]; // normalized lowercase keywords
  yearsExperience: number;
  // Where you are based now. Eligibility is computed relative to this, so
  // changing it (e.g. after relocating) re-evaluates the whole feed — no
  // rebuild needed. Lowercased token, e.g. "nigeria". Defaults to "" (treated
  // as unknown) for older profiles.
  baseCountry: string;
  // Countries/regions you're already authorized to work in (visa, passport,
  // right-to-work): lowercased tokens like ["eu","uk"]. Widens your eligible set.
  workAuthorizations: string[];
  // True statements about yourself you've saved (e.g. from guided gap-fill):
  // "Deployed services to a k8s cluster.", "Led a team of 4.". These are
  // treated as a truth-gate source everywhere, so once saved, the AI may use
  // them and they stop being flagged as gaps. Defaults to [] for older profiles.
  supplementaryFacts: string[];
}

export type JobLevel =
  | "intern"
  | "entry"
  | "mid"
  | "senior"
  | "staff"
  | "lead"
  | "unknown";

export type MatchBand = "Strong" | "Good" | "Fair" | "Weak";

export interface MatchReason {
  factor: "role" | "level" | "skills" | "industry";
  points: number; // contribution to the total, 0..weight
  weight: number; // max possible for this factor
  detail: string; // human-readable explanation
}

export interface MatchScore {
  jobId: string;
  percent: number; // 0..100
  band: MatchBand;
  reasons: MatchReason[];
}

export type ApplicationStatus =
  | "Applied"
  | "Interviewing"
  | "Offer"
  | "Rejected"
  | "Archived";

export interface Application {
  id: number;
  jobId: string;
  status: ApplicationStatus;
  notes: string;
  updatedAt: string; // ISO date
  // Optional follow-up reminder (e.g. "chase up on the 10th"). Null = none.
  reminderAt: string | null; // ISO date
}

// Mirror of storage.ts StatusHistoryEntry, declared here so the renderer-facing
// API types don't create a types↔storage import cycle.
export interface StatusHistoryEntryDTO {
  jobId: string;
  status: ApplicationStatus;
  changedAt: string; // ISO timestamp
}

export interface EligibilityInfo {
  verdict:
    | "eligible"
    | "eligible-with-sponsorship"
    | "likely-ineligible"
    | "unclear";
  scope: "worldwide" | "region" | "country" | "onsite" | "unknown";
  reason: string;
  evidence: string[];
}

export interface PayDisplay {
  text: string; // formatted, e.g. "₦400k/mo (≈ $3.1k/yr)"
  annualMinUsd: number | null; // for filtering/comparison
  fxApproximate: boolean;
}

export interface JobWithMatch {
  job: Job;
  match: MatchScore | null;
  application: Application | null;
  // Whether you can actually take this job from your base country. Computed
  // relative to the profile's baseCountry + workAuthorizations.
  eligibility: EligibilityInfo | null;
  // Parsed pay from the posting, when present. Null when the posting states no
  // compensation.
  pay: PayDisplay | null;
}

// A set of criteria for narrowing the feed. All fields are optional; an empty
// filter matches every job.
export interface JobFilter {
  text?: string; // free text across title/company/description
  location?: string; // substring match on location
  workModels?: WorkModel[]; // any-of
  providers?: BoardProvider[]; // any-of
  minMatchPercent?: number; // 0..100
  postedWithinDays?: number; // only jobs posted within N days
  // When true, show only jobs you can actually take: eligible or
  // eligible-with-sponsorship. Hides likely-ineligible/unclear.
  onlyEligible?: boolean;
  // When true, show only roles that explicitly offer visa/relocation
  // sponsorship (eligibility verdict "eligible-with-sponsorship").
  onlySponsorship?: boolean;
  // Minimum annual pay in USD-equivalent. Jobs with stated pay below this are
  // hidden; jobs with NO stated pay are kept (absence isn't "too low").
  minAnnualUsd?: number;
}

export interface SavedSearch {
  id: number;
  name: string;
  filter: JobFilter;
  alert: boolean; // when true, new matching jobs are counted as alerts
  createdAt: string;
  lastSeenJobIds: string[]; // ids known at last check, to compute "new"
}

export interface SavedSearchWithCount extends SavedSearch {
  matchCount: number;
  newCount: number; // matching jobs not in lastSeenJobIds
}

export interface Resume {
  id: number; // single-row table, always 1
  fileName: string;
  text: string; // extracted plain text
  importedAt: string;
}

// Shape of the API exposed to the renderer via the preload bridge.
export interface JobWellApi {
  getProfile(): Promise<Profile | null>;
  saveProfile(profile: Omit<Profile, "id">): Promise<Profile>;
  addSupplementaryFact(fact: string): Promise<Profile | null>;
  removeSupplementaryFact(fact: string): Promise<Profile | null>;
  listJobs(): Promise<JobWithMatch[]>;
  listStatusHistory(): Promise<StatusHistoryEntryDTO[]>;
  refreshJobs(boards?: BoardRef[]): Promise<{ added: number; total: number }>;
  getFxStatus(): Promise<{ date: string | null; fetchedAt: string | null } | null>;
  setApplicationStatus(
    jobId: string,
    status: ApplicationStatus,
    notes?: string,
  ): Promise<Application>;
  setReminder(jobId: string, reminderAt: string | null): Promise<Application>;
  untrack(jobId: string): Promise<void>;
  listSavedSearches(): Promise<SavedSearchWithCount[]>;
  createSavedSearch(
    name: string,
    filter: JobFilter,
    alert: boolean,
  ): Promise<SavedSearch>;
  deleteSavedSearch(id: number): Promise<void>;
  markSavedSearchSeen(id: number): Promise<void>;
  importResume(): Promise<Resume | null>; // opens a file dialog
  getResume(): Promise<Resume | null>;
  analyzeResume(): Promise<ResumeAnalysis | null>;
  tailorForJob(jobId: string): Promise<TailorResult | null>;
  // Network: LinkedIn connections import, who-to-message, outreach drafts.
  importContacts(
    mode: "replace" | "merge",
  ): Promise<(ContactImportResult & { stored: number }) | null>; // opens a file dialog
  // Import from CSV text already read in the renderer (drag-and-drop).
  importContactsFromText(
    csvText: string,
    mode: "replace" | "merge",
  ): Promise<ContactImportResult & { stored: number }>;
  listContacts(): Promise<Contact[]>;
  whoToMessage(): Promise<RankedContact[]>;
  deleteContact(id: number): Promise<void>;
  clearContacts(): Promise<void>;
  draftOutreach(contactId: number): Promise<AiResult>;
  // Interview prep for a tracked (or any known) job.
  prepInterview(jobId: string): Promise<InterviewPrep | null>;
  generateCoverLetter(jobId: string, gapFacts?: string[]): Promise<AiResult>;
  getAiConfig(): Promise<AiConfigPublic>;
  setAiConfig(config: AiConfigInput): Promise<AiConfigPublic>;
  askAssistant(question: string): Promise<AiResult>;
  getExtensionPairing(): Promise<{ port: number; token: string }>;
  listJobSources(): Promise<JobSourceDTO[]>;
  addJobSource(source: {
    provider: string;
    board: string;
    label: string | null;
    enabled: boolean;
    custom?: CustomSourceConfigDTO | null;
  }): Promise<JobSourceDTO>;
  deleteJobSource(id: number): Promise<void>;
  validateCustomSource(
    cfg: CustomSourceConfigDTO,
  ): Promise<{ ok: boolean; error: string | null }>;
  // Export; pass a passphrase to produce an encrypted .jobwell file, or omit
  // for a plain .json backup.
  exportData(
    passphrase?: string,
  ): Promise<{ saved: boolean; path?: string; encrypted?: boolean }>;
  // Import; if the chosen file is encrypted and no passphrase is supplied, the
  // result is { needsPassphrase: true } so the UI can prompt and retry.
  importData(
    mode: "merge" | "replace",
    passphrase?: string,
  ): Promise<ImportSummaryDTO | { needsPassphrase: true } | null>;
  // Permanently delete all local data and clear any stored AI key.
  deleteAllData(): Promise<void>;
  // Export a text document (cover letter / tailored resume) to PDF or DOCX.
  exportDocument(
    format: "pdf" | "docx",
    title: string,
    body: string,
    suggestedName: string,
  ): Promise<{ saved: boolean; path?: string }>;
}

// Mirror of storage.ts CustomSourceConfig, declared here so the renderer-facing
// API types don't create a types↔storage import cycle.
export interface CustomSourceConfigDTO {
  url: string;
  format: "rss" | "json";
  mapping?: {
    itemsPath: string;
    title: string;
    company?: string;
    location?: string;
    url?: string;
    description?: string;
    postedAt?: string;
    id?: string;
  };
  defaultWorkModel?: "onsite" | "hybrid" | "remote" | "unknown";
}

export interface JobSourceDTO {
  id: number;
  provider: string;
  board: string;
  label: string | null;
  enabled: boolean;
  custom: CustomSourceConfigDTO | null;
}

export interface ImportSummaryDTO {
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

export interface ResumeAnalysis {
  readability: {
    words: number;
    sentences: number;
    avgWordsPerSentence: number;
    grade: number;
    note: string;
  };
  // Keyword gaps against the user's currently stored jobs, best matches first.
  topGaps: {
    jobId: string;
    title: string;
    company: string;
    coverage: number;
    missing: string[];
  }[];
}

export interface TailorResult {
  jobId: string;
  prioritizedLines: { line: string; matchedKeywords: string[] }[];
  gapsToConsider: string[];
  disclaimer: string;
  // Present only when an AI provider is configured and the user requested it.
  aiDraft?: string;
}

// ---- Interview prep (Phase 6) ----
export type InterviewQuestionKind =
  | "behavioral"
  | "technical"
  | "role-specific"
  | "about-you";

export interface InterviewQuestion {
  kind: InterviewQuestionKind;
  question: string;
  // Why this is likely to come up for this role (grounded in the posting).
  rationale: string;
}

export interface InterviewPrep {
  jobId: string;
  title: string;
  company: string;
  questions: InterviewQuestion[];
  // General, honest talking points to prepare — NOT scripted answers.
  talkingPoints: string[];
  usedProvider: AiProvider;
  // Truth-gate findings on the generated content, if any (empty = clean).
  truthViolations?: TruthViolationDTO[];
  // Set when generation failed or no AI is configured; the UI shows it.
  error?: string;
}

// ---- AI configuration (keys are NOT returned to the renderer) ----
export type AiProvider =
  | "none"
  | "ollama"
  | "lmstudio"
  | "openai"
  | "anthropic"
  | "deepseek";

export interface AiConfigInput {
  provider: AiProvider;
  model?: string;
  baseUrl?: string; // for ollama / lmstudio / openai-compatible
  apiKey?: string; // stored securely, never returned
}

export interface AiConfigPublic {
  provider: AiProvider;
  model: string | null;
  baseUrl: string | null;
  hasKey: boolean; // whether a key is stored, without revealing it
}

export interface AiResult {
  ok: boolean;
  text: string; // the model output, or an error/explanation
  usedProvider: AiProvider;
  // When the output was checked against the truth gate, any facts it introduced
  // that aren't supported by the user's resume/profile. Empty = clean.
  truthViolations?: TruthViolationDTO[];
}

export interface TruthViolationDTO {
  kind: "number" | "percentage" | "year" | "skill" | "proper-noun";
  value: string;
  reason: string;
}

export type BoardProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "recruitee"
  // Public global-remote aggregator feeds. Unlike the ATS providers above,
  // these are single global endpoints (no per-company slug) that return many
  // employers' remote roles at once.
  | "remoteok"
  | "remotive"
  // A user-configured RSS/Atom feed or JSON endpoint (config stored per source).
  | "custom";

// A feed-type provider needs no employer slug; by convention its `board` is
// just the provider name.
export const FEED_PROVIDERS: BoardProvider[] = ["remoteok", "remotive"];

export function isFeedProvider(p: BoardProvider): boolean {
  return FEED_PROVIDERS.includes(p);
}

export interface BoardRef {
  provider: BoardProvider;
  board: string; // employer slug for ATS providers; feed name for feeds
}
