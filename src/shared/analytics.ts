import type { ApplicationStatus, JobWithMatch, WorkModel } from "./types";
import type { StatusHistoryEntry } from "./storage";

// Pipeline analytics (Phase 6): pure, deterministic computation over the jobs
// the user has tracked. No new data is collected — everything here is derived
// from existing application status + the job's own fields (eligibility, work
// model, source/provider).
//
// HONESTY NOTE: the funnel/breakdowns below are derived from each
// application's CURRENT status (an application only stores its latest state).
// Time-in-stage is computed SEPARATELY from the recorded transition history
// (status_history) — see computeStageTimeline / computeStageDurations — and
// only reflects transitions captured since that logging was added. Nothing is
// back-filled or invented.

export const PIPELINE_STAGES: ApplicationStatus[] = [
  "Applied",
  "Interviewing",
  "Offer",
  "Rejected",
  "Archived",
];

export interface StatusCount {
  status: ApplicationStatus;
  count: number;
}

// A funnel step. `reached` = applications that got to this stage OR beyond. We
// treat Applied → Interviewing → Offer as the forward progression; Rejected and
// Archived are terminal and counted separately (an app can be rejected from any
// stage, so they aren't part of the forward funnel).
export interface FunnelStep {
  stage: "Applied" | "Interviewing" | "Offer";
  reached: number; // got to this stage or further
  // Conversion from the PREVIOUS forward stage to this one, 0..1. Null for the
  // first stage (nothing precedes it) or when the previous stage had zero.
  conversionFromPrev: number | null;
}

export interface Breakdown {
  label: string; // the dimension value, e.g. "remote", "eligible", "greenhouse"
  total: number; // tracked apps in this bucket
  interviewing: number; // reached Interviewing or beyond
  offers: number; // reached Offer
  rejected: number;
  // Interview rate = interviewing / total, 0..1. Useful "where do I convert"
  // signal for a location-constrained seeker (e.g. sponsorship vs general).
  interviewRate: number;
}

export interface PipelineAnalytics {
  totalTracked: number;
  statusCounts: StatusCount[];
  funnel: FunnelStep[];
  // Headline rates over ALL tracked apps (not just the forward funnel).
  interviewRate: number; // reached Interviewing or beyond / total
  offerRate: number; // reached Offer / total
  rejectionRate: number; // Rejected / total
  byEligibility: Breakdown[];
  byWorkModel: Breakdown[];
  bySource: Breakdown[];
  // True when there's nothing to analyze yet.
  empty: boolean;
}

// Rank of each status along the forward progression. Rejected/Archived are
// terminal (not on the forward path), so they get a rank that means "counted,
// but doesn't advance the funnel".
const FORWARD_RANK: Record<ApplicationStatus, number> = {
  Applied: 1,
  Interviewing: 2,
  Offer: 3,
  Rejected: 0,
  Archived: 0,
};

// Did this application reach AT LEAST the given forward stage? Someone currently
// "Offer" has, by definition, been through Applied and Interviewing, so they
// count toward every earlier stage's "reached". A Rejected/Archived app is NOT
// assumed to have reached Interviewing (we can't know from a terminal status
// alone), so it only counts at Applied.
function reachedStage(
  status: ApplicationStatus,
  stageRank: number,
): boolean {
  if (status === "Rejected" || status === "Archived") {
    // Terminal: only safely known to have applied.
    return stageRank <= FORWARD_RANK.Applied;
  }
  return FORWARD_RANK[status] >= stageRank;
}

function safeRate(numer: number, denom: number): number {
  return denom === 0 ? 0 : numer / denom;
}

function buildBreakdown(
  label: string,
  apps: ApplicationStatus[],
): Breakdown {
  const total = apps.length;
  const interviewing = apps.filter((s) =>
    reachedStage(s, FORWARD_RANK.Interviewing),
  ).length;
  const offers = apps.filter((s) => reachedStage(s, FORWARD_RANK.Offer)).length;
  const rejected = apps.filter((s) => s === "Rejected").length;
  return {
    label,
    total,
    interviewing,
    offers,
    rejected,
    interviewRate: safeRate(interviewing, total),
  };
}

// Group the tracked apps by a string dimension and build a breakdown for each
// bucket, sorted by total desc then label for stable output.
function groupBy(
  tracked: { status: ApplicationStatus; key: string }[],
): Breakdown[] {
  const buckets = new Map<string, ApplicationStatus[]>();
  for (const t of tracked) {
    const arr = buckets.get(t.key) ?? [];
    arr.push(t.status);
    buckets.set(t.key, arr);
  }
  return [...buckets.entries()]
    .map(([label, statuses]) => buildBreakdown(label, statuses))
    .sort((a, b) => (b.total !== a.total ? b.total - a.total : a.label.localeCompare(b.label)));
}

function workModelLabel(wm: WorkModel): string {
  return wm; // already "remote" | "hybrid" | "onsite" | "unknown"
}

// Compute the full pipeline analytics from the decorated job list. Only jobs
// with an application (i.e. tracked) are considered.
export function computePipelineAnalytics(
  jobs: JobWithMatch[],
): PipelineAnalytics {
  const tracked = jobs.filter((j) => j.application);
  const statuses = tracked.map((j) => j.application!.status);
  const total = tracked.length;

  const statusCounts: StatusCount[] = PIPELINE_STAGES.map((status) => ({
    status,
    count: statuses.filter((s) => s === status).length,
  }));

  const forwardStages: FunnelStep["stage"][] = [
    "Applied",
    "Interviewing",
    "Offer",
  ];
  const funnel: FunnelStep[] = forwardStages.map((stage, i) => {
    const rank = FORWARD_RANK[stage];
    const reached = statuses.filter((s) => reachedStage(s, rank)).length;
    let conversionFromPrev: number | null = null;
    if (i > 0) {
      const prevRank = FORWARD_RANK[forwardStages[i - 1]];
      const prevReached = statuses.filter((s) =>
        reachedStage(s, prevRank),
      ).length;
      conversionFromPrev = prevReached === 0 ? null : reached / prevReached;
    }
    return { stage, reached, conversionFromPrev };
  });

  const interviewingCount = statuses.filter((s) =>
    reachedStage(s, FORWARD_RANK.Interviewing),
  ).length;
  const offerCount = statuses.filter((s) =>
    reachedStage(s, FORWARD_RANK.Offer),
  ).length;
  const rejectedCount = statuses.filter((s) => s === "Rejected").length;

  const byEligibility = groupBy(
    tracked.map((j) => ({
      status: j.application!.status,
      key: j.eligibility?.verdict ?? "unclear",
    })),
  );
  const byWorkModel = groupBy(
    tracked.map((j) => ({
      status: j.application!.status,
      key: workModelLabel(j.job.workModel),
    })),
  );
  const bySource = groupBy(
    tracked.map((j) => ({
      status: j.application!.status,
      key: j.job.provider,
    })),
  );

  return {
    totalTracked: total,
    statusCounts,
    funnel,
    interviewRate: safeRate(interviewingCount, total),
    offerRate: safeRate(offerCount, total),
    rejectionRate: safeRate(rejectedCount, total),
    byEligibility,
    byWorkModel,
    bySource,
    empty: total === 0,
  };
}

export function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

// ---- Status timeline / time-in-stage (from recorded transitions) ---------

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// One stage an application sat in, with how long it stayed before moving on.
export interface StageSpan {
  status: ApplicationStatus;
  enteredAt: string; // ISO
  // When it left this stage (entered the next). Null = still here (current).
  leftAt: string | null;
  // Days spent in this stage. For the current stage, measured up to `now`.
  days: number;
  current: boolean;
}

export interface JobTimeline {
  jobId: string;
  spans: StageSpan[];
  // Total days from first recorded transition to the latest (or now).
  totalDays: number;
}

// Average days spent in a stage across all applications that have LEFT it
// (we only average completed stages, so an in-progress stage doesn't skew the
// number downward). `samples` is how many completed spans fed the average.
export interface StageDurationStat {
  status: ApplicationStatus;
  avgDays: number;
  samples: number;
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return ms / MS_PER_DAY;
}

// Build a per-job timeline from the raw transition log. `nowIso` lets callers
// (and tests) pin "now" for the open/current span; defaults to the real clock.
export function computeStageTimeline(
  history: StatusHistoryEntry[],
  nowIso: string = new Date().toISOString(),
): JobTimeline[] {
  // Group transitions by job, preserving chronological order.
  const byJob = new Map<string, StatusHistoryEntry[]>();
  for (const h of history) {
    const arr = byJob.get(h.jobId) ?? [];
    arr.push(h);
    byJob.set(h.jobId, arr);
  }

  const timelines: JobTimeline[] = [];
  for (const [jobId, entries] of byJob) {
    const sorted = [...entries].sort((a, b) =>
      a.changedAt.localeCompare(b.changedAt),
    );
    const spans: StageSpan[] = sorted.map((entry, i) => {
      const next = sorted[i + 1];
      const leftAt = next ? next.changedAt : null;
      const end = leftAt ?? nowIso;
      return {
        status: entry.status,
        enteredAt: entry.changedAt,
        leftAt,
        days: Math.round(daysBetween(entry.changedAt, end) * 10) / 10,
        current: !next,
      };
    });
    const totalDays =
      spans.length === 0
        ? 0
        : Math.round(
            daysBetween(sorted[0].changedAt, nowIso) * 10,
          ) / 10;
    timelines.push({ jobId, spans, totalDays });
  }
  // Stable order: most recently active first.
  return timelines.sort((a, b) => {
    const la = a.spans[a.spans.length - 1]?.enteredAt ?? "";
    const lb = b.spans[b.spans.length - 1]?.enteredAt ?? "";
    return lb.localeCompare(la);
  });
}

// Average time-in-stage across all jobs, over COMPLETED spans only.
export function computeStageDurations(
  history: StatusHistoryEntry[],
): StageDurationStat[] {
  const timelines = computeStageTimeline(history);
  const totals = new Map<ApplicationStatus, { sum: number; n: number }>();
  for (const t of timelines) {
    for (const span of t.spans) {
      if (span.current) continue; // only completed stages
      const cur = totals.get(span.status) ?? { sum: 0, n: 0 };
      cur.sum += span.days;
      cur.n += 1;
      totals.set(span.status, cur);
    }
  }
  return PIPELINE_STAGES.filter((s) => totals.has(s)).map((status) => {
    const { sum, n } = totals.get(status)!;
    return {
      status,
      avgDays: Math.round((sum / n) * 10) / 10,
      samples: n,
    };
  });
}

export function formatDays(days: number): string {
  if (days < 1) return "<1 day";
  const rounded = Math.round(days);
  return rounded === 1 ? "1 day" : `${rounded} days`;
}
