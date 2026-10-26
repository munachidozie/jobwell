import type {
  AiConfigInput,
  AiConfigPublic,
  AiResult,
  ApplicationStatus,
  BoardRef,
  InterviewPrep,
  InterviewQuestion,
  InterviewQuestionKind,
  JobFilter,
  JobWithMatch,
  Profile,
  Resume,
  ResumeAnalysis,
  SavedSearchWithCount,
  TailorResult,
} from "@shared/types";
import {
  EXPORT_SCHEMA_VERSION,
  type ExportBundle,
  type ImportMode,
  type ImportSummary,
  type Storage,
  type StoredJobSource,
} from "@shared/storage";
import { scoreJob } from "@shared/matching";
import { applyFilter } from "@shared/filtering";
import { keywordGap, readability, tailorTruthfully } from "@shared/resume";
import { checkTruth, type TruthSources } from "@shared/truthGate";
import { assessEligibility, classifyEligibility } from "@shared/eligibility";
import { formatPay, parsePay } from "@shared/parsers";
import {
  displayName,
  rankContacts,
  type Contact,
  type ContactImportResult,
  type RankedContact,
} from "@shared/contacts";

// Collaborators the service needs that aren't storage: the scraper, the AI
// client, the resume file picker, and the secret vault. Passing them in keeps
// JobService free of Electron and Node specifics, so it can run on a server too.
export interface ServiceDeps {
  storage: Storage;
  fetchBoards(boards: BoardRef[]): Promise<import("@shared/types").Job[]>;
  chat(params: {
    provider: AiConfigPublic["provider"];
    model: string | null;
    baseUrl: string | null;
    system: string;
    user: string;
  }): Promise<AiResult>;
  secrets: {
    hasApiKey(): boolean;
    storeApiKey(key: string): void;
    clearApiKey(): void;
  };
  pickAndExtractResume(): Promise<{ fileName: string; text: string } | null>;
  // Open a file dialog and parse a LinkedIn Connections.csv export. Returns
  // null if the user cancels.
  pickAndParseContactsCsv(): Promise<
    import("@shared/contacts").ContactImportResult | null
  >;
  // Fetch live FX rates (units per USD). Returns null on failure.
  fetchFxRates(): Promise<import("@shared/storage").FxRates | null>;
  // Fetch a user-configured custom RSS/JSON source.
  fetchCustom(
    cfg: import("@shared/storage").CustomSourceConfig,
    sourceKey: string,
  ): Promise<import("@shared/types").Job[]>;
}

// The portable application core. The shell (Electron IPC today) is a thin
// adapter that forwards calls here. Everything testable and reusable lives in
// this class.
export class JobService {
  constructor(private deps: ServiceDeps) {}

  private get storage(): Storage {
    return this.deps.storage;
  }

  // Build jobs decorated with match scores, application status, and — crucially
  // for a location-constrained seeker — an eligibility verdict computed relative
  // to the profile's base country and work authorizations.
  async buildJobsWithMatch(): Promise<JobWithMatch[]> {
    const [profile, jobs, apps, fx] = await Promise.all([
      this.storage.getProfile(),
      this.storage.listJobs(),
      this.storage.listApplications(),
      this.storage.getFxRates(),
    ]);
    const appByJob = new Map(apps.map((a) => [a.jobId, a]));
    const liveRates = fx?.rates;
    const ctx = profile
      ? {
          baseCountry: (profile.baseCountry || profile.location || "").toLowerCase(),
          workAuthorizations: profile.workAuthorizations ?? [],
        }
      : null;

    return jobs.map((job) => {
      let eligibility: JobWithMatch["eligibility"] = null;
      if (ctx) {
        const facts = classifyEligibility(
          job.title,
          job.description,
          job.location,
          job.workModel,
        );
        const assessment = assessEligibility(facts, ctx);
        eligibility = {
          verdict: assessment.verdict,
          scope: facts.scope,
          reason: assessment.reason,
          evidence: facts.evidence,
        };
      }
      // Parse pay from title + description (many feeds put comp in either),
      // converting with cached live FX rates when available.
      const payInfo = parsePay(`${job.title}\n${job.description}`, liveRates);
      const payText = formatPay(payInfo);
      const pay = payText
        ? {
            text: payText,
            annualMinUsd: payInfo.annualMinUsd,
            fxApproximate: payInfo.fxApproximate,
          }
        : null;

      return {
        job,
        match: profile ? scoreJob(profile, job) : null,
        application: appByJob.get(job.id) ?? null,
        eligibility,
        pay,
      };
    });
  }

  getProfile(): Promise<Profile | null> {
    return this.storage.getProfile();
  }

  saveProfile(p: Omit<Profile, "id">): Promise<Profile> {
    return this.storage.saveProfile(p);
  }

  // Save a true fact about the user (from guided gap-fill) so it's remembered
  // as a truth-gate source going forward. No-op/dedupe on blanks and repeats.
  async addSupplementaryFact(fact: string): Promise<Profile | null> {
    const trimmed = fact.trim();
    const profile = await this.storage.getProfile();
    if (!profile || !trimmed) return profile;
    if (profile.supplementaryFacts.includes(trimmed)) return profile;
    const { id: _id, ...rest } = profile;
    return this.storage.saveProfile({
      ...rest,
      supplementaryFacts: [...profile.supplementaryFacts, trimmed],
    });
  }

  async removeSupplementaryFact(fact: string): Promise<Profile | null> {
    const profile = await this.storage.getProfile();
    if (!profile) return null;
    const { id: _id, ...rest } = profile;
    return this.storage.saveProfile({
      ...rest,
      supplementaryFacts: profile.supplementaryFacts.filter((f) => f !== fact),
    });
  }

  listJobs(): Promise<JobWithMatch[]> {
    return this.buildJobsWithMatch();
  }

  // Raw application status-change log, for the pipeline timeline / time-in-stage
  // view. Oldest-first.
  listStatusHistory(): Promise<import("@shared/storage").StatusHistoryEntry[]> {
    return this.storage.listStatusHistory();
  }

  async getFxStatus(): Promise<{ date: string | null; fetchedAt: string | null } | null> {
    const fx = await this.storage.getFxRates();
    if (!fx) return null;
    return { date: fx.date, fetchedAt: fx.fetchedAt };
  }

  async refreshJobs(
    // When omitted, refresh fetches the user's enabled stored sources.
    boards?: BoardRef[],
  ): Promise<{ added: number; total: number }> {
    // Refresh FX rates alongside jobs (one call), cache them. Non-fatal: if it
    // fails we keep the last cached rates, or fall back to built-in rates.
    try {
      const fx = await this.deps.fetchFxRates();
      if (fx) await this.storage.saveFxRates(fx);
    } catch {
      // ignore — pay conversion falls back gracefully
    }
    const jobs: import("@shared/types").Job[] = [];

    if (boards) {
      // Explicit board list (tests/overrides): built-in providers only.
      jobs.push(...(await this.deps.fetchBoards(boards)));
    } else {
      // Normal path: split stored sources into built-in providers vs. custom
      // RSS/JSON sources, fetch each appropriately.
      const sources = (await this.storage.listJobSources()).filter(
        (s) => s.enabled,
      );
      const builtIn = sources
        .filter((s) => s.provider !== "custom")
        .map((s) => ({ provider: s.provider as BoardRef["provider"], board: s.board }));
      jobs.push(...(await this.deps.fetchBoards(builtIn)));

      for (const s of sources) {
        if (s.provider === "custom" && s.custom) {
          try {
            jobs.push(...(await this.deps.fetchCustom(s.custom, s.board)));
          } catch (err) {
            console.error(`Custom source ${s.board} failed`, err);
          }
        }
      }
    }

    const added = await this.storage.upsertJobs(jobs);
    const total = (await this.storage.listJobs()).length;
    return { added, total };
  }

  setApplicationStatus(
    jobId: string,
    status: ApplicationStatus,
    notes?: string,
  ) {
    return this.storage.setApplicationStatus(jobId, status, notes);
  }

  setReminder(jobId: string, reminderAt: string | null) {
    return this.storage.setReminder(jobId, reminderAt);
  }

  untrack(jobId: string) {
    return this.storage.deleteApplication(jobId);
  }

  async listSavedSearches(): Promise<SavedSearchWithCount[]> {
    const all = await this.buildJobsWithMatch();
    const searches = await this.storage.listSavedSearches();
    return searches.map((s) => {
      const matched = applyFilter(all, s.filter);
      const seen = new Set(s.lastSeenJobIds);
      const newCount = matched.filter((m) => !seen.has(m.job.id)).length;
      return { ...s, matchCount: matched.length, newCount };
    });
  }

  createSavedSearch(name: string, filter: JobFilter, alert: boolean) {
    return this.storage.createSavedSearch(name, filter, alert);
  }

  deleteSavedSearch(id: number) {
    return this.storage.deleteSavedSearch(id);
  }

  async markSavedSearchSeen(id: number): Promise<void> {
    const all = await this.buildJobsWithMatch();
    const search = (await this.storage.listSavedSearches()).find(
      (s) => s.id === id,
    );
    if (!search) return;
    const matched = applyFilter(all, search.filter);
    await this.storage.updateSavedSearchSeen(
      id,
      matched.map((m) => m.job.id),
    );
  }

  // ---- Resume ----
  async importResume(): Promise<Resume | null> {
    const picked = await this.deps.pickAndExtractResume();
    if (!picked) return null;
    return this.storage.saveResume(picked.fileName, picked.text);
  }

  getResume(): Promise<Resume | null> {
    return this.storage.getResume();
  }

  async analyzeResume(): Promise<ResumeAnalysis | null> {
    const resume = await this.storage.getResume();
    if (!resume) return null;
    const jobs = await this.buildJobsWithMatch();
    const topGaps = jobs
      .map(({ job }) => {
        const gap = keywordGap(resume.text, job);
        return {
          jobId: job.id,
          title: job.title,
          company: job.company,
          coverage: gap.coverage,
          missing: gap.missing.slice(0, 10),
        };
      })
      .sort((a, b) => b.coverage - a.coverage)
      .slice(0, 10);
    return { readability: readability(resume.text), topGaps };
  }

  async tailorForJob(jobId: string): Promise<TailorResult | null> {
    const resume = await this.storage.getResume();
    if (!resume) return null;
    const job = (await this.storage.listJobs()).find((j) => j.id === jobId);
    if (!job) return null;
    return { ...tailorTruthfully(resume.text, job) };
  }

  // ---- Network (contacts / outreach) ----

  // Import a LinkedIn Connections.csv. `mode` "replace" swaps the whole set
  // (recommended for a fresh export); "merge" adds to what's there. Returns the
  // parse notes plus how many were stored, or null if the user cancelled.
  async importContacts(
    mode: "replace" | "merge" = "replace",
  ): Promise<(ContactImportResult & { stored: number }) | null> {
    const parsed = await this.deps.pickAndParseContactsCsv();
    if (!parsed) return null;
    return this.storeParsedContacts(parsed, mode);
  }

  // Import contacts from raw CSV text (used by drag-and-drop in the renderer,
  // which already holds the dropped file's contents — no file dialog needed).
  async importContactsFromText(
    csvText: string,
    mode: "replace" | "merge" = "replace",
  ): Promise<ContactImportResult & { stored: number }> {
    const { parseLinkedInCsv } = await import("@shared/contacts");
    const parsed = parseLinkedInCsv(csvText);
    return this.storeParsedContacts(parsed, mode);
  }

  private async storeParsedContacts(
    parsed: ContactImportResult,
    mode: "replace" | "merge",
  ): Promise<ContactImportResult & { stored: number }> {
    const stored =
      mode === "replace"
        ? await this.storage.replaceContacts(parsed.contacts)
        : await this.storage.addContacts(parsed.contacts);
    return { ...parsed, stored };
  }

  listContacts(): Promise<Contact[]> {
    return this.storage.listContacts();
  }

  deleteContact(id: number): Promise<void> {
    return this.storage.deleteContact(id);
  }

  clearContacts(): Promise<void> {
    return this.storage.clearContacts();
  }

  // The companies the user is actively pursuing: anything they've tracked
  // (applied/interviewing/etc.) plus companies from their saved-search-free
  // feed is too broad, so we anchor on tracked jobs — a strong intent signal.
  private async targetCompanies(): Promise<string[]> {
    const [apps, jobs] = await Promise.all([
      this.storage.listApplications(),
      this.storage.listJobs(),
    ]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const companies = new Set<string>();
    for (const a of apps) {
      // Archived/Rejected are no longer active targets.
      if (a.status === "Rejected" || a.status === "Archived") continue;
      const job = jobById.get(a.jobId);
      if (job?.company) companies.add(job.company.toLowerCase().trim());
    }
    return [...companies];
  }

  // Rank the user's connections for outreach against the companies they're
  // pursuing and their target role. Pure ranking lives in @shared/contacts.
  async whoToMessage(): Promise<RankedContact[]> {
    const [contacts, profile, targetCompanies] = await Promise.all([
      this.storage.listContacts(),
      this.storage.getProfile(),
      this.targetCompanies(),
    ]);
    return rankContacts(contacts, {
      targetCompanies,
      jobFunction: profile?.jobFunction ?? "",
    });
  }

  // Draft a short, honest outreach message to a contact. Grounded in the user's
  // own resume/profile and run through the truth gate, so it won't fabricate a
  // shared history, mutual projects, or credentials the user doesn't have.
  async draftOutreach(contactId: number): Promise<AiResult> {
    const cfg = await this.storage.getAiConfig();
    const contacts = await this.storage.listContacts();
    const contact = contacts.find((c) => c.id === contactId);
    if (!contact) {
      return { ok: false, usedProvider: cfg.provider, text: "Contact not found." };
    }
    const [profile, resume] = await Promise.all([
      this.storage.getProfile(),
      this.storage.getResume(),
    ]);
    const name = displayName(contact);
    const system =
      "You write brief, warm, professional LinkedIn outreach messages for a " +
      "job seeker. Keep it under 90 words. Use ONLY facts from the sender's " +
      "resume and profile. Do NOT invent a shared history, mutual connections, " +
      "past conversations, companies, or credentials. If you don't know how " +
      "they're connected, keep it general and honest.";
    const user =
      `Recipient: ${name}` +
      (contact.position ? `, ${contact.position}` : "") +
      (contact.company ? ` at ${contact.company}` : "") +
      `.\n\n` +
      `Sender's target role: ${profile?.jobFunction ?? "(unspecified)"}\n` +
      `Sender's resume:\n${resume?.text.slice(0, 2500) ?? "(no resume imported)"}\n\n` +
      "Write a short outreach message asking to connect about opportunities, " +
      "referencing only truthful details about the sender.";
    const result = await this.deps.chat({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      system,
      user,
    });
    if (result.ok && result.text) {
      // Allow the recipient's own name/company/title as phrasing context (the
      // message legitimately names who it's addressed to), but still catch any
      // fabricated facts about the SENDER.
      const sources = await this.truthSources();
      if (sources) {
        const withRecipient: TruthSources = {
          ...sources,
          jobTitle: [contact.position, name].filter(Boolean).join(" "),
          jobCompany: contact.company,
        };
        const check = checkTruth(result.text, withRecipient);
        if (!check.ok) return { ...result, truthViolations: check.violations };
      }
    }
    return { ...result, truthViolations: [] };
  }

  // Generate likely interview questions + honest talking points for a job,
  // grounded in the posting and the candidate's resume. Questions are role
  // context (safe to invent — they're what an interviewer MIGHT ask). The
  // talking points are checked against the truth gate so the prep doesn't
  // suggest claiming experience the candidate doesn't have.
  async prepInterview(jobId: string): Promise<InterviewPrep | null> {
    const cfg = await this.storage.getAiConfig();
    const job = (await this.storage.listJobs()).find((j) => j.id === jobId);
    if (!job) return null;
    const base: InterviewPrep = {
      jobId,
      title: job.title,
      company: job.company,
      questions: [],
      talkingPoints: [],
      usedProvider: cfg.provider,
    };
    if (cfg.provider === "none") {
      return {
        ...base,
        error:
          "No AI provider is configured. Add one in Settings to generate interview prep.",
      };
    }
    const [profile, resume] = await Promise.all([
      this.storage.getProfile(),
      this.storage.getResume(),
    ]);
    const system =
      "You are an interview coach. Given a job posting and a candidate's " +
      "resume, produce likely interview questions and honest talking points. " +
      "Talking points must use ONLY facts present in the resume/profile — do " +
      "NOT invent experience, numbers, employers, or skills. Respond with " +
      "STRICT JSON only, no prose, in this shape: " +
      '{"questions":[{"kind":"behavioral|technical|role-specific|about-you",' +
      '"question":"...","rationale":"why it is likely for THIS role"}],' +
      '"talkingPoints":["short honest point grounded in the resume"]}. ' +
      "Provide 6-10 questions and 3-6 talking points.";
    const user =
      `Job: ${job.title} at ${job.company}\n` +
      `Location/model: ${job.location} (${job.workModel})\n\n` +
      `Job description:\n${job.description.slice(0, 2500)}\n\n` +
      `Candidate target role: ${profile?.jobFunction ?? "(unspecified)"}\n` +
      `Candidate resume:\n${resume?.text.slice(0, 3500) ?? "(no resume imported)"}`;
    const result = await this.deps.chat({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      system,
      user,
    });
    if (!result.ok) {
      return { ...base, error: result.text || "The AI request failed." };
    }
    const parsed = parseInterviewJson(result.text);
    if (!parsed) {
      return {
        ...base,
        error:
          "Couldn't parse the AI response into prep questions. Try regenerating.",
      };
    }
    // Truth-check ONLY the talking points (they make claims about the
    // candidate). Questions are an interviewer's hypotheticals, not claims.
    let truthViolations: InterviewPrep["truthViolations"] = [];
    const sources = await this.truthSources(jobId);
    if (sources && parsed.talkingPoints.length) {
      const check = checkTruth(parsed.talkingPoints.join("\n"), sources);
      if (!check.ok) truthViolations = check.violations;
    }
    return {
      ...base,
      questions: parsed.questions,
      talkingPoints: parsed.talkingPoints,
      truthViolations,
    };
  }

  // ---- AI ----
  async getAiConfig(): Promise<AiConfigPublic> {
    const row = await this.storage.getAiConfig();
    return { ...row, hasKey: this.deps.secrets.hasApiKey() };
  }

  async setAiConfig(config: AiConfigInput): Promise<AiConfigPublic> {
    await this.storage.saveAiConfig(
      config.provider,
      config.model ?? null,
      config.baseUrl ?? null,
    );
    if (typeof config.apiKey === "string") {
      if (config.apiKey.length > 0) this.deps.secrets.storeApiKey(config.apiKey);
      else this.deps.secrets.clearApiKey();
    }
    const row = await this.storage.getAiConfig();
    return { ...row, hasKey: this.deps.secrets.hasApiKey() };
  }

  // Build the allowed-fact set for the truth gate from what the user actually
  // provided (resume + profile), plus the job title/company as phrasing-only
  // context. `extraFacts` are facts the USER typed into the guided gap-fill —
  // they're genuine user-supplied truth, so they're appended to the resume text
  // the gate validates against.
  private async truthSources(
    jobId?: string,
    extraFacts?: string[],
  ): Promise<TruthSources | null> {
    const [profile, resume] = await Promise.all([
      this.storage.getProfile(),
      this.storage.getResume(),
    ]);
    if (!profile && !resume && !(extraFacts && extraFacts.length)) return null;
    const job = jobId
      ? (await this.storage.listJobs()).find((j) => j.id === jobId)
      : undefined;
    // Saved supplementary facts are permanent truth sources; the one-off
    // `extraFacts` (from this regeneration's gap-fill) are added on top.
    const saved = profile?.supplementaryFacts ?? [];
    const allExtra = [...saved, ...(extraFacts ?? [])]
      .filter((f) => f.trim())
      .join("\n");
    return {
      resumeText: `${resume?.text ?? ""}${allExtra ? `\n${allExtra}` : ""}`,
      profileSkills: profile?.skills ?? [],
      profileIndustries: profile?.industries ?? [],
      jobFunction: profile?.jobFunction ?? "",
      yearsExperience: profile?.yearsExperience ?? 0,
      jobTitle: job?.title,
      jobCompany: job?.company,
    };
  }

  // Generate a cover letter. `gapFacts` are optional facts the USER typed in
  // the guided gap-fill step — genuine truths they supplied to fill flagged
  // gaps. They're given to the model AND added to the truth-gate sources, so
  // the AI may use them but still can't invent anything beyond them.
  async generateCoverLetter(
    jobId: string,
    gapFacts?: string[],
  ): Promise<AiResult> {
    const resume = await this.storage.getResume();
    const job = (await this.storage.listJobs()).find((j) => j.id === jobId);
    const cfg = await this.storage.getAiConfig();
    if (!job) {
      return { ok: false, usedProvider: cfg.provider, text: "Job not found." };
    }
    const profile = await this.storage.getProfile();
    const saved = (profile?.supplementaryFacts ?? []).filter((f) => f.trim());
    const extra = [...saved, ...(gapFacts ?? []).filter((f) => f.trim())];
    const system =
      "You help write honest, concise cover letters. Use only facts present " +
      "in the candidate's resume and the candidate-provided facts. Do not " +
      "invent experience, titles, skills, numbers, metrics, employers, or " +
      "dates beyond what is given.";
    const user =
      `Job: ${job.title} at ${job.company}\n\n` +
      `Job description:\n${job.description.slice(0, 2000)}\n\n` +
      `Candidate resume:\n${resume?.text.slice(0, 4000) ?? "(no resume imported)"}\n\n` +
      (extra.length
        ? `Additional facts the candidate provided (TRUE — you may use these):\n- ${extra.join("\n- ")}\n\n`
        : "") +
      "Write a short cover letter using only truthful details from the resume " +
      "and the candidate-provided facts.";
    const result = await this.deps.chat({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      system,
      user,
    });

    // Re-check against sources that now INCLUDE the user's supplied facts, so
    // facts they genuinely provided are accepted and only real fabrication is
    // flagged.
    if (result.ok && result.text) {
      const sources = await this.truthSources(jobId, extra);
      if (sources) {
        const check = checkTruth(result.text, sources);
        if (!check.ok) {
          return { ...result, truthViolations: check.violations };
        }
      }
    }
    return { ...result, truthViolations: [] };
  }

  async askAssistant(question: string): Promise<AiResult> {
    const cfg = await this.storage.getAiConfig();
    const resume = await this.storage.getResume();
    const jobs = (await this.buildJobsWithMatch()).slice(0, 30);
    const context = jobs
      .map(
        (j) =>
          `- ${j.job.title} @ ${j.job.company} (${j.match?.percent ?? "?"}% match)`,
      )
      .join("\n");
    const system =
      "You are a job-search assistant. Answer only from the provided jobs " +
      "and resume. If something is not in the context, say so. Never invent facts.";
    const user =
      `My jobs:\n${context}\n\n` +
      `My resume:\n${resume?.text.slice(0, 3000) ?? "(none)"}\n\n` +
      `Question: ${question}`;
    const result = await this.deps.chat({
      provider: cfg.provider,
      model: cfg.model,
      baseUrl: cfg.baseUrl,
      system,
      user,
    });
    // The assistant is grounded in the user's own data; surface any facts it
    // introduced that aren't supported (numbers/skills/employers it invented).
    if (result.ok && result.text) {
      const sources = await this.truthSources();
      if (sources) {
        const check = checkTruth(result.text, sources);
        if (!check.ok) return { ...result, truthViolations: check.violations };
      }
    }
    return { ...result, truthViolations: [] };
  }

  // ---- Job sources ----
  listJobSources(): Promise<StoredJobSource[]> {
    return this.storage.listJobSources();
  }

  addJobSource(source: Omit<StoredJobSource, "id">): Promise<StoredJobSource> {
    return this.storage.addJobSource(source);
  }

  deleteJobSource(id: number): Promise<void> {
    return this.storage.deleteJobSource(id);
  }

  async validateCustomSource(
    cfg: import("@shared/storage").CustomSourceConfig,
  ): Promise<{ ok: boolean; error: string | null }> {
    const { validateCustomConfig } = await import("@shared/customSource");
    const error = validateCustomConfig(cfg);
    return { ok: error === null, error };
  }

  // Seed the stored source list with sensible defaults on first run, so the
  // user has something to refresh immediately and can then edit the list. Runs
  // only when no sources exist yet — never overwrites user changes.
  async seedDefaultSourcesIfEmpty(
    defaults: { provider: string; board: string; label: string | null }[],
  ): Promise<void> {
    const existing = await this.storage.listJobSources();
    if (existing.length > 0) return;
    for (const d of defaults) {
      await this.storage.addJobSource({ ...d, enabled: true });
    }
  }

  // The boards to actually fetch: the enabled stored sources.
  async getActiveBoards(): Promise<BoardRef[]> {
    const sources = await this.storage.listJobSources();
    return sources
      .filter((s) => s.enabled)
      .map((s) => ({ provider: s.provider as BoardRef["provider"], board: s.board }));
  }

  // ---- Portability ----
  exportAll(): Promise<ExportBundle> {
    return this.storage.exportAll();
  }

  importAll(bundle: ExportBundle, mode: ImportMode): Promise<ImportSummary> {
    return this.storage.importAll(bundle, mode);
  }

  // Delete every piece of local data (profile, jobs, tracker, saved searches,
  // resume, AI prefs, sources, FX cache) by importing an empty bundle in
  // replace mode. API keys live in the OS vault and are cleared separately.
  async deleteAllData(): Promise<void> {
    const empty: ExportBundle = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      app: "jobwell",
      appVersion: "0.1.0",
      data: {
        profile: null,
        jobs: [],
        applications: [],
        savedSearches: [],
        resume: null,
        aiConfig: { provider: "none", model: null, baseUrl: null },
        jobSources: [],
        contacts: [],
      },
    };
    await this.storage.importAll(empty, "replace");
    // Also clear any stored AI key from the OS vault.
    this.deps.secrets.clearApiKey();
  }
}

const VALID_KINDS: InterviewQuestionKind[] = [
  "behavioral",
  "technical",
  "role-specific",
  "about-you",
];

// Parse the model's interview-prep JSON defensively. Models often wrap JSON in
// prose or markdown fences, so we extract the first {...} block and validate the
// shape. Returns null when nothing usable is found.
export function parseInterviewJson(
  text: string,
): { questions: InterviewQuestion[]; talkingPoints: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  let obj: unknown;
  try {
    obj = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const rec = obj as Record<string, unknown>;

  const rawQuestions = Array.isArray(rec.questions) ? rec.questions : [];
  const questions: InterviewQuestion[] = [];
  for (const q of rawQuestions) {
    if (typeof q !== "object" || q === null) continue;
    const qr = q as Record<string, unknown>;
    const question = typeof qr.question === "string" ? qr.question.trim() : "";
    if (!question) continue;
    const kind = VALID_KINDS.includes(qr.kind as InterviewQuestionKind)
      ? (qr.kind as InterviewQuestionKind)
      : "role-specific";
    const rationale =
      typeof qr.rationale === "string" ? qr.rationale.trim() : "";
    questions.push({ kind, question, rationale });
  }

  const rawPoints = Array.isArray(rec.talkingPoints) ? rec.talkingPoints : [];
  const talkingPoints = rawPoints
    .filter((p): p is string => typeof p === "string")
    .map((p) => p.trim())
    .filter(Boolean);

  if (questions.length === 0 && talkingPoints.length === 0) return null;
  return { questions, talkingPoints };
}
