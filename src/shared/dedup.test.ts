import { describe, expect, it } from "vitest";
import { dedupeJobs } from "./dedup";
import type { JobWithMatch } from "./types";

function item(
  provider: string,
  company: string,
  title: string,
  opts: { desc?: string; percent?: number } = {},
): JobWithMatch {
  return {
    job: {
      id: `${provider}:x:${title}`,
      provider,
      board: "feed",
      company,
      title,
      location: "Remote - Worldwide",
      workModel: "remote",
      url: "https://example.com",
      postedAt: null,
      description: opts.desc ?? "",
      fetchedAt: new Date().toISOString(),
    },
    match: { jobId: "x", percent: opts.percent ?? 50, band: "Fair", reasons: [] },
    application: null,
    eligibility: {
      verdict: "eligible",
      scope: "worldwide",
      reason: "",
      evidence: [],
    },
    pay: null,
  };
}

describe("dedupeJobs", () => {
  it("collapses the same role posted on two boards", () => {
    const jobs = [
      item("remotive", "Acme", "Senior Software Engineer", { desc: "short" }),
      item("greenhouse", "Acme Inc", "Software Engineer", {
        desc: "a much longer and more complete description of the role",
      }),
    ];
    const out = dedupeJobs(jobs);
    expect(out).toHaveLength(1);
    expect(out[0].duplicateCount).toBe(2);
    expect(out[0].sources.sort()).toEqual(["greenhouse", "remotive"]);
  });

  it("keeps the most complete description as representative", () => {
    const jobs = [
      item("remotive", "Acme", "Software Engineer", { desc: "short" }),
      item("greenhouse", "Acme", "Software Engineer", {
        desc: "a much longer description with lots of detail about the job",
      }),
    ];
    const out = dedupeJobs(jobs);
    expect(out[0].job.description).toContain("much longer");
  });

  it("does NOT merge different roles at the same company", () => {
    const jobs = [
      item("greenhouse", "Acme", "Software Engineer"),
      item("greenhouse", "Acme", "Product Manager"),
    ];
    expect(dedupeJobs(jobs)).toHaveLength(2);
  });

  it("does NOT merge the same title at different companies", () => {
    const jobs = [
      item("remotive", "Acme", "Software Engineer"),
      item("remotive", "Globex", "Software Engineer"),
    ];
    expect(dedupeJobs(jobs)).toHaveLength(2);
  });

  it("leaves a single posting untouched (count 1, one source)", () => {
    const out = dedupeJobs([item("remoteok", "Acme", "Designer")]);
    expect(out).toHaveLength(1);
    expect(out[0].duplicateCount).toBe(1);
    expect(out[0].sources).toEqual(["remoteok"]);
  });

  it("is deterministic", () => {
    const jobs = [
      item("remotive", "Acme", "Software Engineer", { desc: "aaa" }),
      item("greenhouse", "Acme", "Senior Software Engineer", { desc: "bbbb" }),
    ];
    expect(dedupeJobs(jobs)).toEqual(dedupeJobs(jobs));
  });
});
