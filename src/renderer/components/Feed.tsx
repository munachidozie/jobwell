import { useState } from "react";
import type { AiResult, ApplicationStatus, EligibilityInfo } from "@shared/types";
import type { DedupedJob } from "@shared/dedup";

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
  // Guided gap-fill: user-supplied facts, keyed by the flagged value.
  const [gapFacts, setGapFacts] = useState<Record<string, string>>({});
  // Flagged values whose typed fact the user explicitly saved to their profile.
  const [savedGaps, setSavedGaps] = useState<Record<string, boolean>>({});

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

  // Regenerate using the facts the user typed for each flagged gap. Only
  // non-empty facts are sent; the truth gate re-checks against them so the
  // AI may use them but still can't fabricate beyond what the user supplied.
  async function regenerateWithFacts() {
    const facts = Object.values(gapFacts)
      .map((f) => f.trim())
      .filter(Boolean);
    await genCoverLetter(facts);
  }

  // Persist a single gap fact to the profile so it's remembered and stops being
  // flagged next time. Only saves what the user actually typed.
  async function saveGapToProfile(value: string) {
    const fact = (gapFacts[value] ?? "").trim();
    if (!fact) return;
    await window.jobwell.addSupplementaryFact(fact);
    setSavedGaps((s) => ({ ...s, [value]: true }));
  }

  async function copyLetter() {
    if (letter?.text) await navigator.clipboard.writeText(letter.text);
  }

  async function exportLetter(format: "pdf" | "docx") {
    if (!letter?.text) return;
    const safeCompany = job.company.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    await window.jobwell.exportDocument(
      format,
      `Cover Letter — ${job.title} at ${job.company}`,
      letter.text,
      `cover-letter-${safeCompany}`,
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
      </div>

      {/* Cover letter spans the full card width when shown. */}
      {showLetter && (
        <div className="coverletter">
          <div className="row">
            <h4 style={{ margin: 0, flex: 1 }}>Cover letter</h4>
            {letter?.ok && (
              <>
                <button className="tab" onClick={copyLetter}>
                  Copy
                </button>
                <button className="tab" onClick={() => exportLetter("pdf")}>
                  PDF
                </button>
                <button className="tab" onClick={() => exportLetter("docx")}>
                  Word
                </button>
              </>
            )}
            <button className="tab" onClick={() => setShowLetter(false)}>
              Close
            </button>
          </div>

          {letterBusy && <p className="hint">Generating…</p>}

          {letter && !letter.ok && (
            <p className="hint" style={{ color: "var(--danger)" }}>
              {letter.text}
            </p>
          )}

          {letter?.ok && (
            <>
              {letter.truthViolations && letter.truthViolations.length > 0 && (
                <div className="truth-warn">
                  <strong>
                    ⚠️ These aren't in your resume/profile. If you genuinely
                    have the experience, describe it in your own words and
                    regenerate — otherwise leave blank to drop it.
                  </strong>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    {letter.truthViolations.map((v, i) => (
                      <div key={i}>
                        <div style={{ fontSize: 13, marginBottom: 2 }}>
                          <code>{v.value}</code> — {v.reason}
                        </div>
                        <input
                          className="filter-input"
                          style={{ width: "100%" }}
                          placeholder={`Your real experience with "${v.value}" (or leave blank)`}
                          value={gapFacts[v.value] ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            setGapFacts((g) => ({ ...g, [v.value]: val }));
                            // Editing invalidates a prior save for this gap.
                            setSavedGaps((s) =>
                              s[v.value] ? { ...s, [v.value]: false } : s,
                            );
                          }}
                        />
                        <div style={{ marginTop: 4 }}>
                          {savedGaps[v.value] ? (
                            <span
                              className="hint"
                              style={{ color: "var(--strong)" }}
                            >
                              💾 Saved to profile — won't be flagged next time.
                            </span>
                          ) : (
                            <button
                              className="link"
                              disabled={!(gapFacts[v.value] ?? "").trim()}
                              onClick={() => saveGapToProfile(v.value)}
                            >
                              💾 Save to profile
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <button
                      className="primary"
                      onClick={regenerateWithFacts}
                      disabled={letterBusy}
                    >
                      Regenerate with my facts
                    </button>
                  </div>
                  <p className="hint" style={{ marginTop: 6 }}>
                    Only what you type here is added — the AI still can't invent
                    anything beyond your resume and these facts.
                  </p>
                </div>
              )}
              {letter.truthViolations &&
                letter.truthViolations.length === 0 && (
                  <p className="hint" style={{ color: "var(--strong)" }}>
                    ✅ Every fact in this draft traces to your resume/profile.
                  </p>
                )}
              <textarea
                className="letter-text"
                value={letter.text}
                readOnly
                rows={14}
              />
            </>
          )}
        </div>
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
