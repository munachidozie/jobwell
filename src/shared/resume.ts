import type { Job } from "./types";

// Pure resume analysis. No file I/O here — callers pass already-extracted text.
// Everything is deterministic and unit-testable.

export interface ReadabilityResult {
  words: number;
  sentences: number;
  avgWordsPerSentence: number;
  grade: number; // Flesch–Kincaid grade level
  note: string;
}

export interface KeywordGap {
  jobId: string;
  present: string[]; // job keywords found in the resume
  missing: string[]; // job keywords absent from the resume
  coverage: number; // 0..1
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "that",
  "this", "have", "from", "has", "was", "but", "not", "all", "can", "who",
  "a", "an", "to", "of", "in", "on", "at", "by", "is", "it", "as", "or",
  "we", "be", "we're", "they", "their", "job", "role", "work", "team",
  "experience", "years", "including", "ability", "strong", "plus",
]);

function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

export function readability(text: string): ReadabilityResult {
  const words = text.match(/\b[\w'-]+\b/g) ?? [];
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const wordCount = words.length;
  const sentenceCount = Math.max(1, sentences.length);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);

  // Flesch–Kincaid grade level.
  const grade =
    0.39 * (wordCount / sentenceCount) +
    11.8 * (syllables / Math.max(1, wordCount)) -
    15.59;

  const rounded = Math.round(grade * 10) / 10;
  const note =
    rounded <= 10
      ? "Clear and easy to read."
      : rounded <= 13
        ? "Moderately complex; fine for most roles."
        : "Dense; consider shorter sentences and simpler words.";

  return {
    words: wordCount,
    sentences: sentenceCount,
    avgWordsPerSentence:
      Math.round((wordCount / sentenceCount) * 10) / 10,
    grade: rounded,
    note,
  };
}

// Extract candidate keywords from arbitrary text: lowercase tokens and common
// bigrams, excluding stopwords and very short tokens.
export function extractKeywords(text: string, limit = 40): string[] {
  const tokens = (text.toLowerCase().match(/\b[a-z][a-z+#.]{1,}\b/g) ?? [])
    .map((t) => t.replace(/\.$/, ""))
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));

  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

export function keywordGap(resumeText: string, job: Job): KeywordGap {
  const resumeTokens = new Set(extractKeywords(resumeText, 200));
  const jobKeywords = extractKeywords(`${job.title} ${job.description}`, 30);
  const present: string[] = [];
  const missing: string[] = [];
  for (const k of jobKeywords) {
    if (resumeTokens.has(k)) present.push(k);
    else missing.push(k);
  }
  const coverage =
    jobKeywords.length === 0 ? 1 : present.length / jobKeywords.length;
  return { jobId: job.id, present, missing, coverage };
}

// ---- Truthful tailoring ------------------------------------------------
// Tailoring must never invent facts. It only reorders and selects content the
// candidate already wrote, surfacing the resume lines most relevant to a job.
// It returns a suggestion the user edits and owns — it does not fabricate.

export interface TailoringSuggestion {
  jobId: string;
  // Resume lines ranked by overlap with the job's keywords. Verbatim — never
  // reworded or invented.
  prioritizedLines: { line: string; matchedKeywords: string[] }[];
  // Job keywords absent from the resume, offered as honest gaps to consider —
  // NOT auto-inserted.
  gapsToConsider: string[];
  disclaimer: string;
}

export function tailorTruthfully(
  resumeText: string,
  job: Job,
): TailoringSuggestion {
  const jobKeywords = new Set(
    extractKeywords(`${job.title} ${job.description}`, 30),
  );
  const lines = resumeText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const ranked = lines
    .map((line) => {
      const lineTokens = new Set(extractKeywords(line, 50));
      const matchedKeywords = [...jobKeywords].filter((k) =>
        lineTokens.has(k),
      );
      return { line, matchedKeywords };
    })
    .filter((r) => r.matchedKeywords.length > 0)
    .sort((a, b) => b.matchedKeywords.length - a.matchedKeywords.length);

  const gap = keywordGap(resumeText, job);

  return {
    jobId: job.id,
    prioritizedLines: ranked,
    gapsToConsider: gap.missing,
    disclaimer:
      "These are your own resume lines, reordered by relevance — nothing was invented or reworded. Gaps are listed honestly for you to address only if they are genuinely true of you.",
  };
}
