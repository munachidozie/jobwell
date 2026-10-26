import type { Job } from "@shared/types";
import { USER_AGENT, inferWorkModel } from "./index";

// Recruitee public careers API:
// https://{board}.recruitee.com/api/offers/
interface RecruiteeOffer {
  id: number;
  title: string;
  location?: string;
  city?: string;
  country?: string;
  remote?: boolean;
  published_at?: string;
  careers_url?: string;
  careers_apply_url?: string;
  description?: string;
  company_name?: string;
}

interface RecruiteeResponse {
  offers: RecruiteeOffer[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchRecruitee(board: string): Promise<Job[]> {
  const url = `https://${encodeURIComponent(board)}.recruitee.com/api/offers/`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Recruitee ${board}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as RecruiteeResponse;
  const now = new Date().toISOString();
  return (data.offers ?? []).map((o) => {
    const place = o.location ?? [o.city, o.country].filter(Boolean).join(", ");
    const location = o.remote ? `Remote ${place}`.trim() : place;
    return {
      id: `recruitee:${board}:${o.id}`,
      provider: "recruitee",
      board,
      company: o.company_name ?? board,
      title: o.title,
      location,
      workModel: inferWorkModel(location),
      url: o.careers_url ?? o.careers_apply_url ?? `https://${board}.recruitee.com/o/${o.id}`,
      postedAt: o.published_at ?? null,
      description: o.description ? stripHtml(o.description) : "",
      fetchedAt: now,
    } satisfies Job;
  });
}
