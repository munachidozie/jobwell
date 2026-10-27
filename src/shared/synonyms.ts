// Lightweight "similar, not exact" matching helpers. A small, editable
// dictionary lets related terms credit each other (e.g. "react" ~ "frontend",
// "k8s" ~ "kubernetes") without any ML model. Pure and deterministic.
//
// This is deliberately a curated dictionary, not inference — it's transparent
// (you can see exactly why two terms matched) and cheap. True meaning-based
// similarity is deferred to the semantic/embeddings phase.

// Each group is a set of mutually-related terms. Membership is symmetric:
// if the profile has any term in a group, a job mentioning any other term in
// that group counts as a (partial) skill hit.
const SYNONYM_GROUPS: string[][] = [
  // Frontend
  ["react", "reactjs", "react.js", "frontend", "front-end", "front end", "ui engineer", "ui developer"],
  ["vue", "vuejs", "vue.js", "nuxt"],
  ["angular", "angularjs"],
  ["javascript", "js", "ecmascript"],
  ["typescript", "ts"],
  // Backend / languages
  ["node", "nodejs", "node.js"],
  ["python", "py", "django", "flask", "fastapi"],
  ["java", "spring", "spring boot"],
  ["c#", "csharp", ".net", "dotnet", "asp.net"],
  ["go", "golang"],
  ["ruby", "rails", "ruby on rails"],
  ["php", "laravel"],
  // Data / infra
  ["sql", "postgres", "postgresql", "mysql", "database"],
  ["nosql", "mongodb", "mongo", "dynamodb"],
  ["kubernetes", "k8s"],
  ["docker", "containers", "containerization"],
  ["aws", "amazon web services"],
  ["gcp", "google cloud"],
  ["azure", "microsoft azure"],
  ["ci/cd", "cicd", "continuous integration", "continuous delivery"],
  ["terraform", "infrastructure as code", "iac"],
  // Roles / disciplines
  ["devops", "sre", "site reliability", "platform engineer"],
  ["data scientist", "data science", "machine learning", "ml", "ai"],
  ["data engineer", "data engineering", "etl", "data pipeline"],
  ["product manager", "pm", "product owner"],
  ["designer", "ux", "ui/ux", "product designer", "figma"],
  ["qa", "quality assurance", "test engineer", "sdet", "automation testing"],
  ["mobile", "ios", "android", "react native", "flutter"],
  ["fullstack", "full-stack", "full stack"],
  ["security", "infosec", "appsec", "cybersecurity"],
];

// Build a term -> group-index lookup once.
const TERM_TO_GROUP = new Map<string, number>();
SYNONYM_GROUPS.forEach((group, i) => {
  for (const term of group) TERM_TO_GROUP.set(term, i);
});

// Returns the set of terms related to `term` (including itself), lowercased.
export function relatedTerms(term: string): string[] {
  const t = term.toLowerCase().trim();
  const gi = TERM_TO_GROUP.get(t);
  if (gi === undefined) return [t];
  return SYNONYM_GROUPS[gi];
}

// True if `haystack` contains the term OR any of its related terms. Whole-ish
// word matching avoids "java" matching "javascript": we check word boundaries
// for short alphanumeric terms, and plain inclusion for multi-word phrases.
export function mentionsRelated(haystack: string, term: string): boolean {
  const hay = haystack.toLowerCase();
  for (const related of relatedTerms(term)) {
    if (containsTerm(hay, related)) return true;
  }
  return false;
}

// Word-boundary-aware containment. Phrases (with spaces/punctuation) use plain
// includes; single tokens use a boundary check so "java" != "javascript".
export function containsTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  if (/[\s/.]/.test(term)) {
    // multi-word or punctuated term (e.g. "spring boot", "c#", ".net")
    return haystack.includes(term);
  }
  const re = new RegExp(`(?:^|[^a-z0-9+#])${escapeRegex(term)}(?:$|[^a-z0-9+#])`, "i");
  return re.test(haystack);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Join a multi-role job function into a single readable string for the few
// consumers that want one (AI prompts, truth-gate source text, contact-role
// overlap). Blank entries are dropped.
export function formatRoles(roles: string[]): string {
  return roles.map((r) => r.trim()).filter(Boolean).join(", ");
}

// ---- Role / job-function similarity ----
// Compares the user's stated job function to a posting title with token
// overlap, so "Software Engineer" matches "Senior Software Engineer",
// "Backend Software Engineer", etc., and common abbreviations resolve.

const ROLE_ABBREVIATIONS: Record<string, string> = {
  swe: "software engineer",
  sde: "software engineer",
  pm: "product manager",
  "ml engineer": "machine learning engineer",
  dev: "developer",
  eng: "engineer",
};

// Words that carry no role meaning and shouldn't drive a title match.
const ROLE_STOPWORDS = new Set([
  "senior", "junior", "sr", "jr", "staff", "principal", "lead", "mid",
  "i", "ii", "iii", "iv", "the", "a", "an", "of", "and", "for", "remote",
  "entry", "level", "associate",
]);

function expandAbbreviations(text: string): string {
  let t = text.toLowerCase();
  for (const [abbr, full] of Object.entries(ROLE_ABBREVIATIONS)) {
    const re = new RegExp(`(?:^|\\s)${escapeRegex(abbr)}(?:$|\\s)`, "g");
    t = t.replace(re, ` ${full} `);
  }
  return t;
}

function roleTokens(text: string): string[] {
  return expandAbbreviations(text)
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 1 && !ROLE_STOPWORDS.has(w));
}

// 0..1 similarity between a job function and a posting title, by meaningful
// token overlap (how much of the user's function is present in the title).
export function roleSimilarity(jobFunction: string, title: string): number {
  const fnTokens = roleTokens(jobFunction);
  if (fnTokens.length === 0) return 0;
  const titleTokens = new Set(roleTokens(title));
  if (titleTokens.size === 0) return 0;
  let hits = 0;
  for (const tok of fnTokens) {
    if (titleTokens.has(tok)) hits++;
    else if ([...titleTokens].some((tt) => relatedTerms(tok).includes(tt))) {
      hits += 0.5; // related-but-not-exact token
    }
  }
  return Math.min(1, hits / fnTokens.length);
}
