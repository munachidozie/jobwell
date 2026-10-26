import type { JobLevel, WorkModel } from "./types";

// Pure posting parsers. Each extracts one kind of structured fact from raw job
// text. All deterministic and unit-testable, with no network or Node deps.
// These feed both filters and match scoring, and underpin honest facts like
// pay and work authorization (never guessed — only reported when the text
// states them).

// ---- Pay / compensation ----

export type PayPeriod = "year" | "hour" | "month" | "day" | "week" | "unknown";

export interface PayInfo {
  min: number | null;
  max: number | null;
  currency: string; // ISO code, e.g. "USD", "NGN", "GBP"
  period: PayPeriod;
  // Annualized USD-equivalent min/max, converted via approximate fixed rates so
  // roles in different currencies can be compared and filtered on one scale.
  // Null only when the period is unknown or the currency is unrecognized.
  // NOTE: FX is approximate (not live) — clearly a rough comparison aid.
  annualMinUsd: number | null;
  annualMaxUsd: number | null;
  fxApproximate: boolean; // true when a non-USD rate was applied
  raw: string | null; // the matched substring, for transparency
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
  "¥": "JPY",
  "₦": "NGN",
  "₹": "INR",
};

// Fallback USD exchange rates as "units of currency per 1 USD" — used only when
// live/cached rates aren't available. Rounded; the app labels conversions as
// approximate. Live rates (open.er-api.com, cached per refresh) override these.
const FALLBACK_UNITS_PER_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 155,
  NGN: 1540,
  INR: 83,
};

// How many USD is 1 unit of `currency`, given an optional live rates table
// (units-per-USD, base USD). Returns null if the currency is unknown.
function usdPerUnit(
  currency: string,
  liveRates?: Record<string, number>,
): number | null {
  if (currency === "USD") return 1;
  const unitsPerUsd = liveRates?.[currency] ?? FALLBACK_UNITS_PER_USD[currency];
  if (!unitsPerUsd || unitsPerUsd <= 0) return null;
  return 1 / unitsPerUsd;
}

const PERIOD_HOURS_PER_YEAR = 2080; // 40h * 52w
const PERIOD_MULTIPLIER: Record<PayPeriod, number | null> = {
  year: 1,
  month: 12,
  week: 52,
  day: 260, // ~52 * 5
  hour: PERIOD_HOURS_PER_YEAR,
  unknown: null,
};

function parseAmount(s: string): number {
  // "120k" -> 120000, "120,000" -> 120000, "95.5k" -> 95500
  const cleaned = s.replace(/[, ]/g, "").toLowerCase();
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)k$/);
  if (kMatch) return Math.round(parseFloat(kMatch[1]) * 1000);
  return Math.round(parseFloat(cleaned));
}

function detectPeriod(text: string): PayPeriod {
  const t = text.toLowerCase();
  if (/\b(per\s*hour|\/\s*hour|hourly|an hour|\/hr|per hr)\b/.test(t))
    return "hour";
  if (/\b(per\s*month|\/\s*month|monthly|per mo|\/mo)\b/.test(t))
    return "month";
  if (/\b(per\s*week|weekly|\/\s*week)\b/.test(t)) return "week";
  if (/\b(per\s*day|daily|\/\s*day|per diem)\b/.test(t)) return "day";
  if (/\b(per\s*year|annually|annual|per annum|\/\s*year|\/yr|a year|p\.a\.)\b/.test(t))
    return "year";
  return "unknown";
}

// Piecework / non-salary rates we must NOT treat as compensation, e.g.
// "$1k per task", "$0.10 per word", "$50 per project", "$1000 bonus".
const PIECEWORK_RE =
  /\bper\s*(task|project|gig|word|article|piece|unit|assignment|delivery|milestone|ticket)\b/i;
const NON_SALARY_CONTEXT_RE =
  /\b(bonus|stipend|credit|referral|reward|prize|signing|sign-on|budget|allowance|discount|voucher|gift)\b/i;

// Infer a sensible default period from magnitude when text doesn't say.
function inferPeriodFromAmount(max: number): PayPeriod {
  if (max <= 500) return "hour"; // $X/hr ranges
  return "year";
}

export function parsePay(
  text: string,
  // Optional live FX rates (units of currency per 1 USD, base USD). When
  // omitted, built-in fallback rates are used.
  liveRates?: Record<string, number>,
): PayInfo {
  const none: PayInfo = {
    min: null,
    max: null,
    currency: "USD",
    period: "unknown",
    annualMinUsd: null,
    annualMaxUsd: null,
    fxApproximate: false,
    raw: null,
  };
  if (!text) return none;

  // Find ALL money mentions (symbol- or code-prefixed, optional range), then
  // choose the best SALARY candidate — rather than blindly taking the first
  // number, which misfires on "$1k per task" / "$500 bonus".
  const moneyRe =
    /(?:([$£€¥₦₹])|\b(USD|NGN|GBP|EUR|JPY|INR|CAD|AUD)\b)\s?(\d[\d,]*(?:\.\d+)?k?)\s*(?:(?:[-–—]|to)\s*(?:[$£€¥₦₹]|USD|NGN|GBP|EUR|JPY|INR|CAD|AUD)?\s?(\d[\d,]*(?:\.\d+)?k?))?/gi;

  interface Candidate {
    currency: string;
    min: number;
    max: number;
    period: PayPeriod;
    raw: string;
    index: number;
    score: number;
  }

  const candidates: Candidate[] = [];
  let m: RegExpExecArray | null;
  while ((m = moneyRe.exec(text)) !== null) {
    const currency = m[1]
      ? (CURRENCY_SYMBOLS[m[1]] ?? "USD")
      : (m[2] ?? "USD").toUpperCase();
    const min = parseAmount(m[3]);
    const max = m[4] ? parseAmount(m[4]) : min;
    const idx = m.index;
    // Context window around the amount to read its period/piecework signals.
    const window = text.slice(
      Math.max(0, idx - 12),
      idx + m[0].length + 24,
    );

    // Reject piecework and non-salary mentions (bonuses, stipends, etc.).
    if (PIECEWORK_RE.test(window) || NON_SALARY_CONTEXT_RE.test(window)) {
      continue;
    }

    const explicitPeriod = detectPeriod(window);
    const period =
      explicitPeriod === "unknown" ? inferPeriodFromAmount(max) : explicitPeriod;

    // Score: prefer an explicit salary period, then larger annualized figures
    // (a real salary beats a stray small number), then earlier position.
    let score = 0;
    if (explicitPeriod === "year") score += 100;
    else if (explicitPeriod === "hour" || explicitPeriod === "month")
      score += 60;
    else if (explicitPeriod !== "unknown") score += 40;
    // A plausible annual salary magnitude adds confidence.
    const approxAnnual = period === "year" ? max : max * (PERIOD_MULTIPLIER[period] ?? 0);
    if (approxAnnual >= 10000) score += 20;
    if (approxAnnual < 2000) score -= 30; // very likely not a salary

    candidates.push({ currency, min, max, period, raw: m[0].trim(), index: idx, score });
  }

  if (candidates.length === 0) return none;

  // Best score wins; ties broken by earliest position.
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];

  const mult = PERIOD_MULTIPLIER[best.period];
  const rate = usdPerUnit(best.currency, liveRates);
  const canConvert = mult != null && rate != null;
  const annualMinUsd = canConvert ? Math.round(best.min * mult! * rate!) : null;
  const annualMaxUsd = canConvert ? Math.round(best.max * mult! * rate!) : null;

  return {
    min: best.min,
    max: best.max,
    currency: best.currency,
    period: best.period,
    annualMinUsd,
    annualMaxUsd,
    fxApproximate: canConvert && best.currency !== "USD",
    raw: best.raw,
  };
}

// Format a PayInfo for display, e.g. "$120k–$150k/yr" or
// "₦400k/mo (≈ $3.1k/yr)".
export function formatPay(pay: PayInfo): string | null {
  if (pay.min == null) return null;
  const sym =
    Object.entries(CURRENCY_SYMBOLS).find(([, c]) => c === pay.currency)?.[0] ??
    `${pay.currency} `;
  const k = (n: number) =>
    n >= 1000 ? `${Math.round(n / 100) / 10}k` : `${n}`;
  const range =
    pay.max && pay.max !== pay.min
      ? `${sym}${k(pay.min)}–${sym}${k(pay.max)}`
      : `${sym}${k(pay.min)}`;
  const per =
    pay.period === "unknown"
      ? ""
      : `/${pay.period === "year" ? "yr" : pay.period === "hour" ? "hr" : pay.period === "month" ? "mo" : pay.period}`;
  let out = `${range}${per}`;
  if (pay.fxApproximate && pay.annualMinUsd != null) {
    out += ` (≈ $${k(pay.annualMinUsd)}/yr)`;
  }
  return out;
}

// ---- Level ----

// Infer seniority level from title (primary) with description as fallback.
export function parseLevel(title: string, description = ""): JobLevel {
  const t = `${title}`.toLowerCase();
  // Title signals take priority.
  if (/\b(intern|internship)\b/.test(t)) return "intern";
  if (/\b(principal|staff)\b/.test(t)) return "staff";
  if (/\blead\b/.test(t)) return "lead";
  if (/\b(sr\.?|senior)\b/.test(t)) return "senior";
  if (/\b(jr\.?|junior|entry|associate|new ?grad|graduate)\b/.test(t))
    return "entry";
  if (/\b(mid|intermediate)\b/.test(t)) return "mid";

  // Fall back to description cues only if the title was silent.
  const d = description.toLowerCase();
  if (/\b(senior|5\+ years|6\+ years|7\+ years)\b/.test(d)) return "senior";
  if (/\b(entry.level|0-2 years|new grad)\b/.test(d)) return "entry";
  return "unknown";
}

// ---- Years of experience required ----

export interface YearsRequired {
  min: number | null;
  max: number | null;
  raw: string | null;
}

export function parseYearsRequired(text: string): YearsRequired {
  if (!text) return { min: null, max: null, raw: null };
  // "5+ years", "3-5 years", "minimum of 4 years", "at least 2 years"
  const patterns: RegExp[] = [
    /(\d+)\s*(?:\+|or more)\s*years?/i,
    /(\d+)\s*[-–to]+\s*(\d+)\s*years?/i,
    /(?:minimum|at least|min\.?)\s*(?:of\s*)?(\d+)\s*years?/i,
    /(\d+)\s*years?(?:\s+of)?\s+(?:experience|exp)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : null;
      return { min: a, max: b, raw: m[0].trim() };
    }
  }
  return { min: null, max: null, raw: null };
}

// ---- Work model ----

export function parseWorkModel(text: string): WorkModel {
  const t = text.toLowerCase();
  // "hybrid" wins over a stray "remote" mention; onsite only if explicit.
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\b(fully remote|100% remote|remote-first|remote\b)/.test(t))
    return "remote";
  if (/\b(on-?site|in-?office|in person|on premises)\b/.test(t))
    return "onsite";
  return "unknown";
}

// ---- Work authorization statements ----

export interface WorkAuthFacts {
  // Each is true only when the posting explicitly states it. Absence means
  // "not stated" (null-ish), never a guessed "no".
  clearanceRequired: boolean;
  usCitizenOnly: boolean;
  sponsorshipOffered: boolean | null; // true=offers, false=explicitly won't, null=unstated
  evidence: string[]; // matched phrases, for transparency
}

export function parseWorkAuth(text: string): WorkAuthFacts {
  const evidence: string[] = [];

  const clearance =
    /\b(security clearance|ts\/sci|top secret|secret clearance|public trust)\b/i;
  const clearanceM = text.match(clearance);
  if (clearanceM) evidence.push(clearanceM[0]);

  const citizen =
    /\b(u\.?s\.? citizen(?:ship)?\s+(?:is\s+)?required|must be a u\.?s\.? citizen|citizens only)\b/i;
  const citizenM = text.match(citizen);
  if (citizenM) evidence.push(citizenM[0]);

  // Sponsorship: detect explicit "will not sponsor" vs "sponsorship available".
  let sponsorshipOffered: boolean | null = null;
  const noSponsor =
    /\b(no\s+sponsorship|not\s+(?:able\s+to\s+|be\s+able\s+to\s+)?sponsor|unable to sponsor|do(?:es)? not (?:provide|offer) sponsorship|without sponsorship)\b/i;
  const yesSponsor =
    /\b(sponsorship (?:is\s+)?available|will sponsor|visa sponsorship (?:is\s+)?(?:available|offered|provided)|h-?1b sponsorship)\b/i;
  const noM = text.match(noSponsor);
  const yesM = text.match(yesSponsor);
  if (noM) {
    sponsorshipOffered = false;
    evidence.push(noM[0]);
  } else if (yesM) {
    sponsorshipOffered = true;
    evidence.push(yesM[0]);
  }

  return {
    clearanceRequired: !!clearanceM,
    usCitizenOnly: !!citizenM,
    sponsorshipOffered,
    evidence,
  };
}

// Convenience: parse everything a posting offers in one call.
export interface ParsedPosting {
  pay: PayInfo;
  level: JobLevel;
  years: YearsRequired;
  workModel: WorkModel;
  workAuth: WorkAuthFacts;
}

export function parsePosting(title: string, description: string): ParsedPosting {
  const blob = `${title}\n${description}`;
  return {
    pay: parsePay(blob),
    level: parseLevel(title, description),
    years: parseYearsRequired(blob),
    workModel: parseWorkModel(blob),
    workAuth: parseWorkAuth(blob),
  };
}
