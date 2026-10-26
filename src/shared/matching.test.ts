import { describe, expect, it } from "vitest";
import { inferLevelFromTitle, scoreJob } from "./matching";
import type { Job, Profile } from "./types";

const profile: Profile = {
  id: 1,
  jobFunction: "Software Engineer",
  level: "senior",
  location: "Remote",
  skills: ["typescript", "react", "node", "sql"],
  industries: ["fintech"],
  yearsExperience: 6,
  baseCountry: "nigeria",
  workAuthorizations: [],
  supplementaryFacts: [],
};

function job(overrides: Partial<Job>): Job {
  return {
    id: "greenhouse:acme:1",
    provider: "greenhouse",
    board: "acme",
    company: "Acme",
    title: "Software Engineer",
    location: "Remote",
    workModel: "remote",
    url: "https://example.com/job",
    postedAt: null,
    description: "",
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("inferLevelFromTitle", () => {
  it("detects common level words", () => {
    expect(inferLevelFromTitle("Senior Backend Engineer")).toBe("senior");
    expect(inferLevelFromTitle("Staff Software Engineer")).toBe("staff");
    expect(inferLevelFromTitle("Software Engineering Intern")).toBe("intern");
    expect(inferLevelFromTitle("Junior Developer")).toBe("entry");
    expect(inferLevelFromTitle("Software Engineer")).toBe("unknown");
  });
});

describe("scoreJob", () => {
  it("is deterministic — same inputs give same score", () => {
    const j = job({
      title: "Senior Software Engineer",
      description: "We use TypeScript, React and Node in fintech payments.",
    });
    const a = scoreJob(profile, j);
    const b = scoreJob(profile, j);
    expect(a.percent).toBe(b.percent);
    expect(a).toEqual(b);
  });

  it("scores a strong match high", () => {
    const j = job({
      title: "Senior Software Engineer",
      company: "Acme Fintech",
      description: "TypeScript, React, Node, SQL. Fintech payments platform.",
    });
    const score = scoreJob(profile, j);
    expect(score.percent).toBeGreaterThanOrEqual(80);
    expect(score.band).toBe("Strong");
  });

  it("scores an unrelated job low", () => {
    const j = job({
      title: "Warehouse Associate",
      company: "Logistics Co",
      description: "Lifting boxes, forklift certification preferred.",
    });
    const score = scoreJob(profile, j);
    expect(score.percent).toBeLessThan(40);
    expect(score.band).toBe("Weak");
  });

  it("always explains every factor", () => {
    const score = scoreJob(profile, job({}));
    const factors = score.reasons.map((r) => r.factor).sort();
    expect(factors).toEqual(["industry", "level", "role", "skills"]);
    for (const r of score.reasons) {
      expect(r.detail.length).toBeGreaterThan(0);
      expect(r.points).toBeLessThanOrEqual(r.weight);
    }
  });

  it("percent equals the sum of reason points", () => {
    const score = scoreJob(
      profile,
      job({ title: "Senior Engineer", description: "react and sql" }),
    );
    const sum = score.reasons.reduce((s, r) => s + r.points, 0);
    expect(score.percent).toBe(sum);
  });

  it("job function drives the role factor (similar titles score, unrelated don't)", () => {
    const related = scoreJob(
      profile,
      job({ title: "Senior Backend Software Engineer", description: "" }),
    );
    const unrelated = scoreJob(
      profile,
      job({ title: "Accountant", description: "" }),
    );
    const roleRelated = related.reasons.find((r) => r.factor === "role")!;
    const roleUnrelated = unrelated.reasons.find((r) => r.factor === "role")!;
    expect(roleRelated.points).toBeGreaterThan(roleUnrelated.points);
    expect(roleRelated.points).toBeGreaterThan(0);
  });

  it("matches similar skills, not just exact words (react credits 'frontend')", () => {
    const frontendProfile: Profile = {
      ...profile,
      jobFunction: "Frontend Engineer",
      skills: ["react"],
    };
    const j = job({
      title: "Frontend Engineer",
      description: "We need a strong frontend developer to build our UI.",
    });
    const skills = scoreJob(frontendProfile, j).reasons.find(
      (r) => r.factor === "skills",
    )!;
    // "react" isn't literally in the text, but "frontend" is a related term.
    expect(skills.points).toBeGreaterThan(0);
  });
});
