import { useState } from "react";
import type { AiResult, ApplicationStatus, EligibilityInfo } from "@shared/types";
import type { DedupedJob } from "@shared/dedup";
import { AiDocPanel } from "./AiDocPanel";

const STATUSES: ApplicationStatus[] = [
  "Applied",
  "Interviewing",
  "Offer",
  "Rejected",
  "Archived",
];

function eligibilityLabel(verdict: EligibilityInfo["verdict"]): string {
  switch (verdict) {
    case "eligible":
      return "✅ You can apply";
    case "eligible-with-sponsorship":
      return "🛂 Sponsorship offered";
    case "likely-ineligible":
      return "⚠️ Likely not open to you";
    default:
      return "❔ Eligibility unclear";
  }
}

function JobCard({
  item,
  onReload,
}: {
  item: DedupedJob;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { job, match, application, eligibility, sources, pay } = item;

  // Cover-letter state for this card.
  const [letter, setLetter] = useState<AiResult | null>(null);
  const [letterBusy, setLetterBusy] = useState(false);
  const [showLetter, setShowLetter] = useState(false);
  // Tailored-resume state for this card (same shape/flow as the cover letter).
  const [resume, setResume] = useState<AiResult | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [showResume, setShowResume] = useState(false);

  const safeCompany = job.company.replace(/[^a-z0-9]+/gi, "-").toLowerCase();

  async function setStatus(status: ApplicationStatus) {
    await window.jobwell.setApplicationStatus(job.id, status);
    onReload();
  }

  async function genCoverLetter(facts?: string[]) {
    setLetterBusy(true);
    setShowLetter(true);
    try {
      const res = await window.jobwell.generateCoverLetter(job.id, facts);
      setLetter(res);
    } catch (e) {
      setLetter({ ok: false, text: String(e), usedProvider: "none" });
    } finally {
      setLetterBusy(false);
    }
  }

  async function genTailoredResume(facts?: string[]) {
    setResumeBusy(true);
    setShowResume(true);
    try {
      const res = await window.jobwell.tailorResumeWithAi(job.id, facts);
      setResume(res);
    } catch (e) {
      setResume({ ok: false, text: String(e), usedProvider: "none" });
    } finally {
      setResumeBusy(false);
    }
  }

  async function exportLetter(format: "pdf" | "docx") {
    if (!letter?.text) return;
    await window.jobwell.exportDocument(
      format,
      `Cover Letter — ${job.title} at ${job.company}`,
      letter.text,
      `cover-letter-${safeCompany}`,
    );
  }

  async function exportResume(format: "pdf" | "docx") {
    if (!resume?.text) return;
    await window.jobwell.exportDocument(
      format,
      `Resume — ${job.title} at ${job.company}`,
      resume.text,
      `resume-${safeCompany}`,
    );
  }

  return (
    <div className="job">
      <div>
        <h3>
          <a href={job.url} target="_blank" rel="noreferrer">
            {job.title}
          </a>
        </h3>
        <div className="meta">
          <span>{job.company}</span>
          <span className="badge">{job.location || "Location n/a"}</span>
          <span className="badge">{job.workModel}</span>
          {sources.length > 1 ? (
            <span
              className="badge multi"
              title={`Posted on: ${sources.join(", ")}`}
            >
              on {sources.length} boards: {sources.join(", ")}
            </span>
          ) : (
            <span className="badge">{job.provider}</span>
          )}
          {pay && (
            <span
              className="badge pay"
              title={
                pay.fxApproximate
                  ? "Pay converted to USD at an approximate rate for comparison"
                  : "Pay as stated in the posting"
              }
            >
              {pay.text}
            </span>
          )}
        </div>
        {eligibility && (
          <div className={`elig elig-${eligibility.verdict}`} title={eligibility.reason}>
            {eligibilityLabel(eligibility.verdict)} · {eligibility.reason}
          </div>
        )}
        {match && (
          <div className="reasons">
            <button
              className="tab"
              style={{ padding: "2px 0", color: "var(--accent)" }}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? "Hide" : "Why this score?"}
            </button>
            {open &&
              match.reasons.map((r) => (
                <div key={r.factor}>
                  <strong>
                    {r.factor} ({r.points}/{r.weight}):
                  </strong>{" "}
                  {r.detail}
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="score">
        {match ? (
          <>
            <div className={`pct band-${match.band}`}>{match.percent}%</div>
            <div className={`band-${match.band}`}>{match.band}</div>
          </>
        ) : (
          <div className="hint">Set a profile to score</div>
        )}
        <div className="row" style={{ marginTop: 10, justifyContent: "flex-end" }}>
          <select
            className="status-select"
            value={application?.status ?? ""}
            onChange={(e) => setStatus(e.target.value as ApplicationStatus)}
          >
            <option value="" disabled>
              Track…
            </option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="row" style={{ marginTop: 6, justifyContent: "flex-end" }}>
          <button
            className="tab"
            onClick={() => genCoverLetter()}
            disabled={letterBusy}
          >
            {letterBusy ? "Writing…" : "✍️ Cover letter"}
          </button>
        </div>
        <div className="row" style={{ marginTop: 6, justifyContent: "flex-end" }}>
          <button
            className="tab"
            onClick={() => genTailoredResume()}
            disabled={resumeBusy}
            title="Rewrite your resume to fit this job, using only your real experience"
          >
            {resumeBusy ? "Tailoring…" : "📄 Tailor resume"}
          </button>
        </div>
      </div>

      {/* AI documents span the full card width when shown. */}
      {showLetter && (
        <AiDocPanel
          title="Cover letter"
          result={letter}
          busy={letterBusy}
          onRegenerate={(facts) => genCoverLetter(facts)}
          onClose={() => setShowLetter(false)}
          onExport={exportLetter}
          onCopy={() => letter?.text && navigator.clipboard.writeText(letter.text)}
        />
      )}
      {showResume && (
        <AiDocPanel
          title="Tailored resume"
          result={resume}
          busy={resumeBusy}
          onRegenerate={(facts) => genTailoredResume(facts)}
          onClose={() => setShowResume(false)}
          onExport={exportResume}
          onCopy={() => resume?.text && navigator.clipboard.writeText(resume.text)}
        />
      )}
    </div>
  );
}

export function Feed({
  jobs,
  hasProfile,
  onReload,
}: {
  jobs: DedupedJob[];
  hasProfile: boolean;
  onReload: () => void;
}) {
  if (jobs.length === 0) {
    return (
      <div className="empty">
        <p>No jobs yet.</p>
        <p className="hint">
          {hasProfile
            ? 'Click "Refresh jobs" to pull postings from employer boards.'
            : "Set up your profile first, then refresh jobs."}
        </p>
      </div>
    );
  }
  return (
    <div>
      {jobs.map((item) => (
        <JobCard key={item.job.id} item={item} onReload={onReload} />
      ))}
    </div>
  );
}
