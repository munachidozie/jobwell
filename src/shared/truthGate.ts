import { relatedTerms } from "./synonyms";

// The truth gate: verifies that AI-generated text (cover letters, tailored
// resume bullets, assistant answers) introduces no facts absent from the
// user's own source material. This is the property that makes JobWell's AI
// trustworthy — it never fabricates experience, numbers, titles, or employers.
//
// The gate does NOT rewrite text. It inspects a draft against an allowed set of
// source facts and returns violations. Callers decide whether to reject, redact,
// or surface the draft with warnings. Pure and deterministic.

export interface TruthSources {
  // Everything the user has actually told us: resume text + profile fields.
  // The job posting is intentionally NOT a source of personal facts (it may be
  // passed separately as "jobContext" for phrasing about the role itself).
  resumeText: string;
  profileSkills: string[];
  profileIndustries: string[];
  jobFunction: string;
  yearsExperience: number;
  // Text about the role that MAY legitimately appear (company, job title) even
  // though it isn't a fact about the candidate.
  jobTitle?: string;
  jobCompany?: string;
}

export type ViolationKind =
  | "number" // a quantity/metric not in the sources
  | "percentage"
  | "year" // a calendar year or duration not supported
  | "skill" // a named technology/skill not in the sources
  | "proper-noun"; // a company/employer/school name not in the sources

export interface Violation {
  kind: ViolationKind;
  value: string;
  reason: string;
}

export interface TruthResult {
  ok: boolean;
  violations: Violation[];
}

// Normalize text to a lowercase token set for membership checks.
function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/\b[\w.+#-]{2,}\b/g) ?? [];
  return new Set(tokens);
}

// Build the pool of allowed source text (what the user actually provided).
function sourceBlob(s: TruthSources): string {
  return [
    s.resumeText,
    s.profileSkills.join(" "),
    s.profileIndustries.join(" "),
    s.jobFunction,
    String(s.yearsExperience),
  ]
    .join(" ")
    .toLowerCase();
}

// A small dictionary of common tech skills we care about verifying. If a draft
// claims one of these and it's not in the sources, that's a fabrication.
const KNOWN_SKILLS = [
  "javascript", "typescript", "python", "java", "c++", "c#", "go", "rust",
  "ruby", "php", "swift", "kotlin", "scala", "react", "angular", "vue",
  "svelte", "node", "express", "django", "flask", "spring", "rails",
  "postgres", "postgresql", "mysql", "mongodb", "redis", "sql", "graphql",
  "docker", "kubernetes", "aws", "azure", "gcp", "terraform", "kafka",
  "spark", "hadoop", "tensorflow", "pytorch", "figma", "sketch",
];

export function checkTruth(draft: string, sources: TruthSources): TruthResult {
  const violations: Violation[] = [];
  const blob = sourceBlob(sources);
  const sourceTokens = tokenize(blob);

  // Allowed extras: the job's own title/company may appear even if not in the
  // resume, because a letter legitimately names the role being applied to.
  const allowedExtra = new Set<string>();
  for (const extra of [sources.jobTitle, sources.jobCompany]) {
    if (extra) for (const tok of tokenize(extra)) allowedExtra.add(tok);
  }

  // 1. Numbers and percentages: any numeric claim must appear in the sources.
  // Capture an optional trailing % (which is a non-word char, so we can't rely
  // on a trailing \b).
  const numberMatches = draft.match(/\d[\d,.]*%?/g) ?? [];
  for (const num of numberMatches) {
    const clean = num.replace(/[,]/g, "");
    const isPercent = clean.endsWith("%");
    const bare = clean.replace(/%$/, "");
    // Allow small ordinals/common words-as-numbers and years-of-experience that
    // match the profile.
    if (bare === String(sources.yearsExperience)) continue;
    if (blob.includes(clean.toLowerCase()) || blob.includes(bare.toLowerCase())) {
      continue;
    }
    // A number not found anywhere in the sources is a fabrication risk.
    violations.push({
      kind: isPercent ? "percentage" : "number",
      value: num,
      reason: isPercent
        ? "Percentage not found in your resume or profile."
        : "Number/metric not found in your resume or profile.",
    });
  }

  // 2. Calendar years (e.g. 2019) not in the sources.
  const yearMatches = draft.match(/\b(19|20)\d{2}\b/g) ?? [];
  for (const y of yearMatches) {
    if (!blob.includes(y)) {
      violations.push({
        kind: "year",
        value: y,
        reason: "Year not found in your resume or profile.",
      });
    }
  }

  // 3. Known skills claimed but not in the sources — SYNONYM-AWARE. A draft
  //    mentioning "Kubernetes" is NOT flagged if the user's sources contain a
  //    related term like "k8s". This recognizes skills the user genuinely has
  //    under a different name, without ever inventing a claim.
  const draftLower = draft.toLowerCase();
  for (const skill of KNOWN_SKILLS) {
    const re = new RegExp(`(?:^|[^\\w])${escapeRegex(skill)}(?:$|[^\\w])`, "i");
    if (!re.test(draftLower)) continue;
    // Covered if the skill OR any of its synonyms appears in the user's data.
    const covered = relatedTerms(skill).some(
      (term) => sourceTokens.has(term) || blob.includes(term),
    );
    if (!covered) {
      violations.push({
        kind: "skill",
        value: skill,
        reason:
          "Skill mentioned in the draft but not present (even as a related term) in your profile or resume.",
      });
    }
  }

  // 4. Capitalized multi-word proper nouns (likely employers/schools) that
  //    aren't in the sources or the allowed job title/company. Heuristic:
  //    sequences of Capitalized words of length >=1 that look like org names.
  const properNounRe = /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3})\b/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = properNounRe.exec(draft)) !== null) {
    const phrase = m[1];
    const lower = phrase.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    // Flag multi-word Capitalized phrases (likely orgs) and single capitalized
    // tokens that aren't common English words — both are candidate fabricated
    // names unless present in the sources. A lone common word (sentence-initial
    // "From", "Dear", etc.) is excluded via COMMON_WORDS below.
    const words = phrase.split(/\s+/);
    if (words.length === 1 && COMMON_WORDS.has(phrase.toLowerCase())) continue;
    let allTokensKnown = true;
    for (const t of tokenize(phrase)) {
      if (!sourceTokens.has(t) && !allowedExtra.has(t) && !COMMON_WORDS.has(t)) {
        allTokensKnown = false;
        break;
      }
    }
    if (!allTokensKnown) {
      violations.push({
        kind: "proper-noun",
        value: phrase,
        reason:
          "Proper noun (possible employer/school/product) not found in your sources.",
      });
    }
  }

  return { ok: violations.length === 0, violations };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Very common capitalized words that often start sentences; not org names.
const COMMON_WORDS = new Set([
  "i", "the", "a", "an", "my", "we", "our", "this", "that", "with", "as",
  "dear", "hiring", "manager", "team", "sincerely", "regards", "best",
  "thank", "you", "role", "position", "company", "experience", "skills",
  "i'm", "i've", "it", "they", "your", "please", "thanks",
]);
