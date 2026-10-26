import type { JobFilter, JobWithMatch } from "./types";

// Split a free-text query into terms, honoring "quoted phrases" and preserving
// special characters so "c++", "c#", ".net", "node.js" survive as literal
// terms. Unquoted whitespace separates terms; all terms must match (AND).
export function parseQueryTerms(query: string): string[] {
  const terms: string[] = [];
  const re = /"([^"]+)"|(\S+)/g; // quoted phrase OR a non-space run
  let m: RegExpExecArray | null;
  while ((m = re.exec(query)) !== null) {
    const term = (m[1] ?? m[2]).trim().toLowerCase();
    if (term) terms.push(term);
  }
  return terms;
}

// Pure, deterministic filtering. Given the same items and filter, always
// returns the same subset. An empty filter matches everything.
export function applyFilter(
  items: JobWithMatch[],
  filter: JobFilter,
): JobWithMatch[] {
  const terms = filter.text ? parseQueryTerms(filter.text) : [];
  const location = filter.location?.trim().toLowerCase();
  const now = Date.now();

  return items.filter(({ job, match, eligibility, pay }) => {
    if (filter.onlyEligible) {
      const v = eligibility?.verdict;
      if (v !== "eligible" && v !== "eligible-with-sponsorship") return false;
    }
    if (filter.onlySponsorship) {
      if (eligibility?.verdict !== "eligible-with-sponsorship") return false;
    }
    if (terms.length > 0) {
      const hay = `${job.title} ${job.company} ${job.description}`.toLowerCase();
      // AND semantics: every term (special chars preserved) must appear.
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    if (location) {
      if (!job.location.toLowerCase().includes(location)) return false;
    }
    if (filter.workModels && filter.workModels.length > 0) {
      if (!filter.workModels.includes(job.workModel)) return false;
    }
    if (filter.providers && filter.providers.length > 0) {
      if (!filter.providers.includes(job.provider as never)) return false;
    }
    if (typeof filter.minMatchPercent === "number") {
      const pct = match?.percent ?? 0;
      if (pct < filter.minMatchPercent) return false;
    }
    if (typeof filter.minAnnualUsd === "number") {
      // Only exclude when pay is STATED and below the floor. Jobs with no pay
      // info are kept — absence of a figure isn't evidence it's too low.
      const annual = pay?.annualMinUsd;
      if (typeof annual === "number" && annual < filter.minAnnualUsd) {
        return false;
      }
    }
    if (typeof filter.postedWithinDays === "number" && job.postedAt) {
      const posted = Date.parse(job.postedAt);
      if (!Number.isNaN(posted)) {
        const ageDays = (now - posted) / 86_400_000;
        if (ageDays > filter.postedWithinDays) return false;
      }
    }
    return true;
  });
}

// True when a filter has no active criteria.
export function isEmptyFilter(filter: JobFilter): boolean {
  return (
    !filter.text?.trim() &&
    !filter.location?.trim() &&
    (!filter.workModels || filter.workModels.length === 0) &&
    (!filter.providers || filter.providers.length === 0) &&
    typeof filter.minMatchPercent !== "number" &&
    typeof filter.postedWithinDays !== "number" &&
    !filter.onlyEligible &&
    !filter.onlySponsorship &&
    typeof filter.minAnnualUsd !== "number"
  );
}

// Rank for a location-constrained seeker: eligible roles first, then by match.
// Keeps the feed focused on what you can actually take.
const ELIGIBILITY_RANK: Record<string, number> = {
  eligible: 0,
  "eligible-with-sponsorship": 1,
  unclear: 2,
  "likely-ineligible": 3,
};

export function sortByEligibilityThenMatch<T extends JobWithMatch>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    const ra = ELIGIBILITY_RANK[a.eligibility?.verdict ?? "unclear"] ?? 2;
    const rb = ELIGIBILITY_RANK[b.eligibility?.verdict ?? "unclear"] ?? 2;
    if (ra !== rb) return ra - rb;
    return (b.match?.percent ?? 0) - (a.match?.percent ?? 0);
  });
}
