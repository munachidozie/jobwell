import { describe, expect, it } from "vitest";
import {
  decideClosures,
  isNeverContactHost,
  isPathAllowed,
  parseRobots,
  type CrawlOutcome,
} from "./crawlPolicy";

describe("isNeverContactHost", () => {
  it("blocks LinkedIn/Indeed/Glassdoor and subdomains", () => {
    expect(isNeverContactHost("https://www.linkedin.com/jobs")).toBe(true);
    expect(isNeverContactHost("indeed.com")).toBe(true);
    expect(isNeverContactHost("https://uk.indeed.com")).toBe(true);
    expect(isNeverContactHost("https://glassdoor.com/x")).toBe(true);
  });

  it("allows legitimate ATS hosts", () => {
    expect(isNeverContactHost("https://boards.greenhouse.io/stripe")).toBe(false);
    expect(isNeverContactHost("https://jobs.lever.co/netflix")).toBe(false);
  });
});

describe("parseRobots + isPathAllowed", () => {
  it("applies the wildcard group", () => {
    const policy = parseRobots(`User-agent: *\nDisallow: /private\nAllow: /private/public`);
    expect(isPathAllowed(policy, "/private/secret")).toBe(false);
    expect(isPathAllowed(policy, "/private/public")).toBe(true); // longer Allow wins
    expect(isPathAllowed(policy, "/open")).toBe(true);
  });

  it("prefers a group naming our user-agent", () => {
    const policy = parseRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: jobwell\nAllow: /\n`,
    );
    expect(isPathAllowed(policy, "/anything")).toBe(true);
  });

  it("honors the $ end-anchor and * wildcard", () => {
    const policy = parseRobots(`User-agent: *\nDisallow: /*.pdf$`);
    expect(isPathAllowed(policy, "/files/a.pdf")).toBe(false);
    expect(isPathAllowed(policy, "/files/a.pdf?x=1")).toBe(true);
  });

  it("reads crawl-delay", () => {
    const policy = parseRobots(`User-agent: *\nCrawl-delay: 5`);
    expect(policy.crawlDelaySec).toBe(5);
  });

  it("empty disallow means allow all", () => {
    const policy = parseRobots(`User-agent: *\nDisallow:`);
    expect(isPathAllowed(policy, "/anything")).toBe(true);
  });
});

describe("decideClosures (proof-of-coverage)", () => {
  const stored = ["a", "b", "c", "d"];

  function outcome(over: Partial<CrawlOutcome>): CrawlOutcome {
    return {
      board: "acme",
      completed: true,
      errorCount: 0,
      postingsSeen: 10,
      seenJobIds: new Set(["a", "b", "c", "d"]),
      ...over,
    };
  }

  it("closes jobs absent from a fully-covered crawl", () => {
    const d = decideClosures(
      stored,
      outcome({ seenJobIds: new Set(["a", "b", "c"]) }), // d absent
    );
    expect(d.toClose).toEqual(["d"]);
  });

  it("closes nothing if the crawl had errors", () => {
    const d = decideClosures(
      stored,
      outcome({ errorCount: 2, seenJobIds: new Set(["a"]) }),
    );
    expect(d.toClose).toHaveLength(0);
    expect(d.skipped).toEqual(stored);
  });

  it("closes nothing if the crawl was incomplete", () => {
    const d = decideClosures(stored, outcome({ completed: false }));
    expect(d.toClose).toHaveLength(0);
  });

  it("refuses to close more than half a board in one sweep", () => {
    // 3 of 4 absent = 75% > 50% cap
    const d = decideClosures(
      stored,
      outcome({ seenJobIds: new Set(["a"]) }),
    );
    expect(d.toClose).toHaveLength(0);
    expect(d.reason).toMatch(/safety cap/);
  });

  it("closes nothing when the crawl saw no postings", () => {
    const d = decideClosures(
      stored,
      outcome({ postingsSeen: 0, seenJobIds: new Set() }),
    );
    expect(d.toClose).toHaveLength(0);
  });
});
