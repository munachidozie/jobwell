import type { Job } from "@shared/types";
import { USER_AGENT, inferWorkModel } from "./index";

// Greenhouse public job board API:
// https://boards-api.greenhouse.io/v1/boards/{board}/jobs?content=true
interface GreenhouseJob {
  id: number;
  title: string;
  absolute_url: string;
  updated_at?: string;
  location?: { name?: string };
  content?: string;
  company_name?: string;
}

interface GreenhouseResponse {
  jobs: GreenhouseJob[];
}

// Greenhouse returns job descriptions as HTML-encoded strings. Strip tags and
// decode the few entities that matter for plain-text matching/display.
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchGreenhouse(board: string): Promise<Job[]> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Greenhouse ${board}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as GreenhouseResponse;
  const now = new Date().toISOString();
  return (data.jobs ?? []).map((j) => {
    const location = j.location?.name ?? "";
    return {
      id: `greenhouse:${board}:${j.id}`,
      provider: "greenhouse",
      board,
      company: j.company_name ?? board,
      title: j.title,
      location,
      workModel: inferWorkModel(location),
      url: j.absolute_url,
      postedAt: j.updated_at ?? null,
      description: j.content ? htmlToText(j.content) : "",
      fetchedAt: now,
    } satisfies Job;
  });
}
