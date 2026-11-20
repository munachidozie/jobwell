import { useState } from "react";
import type { AiResult } from "@shared/types";

// Shared panel for an AI-generated, truth-gated document (cover letter or
// tailored resume). It renders the result, the guided gap-fill for any truth
// violations (with "save to profile"), and copy/export controls. Keeping this
// in one place means the cover letter and the tailored resume behave
// identically — same honesty UX, flagged facts, and export.
export function AiDocPanel({
  title,
  result,
  busy,
  onRegenerate,
  onClose,
  onExport,
  onCopy,
}: {
  title: string;
  result: AiResult | null;
  busy: boolean;
  // Called with the user's typed gap-fill facts to regenerate the document.
  onRegenerate: (facts: string[]) => void;
  onClose: () => void;
  onExport: (format: "pdf" | "docx") => void;
  onCopy: () => void;
}) {
  // Guided gap-fill: user-supplied facts keyed by the flagged value.
  const [gapFacts, setGapFacts] = useState<Record<string, string>>({});
  // Flagged values whose fact the user explicitly saved to their profile.
  const [savedGaps, setSavedGaps] = useState<Record<string, boolean>>({});

  function regenerate() {
    const facts = Object.values(gapFacts)
      .map((f) => f.trim())
      .filter(Boolean);
    onRegenerate(facts);
  }

  async function saveGapToProfile(value: string) {
    const fact = (gapFacts[value] ?? "").trim();
    if (!fact) return;
    await window.jobwell.addSupplementaryFact(fact);
    setSavedGaps((s) => ({ ...s, [value]: true }));
  }

  return (
    <div className="coverletter">
      <div className="row">
        <h4 style={{ margin: 0, flex: 1 }}>{title}</h4>
        {result?.ok && (
          <>
            <button className="tab" onClick={onCopy}>
              Copy
            </button>
            <button className="tab" onClick={() => onExport("pdf")}>
              PDF
            </button>
            <button className="tab" onClick={() => onExport("docx")}>
              Word
            </button>
          </>
        )}
        <button className="tab" onClick={onClose}>
          Close
        </button>
      </div>

      {busy && <p className="hint">Generating…</p>}

      {result && !result.ok && (
        <p className="hint" style={{ color: "var(--danger)" }}>
          {result.text}
        </p>
      )}

      {result?.ok && (
        <>
          {result.truthViolations && result.truthViolations.length > 0 && (
            <div className="truth-warn">
              <strong>
                ⚠️ These aren't in your resume/profile. If you genuinely have
                the experience, describe it in your own words and regenerate —
                otherwise leave blank to drop it.
              </strong>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {result.truthViolations.map((v, i) => (
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
                <button className="primary" onClick={regenerate} disabled={busy}>
                  Regenerate with my facts
                </button>
              </div>
              <p className="hint" style={{ marginTop: 6 }}>
                Only what you type here is added — the AI still can't invent
                anything beyond your resume and these facts.
              </p>
            </div>
          )}
          {result.truthViolations && result.truthViolations.length === 0 && (
            <p className="hint" style={{ color: "var(--strong)" }}>
              ✅ Every fact in this draft traces to your resume/profile.
            </p>
          )}
          <textarea
            className="letter-text"
            value={result.text}
            readOnly
            rows={14}
          />
        </>
      )}
    </div>
  );
}
