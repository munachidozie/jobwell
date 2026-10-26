import type { BoardRef, Job, WorkModel } from "@shared/types";
import { parseWorkModel } from "@shared/parsers";
import {
  isNeverContactHost,
  isPathAllowed,
  parseRobots,
} from "@shared/crawlPolicy";
import { fetchGreenhouse } from "./greenhouse";
import { fetchLever } from "./lever";
import { fetchAshby } from "./ashby";
import { fetchWorkable } from "./workable";
import { fetchRecruitee } from "./recruitee";
import { fetchRemoteOk } from "./remoteok";
import { fetchRemotive } from "./remotive";

export const USER_AGENT = "jobwell/0.1.0";

// The base host each provider contacts, for never-contact and robots checks.
const PROVIDER_HOST: Record<string, string> = {
  greenhouse: "https://boards-api.greenhouse.io",
  lever: "https://api.lever.co",
  ashby: "https://api.ashbyhq.com",
  workable: "https://apply.workable.com",
  recruitee: "https://recruitee.com",
  remoteok: "https://remoteok.com",
  remotive: "https://remotive.com",
};

// Fetch and cache robots.txt per host for the duration of a refresh.
const robotsCache = new Map<string, Awaited<ReturnType<typeof loadRobots>>>();

async function loadRobots(origin: string) {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      // Unreadable robots: be conservative but not self-blocking for a 404
      // (no robots = allow); a 5xx means disallow for safety this run.
      return res.status >= 500
        ? parseRobots("User-agent: *\nDisallow: /")
        : parseRobots("");
    }
    return parseRobots(await res.text());
  } catch {
    return parseRobots(""); // network error fetching robots: allow, fetch may still fail
  }
}

// Guard a fetch: refuse never-contact hosts, and honor robots.txt for the path.
export async function mayFetch(
  origin: string,
  path: string,
): Promise<{ ok: boolean; reason?: string }> {
  if (isNeverContactHost(origin)) {
    return { ok: false, reason: `${origin} is on the never-contact list.` };
  }
  let policy = robotsCache.get(origin);
  if (!policy) {
    policy = await loadRobots(origin);
    robotsCache.set(origin, policy);
  }
  if (!isPathAllowed(policy, path)) {
    return { ok: false, reason: `robots.txt disallows ${path} on ${origin}.` };
  }
  return { ok: true };
}

// Normalize free-text (location and/or title) into a coarse work model, using
// the shared parser so classification is consistent across the app. Falls back
// to "onsite" when text is present but gives no remote/hybrid signal.
export function inferWorkModel(text: string): WorkModel {
  const parsed = parseWorkModel(text);
  if (parsed !== "unknown") return parsed;
  return text.trim().length > 0 ? "onsite" : "unknown";
}

// One request per second per host, honoring a simple delay between calls.
export async function politeDelay(ms = 1000): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchBoard(ref: BoardRef): Promise<Job[]> {
  const origin = PROVIDER_HOST[ref.provider];
  if (origin) {
    // We check the robots root path as a proxy for the provider's API surface.
    const guard = await mayFetch(origin, "/");
    if (!guard.ok) {
      console.warn(`Skipping ${ref.provider}:${ref.board} — ${guard.reason}`);
      return [];
    }
  }
  switch (ref.provider) {
    case "greenhouse":
      return fetchGreenhouse(ref.board);
    case "lever":
      return fetchLever(ref.board);
    case "ashby":
      return fetchAshby(ref.board);
    case "workable":
      return fetchWorkable(ref.board);
    case "recruitee":
      return fetchRecruitee(ref.board);
    case "remoteok":
      return fetchRemoteOk();
    case "remotive":
      return fetchRemotive();
    default:
      return [];
  }
}

// Fetch multiple boards sequentially with a polite delay between each.
export async function fetchBoards(refs: BoardRef[]): Promise<Job[]> {
  const all: Job[] = [];
  for (let i = 0; i < refs.length; i++) {
    try {
      const jobs = await fetchBoard(refs[i]);
      all.push(...jobs);
    } catch (err) {
      // A single failing board should not abort the whole refresh.
      console.error(`Board fetch failed for ${refs[i].provider}:${refs[i].board}`, err);
    }
    if (i < refs.length - 1) await politeDelay();
  }
  return all;
}
