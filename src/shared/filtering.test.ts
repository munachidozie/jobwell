import { describe, expect, it } from "vitest";
import {
  applyFilter,
  isEmptyFilter,
  parseQueryTerms,
  sortByEligibilityThenMatch,
} from "./filtering";
import type { EligibilityInfo, JobWithMatch } from "./types";

function item(overrides: Partial<JobWithMatch["job"]>, percent = 50): JobWithMatch {
  return {
    job: {
      id: `${overrides.provider ?? "greenhouse"}:acme:${overrides.title ?? "x"}`,
      provider: overrides.provider ?? "greenhouse",
      board: "acme",
      company: overrides.company ?? "Acme",
      title: overrides.title ?? "Engineer",
      location: overrides.location ?? "Remote",
      workModel: overrides.workModel ?? "remote",
      url: "https://example.com",
      postedAt: overrides.postedAt ?? null,
      description: overrides.description ?? "",
      fetchedAt: new Date().toISOString(),
    },
    match: {
      jobId: "x",
      percent,
      band: "Fair",
      reasons: [],
    },
    application: null,
    eligibility: null,
    pay: null,
  };
}

const items: JobWithMatch[] = [
  item({ title: "Senior React Engineer", workModel: "remote", provider: "lever" }, 85),
  item({ title: "Data Analyst", workModel: "onsite", location: "Seattle" }, 40),
  item({ title: "Backend Engineer", workModel: "hybrid", provider: "ashby" }, 65),
];

describe("isEmptyFilter", () => {
  it("is true for {} and false when any criterion set", () => {
    expect(isEmptyFilter({})).toBe(true);
    expect(isEmptyFilter({ text: "react" })).toBe(false);
    expect(isEmptyFilter({ minMatchPercent: 50 })).toBe(false);
  });
});

describe("applyFilter", () => {
  it("empty filter returns everything", () => {
    expect(applyFilter(items, {})).toHaveLength(3);
  });

  it("text matches title", () => {
    const r = applyFilter(items, { text: "react" });
    expect(r).toHaveLength(1);
    expect(r[0].job.title).toContain("React");
  });

  it("work model any-of", () => {
    const r = applyFilter(items, { workModels: ["remote", "hybrid"] });
    expect(r).toHaveLength(2);
  });

  it("provider any-of", () => {
    const r = applyFilter(items, { providers: ["ashby"] });
    expect(r).toHaveLength(1);
    expect(r[0].job.provider).toBe("ashby");
  });

  it("min match percent", () => {
    const r = applyFilter(items, { minMatchPercent: 60 });
    expect(r.map((x) => x.match?.percent).sort()).toEqual([65, 85]);
  });

  it("location substring", () => {
    const r = applyFilter(items, { location: "seattle" });
    expect(r).toHaveLength(1);
  });

  it("combines criteria with AND", () => {
    const r = applyFilter(items, {
      workModels: ["remote"],
      minMatchPercent: 80,
    });
    expect(r).toHaveLength(1);
    expect(r[0].job.title).toContain("React");
  });
});

function withElig(
  it: JobWithMatch,
  verdict: EligibilityInfo["verdict"],
): JobWithMatch {
  return {
    ...it,
    eligibility: { verdict, scope: "worldwide", reason: "", evidence: [] },
  };
}

describe("eligibility filter + sort", () => {
  const eligible = withElig(item({ title: "A" }, 50), "eligible");
  const sponsor = withElig(item({ title: "B" }, 90), "eligible-with-sponsorship");
  const ineligible = withElig(item({ title: "C" }, 99), "likely-ineligible");

  it("onlyEligible keeps eligible and sponsorship, drops ineligible", () => {
    const r = applyFilter([eligible, sponsor, ineligible], {
      onlyEligible: true,
    });
    const titles = r.map((x) => x.job.title).sort();
    expect(titles).toEqual(["A", "B"]);
  });

  it("sorts eligible first even when a higher-match role is ineligible", () => {
    const sorted = sortByEligibilityThenMatch([ineligible, eligible, sponsor]);
    // eligible (50%) first, then sponsorship (90%), then ineligible (99%)
    expect(sorted.map((x) => x.job.title)).toEqual(["A", "B", "C"]);
  });

  it("isEmptyFilter accounts for onlyEligible", () => {
    expect(isEmptyFilter({ onlyEligible: true })).toBe(false);
  });

  it("onlySponsorship keeps only sponsorship roles", () => {
    const r = applyFilter([eligible, sponsor, ineligible], {
      onlySponsorship: true,
    });
    expect(r.map((x) => x.job.title)).toEqual(["B"]); // only the sponsorship one
  });

  it("isEmptyFilter accounts for onlySponsorship", () => {
    expect(isEmptyFilter({ onlySponsorship: true })).toBe(false);
  });
});

describe("parseQueryTerms", () => {
  it("splits on whitespace into AND terms", () => {
    expect(parseQueryTerms("react typescript")).toEqual(["react", "typescript"]);
  });
  it("keeps quoted phrases together", () => {
    expect(parseQueryTerms('"machine learning" python')).toEqual([
      "machine learning",
      "python",
    ]);
  });
  it("preserves special characters", () => {
    expect(parseQueryTerms("c++ c# .net node.js")).toEqual([
      "c++",
      "c#",
      ".net",
      "node.js",
    ]);
  });
  it("returns empty for blank", () => {
    expect(parseQueryTerms("   ")).toEqual([]);
  });
});

describe("free-text search", () => {
  const react = item({ title: "React Engineer", description: "typescript and graphql" });
  const cpp = item({ title: "Systems Engineer", description: "Strong C++ and C# skills." });

  it("matches a single term", () => {
    expect(applyFilter([react, cpp], { text: "graphql" })).toHaveLength(1);
  });
  it("requires ALL terms (AND)", () => {
    expect(applyFilter([react, cpp], { text: "react typescript" })).toHaveLength(1);
    expect(applyFilter([react, cpp], { text: "react rust" })).toHaveLength(0);
  });
  it("matches special-character terms literally", () => {
    const r = applyFilter([react, cpp], { text: "c#" });
    expect(r).toHaveLength(1);
    expect(r[0].job.title).toContain("Systems");
  });
});

describe("minAnnualUsd pay filter", () => {
  function withPay(it: JobWithMatch, annualMinUsd: number | null): JobWithMatch {
    return {
      ...it,
      pay: annualMinUsd == null
        ? null
        : { text: "x", annualMinUsd, fxApproximate: false },
    };
  }
  const high = withPay(item({ title: "High" }), 150000);
  const low = withPay(item({ title: "Low" }), 40000);
  const noPay = withPay(item({ title: "NoPay" }), null);

  it("hides stated pay below the floor but keeps jobs with no stated pay", () => {
    const r = applyFilter([high, low, noPay], { minAnnualUsd: 100000 });
    const titles = r.map((x) => x.job.title).sort();
    // High stays (>=100k); Low is hidden (<100k); NoPay stays (unknown).
    expect(titles).toEqual(["High", "NoPay"]);
  });

  it("isEmptyFilter accounts for minAnnualUsd", () => {
    expect(isEmptyFilter({ minAnnualUsd: 50000 })).toBe(false);
  });
});
