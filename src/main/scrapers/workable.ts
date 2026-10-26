import type { Job } from "@shared/types";
import { USER_AGENT, inferWorkModel } from "./index";

// Workable public board API:
// https://apply.workable.com/api/v1/widget/accounts/{board}?details=true
interface WorkableJob {
  id?: string;
  shortcode: string;
  title: string;
  city?: string;
  state?: string;
  country?: string;
  remote?: boolean;
  published_on?: string;
  url?: string;
  application_url?: string;
  description?: string;
}

interface WorkableResponse {
  jobs: WorkableJob[];
  name?: string;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchWorkable(board: string): Promise<Job[]> {
  const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(board)}?details=true`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Workable ${board}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as WorkableResponse;
  const company = data.name ?? board;
  const now = new Date().toISOString();
  return (data.jobs ?? []).map((j) => {
    const place = [j.city, j.state, j.country].filter(Boolean).join(", ");
    const location = j.remote ? `Remote ${place}`.trim() : place;
    return {
      id: `workable:${board}:${j.shortcode}`,
      provider: "workable",
      board,
      company,
      title: j.title,
      location,
      workModel: inferWorkModel(location),
      url: j.url ?? j.application_url ?? `https://apply.workable.com/${board}/j/${j.shortcode}`,
      postedAt: j.published_on ?? null,
      description: j.description ? stripHtml(j.description) : "",
      fetchedAt: now,
    } satisfies Job;
  });
}
