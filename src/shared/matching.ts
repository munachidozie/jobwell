import type {
  Job,
  JobLevel,
  MatchBand,
  MatchReason,
  MatchScore,
  Profile,
} from "./types";
import { mentionsRelated, roleSimilarity } from "./synonyms";

// Transparent, deterministic match scoring.
// Four weighted factors sum to 100: role (30), skills (35), level (20),
// industry (15). The same (profile, job) pair always yields the same score —
// no randomness, no time-dependence. Every point is explained in `reasons`.
//
// "role" compares your job function to the posting TITLE with fuzzy token
// overlap, so similar roles match without exact wording. "skills" credits
// related terms (react ~ frontend) via the synonym dictionary. Together these
// make the feed rank roles SIMILAR to what you do, not just exact-word hits.

const WEIGHTS = { role: 30, skills: 35, level: 20, industry: 15 } as const;

const LEVEL_ORDER: Record<JobLevel, number> = {
  intern: 0,
  entry: 1,
  mid: 2,
  senior: 3,
  staff: 4,
  lead: 4,
  unknown: -1,
};

// Infer a job's level from its title when the board doesn't state one.
export function inferLevelFromTitle(title: string): JobLevel {
  const t = title.toLowerCase();
  if (/\b(intern|internship)\b/.test(t)) return "intern";
  if (/\b(principal|staff)\b/.test(t)) return "staff";
  if (/\blead\b/.test(t)) return "lead";
  if (/\b(sr\.?|senior)\b/.test(t)) return "senior";
  if (/\b(jr\.?|junior|entry|associate|new grad|graduate)\b/.test(t))
    return "entry";
  if (/\b(mid|intermediate)\b/.test(t)) return "mid";
  return "unknown";
}

function scoreRole(profile: Profile, job: Job): MatchReason {
  const weight = WEIGHTS.role;
  const fn = profile.jobFunction.trim();
  if (!fn) {
    return {
      factor: "role",
      points: Math.round(weight * 0.5),
      weight,
      detail: "No job function set; scored neutrally. Set it in your profile for better ranking.",
    };
  }
  const sim = roleSimilarity(fn, job.title);
  const points = Math.round(weight * sim);
  let detail: string;
  if (sim >= 0.99) detail = `Title strongly matches your function (${fn}).`;
  else if (sim > 0) detail = `Title partially matches your function (${fn}).`;
  else detail = `Title doesn't match your function (${fn}).`;
  return { factor: "role", points, weight, detail };
}

function scoreLevel(profile: Profile, job: Job): MatchReason {
  const jobLevel = inferLevelFromTitle(job.title);
  const weight = WEIGHTS.level;
  if (jobLevel === "unknown" || profile.level === "unknown") {
    return {
      factor: "level",
      points: Math.round(weight * 0.5),
      weight,
      detail: "Level unclear from the posting; scored neutrally.",
    };
  }
  const distance = Math.abs(LEVEL_ORDER[jobLevel] - LEVEL_ORDER[profile.level]);
  // Exact match = full points; each step away loses a third.
  const factor = Math.max(0, 1 - distance / 3);
  const points = Math.round(weight * factor);
  const detail =
    distance === 0
      ? `Posting level (${jobLevel}) matches your level (${profile.level}).`
      : `Posting level (${jobLevel}) is ${distance} step(s) from yours (${profile.level}).`;
  return { factor: "level", points, weight, detail };
}

function scoreSkills(profile: Profile, job: Job): MatchReason {
  const weight = WEIGHTS.skills;
  const haystack = `${job.title} ${job.description}`.toLowerCase();
  const skills = profile.skills.map((s) => s.toLowerCase()).filter(Boolean);
  if (skills.length === 0) {
    return {
      factor: "skills",
      points: 0,
      weight,
      detail: "No skills in your profile to match.",
    };
  }
  // Synonym-aware: a skill counts if the posting mentions it OR a related term
  // (e.g. "react" credits a posting that says "frontend").
  const matched = skills.filter((s) => mentionsRelated(haystack, s));
  const factor = matched.length / skills.length;
  const points = Math.round(weight * factor);
  const detail =
    matched.length > 0
      ? `Matched ${matched.length}/${skills.length} skills (incl. related terms): ${matched.join(", ")}.`
      : "None of your skills or related terms appear in this posting.";
  return { factor: "skills", points, weight, detail };
}

function scoreIndustry(profile: Profile, job: Job): MatchReason {
  const weight = WEIGHTS.industry;
  const haystack = `${job.company} ${job.description}`.toLowerCase();
  const industries = profile.industries
    .map((s) => s.toLowerCase())
    .filter(Boolean);
  if (industries.length === 0) {
    return {
      factor: "industry",
      points: Math.round(weight * 0.5),
      weight,
      detail: "No industries in your profile; scored neutrally.",
    };
  }
  const matched = industries.filter((s) => haystack.includes(s));
  const factor = matched.length > 0 ? 1 : 0;
  const points = Math.round(weight * factor);
  const detail =
    matched.length > 0
      ? `Industry signal found: ${matched.join(", ")}.`
      : "No matching industry signal in this posting.";
  return { factor: "industry", points, weight, detail };
}

function bandFor(percent: number): MatchBand {
  if (percent >= 80) return "Strong";
  if (percent >= 60) return "Good";
  if (percent >= 40) return "Fair";
  return "Weak";
}

export function scoreJob(profile: Profile, job: Job): MatchScore {
  const reasons = [
    scoreRole(profile, job),
    scoreSkills(profile, job),
    scoreLevel(profile, job),
    scoreIndustry(profile, job),
  ];
  const percent = reasons.reduce((sum, r) => sum + r.points, 0);
  return {
    jobId: job.id,
    percent,
    band: bandFor(percent),
    reasons,
  };
}
