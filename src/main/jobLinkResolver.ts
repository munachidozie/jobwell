import type { Job } from "@shared/types";
import {
  extractJobFromHtml,
  isBlockedHost,
  matchKnownBoard,
  toJob,
  type ExtractedJob,
} from "@shared/jobLink";
import { USER_AGENT, fetchBoard, inferWorkModel, mayFetch } from "./scrapers";

// Result of resolving a pasted link. `job` is a ready-to-save Job when we could
// build one; `draft` carries partial fields for the UI to confirm/complete when
// extraction was incomplete or the site can't be read. `suggestion` tells the
// UI whether the link's host could become a recurring custom source.
export interface ResolveResult {
  ok: boolean;
  // A complete Job (known board, or clean JSON-LD). Null when we only have a draft.
  job: Job | null;
  // Partial fields for the confirm/manual-entry form.
  draft: ExtractedJob | null;
  // Human note explaining how we read it (or why we couldn't).
  message: string;
  // When set, the UI may offer "also track this site as a recurring source".
  // Only meaningful for non-blocked, non-known-board hosts.
  recurringSuggestion: { host: string; url: string } | null;
}

export async function resolveJobLink(rawUrl: string): Promise<ResolveResult> {
  const url = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      ok: false,
      job: null,
      draft: null,
      message: "That doesn't look like a valid URL.",
      recurringSuggestion: null,
    };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      ok: false,
      job: null,
      draft: null,
      message: "Only http(s) links are supported.",
      recurringSuggestion: null,
    };
  }
  const host = parsed.hostname.replace(/^www\./, "");

  // 1) Known board → reuse the existing scraper for a full, clean result.
  const known = matchKnownBoard(url);
  if (known) {
    try {
      const jobs = await fetchBoard({ provider: known.provider, board: known.board });
      // If the URL named a specific posting, pick it; else let the user know we
      // pulled the whole board (they can find the role in the feed).
      let picked: Job | undefined;
      if (known.jobId) {
        picked = jobs.find(
          (j) => j.id.endsWith(`:${known.jobId}`) || j.url.includes(known.jobId!),
        );
      }
      if (picked) {
        return {
          ok: true,
          job: picked,
          draft: null,
          message: `Read from ${known.provider} (${known.board}).`,
          recurringSuggestion: null, // it's a known board; add via Sources if wanted
        };
      }
      // Couldn't match the exact posting, but we know the board — offer the
      // first result as a draft and suggest adding the board as a source.
      return {
        ok: true,
        job: null,
        draft: jobs[0]
          ? {
              title: jobs[0].title,
              company: jobs[0].company,
              location: jobs[0].location,
              description: jobs[0].description,
              url,
              via: "json-ld",
            }
          : { title: "", company: "", location: "", description: "", url, via: "empty" },
        message: `Recognized a ${known.provider} board (${known.board}) but couldn't pinpoint this exact posting. Confirm the details below.`,
        recurringSuggestion: null,
      };
    } catch (err) {
      return {
        ok: false,
        job: null,
        draft: { title: "", company: "", location: "", description: "", url, via: "empty" },
        message: `Couldn't reach the ${known.provider} board: ${String(err)}. You can enter the details manually.`,
        recurringSuggestion: null,
      };
    }
  }

  // 2) Known-blocked host → don't scrape; route to manual entry honestly.
  if (isBlockedHost(url)) {
    return {
      ok: false,
      job: null,
      draft: { title: "", company: "", location: "", description: "", url, via: "empty" },
      message: `${host} blocks automated reading, so JobWell can't fetch it. Paste the job's details below to add it manually.`,
      recurringSuggestion: null,
    };
  }

  // 3) Generic page → honor robots/never-contact, fetch, extract.
  const origin = `${parsed.protocol}//${parsed.host}`;
  const guard = await mayFetch(origin, parsed.pathname || "/");
  if (!guard.ok) {
    return {
      ok: false,
      job: null,
      draft: { title: "", company: "", location: "", description: "", url, via: "empty" },
      message: `Can't fetch this page (${guard.reason}). Enter the details manually below.`,
      recurringSuggestion: null,
    };
  }

  let html: string;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && !ct.includes("text")) {
      throw new Error("not an HTML page");
    }
    html = await res.text();
  } catch (err) {
    return {
      ok: false,
      job: null,
      draft: { title: "", company: "", location: "", description: "", url, via: "empty" },
      message: `Couldn't read that page (${String(err)}). Enter the details manually below.`,
      recurringSuggestion: null,
    };
  }

  const extracted = extractJobFromHtml(html, url);
  const recurring = { host, url: origin };

  if (extracted.via === "json-ld" && extracted.title) {
    // Clean structured result → build the job, still let the user confirm.
    return {
      ok: true,
      job: toJob(extracted, inferWorkModel),
      draft: extracted,
      message: `Read structured job data from ${host}. Confirm or edit below.`,
      recurringSuggestion: recurring,
    };
  }
  if (extracted.via === "heuristic" && (extracted.title || extracted.description)) {
    return {
      ok: true,
      job: null,
      draft: extracted,
      message: `Couldn't find structured job data on ${host}; pulled a rough draft. Please check and complete the details below.`,
      recurringSuggestion: recurring,
    };
  }
  return {
    ok: false,
    job: null,
    draft: { ...extracted, url },
    message: `Couldn't extract job details from ${host}. Enter them manually below.`,
    recurringSuggestion: recurring,
  };
}
