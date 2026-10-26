import { useEffect, useMemo, useState } from "react";
import type { JobWithMatch, StatusHistoryEntryDTO } from "@shared/types";
import type { Breakdown, JobTimeline } from "@shared/analytics";
import {
  computePipelineAnalytics,
  computeStageDurations,
  computeStageTimeline,
  formatDays,
  formatRate,
} from "@shared/analytics";

function BreakdownTable({
  title,
  rows,
  hint,
}: {
  title: string;
  rows: Breakdown[];
  hint?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="job" style={{ display: "block" }}>
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      <table className="analytics-table">
        <thead>
          <tr>
            <th>{title.replace(/^By /, "")}</th>
            <th>Tracked</th>
            <th>Interviewing+</th>
            <th>Offers</th>
            <th>Interview rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              <td>{r.total}</td>
              <td>{r.interviewing}</td>
              <td>{r.offers}</td>
              <td>{formatRate(r.interviewRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Map each tracked job id to a readable "Title · Company" label.
function labelFor(jobs: JobWithMatch[], jobId: string): string {
  const j = jobs.find((x) => x.job.id === jobId);
  return j ? `${j.job.title} · ${j.job.company}` : jobId;
}

export function Analytics({ jobs }: { jobs: JobWithMatch[] }) {
  const a = useMemo(() => computePipelineAnalytics(jobs), [jobs]);
  const [history, setHistory] = useState<StatusHistoryEntryDTO[]>([]);

  useEffect(() => {
    void window.jobwell.listStatusHistory().then(setHistory);
  }, [jobs]);

  const timelines = useMemo(() => computeStageTimeline(history), [history]);
  const stageDurations = useMemo(
    () => computeStageDurations(history),
    [history],
  );

  if (a.empty) {
    return (
      <div className="empty">
        <p>No pipeline data yet.</p>
        <p className="hint">
          Track a few jobs from the Feed (use the "Track…" dropdown) and set
          their status as you apply and interview. Your funnel and conversion
          rates will build up here — computed entirely on your machine.
        </p>
      </div>
    );
  }

  // Largest "reached" in the forward funnel, for proportional bar widths.
  const maxReached = Math.max(...a.funnel.map((f) => f.reached), 1);

  return (
    <div className="form" style={{ maxWidth: 820 }}>
      <h2>Pipeline analytics</h2>
      <p className="hint">
        {a.totalTracked} tracked application(s). All figures are computed
        locally from your tracker — nothing is uploaded.
      </p>

      <div className="meta" style={{ marginBottom: 12 }}>
        <span className="badge">Interview rate {formatRate(a.interviewRate)}</span>
        <span className="badge">Offer rate {formatRate(a.offerRate)}</span>
        <span className="badge">
          Rejection rate {formatRate(a.rejectionRate)}
        </span>
      </div>

      <div className="job" style={{ display: "block" }}>
        <h3>Funnel</h3>
        <p className="hint">
          How far your applications have reached. A later stage implies the
          earlier ones, so "reached" counts anyone at that stage or beyond.
        </p>
        <div className="funnel">
          {a.funnel.map((f) => (
            <div className="funnel-row" key={f.stage}>
              <span className="funnel-label">{f.stage}</span>
              <div className="funnel-bar-track">
                <div
                  className="funnel-bar"
                  style={{ width: `${(f.reached / maxReached) * 100}%` }}
                />
              </div>
              <span className="funnel-count">
                {f.reached}
                {f.conversionFromPrev !== null && (
                  <span className="hint">
                    {" "}
                    ({formatRate(f.conversionFromPrev)} from prev)
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="job" style={{ display: "block" }}>
        <h3>By status</h3>
        <div className="meta">
          {a.statusCounts.map((s) => (
            <span className="badge" key={s.status}>
              {s.status}: {s.count}
            </span>
          ))}
        </div>
      </div>

      <BreakdownTable
        title="By eligibility"
        rows={a.byEligibility}
        hint="Where you convert best given your base country — e.g. sponsorship-offering roles vs general remote."
      />
      <BreakdownTable
        title="By work model"
        rows={a.byWorkModel}
      />
      <BreakdownTable
        title="By source"
        rows={a.bySource}
        hint="Which job boards/feeds actually lead to interviews for you."
      />

      <div className="job" style={{ display: "block" }}>
        <h3>Time in stage</h3>
        {stageDurations.length === 0 ? (
          <p className="hint">
            Nothing to show yet. Time-in-stage is measured from recorded status
            changes, so move an application between stages (e.g. Applied →
            Interviewing) and the averages will appear here. Only transitions
            made from now on are counted — nothing is back-filled.
          </p>
        ) : (
          <>
            <p className="hint">
              Average days spent in each stage before moving on, across
              completed stages. In-progress stages aren't averaged in.
            </p>
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Avg time</th>
                  <th>Samples</th>
                </tr>
              </thead>
              <tbody>
                {stageDurations.map((d) => (
                  <tr key={d.status}>
                    <td>{d.status}</td>
                    <td>{formatDays(d.avgDays)}</td>
                    <td>{d.samples}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {timelines.length > 0 && (
        <div className="job" style={{ display: "block" }}>
          <h3>Per-application timeline</h3>
          <p className="hint">
            How each tracked application has moved through stages, with days in
            each. The current stage shows elapsed time so far.
          </p>
          {timelines.map((t: JobTimeline) => (
            <div key={t.jobId} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, marginBottom: 4 }}>
                {labelFor(jobs, t.jobId)}{" "}
                <span className="hint">· {formatDays(t.totalDays)} total</span>
              </div>
              <div className="timeline">
                {t.spans.map((span, i) => (
                  <span key={i} className="timeline-step">
                    <span className={`badge ${span.current ? "alert" : ""}`}>
                      {span.status}
                    </span>
                    <span className="hint">
                      {" "}
                      {formatDays(span.days)}
                      {span.current ? " so far" : ""}
                    </span>
                    {i < t.spans.length - 1 && (
                      <span className="timeline-arrow"> → </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
