import type { Job } from "@shared/types";
import { USER_AGENT, inferWorkModel } from "./index";

// Ashby public job board API:
// https://api.ashbyhq.com/posting-api/job-board/{board}?includeCompensation=true
interface AshbyPosting {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  publishedDate?: string;
  jobUrl?: string;
  descriptionPlain?: string;
  descriptionHtml?: string;
}

interface AshbyResponse {
  jobs: AshbyPosting[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchAshby(board: string): Promise<Job[]> {
  const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(board)}?includeCompensation=true`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Ashby ${board}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as AshbyResponse;
  const now = new Date().toISOString();
  return (data.jobs ?? []).map((j) => {
    const location = j.isRemote ? `Remote ${j.location ?? ""}`.trim() : j.location ?? "";
    const description =
      j.descriptionPlain ??
      (j.descriptionHtml ? stripHtml(j.descriptionHtml) : "");
    return {
      id: `ashby:${board}:${j.id}`,
      provider: "ashby",
      board,
      company: board,
      title: j.title,
      location,
      workModel: inferWorkModel(location),
      url: j.jobUrl ?? `https://jobs.ashbyhq.com/${board}/${j.id}`,
      postedAt: j.publishedDate ?? null,
      description,
      fetchedAt: now,
    } satisfies Job;
  });
}
