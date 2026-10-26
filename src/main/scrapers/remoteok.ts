import type { Job } from "@shared/types";
import { USER_AGENT } from "./index";

// RemoteOK public API: https://remoteok.com/api
// Returns a JSON array whose FIRST element is a legal/notice object (not a
// job); real postings follow. All roles here are remote by definition.
interface RemoteOkPosting {
  id?: string | number;
  slug?: string;
  company?: string;
  position?: string; // title
  description?: string;
  location?: string;
  date?: string; // ISO
  url?: string;
  tags?: string[];
  // The first array element is a legal notice carrying this field.
  legal?: string;
}

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

// RemoteOK postings may name a region (e.g. "Europe", "US only"); keep it in
// the location so the eligibility classifier can read region restrictions.
// Default to "Remote - Worldwide" when no restriction is stated, since RemoteOK
// roles are remote and usually global unless they say otherwise.
function remoteLocation(raw?: string): string {
  const loc = (raw ?? "").trim();
  if (!loc || /^(anywhere|worldwide|🌏|🌍|🌎)$/i.test(loc)) {
    return "Remote - Worldwide";
  }
  return `Remote - ${loc}`;
}

export async function fetchRemoteOk(): Promise<Job[]> {
  const res = await fetch("https://remoteok.com/api", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`RemoteOK: HTTP ${res.status}`);
  const data = (await res.json()) as RemoteOkPosting[];
  const now = new Date().toISOString();
  return (data ?? [])
    .filter((p) => !p.legal && p.position) // drop the legal-notice element
    .map((p) => {
      const location = remoteLocation(p.location);
      const tags = (p.tags ?? []).join(", ");
      return {
        id: `remoteok:feed:${p.id ?? p.slug}`,
        provider: "remoteok",
        board: "feed",
        company: p.company ?? "Unknown",
        title: p.position!,
        location,
        workModel: "remote",
        url: p.url ?? `https://remoteok.com/remote-jobs/${p.slug ?? p.id}`,
        postedAt: p.date ?? null,
        description: `${tags ? tags + ". " : ""}${p.description ? stripHtml(p.description) : ""}`.trim(),
        fetchedAt: now,
      } satisfies Job;
    });
}
