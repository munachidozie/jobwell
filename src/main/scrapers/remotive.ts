import type { Job } from "@shared/types";
import { USER_AGENT } from "./index";

// Remotive public API: https://remotive.com/api/remote-jobs
// Returns { jobs: [...] }; all roles are remote.
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  candidate_required_location?: string; // e.g. "Worldwide", "USA Only", "Europe"
  publication_date?: string;
  description?: string;
  job_type?: string;
  category?: string;
}

interface RemotiveResponse {
  jobs: RemotiveJob[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#?\w+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Remotive states required location explicitly in candidate_required_location.
// Preserve it so eligibility can tell "Worldwide" from "USA Only".
function remoteLocation(raw?: string): string {
  const loc = (raw ?? "").trim();
  if (!loc || /^(anywhere|worldwide)$/i.test(loc)) return "Remote - Worldwide";
  return `Remote - ${loc}`;
}

export async function fetchRemotive(): Promise<Job[]> {
  const res = await fetch("https://remotive.com/api/remote-jobs", {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`Remotive: HTTP ${res.status}`);
  const data = (await res.json()) as RemotiveResponse;
  const now = new Date().toISOString();
  return (data.jobs ?? []).map((j) => {
    const location = remoteLocation(j.candidate_required_location);
    return {
      id: `remotive:feed:${j.id}`,
      provider: "remotive",
      board: "feed",
      company: j.company_name,
      title: j.title,
      location,
      workModel: "remote",
      url: j.url,
      postedAt: j.publication_date ?? null,
      description: `${j.category ? j.category + ". " : ""}${j.description ? stripHtml(j.description) : ""}`.trim(),
      fetchedAt: now,
    } satisfies Job;
  });
}
