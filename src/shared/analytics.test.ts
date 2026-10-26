import { describe, expect, it } from "vitest";
import {
  computePipelineAnalytics,
  computeStageDurations,
  computeStageTimeline,
  formatDays,
  formatRate,
} from "./analytics";
import type {
  Application,
  ApplicationStatus,
  JobWithMatch,
  WorkModel,
} from "./types";

let seq = 0;

function tracked(opts: {
  status: ApplicationStatus;
  provider?: string;
  workModel?: WorkModel;
  verdict?: "eligible" | "eligible-with-sponsorship" | "likely-ineligible" | "unclear";
}): JobWithMatch {
  const id = `greenhouse:acme:${seq++}`;
  const application: Application = {
    id: seq,
    jobId: id,
    status: opts.status,
    notes: "",
    updatedAt: "2026-01-01T00:00:00.000Z",
    reminderAt: null,
  };
  return {
    job: {
      id,
      provider: opts.provider ?? "greenhouse",
      board: "acme",
      company: "Acme",
      title: "Engineer",
      location: "Remote",
      workModel: opts.workModel ?? "remote",
      url: "https://x",
      postedAt: null,
      description: "",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    },
    match: null,
    application,
    eligibility: opts.verdict
      ? { verdict: opts.verdict, scope: "worldwide", reason: "", evidence: [] }
      : null,
    pay: null,
  };
}

// An untracked job (no application) must be ignored by analytics.
function untracked(): JobWithMatch {
  const id = `greenhouse:acme:${seq++}`;
  return {
    job: {
      id,
      provider: "greenhouse",
      board: "acme",
      company: "Acme",
      title: "Engineer",
      location: "Remote",
      workModel: "remote",
      url: "https://x",
      postedAt: null,
      description: "",
      fetchedAt: "2026-01-01T00:00:00.000Z",
    },
    match: null,
    application: null,
    eligibility: null,
    pay: null,
  };
}

describe("computePipelineAnalytics", () => {
  it("reports empty when nothing is tracked", () => {
    const a = computePipelineAnalytics([untracked(), untracked()]);
    expect(a.empty).toBe(true);
    expect(a.totalTracked).toBe(0);
  });

  it("counts statuses and ignores untracked jobs", () => {
    const a = computePipelineAnalytics([
      tracked({ status: "Applied" }),
      tracked({ status: "Applied" }),
      tracked({ status: "Interviewing" }),
      untracked(),
    ]);
    expect(a.totalTracked).toBe(3);
    const applied = a.statusCounts.find((s) => s.status === "Applied")!;
    expect(applied.count).toBe(2);
  });

  it("treats a later stage as having reached earlier stages", () => {
    // One Offer implies it reached Applied and Interviewing too.
    const a = computePipelineAnalytics([
      tracked({ status: "Applied" }),
      tracked({ status: "Interviewing" }),
      tracked({ status: "Offer" }),
    ]);
    const [applied, interviewing, offer] = a.funnel;
    expect(applied.reached).toBe(3); // all three reached "Applied"
    expect(interviewing.reached).toBe(2); // Interviewing + Offer
    expect(offer.reached).toBe(1);
    // Conversion Applied->Interviewing = 2/3.
    expect(interviewing.conversionFromPrev).toBeCloseTo(2 / 3);
    // Interviewing->Offer = 1/2.
    expect(offer.conversionFromPrev).toBeCloseTo(1 / 2);
    expect(applied.conversionFromPrev).toBeNull();
  });

  it("does not assume a rejected app reached interviewing", () => {
    // A Rejected app only safely counts as "Applied".
    const a = computePipelineAnalytics([
      tracked({ status: "Rejected" }),
      tracked({ status: "Interviewing" }),
    ]);
    const interviewing = a.funnel.find((f) => f.stage === "Interviewing")!;
    expect(interviewing.reached).toBe(1); // only the Interviewing one
    expect(a.rejectionRate).toBeCloseTo(1 / 2);
    expect(a.interviewRate).toBeCloseTo(1 / 2);
  });

  it("breaks down by eligibility, work model, and source", () => {
    const a = computePipelineAnalytics([
      tracked({ status: "Interviewing", verdict: "eligible-with-sponsorship", workModel: "remote", provider: "remoteok" }),
      tracked({ status: "Applied", verdict: "eligible-with-sponsorship", workModel: "remote", provider: "remoteok" }),
      tracked({ status: "Applied", verdict: "eligible", workModel: "onsite", provider: "greenhouse" }),
    ]);
    const sponsorship = a.byEligibility.find(
      (b) => b.label === "eligible-with-sponsorship",
    )!;
    expect(sponsorship.total).toBe(2);
    expect(sponsorship.interviewing).toBe(1);
    expect(sponsorship.interviewRate).toBeCloseTo(1 / 2);

    expect(a.byWorkModel.find((b) => b.label === "remote")!.total).toBe(2);
    expect(a.bySource.find((b) => b.label === "remoteok")!.total).toBe(2);
    // Sorted by total desc: remote (2) before onsite (1).
    expect(a.byWorkModel[0].label).toBe("remote");
  });

  it("is deterministic", () => {
    const jobs = [
      tracked({ status: "Applied" }),
      tracked({ status: "Offer" }),
    ];
    expect(computePipelineAnalytics(jobs)).toEqual(
      computePipelineAnalytics(jobs),
    );
  });
});

describe("formatRate", () => {
  it("renders a 0..1 rate as a rounded percentage", () => {
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(0.6667)).toBe("67%");
    expect(formatRate(1)).toBe("100%");
  });
});

describe("computeStageTimeline", () => {
  const now = "2026-01-20T00:00:00.000Z";

  it("builds spans with durations and marks the current stage open", () => {
    const history = [
      { jobId: "j1", status: "Applied" as const, changedAt: "2026-01-01T00:00:00.000Z" },
      { jobId: "j1", status: "Interviewing" as const, changedAt: "2026-01-06T00:00:00.000Z" },
      { jobId: "j1", status: "Offer" as const, changedAt: "2026-01-16T00:00:00.000Z" },
    ];
    const [t] = computeStageTimeline(history, now);
    expect(t.jobId).toBe("j1");
    expect(t.spans).toHaveLength(3);
    // Applied: Jan 1 -> Jan 6 = 5 days, completed.
    expect(t.spans[0]).toMatchObject({ status: "Applied", days: 5, current: false });
    // Interviewing: Jan 6 -> Jan 16 = 10 days.
    expect(t.spans[1]).toMatchObject({ status: "Interviewing", days: 10 });
    // Offer: Jan 16 -> now (Jan 20) = 4 days, still current.
    expect(t.spans[2]).toMatchObject({ status: "Offer", days: 4, current: true });
    expect(t.totalDays).toBe(19); // Jan 1 -> Jan 20
  });

  it("separates multiple jobs", () => {
    const history = [
      { jobId: "a", status: "Applied" as const, changedAt: "2026-01-01T00:00:00.000Z" },
      { jobId: "b", status: "Applied" as const, changedAt: "2026-01-02T00:00:00.000Z" },
    ];
    const timelines = computeStageTimeline(history, now);
    expect(timelines).toHaveLength(2);
    expect(timelines.map((t) => t.jobId).sort()).toEqual(["a", "b"]);
  });

  it("sorts transitions chronologically even if given out of order", () => {
    const history = [
      { jobId: "j", status: "Interviewing" as const, changedAt: "2026-01-06T00:00:00.000Z" },
      { jobId: "j", status: "Applied" as const, changedAt: "2026-01-01T00:00:00.000Z" },
    ];
    const [t] = computeStageTimeline(history, now);
    expect(t.spans[0].status).toBe("Applied");
    expect(t.spans[1].status).toBe("Interviewing");
  });
});

describe("computeStageDurations", () => {
  const now = "2026-02-01T00:00:00.000Z";

  it("averages only COMPLETED spans across jobs", () => {
    const history = [
      // Job a: Applied 4 days (completed), then Interviewing (current).
      { jobId: "a", status: "Applied" as const, changedAt: "2026-01-01T00:00:00.000Z" },
      { jobId: "a", status: "Interviewing" as const, changedAt: "2026-01-05T00:00:00.000Z" },
      // Job b: Applied 6 days (completed), then Offer (current).
      { jobId: "b", status: "Applied" as const, changedAt: "2026-01-01T00:00:00.000Z" },
      { jobId: "b", status: "Offer" as const, changedAt: "2026-01-07T00:00:00.000Z" },
    ];
    const stats = computeStageDurations(history);
    const applied = stats.find((s) => s.status === "Applied")!;
    // (4 + 6) / 2 = 5 days, from 2 completed samples.
    expect(applied.avgDays).toBe(5);
    expect(applied.samples).toBe(2);
    // Interviewing and Offer are current (open) for their jobs → not averaged.
    expect(stats.find((s) => s.status === "Interviewing")).toBeUndefined();
    expect(stats.find((s) => s.status === "Offer")).toBeUndefined();
    // Suppress unused var lint on `now` by referencing it.
    expect(now).toBeDefined();
  });

  it("returns empty when there's no history", () => {
    expect(computeStageDurations([])).toEqual([]);
  });
});

describe("formatDays", () => {
  it("formats day counts readably", () => {
    expect(formatDays(0.4)).toBe("<1 day");
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(3.6)).toBe("4 days");
  });
});
