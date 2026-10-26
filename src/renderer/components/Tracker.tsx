import { useState } from "react";
import type {
  ApplicationStatus,
  InterviewPrep,
  JobWithMatch,
} from "@shared/types";

const STATUSES: ApplicationStatus[] = [
  "Applied",
  "Interviewing",
  "Offer",
  "Rejected",
  "Archived",
];

// ISO date (yyyy-mm-dd) for a <input type="date">, or "" if none.
function toDateInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

function isDue(iso: string | null): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  // Due if the reminder date is today or earlier.
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return d.getTime() <= today.getTime();
}

export function Tracker({
  jobs,
  onReload,
}: {
  jobs: JobWithMatch[];
  onReload: () => void;
}) {
  const tracked = jobs.filter((j) => j.application);

  // Surface any due reminders at the top.
  const due = tracked.filter((j) => isDue(j.application?.reminderAt ?? null));

  // Interview prep, lazily generated per job and cached in component state.
  const [prep, setPrep] = useState<Record<string, InterviewPrep | null>>({});
  const [prepBusy, setPrepBusy] = useState<string | null>(null);

  async function generatePrep(jobId: string) {
    setPrepBusy(jobId);
    try {
      const res = await window.jobwell.prepInterview(jobId);
      setPrep((p) => ({ ...p, [jobId]: res }));
    } catch (e) {
      setPrep((p) => ({
        ...p,
        [jobId]: {
          jobId,
          title: "",
          company: "",
          questions: [],
          talkingPoints: [],
          usedProvider: "none",
          error: String(e),
        },
      }));
    } finally {
      setPrepBusy(null);
    }
  }

  if (tracked.length === 0) {
    return (
      <div className="empty">
        <p>Nothing tracked yet.</p>
        <p className="hint">
          Use the "Track…" dropdown on a job in the Feed to add it here.
        </p>
      </div>
    );
  }

  async function update(jobId: string, status: ApplicationStatus) {
    await window.jobwell.setApplicationStatus(jobId, status);
    onReload();
  }

  async function setReminder(jobId: string, dateStr: string) {
    // Store end-of-day ISO so a same-day reminder counts as due that day.
    const iso = dateStr ? new Date(`${dateStr}T09:00:00`).toISOString() : null;
    await window.jobwell.setReminder(jobId, iso);
    onReload();
  }

  async function untrack(jobId: string) {
    await window.jobwell.untrack(jobId);
    onReload();
  }

  return (
    <div>
      {due.length > 0 && (
        <div className="truth-warn" style={{ marginBottom: 16 }}>
          <strong>⏰ {due.length} reminder(s) due:</strong>
          <ul>
            {due.map(({ job }) => (
              <li key={job.id}>
                {job.title} @ {job.company}
              </li>
            ))}
          </ul>
        </div>
      )}

      {STATUSES.map((status) => {
        const group = tracked.filter((j) => j.application?.status === status);
        if (group.length === 0) return null;
        return (
          <div key={status} style={{ marginBottom: 20 }}>
            <h3 style={{ color: "var(--muted)" }}>
              {status} ({group.length})
            </h3>
            {group.map(({ job, application }) => {
              const due = isDue(application?.reminderAt ?? null);
              const p = prep[job.id];
              return (
                <div className="job" key={job.id} style={{ display: "block" }}>
                 <div className="row">
                  <div>
                    <h3>
                      <a href={job.url} target="_blank" rel="noreferrer">
                        {job.title}
                      </a>
                    </h3>
                    <div className="meta">
                      <span>{job.company}</span>
                      <span className="badge">{job.location || "n/a"}</span>
                      {application?.reminderAt && (
                        <span className={`badge ${due ? "alert" : ""}`}>
                          ⏰ {toDateInput(application.reminderAt)}
                          {due ? " (due)" : ""}
                        </span>
                      )}
                    </div>
                    <label
                      className="hint"
                      style={{ display: "block", marginTop: 6 }}
                    >
                      Follow-up reminder:{" "}
                      <input
                        type="date"
                        className="status-select"
                        value={toDateInput(application?.reminderAt ?? null)}
                        onChange={(e) => setReminder(job.id, e.target.value)}
                      />
                      {application?.reminderAt && (
                        <button
                          className="tab"
                          onClick={() => setReminder(job.id, "")}
                        >
                          clear
                        </button>
                      )}
                    </label>
                  </div>
                  <div className="score">
                    <select
                      className="status-select"
                      value={status}
                      onChange={(e) =>
                        update(job.id, e.target.value as ApplicationStatus)
                      }
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <div
                      className="row"
                      style={{ marginTop: 6, justifyContent: "flex-end" }}
                    >
                      <button
                        className="tab"
                        onClick={() => generatePrep(job.id)}
                        disabled={prepBusy === job.id}
                        title="Likely interview questions + honest talking points"
                      >
                        {prepBusy === job.id ? "Prepping…" : "Prep interview"}
                      </button>
                      <button
                        className="tab danger"
                        onClick={() => untrack(job.id)}
                        title="Remove from tracker (keeps the job in your feed)"
                      >
                        Untrack
                      </button>
                    </div>
                  </div>
                  </div>

                  {p && <InterviewPrepPanel prep={p} />}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  "role-specific": "Role-specific",
  "about-you": "About you",
};

function InterviewPrepPanel({ prep }: { prep: InterviewPrep }) {
  if (prep.error) {
    return (
      <p className="hint" style={{ color: "var(--danger)", marginTop: 10 }}>
        {prep.error}
      </p>
    );
  }
  return (
    <div style={{ marginTop: 12 }}>
      <h4>Likely interview questions</h4>
      <p className="hint">
        What an interviewer might ask for this role, based on the posting.
        Rehearse honest answers from your real experience.
      </p>
      <ul>
        {prep.questions.map((q, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <span className="badge">{KIND_LABEL[q.kind] ?? q.kind}</span>{" "}
            {q.question}
            {q.rationale && <div className="hint">{q.rationale}</div>}
          </li>
        ))}
      </ul>

      {prep.talkingPoints.length > 0 && (
        <>
          <h4>Your talking points</h4>
          <p className="hint">
            Grounded in your resume. Use these as honest anchors — don't claim
            anything that isn't true of you.
          </p>
          <ul>
            {prep.talkingPoints.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </>
      )}

      {prep.truthViolations && prep.truthViolations.length > 0 && (
        <p className="truth-warn" style={{ marginTop: 8 }}>
          ⚠️ Some talking points mention things not in your resume (
          {prep.truthViolations.map((v) => v.value).join(", ")}). Only use them
          if they're genuinely true of you.
        </p>
      )}
    </div>
  );
}
