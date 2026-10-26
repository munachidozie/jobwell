import { describe, expect, it } from "vitest";
import {
  extractKeywords,
  keywordGap,
  readability,
  tailorTruthfully,
} from "./resume";
import type { Job } from "./types";

const job: Job = {
  id: "greenhouse:acme:1",
  provider: "greenhouse",
  board: "acme",
  company: "Acme",
  title: "Senior React Engineer",
  location: "Remote",
  workModel: "remote",
  url: "https://example.com",
  postedAt: null,
  description:
    "We need strong TypeScript and React skills. Experience with GraphQL and PostgreSQL is a plus.",
  fetchedAt: new Date().toISOString(),
};

describe("readability", () => {
  it("returns a grade and counts for normal prose", () => {
    const r = readability(
      "I build web apps. I use React and TypeScript daily. My work is clear.",
    );
    expect(r.words).toBeGreaterThan(0);
    expect(r.sentences).toBeGreaterThanOrEqual(3);
    expect(typeof r.grade).toBe("number");
    expect(r.note.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const text = "Short clear sentences. Easy to read. Nothing fancy here.";
    expect(readability(text)).toEqual(readability(text));
  });
});

describe("extractKeywords", () => {
  it("drops stopwords and short tokens", () => {
    const kws = extractKeywords("the react and the typescript app");
    expect(kws).toContain("react");
    expect(kws).toContain("typescript");
    expect(kws).not.toContain("the");
    expect(kws).not.toContain("and");
  });
});

describe("keywordGap", () => {
  it("splits present vs missing against a resume", () => {
    const resume = "Experienced engineer skilled in typescript and react.";
    const gap = keywordGap(resume, job);
    expect(gap.present).toContain("typescript");
    expect(gap.present).toContain("react");
    expect(gap.missing).toContain("graphql");
    expect(gap.coverage).toBeGreaterThan(0);
    expect(gap.coverage).toBeLessThanOrEqual(1);
  });
});

describe("tailorTruthfully", () => {
  it("only returns verbatim resume lines — never invents", () => {
    const resume = [
      "Built React dashboards with TypeScript.",
      "Managed a small team.",
      "Hobbies: cycling and chess.",
    ].join("\n");
    const result = tailorTruthfully(resume, job);
    // Every prioritized line must exist verbatim in the original resume.
    for (const { line } of result.prioritizedLines) {
      expect(resume.includes(line)).toBe(true);
    }
    // The React/TS line should rank since it overlaps job keywords.
    expect(result.prioritizedLines[0].line).toContain("React");
    // Gaps are surfaced honestly, not inserted.
    expect(result.gapsToConsider).toContain("graphql");
    expect(result.disclaimer.toLowerCase()).toContain("invented");
  });

  it("returns no fabricated lines when nothing overlaps", () => {
    const resume = "Chess club president. Enjoys hiking.";
    const result = tailorTruthfully(resume, job);
    expect(result.prioritizedLines).toHaveLength(0);
  });
});
