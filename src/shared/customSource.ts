import type { CustomSourceConfig } from "./storage";
import type { Job, WorkModel } from "./types";

// Pure parsing/mapping for user-configured custom sources (RSS/Atom feeds and
// JSON endpoints). Given already-fetched text, produces Job records. No network
// here — the fetch lives in main/. Deterministic and unit-testable.

// ---- Shared helpers ----

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Read a dot-path (e.g. "data.results") out of a nested object.
function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function str(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

// A stable id for a custom job: prefer an explicit id, else the URL, else a
// hash-ish of title+company. Prefixed so it never collides with other sources.
function customId(
  sourceKey: string,
  idVal: string,
  url: string,
  title: string,
  company: string,
): string {
  const basis = idVal || url || `${company}:${title}`;
  return `custom:${sourceKey}:${basis}`;
}

// ---- RSS / Atom ----

// Minimal, dependency-free RSS 2.0 + Atom item extraction. Pulls <item> (RSS)
// or <entry> (Atom) blocks and reads title/link/description/pubDate.
export function parseRssJobs(
  xml: string,
  cfg: CustomSourceConfig,
  sourceKey: string,
  now: string,
): Job[] {
  const jobs: Job[] = [];
  const itemRe = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  const blocks = xml.match(itemRe) ?? [];
  for (const block of blocks) {
    const title = decodeEntities(tag(block, "title"));
    if (!title) continue;
    // RSS uses <link>text</link>; Atom uses <link href="..."/>.
    const link =
      tag(block, "link") || attr(block, "link", "href") || tag(block, "guid");
    const description = stripHtml(
      tag(block, "description") ||
        tag(block, "summary") ||
        tag(block, "content"),
    );
    const pub =
      tag(block, "pubDate") ||
      tag(block, "updated") ||
      tag(block, "published");
    const postedAt = pub ? toIso(pub) : null;
    // RSS has no company field; use the source label as company fallback.
    const company = decodeEntities(tag(block, "author")) || sourceKey;
    const location = description.match(/\bremote\b/i) ? "Remote" : "";
    jobs.push({
      id: customId(sourceKey, tag(block, "guid"), link, title, company),
      provider: "custom",
      board: sourceKey,
      company,
      title,
      location,
      workModel: resolveWorkModel(cfg, `${title} ${location} ${description}`),
      url: link,
      postedAt,
      description,
      fetchedAt: now,
    });
  }
  return jobs;
}

function tag(block: string, name: string): string {
  // Handles <name>..</name> and CDATA.
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i");
  const m = block.match(re);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function attr(block: string, name: string, attrName: string): string {
  const re = new RegExp(`<${name}\\b[^>]*\\b${attrName}=["']([^"']+)["']`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : "";
}

function toIso(dateStr: string): string | null {
  const t = Date.parse(dateStr);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---- JSON ----

export function parseJsonJobs(
  data: unknown,
  cfg: CustomSourceConfig,
  sourceKey: string,
  now: string,
): Job[] {
  const mapping = cfg.mapping;
  if (!mapping) return [];
  const itemsRaw = getPath(data, mapping.itemsPath);
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const jobs: Job[] = [];
  for (const raw of items) {
    if (raw == null || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const title = str(getPath(item, mapping.title));
    if (!title) continue;
    const company = mapping.company ? str(getPath(item, mapping.company)) : sourceKey;
    const location = mapping.location ? str(getPath(item, mapping.location)) : "";
    const url = mapping.url ? str(getPath(item, mapping.url)) : "";
    const description = mapping.description
      ? stripHtml(str(getPath(item, mapping.description)))
      : "";
    const idVal = mapping.id ? str(getPath(item, mapping.id)) : "";
    const postedRaw = mapping.postedAt ? str(getPath(item, mapping.postedAt)) : "";
    jobs.push({
      id: customId(sourceKey, idVal, url, title, company),
      provider: "custom",
      board: sourceKey,
      company: company || sourceKey,
      title,
      location,
      workModel: resolveWorkModel(cfg, `${title} ${location} ${description}`),
      url,
      postedAt: postedRaw ? toIso(postedRaw) : null,
      description,
      fetchedAt: now,
    });
  }
  return jobs;
}

// Resolve work model: an explicit per-source default wins, else infer from text
// (remote/hybrid/onsite keywords), else unknown.
function resolveWorkModel(cfg: CustomSourceConfig, text: string): WorkModel {
  if (cfg.defaultWorkModel && cfg.defaultWorkModel !== "unknown") {
    return cfg.defaultWorkModel;
  }
  const t = text.toLowerCase();
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\bremote\b/.test(t)) return "remote";
  if (/\b(on-?site|in-?office)\b/.test(t)) return "onsite";
  return "unknown";
}

// Validate a custom config before saving — returns an error string or null.
export function validateCustomConfig(
  cfg: Partial<CustomSourceConfig>,
): string | null {
  if (!cfg.url || !/^https:\/\//i.test(cfg.url)) {
    return "URL must start with https://";
  }
  if (cfg.format !== "rss" && cfg.format !== "json") {
    return "Format must be rss or json.";
  }
  if (cfg.format === "json") {
    if (!cfg.mapping) return "JSON sources need a field mapping.";
    if (!cfg.mapping.title) return "JSON mapping needs at least a 'title' field.";
  }
  return null;
}

// Parse by format — the single entry the main-process fetcher calls after it
// has the raw text/parsed JSON.
export function parseCustomSource(
  cfg: CustomSourceConfig,
  payload: { text?: string; json?: unknown },
  sourceKey: string,
  now = new Date().toISOString(),
): Job[] {
  if (cfg.format === "rss") {
    return parseRssJobs(payload.text ?? "", cfg, sourceKey, now);
  }
  return parseJsonJobs(payload.json, cfg, sourceKey, now);
}
