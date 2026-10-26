// Crawl-safety policy: a robots.txt parser, a hard never-contact host list, and
// proof-of-coverage logic for deciding when a job may be marked closed. Pure
// and deterministic so it can be unit-tested without the network.

// ---- Never-contact hosts ----
// Sites we will never scrape, by policy. Scraping these violates their terms
// and/or is hostile; JobWell refuses regardless of any user-added source.
const NEVER_CONTACT = [
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
];

export function isNeverContactHost(urlOrHost: string): boolean {
  const host = extractHost(urlOrHost);
  if (!host) return false;
  return NEVER_CONTACT.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}

function extractHost(urlOrHost: string): string | null {
  try {
    if (/^https?:\/\//i.test(urlOrHost)) {
      return new URL(urlOrHost).hostname.toLowerCase();
    }
  } catch {
    return null;
  }
  // Treat a bare host string as-is.
  return urlOrHost.toLowerCase().replace(/\/.*$/, "") || null;
}

// ---- robots.txt ----
// A pragmatic subset of RFC 9309: groups by User-agent, Allow/Disallow with
// longest-match-wins (Allow breaks ties), `*` wildcard and `$` end-anchor, and
// Crawl-delay. We match our own UA token, falling back to `*`.

interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[]; // for the applicable group
  crawlDelaySec: number | null;
}

const OUR_UA_TOKEN = "jobwell";

export function parseRobots(text: string): RobotsPolicy {
  const lines = text.split(/\r?\n/);
  // Collect groups: a set of user-agents -> rules.
  type Group = { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === "allow" || field === "disallow") {
      if (!current) {
        current = { agents: ["*"], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.rules.push({ allow: field === "allow", pattern: value });
      lastWasAgent = false;
    } else if (field === "crawl-delay") {
      if (current) {
        const n = parseFloat(value);
        if (!Number.isNaN(n)) current.crawlDelay = n;
      }
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }

  // Choose the most specific matching group: our UA token first, else "*".
  const ourGroup = groups.find((g) => g.agents.includes(OUR_UA_TOKEN));
  const starGroup = groups.find((g) => g.agents.includes("*"));
  const chosen = ourGroup ?? starGroup ?? { rules: [], crawlDelay: null };
  return { rules: chosen.rules, crawlDelaySec: chosen.crawlDelay };
}

// Convert a robots path pattern (with * and $) to a RegExp.
function patternToRegex(pattern: string): RegExp {
  if (pattern === "") return /^$/; // empty Disallow allows everything (handled by caller)
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") re += ".*";
    else if (c === "$" && i === pattern.length - 1) re += "$";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re);
}

// Decide if a path is allowed under a policy. Longest matching pattern wins;
// Allow beats Disallow on an exact-length tie.
export function isPathAllowed(policy: RobotsPolicy, path: string): boolean {
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of policy.rules) {
    if (rule.pattern === "") {
      // Empty Disallow means "allow all"; empty Allow is a no-op.
      if (!rule.allow) {
        if (!best || 0 > best.len) best = { allow: true, len: 0 };
      }
      continue;
    }
    const re = patternToRegex(rule.pattern);
    if (re.test(path)) {
      const len = rule.pattern.replace(/[*$]/g, "").length;
      if (
        !best ||
        len > best.len ||
        (len === best.len && rule.allow && !best.allow)
      ) {
        best = { allow: rule.allow, len };
      }
    }
  }
  // Default allow when no rule matches.
  return best ? best.allow : true;
}

// ---- Proof-of-coverage job closing ----
// A job absent from the latest crawl of its board may only be closed if the
// crawl *proved* it saw the whole board: it completed without errors and read a
// meaningful number of postings. We also never close more than half a board's
// jobs in one sweep, guarding against a partial/broken crawl wiping the feed.

export interface CrawlOutcome {
  board: string;
  completed: boolean; // crawl finished without aborting
  errorCount: number;
  postingsSeen: number;
  // ids seen this crawl, to compute absence
  seenJobIds: Set<string>;
}

export interface CloseDecision {
  toClose: string[];
  skipped: string[];
  reason: string;
}

export const MAX_CLOSE_SHARE = 0.5;
const MIN_POSTINGS_TO_TRUST = 1;

// Given the jobs currently stored for a board and a crawl outcome, decide which
// absent jobs are safe to close.
export function decideClosures(
  storedJobIdsForBoard: string[],
  outcome: CrawlOutcome,
): CloseDecision {
  if (!outcome.completed || outcome.errorCount > 0) {
    return {
      toClose: [],
      skipped: storedJobIdsForBoard,
      reason: "Crawl did not prove full coverage (incomplete or had errors); nothing closed.",
    };
  }
  if (outcome.postingsSeen < MIN_POSTINGS_TO_TRUST) {
    return {
      toClose: [],
      skipped: storedJobIdsForBoard,
      reason: "Crawl saw too few postings to trust absence; nothing closed.",
    };
  }
  const absent = storedJobIdsForBoard.filter(
    (id) => !outcome.seenJobIds.has(id),
  );
  const cap = Math.floor(storedJobIdsForBoard.length * MAX_CLOSE_SHARE);
  if (absent.length > cap) {
    return {
      toClose: [],
      skipped: storedJobIdsForBoard,
      reason: `Absent count (${absent.length}) exceeds the ${Math.round(
        MAX_CLOSE_SHARE * 100,
      )}% safety cap; refusing to close (likely a partial crawl).`,
    };
  }
  return {
    toClose: absent,
    skipped: [],
    reason: `Closed ${absent.length} job(s) absent from a fully-covered crawl.`,
  };
}
