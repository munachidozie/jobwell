import type { JobWithMatch } from "./types";

// Cross-board de-duplication. With aggregator feeds (RemoteOK, Remotive) running
// alongside company ATS boards, the SAME role often appears more than once — a
// company posts on its Greenhouse board AND it's syndicated to Remotive. This
// collapses those into one feed entry that credits every source it came from,
// so the feed isn't cluttered with repeats.
//
// Pure and deterministic: same input jobs always collapse the same way.

export interface DedupedJob extends JobWithMatch {
  // Every source this same role was seen on, e.g. ["remotive", "greenhouse"].
  // Length > 1 means it was posted on multiple boards.
  sources: string[];
  // How many raw postings collapsed into this entry (>= 1).
  duplicateCount: number;
}

// Normalize a title for comparison: lowercase, drop seniority/level words and
// punctuation, collapse whitespace. "Senior Software Engineer (Remote)" and
// "Software Engineer" both reduce toward "software engineer".
const TITLE_NOISE =
  /\b(senior|sr|junior|jr|staff|principal|lead|mid|i{1,3}|iv|remote|contract|full[\s-]?time|part[\s-]?time)\b/g;

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop parenthetical notes
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(TITLE_NOISE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(company: string): string {
  return company
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|gmbh|co|corp|corporation|limited)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The grouping key: same company + same normalized title = same role.
function dedupKey(item: JobWithMatch): string {
  return `${normalizeCompany(item.job.company)}::${normalizeTitle(item.job.title)}`;
}

// Collapse duplicates. For each group we keep the "best" representative — the
// posting with the most complete description, then the one you're most likely
// eligible for — and attach the list of all sources + a duplicate count.
export function dedupeJobs(items: JobWithMatch[]): DedupedJob[] {
  const groups = new Map<string, JobWithMatch[]>();
  for (const item of items) {
    const key = dedupKey(item);
    const g = groups.get(key);
    if (g) g.push(item);
    else groups.set(key, [item]);
  }

  const out: DedupedJob[] = [];
  for (const group of groups.values()) {
    // Pick a representative: longest description wins (most informative),
    // tie-broken by eligibility preference then higher match.
    const rep = [...group].sort((a, b) => {
      const descDiff =
        (b.job.description?.length ?? 0) - (a.job.description?.length ?? 0);
      if (descDiff !== 0) return descDiff;
      const eligRank = (x: JobWithMatch) =>
        x.eligibility?.verdict === "eligible"
          ? 0
          : x.eligibility?.verdict === "eligible-with-sponsorship"
            ? 1
            : 2;
      const er = eligRank(a) - eligRank(b);
      if (er !== 0) return er;
      return (b.match?.percent ?? 0) - (a.match?.percent ?? 0);
    })[0];

    // Distinct sources (providers), preserving first-seen order.
    const sources: string[] = [];
    for (const g of group) {
      if (!sources.includes(g.job.provider)) sources.push(g.job.provider);
    }

    out.push({ ...rep, sources, duplicateCount: group.length });
  }
  return out;
}
