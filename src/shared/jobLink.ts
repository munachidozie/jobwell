// "Add a job by link": turn a pasted URL into a Job, for roles the user found
// OUTSIDE the app. Pure, testable logic lives here:
//   - recognizing known-board URLs (so we can use the existing scraper), and
//   - extracting a JobPosting from a page's HTML (JSON-LD first, then a
//     best-effort fallback).
// The actual network fetch is done by the main process (jobLinkResolver.ts),
// which hands raw HTML back here for parsing.

import type { Job, WorkModel } from "./types";

// What a known-board URL resolves to: the provider + board slug (+ optional job
// id) so the caller can reuse that provider's scraper for a perfect result.
export interface KnownBoardRef {
  provider: "greenhouse" | "lever" | "ashby" | "workable" | "recruitee";
  board: string;
  jobId?: string; // the specific posting id when the URL contains one
}

// A job parsed from a page's HTML when it isn't a known board. Fields may be
// partial — the UI lets the user complete/confirm before saving.
export interface ExtractedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  url: string;
  // How we got it, for an honest UI note ("read from the page" vs "needs your
  // input").
  via: "json-ld" | "heuristic" | "empty";
}

// Recognize a URL belonging to a board JobWell already understands, so we can
// fetch a clean, full result via that provider's API instead of scraping HTML.
// Returns null when the URL isn't a recognized board.
export function matchKnownBoard(rawUrl: string): KnownBoardRef | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);

  // Greenhouse: boards.greenhouse.io/{board}/jobs/{id}
  //        or   job-boards.greenhouse.io/{board}/jobs/{id}
  if (host.endsWith("greenhouse.io")) {
    const board = parts[0];
    const jobsIdx = parts.indexOf("jobs");
    const jobId = jobsIdx >= 0 ? parts[jobsIdx + 1] : undefined;
    if (board && board !== "jobs") {
      return { provider: "greenhouse", board, jobId };
    }
  }

  // Lever: jobs.lever.co/{board}/{id}
  if (host === "jobs.lever.co" || host.endsWith(".lever.co")) {
    const board = parts[0];
    const jobId = parts[1];
    if (board) return { provider: "lever", board, jobId };
  }

  // Ashby: jobs.ashbyhq.com/{board}/{id}
  if (host === "jobs.ashbyhq.com" || host.endsWith("ashbyhq.com")) {
    const board = parts[0];
    const jobId = parts[1];
    if (board) return { provider: "ashby", board, jobId };
  }

  // Workable: apply.workable.com/{board}/j/{id} or {board}.workable.com
  if (host === "apply.workable.com") {
    const board = parts[0];
    const jIdx = parts.indexOf("j");
    const jobId = jIdx >= 0 ? parts[jIdx + 1] : undefined;
    if (board) return { provider: "workable", board, jobId };
  }
  if (host.endsWith(".workable.com") && host !== "apply.workable.com") {
    const board = host.replace(".workable.com", "");
    if (board) return { provider: "workable", board };
  }

  // Recruitee: {board}.recruitee.com/o/{slug}
  if (host.endsWith(".recruitee.com")) {
    const board = host.replace(".recruitee.com", "");
    if (board) return { provider: "recruitee", board };
  }

  return null;
}

// Hosts that block automated reading and/or forbid it in their terms. We don't
// attempt to scrape these; the UI routes the user to manual entry instead.
const BLOCKED_HOSTS = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
];

export function isBlockedHost(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`));
  } catch {
    return false;
  }
}

// ---- HTML extraction -----------------------------------------------------

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

// Pull a plain-text value from a JSON-LD field that may be a string, an object
// with a name/address, or nested. Best-effort and defensive.
function textOf(v: unknown): string {
  if (typeof v === "string") return stripTags(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.name === "string") return o.name;
    // Postal address shapes (hiringOrganization / jobLocation.address).
    if (o.address) return textOf(o.address);
    const bits = [o.addressLocality, o.addressRegion, o.addressCountry]
      .filter((x) => typeof x === "string")
      .join(", ");
    if (bits) return bits;
  }
  return "";
}

// Find and parse JobPosting JSON-LD blocks in a page. Google requires this
// schema for jobs to appear in search, so reputable postings carry it. Returns
// the first JobPosting found, or null.
export function extractJsonLdJob(html: string): ExtractedJob | null {
  // Grab every <script type="application/ld+json">…</script> block.
  const re =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const candidates: Record<string, unknown>[] = [];
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      const parsed = JSON.parse(raw);
      // JSON-LD can be a single object, an array, or a @graph container.
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>)["@graph"])
          ? ((parsed as Record<string, unknown>)["@graph"] as unknown[])
          : [parsed];
      for (const it of items) {
        if (it && typeof it === "object") candidates.push(it as Record<string, unknown>);
      }
    } catch {
      // Skip malformed blocks; a page may have several.
    }
  }

  const posting = candidates.find((c) => {
    const t = c["@type"];
    return t === "JobPosting" || (Array.isArray(t) && t.includes("JobPosting"));
  });
  if (!posting) return null;

  const title = textOf(posting.title);
  const company = textOf(posting.hiringOrganization);
  const location = textOf(posting.jobLocation);
  const description = posting.description
    ? stripTags(String(posting.description))
    : "";
  // Remote flag some postings set.
  const remoteFlag =
    posting.jobLocationType === "TELECOMMUTE" ||
    /remote/i.test(String(posting.employmentType ?? ""));

  if (!title && !description) return null; // nothing usable
  return {
    title,
    company,
    location: remoteFlag && !location ? "Remote" : location,
    description,
    url: "",
    via: "json-ld",
  };
}

// Fallback when there's no JSON-LD: scrape the obvious bits. Title from <title>
// or the first <h1>; description from the meta description. Deliberately
// conservative — the UI treats this as a draft for the user to confirm/edit.
export function extractHeuristicJob(html: string): ExtractedJob {
  const titleTag = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html)?.[1];
  const metaDesc =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(
      html,
    )?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i.exec(
      html,
    )?.[1];

  const title = stripTags(h1 ?? titleTag ?? "");
  const description = metaDesc ? decodeEntities(metaDesc).trim() : "";
  return {
    title,
    company: "",
    location: "",
    description,
    url: "",
    via: title || description ? "heuristic" : "empty",
  };
}

// Combine: prefer JSON-LD, fall back to heuristics. Always returns something
// (possibly `via:"empty"`), so the UI can decide whether to prefill or ask.
export function extractJobFromHtml(html: string, url: string): ExtractedJob {
  const jsonLd = extractJsonLdJob(html);
  const base = jsonLd ?? extractHeuristicJob(html);
  return { ...base, url };
}

// ---- Job assembly --------------------------------------------------------

// Short, stable, URL-derived id for a manually-added job, so re-adding the same
// link dedupes instead of duplicating. Deterministic (no hashing dependency).
export function manualJobId(url: string): string {
  const normalized = url.trim().toLowerCase().replace(/[#?].*$/, "").replace(/\/+$/, "");
  let h = 5381;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) + h + normalized.charCodeAt(i)) >>> 0; // djb2
  }
  return `manual:link:${h.toString(16)}`;
}

// Turn a confirmed ExtractedJob (after any user edits) into a full Job record.
// `inferWorkModel` is injected so this stays pure and reuses the app's shared
// classifier without importing main-process code.
export function toJob(
  e: ExtractedJob,
  inferWorkModel: (text: string) => WorkModel,
): Job {
  const now = new Date().toISOString();
  const host = safeHost(e.url);
  return {
    id: manualJobId(e.url),
    provider: "manual",
    board: host,
    company: e.company || host || "Unknown",
    title: e.title || "(untitled role)",
    location: e.location,
    workModel: inferWorkModel(`${e.location} ${e.title}`),
    url: e.url,
    postedAt: null,
    description: e.description,
    fetchedAt: now,
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
