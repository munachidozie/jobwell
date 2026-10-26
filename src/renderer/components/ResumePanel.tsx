import { useEffect, useState } from "react";
import type { Resume, ResumeAnalysis, TailorResult } from "@shared/types";

export function ResumePanel() {
  const [resume, setResume] = useState<Resume | null>(null);
  const [analysis, setAnalysis] = useState<ResumeAnalysis | null>(null);
  const [tailor, setTailor] = useState<TailorResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await window.jobwell.getResume();
    setResume(r);
    if (r) setAnalysis(await window.jobwell.analyzeResume());
  }

  useEffect(() => {
    void load();
  }, []);

  async function importResume() {
    setBusy(true);
    const r = await window.jobwell.importResume();
    setBusy(false);
    if (r) {
      setResume(r);
      setAnalysis(await window.jobwell.analyzeResume());
      setTailor(null);
    }
  }

  async function tailorFor(jobId: string) {
    setTailor(await window.jobwell.tailorForJob(jobId));
  }

  if (!resume) {
    return (
      <div className="empty">
        <p>No resume imported.</p>
        <p className="hint">
          Import a PDF, Word (.docx) or text file. It stays on your machine.
        </p>
        <button className="primary" onClick={importResume} disabled={busy}>
          {busy ? "Importing…" : "Import resume"}
        </button>
      </div>
    );
  }

  const r = analysis?.readability;

  return (
    <div className="form" style={{ maxWidth: 760 }}>
      <div className="row">
        <h2 style={{ flex: 1 }}>Resume: {resume.fileName}</h2>
        <button className="primary" onClick={importResume} disabled={busy}>
          {busy ? "Importing…" : "Replace"}
        </button>
      </div>

      {r && (
        <div className="job">
          <div>
            <h3>Readability</h3>
            <div className="meta">
              <span className="badge">{r.words} words</span>
              <span className="badge">{r.sentences} sentences</span>
              <span className="badge">
                {r.avgWordsPerSentence} words/sentence
              </span>
              <span className="badge">grade {r.grade}</span>
            </div>
            <p className="hint">{r.note}</p>
          </div>
        </div>
      )}

      <h3>Keyword gaps by job</h3>
      <p className="hint">
        How well your resume covers each job's keywords. "Tailor" reorders your
        own lines by relevance — it never invents anything.
      </p>
      {analysis?.topGaps.map((g) => (
        <div className="job" key={g.jobId}>
          <div>
            <h3>
              {g.title} · {g.company}
            </h3>
            <div className="meta">
              <span className="badge">
                {Math.round(g.coverage * 100)}% keyword coverage
              </span>
            </div>
            {g.missing.length > 0 && (
              <p className="hint">Missing: {g.missing.join(", ")}</p>
            )}
          </div>
          <div className="score">
            <button className="tab" onClick={() => tailorFor(g.jobId)}>
              Tailor
            </button>
          </div>
        </div>
      ))}

      {tailor && (
        <div className="job" style={{ display: "block" }}>
          <h3>Tailoring suggestion</h3>
          <p className="hint">{tailor.disclaimer}</p>
          <h4>Your most relevant lines (verbatim)</h4>
          {tailor.prioritizedLines.length === 0 ? (
            <p className="hint">
              None of your resume lines overlap this job's keywords.
            </p>
          ) : (
            <ul>
              {tailor.prioritizedLines.map((l, i) => (
                <li key={i}>
                  {l.line}{" "}
                  <span className="hint">
                    ({l.matchedKeywords.join(", ")})
                  </span>
                </li>
              ))}
            </ul>
          )}
          {tailor.gapsToConsider.length > 0 && (
            <>
              <h4>Honest gaps to consider</h4>
              <p className="hint">
                Only add these if they are genuinely true of you:{" "}
                {tailor.gapsToConsider.join(", ")}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
