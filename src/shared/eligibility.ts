import type { WorkAuthFacts } from "./parsers";
import { parseWorkAuth } from "./parsers";

// Eligibility is THE core signal for a location-constrained job seeker (e.g.
// Nigeria-based, wanting work-from-anywhere or visa sponsorship). It answers:
// "Can I actually take this job from where I live?" — not just "is it remote?".
//
// Everything here is pure and deterministic. Classification is computed from
// posting text; the verdict is computed relative to the user's base country.

// How a posting constrains where you may work from.
export type RemoteScope =
  | "worldwide" // hire from anywhere
  | "region" // remote but limited to a region (e.g. US, EU, EMEA, Americas)
  | "country" // remote but limited to one country
  | "onsite" // must be physically present
  | "unknown";

export interface EligibilityFacts {
  scope: RemoteScope;
  // Region/country tokens the posting ties eligibility to (lowercased), e.g.
  // ["us"], ["eu","emea"], ["nigeria"]. Empty for worldwide/unknown.
  locations: string[];
  sponsorshipOffered: boolean | null; // from work-auth parsing
  countryLocked: boolean; // explicit "must be authorized in X / X only"
  evidence: string[];
}

// Region groupings so "remote EMEA" can include Nigeria, etc.
const REGION_MEMBERS: Record<string, string[]> = {
  worldwide: [],
  emea: ["nigeria", "africa", "europe", "eu", "uk", "middle east"],
  africa: ["nigeria", "africa"],
  europe: ["eu", "europe", "uk"],
  eu: ["eu", "europe"],
  americas: ["us", "usa", "canada", "latam", "brazil"],
  apac: ["india", "australia", "singapore", "asia"],
};

// Normalize common country/region phrases to tokens.
const LOCATION_TOKENS: { re: RegExp; token: string }[] = [
  { re: /\b(worldwide|anywhere|global(?:ly)?|work from anywhere|any location|any country)\b/i, token: "worldwide" },
  { re: /\b(emea)\b/i, token: "emea" },
  { re: /\b(apac)\b/i, token: "apac" },
  { re: /\b(latam|latin america)\b/i, token: "latam" },
  { re: /\b(americas)\b/i, token: "americas" },
  { re: /\b(u\.?s\.?a?\b|united states|us-based|us only|usa)\b/i, token: "us" },
  { re: /\b(u\.?k\.?|united kingdom)\b/i, token: "uk" },
  { re: /\b(e\.?u\.?|european union|europe)\b/i, token: "eu" },
  { re: /\b(canada)\b/i, token: "canada" },
  { re: /\b(india)\b/i, token: "india" },
  { re: /\b(africa)\b/i, token: "africa" },
  { re: /\b(nigeria)\b/i, token: "nigeria" },
  { re: /\b(germany)\b/i, token: "germany" },
];

export function classifyEligibility(
  title: string,
  description: string,
  location: string,
  // The work model the scraper already derived (authoritative). When it says
  // "onsite" or "hybrid", eligibility must not claim worldwide-remote based on
  // stray description keywords.
  knownWorkModel?: "onsite" | "hybrid" | "remote" | "unknown",
): EligibilityFacts {
  const blob = `${title}\n${location}\n${description}`;
  const workAuth: WorkAuthFacts = parseWorkAuth(blob);
  const evidence: string[] = [...workAuth.evidence];

  // The WORK ARRANGEMENT must come from authoritative fields — the title and
  // the structured location — NOT from stray words in the marketing-heavy
  // description. A long JD saying "our global team works on problems anywhere"
  // must not make an on-site San Francisco role look worldwide-remote.
  const arrangementText = `${title}\n${location}`.toLowerCase();

  // A concrete physical place in the location field (a city/country, or an
  // explicit onsite word) is a strong "this is a located role" signal.
  const hasConcreteLocation =
    /[a-z]/i.test(location) &&
    !/^\s*(remote|anywhere|worldwide|global)\b/i.test(location.trim());
  const saysOnsite = /\b(on-?site|in-?office|in person|on premises)\b/i.test(
    arrangementText,
  );
  const saysHybrid = /\bhybrid\b/i.test(arrangementText);
  // Remote only counts if the ARRANGEMENT text says so (title/location), not
  // the description.
  const saysRemote = /\b(remote|work from home|wfh|fully distributed)\b/i.test(
    arrangementText,
  );

  // "Worldwide" requires an explicit anywhere/worldwide phrase in the
  // ARRANGEMENT text AND a remote arrangement — never from description copy.
  const saysWorldwide =
    saysRemote &&
    /\b(worldwide|anywhere|global(?:ly)?|any location|any country)\b/i.test(
      arrangementText,
    );

  // Collect region/country tokens from title + location (for region-locked
  // remote like "Remote - EMEA"). Description is ignored for location tokens.
  const locations: string[] = [];
  for (const { re, token } of LOCATION_TOKENS) {
    if (token === "worldwide") continue;
    const m = arrangementText.match(re);
    if (m && !locations.includes(token)) {
      locations.push(token);
      evidence.push(m[0]);
    }
  }

  const lower = blob.toLowerCase();
  const countryLocked =
    workAuth.usCitizenOnly ||
    /\b(must be (?:authorized|authorised|eligible) to work in|only open to candidates in|must reside in)\b/i.test(
      lower,
    ) ||
    /\bremote\b[^.]{0,30}\b(us|usa|u\.s\.|uk|eu|canada|india)\s+only\b/i.test(
      lower,
    );

  // Decide scope with onsite/location taking priority over loose remote words.
  let scope: RemoteScope;
  if (knownWorkModel === "onsite" || knownWorkModel === "hybrid") {
    // The scraper already classified this as a located role — trust it.
    scope = "onsite";
  } else if (saysHybrid || (saysOnsite && !saysRemote)) {
    scope = "onsite";
  } else if (hasConcreteLocation && !saysRemote) {
    // A real city/country with no remote arrangement = onsite there.
    scope = "onsite";
  } else if (saysWorldwide) {
    scope = "worldwide";
  } else if (saysRemote && locations.length > 0) {
    const onlyCountries = locations.every(
      (l) => !REGION_MEMBERS[l] || REGION_MEMBERS[l].length === 0,
    );
    scope = onlyCountries && locations.length === 1 ? "country" : "region";
  } else if (saysRemote) {
    // Remote stated but with no region and no worldwide claim: unknown reach,
    // not assumed worldwide. We leave region resolution to the verdict.
    scope = "region";
    if (locations.length === 0) scope = "unknown";
  } else {
    scope = "unknown";
  }

  return {
    scope,
    locations,
    sponsorshipOffered: workAuth.sponsorshipOffered,
    countryLocked,
    evidence,
  };
}

// The verdict for a specific user, relative to their base country and any
// extra work authorizations they hold.
export type EligibilityVerdict =
  | "eligible" // you can apply as-is (worldwide remote, or your region, or your country)
  | "eligible-with-sponsorship" // onsite/region-locked BUT they sponsor
  | "likely-ineligible" // region/country-locked away from you, no sponsorship
  | "unclear";

export interface EligibilityAssessment {
  verdict: EligibilityVerdict;
  facts: EligibilityFacts;
  reason: string;
}

export interface UserEligibilityContext {
  baseCountry: string; // lowercased, e.g. "nigeria"
  // Countries/regions the user is already authorized to work in (e.g. holds a
  // visa/passport): lowercased tokens like ["eu","uk"].
  workAuthorizations: string[];
}

// Does a posting's region token cover the user's country or authorizations?
function regionCoversUser(
  token: string,
  ctx: UserEligibilityContext,
): boolean {
  const members = REGION_MEMBERS[token];
  const userLocs = [ctx.baseCountry, ...ctx.workAuthorizations];
  if (token === ctx.baseCountry) return true;
  if (ctx.workAuthorizations.includes(token)) return true;
  if (members && members.some((m) => userLocs.includes(m))) return true;
  return false;
}

export function assessEligibility(
  facts: EligibilityFacts,
  ctx: UserEligibilityContext,
): EligibilityAssessment {
  // Worldwide remote: always eligible.
  if (facts.scope === "worldwide") {
    return {
      verdict: "eligible",
      facts,
      reason: "Remote and open worldwide — you can apply from anywhere.",
    };
  }

  // Region/country-locked remote: eligible only if it covers you.
  if (facts.scope === "region" || facts.scope === "country") {
    const covered = facts.locations.some((loc) => regionCoversUser(loc, ctx));
    if (covered) {
      return {
        verdict: "eligible",
        facts,
        reason: `Remote within ${facts.locations.join("/")}, which includes your location.`,
      };
    }
    if (facts.sponsorshipOffered === true) {
      return {
        verdict: "eligible-with-sponsorship",
        facts,
        reason: `Restricted to ${facts.locations.join("/")}, but sponsorship is offered.`,
      };
    }
    return {
      verdict: "likely-ineligible",
      facts,
      reason: `Limited to ${facts.locations.join("/")} and no sponsorship mentioned — likely not open to you.`,
    };
  }

  // Onsite: eligible only with sponsorship (otherwise relocation is on you).
  if (facts.scope === "onsite") {
    if (facts.sponsorshipOffered === true) {
      return {
        verdict: "eligible-with-sponsorship",
        facts,
        reason: "On-site/hybrid, but the employer offers sponsorship/relocation.",
      };
    }
    if (facts.countryLocked) {
      return {
        verdict: "likely-ineligible",
        facts,
        reason: "On-site and country-locked with no sponsorship mentioned.",
      };
    }
    return {
      verdict: "unclear",
      facts,
      reason: "On-site; sponsorship not stated. Check the posting before applying.",
    };
  }

  return {
    verdict: "unclear",
    facts,
    reason: "Location/eligibility not stated clearly in the posting.",
  };
}
