import { describe, expect, it } from "vitest";
import {
  extractJobFromHtml,
  extractJsonLdJob,
  isBlockedHost,
  manualJobId,
  matchKnownBoard,
  toJob,
} from "./jobLink";
import type { WorkModel } from "./types";

const infer = (t: string): WorkModel =>
  /remote/i.test(t) ? "remote" : "onsite";

describe("matchKnownBoard", () => {
  it("recognizes a Greenhouse posting URL with job id", () => {
    const r = matchKnownBoard("https://boards.greenhouse.io/stripe/jobs/12345");
    expect(r).toEqual({ provider: "greenhouse", board: "stripe", jobId: "12345" });
  });

  it("recognizes a Lever posting URL", () => {
    const r = matchKnownBoard("https://jobs.lever.co/netflix/abc-def");
    expect(r?.provider).toBe("lever");
    expect(r?.board).toBe("netflix");
    expect(r?.jobId).toBe("abc-def");
  });

  it("recognizes an Ashby URL", () => {
    const r = matchKnownBoard("https://jobs.ashbyhq.com/ramp/role-123");
    expect(r?.provider).toBe("ashby");
    expect(r?.board).toBe("ramp");
  });

  it("recognizes a Recruitee subdomain", () => {
    const r = matchKnownBoard("https://acme.recruitee.com/o/backend-engineer");
    expect(r?.provider).toBe("recruitee");
    expect(r?.board).toBe("acme");
  });

  it("returns null for an unknown site", () => {
    expect(matchKnownBoard("https://careers.example.com/jobs/42")).toBeNull();
  });

  it("returns null for a non-URL", () => {
    expect(matchKnownBoard("not a url")).toBeNull();
  });
});

describe("isBlockedHost", () => {
  it("flags LinkedIn and Indeed", () => {
    expect(isBlockedHost("https://www.linkedin.com/jobs/view/123")).toBe(true);
    expect(isBlockedHost("https://indeed.com/viewjob?jk=abc")).toBe(true);
  });
  it("does not flag a normal company site", () => {
    expect(isBlockedHost("https://careers.acme.com/jobs/1")).toBe(false);
  });
});

describe("extractJsonLdJob", () => {
  it("parses a standard JobPosting block", () => {
    const html = `
      <html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org/",
        "@type": "JobPosting",
        "title": "Senior Backend Engineer",
        "description": "<p>Build <b>APIs</b> at scale.</p>",
        "hiringOrganization": { "@type": "Organization", "name": "Acme Corp" },
        "jobLocation": { "address": { "addressLocality": "Berlin", "addressCountry": "DE" } }
      }
      </script></head><body>…</body></html>`;
    const job = extractJsonLdJob(html)!;
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.company).toBe("Acme Corp");
    expect(job.description).toContain("Build APIs at scale.");
    expect(job.location).toContain("Berlin");
    expect(job.via).toBe("json-ld");
  });

  it("finds a JobPosting inside an @graph array", () => {
    const html = `
      <script type="application/ld+json">
      {"@graph":[
        {"@type":"WebSite","name":"x"},
        {"@type":"JobPosting","title":"Data Analyst","description":"SQL work","hiringOrganization":"Globex"}
      ]}
      </script>`;
    const job = extractJsonLdJob(html)!;
    expect(job.title).toBe("Data Analyst");
    expect(job.company).toBe("Globex");
  });

  it("marks remote postings", () => {
    const html = `
      <script type="application/ld+json">
      {"@type":"JobPosting","title":"Remote Dev","description":"d","jobLocationType":"TELECOMMUTE"}
      </script>`;
    expect(extractJsonLdJob(html)?.location).toBe("Remote");
  });

  it("returns null when there's no JobPosting", () => {
    const html = `<script type="application/ld+json">{"@type":"WebSite"}</script>`;
    expect(extractJsonLdJob(html)).toBeNull();
  });

  it("ignores malformed JSON-LD blocks", () => {
    const html = `<script type="application/ld+json">{ broken json </script>`;
    expect(extractJsonLdJob(html)).toBeNull();
  });
});

describe("extractJobFromHtml fallback", () => {
  it("falls back to <h1> and meta description when no JSON-LD", () => {
    const html = `
      <html><head>
        <title>Careers - Acme</title>
        <meta name="description" content="We are hiring a Platform Engineer.">
      </head><body><h1>Platform Engineer</h1></body></html>`;
    const e = extractJobFromHtml(html, "https://acme.com/jobs/1");
    expect(e.title).toBe("Platform Engineer");
    expect(e.description).toContain("Platform Engineer");
    expect(e.via).toBe("heuristic");
    expect(e.url).toBe("https://acme.com/jobs/1");
  });

  it("reports empty when nothing is extractable", () => {
    const e = extractJobFromHtml("<html><body></body></html>", "https://x.com");
    expect(e.via).toBe("empty");
  });
});

describe("manualJobId", () => {
  it("is stable and ignores query/hash/trailing slash", () => {
    const a = manualJobId("https://acme.com/jobs/1");
    const b = manualJobId("https://acme.com/jobs/1/");
    const c = manualJobId("https://acme.com/jobs/1?utm=x#top");
    expect(a).toBe(b);
    expect(a).toBe(c);
    expect(a.startsWith("manual:link:")).toBe(true);
  });

  it("differs for different URLs", () => {
    expect(manualJobId("https://a.com/1")).not.toBe(manualJobId("https://a.com/2"));
  });
});

describe("toJob", () => {
  it("builds a full Job, deriving provider/board and work model", () => {
    const job = toJob(
      {
        title: "Remote Engineer",
        company: "Acme",
        location: "Remote",
        description: "desc",
        url: "https://careers.acme.com/jobs/9",
        via: "json-ld",
      },
      infer,
    );
    expect(job.provider).toBe("manual");
    expect(job.board).toBe("careers.acme.com");
    expect(job.company).toBe("Acme");
    expect(job.workModel).toBe("remote");
    expect(job.id).toBe(manualJobId("https://careers.acme.com/jobs/9"));
  });

  it("falls back gracefully on sparse input", () => {
    const job = toJob(
      { title: "", company: "", location: "", description: "", url: "https://x.com", via: "empty" },
      infer,
    );
    expect(job.title).toBe("(untitled role)");
    expect(job.company).toBe("x.com");
  });
});
