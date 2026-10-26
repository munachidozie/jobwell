import type { Job } from "@shared/types";
import { USER_AGENT, inferWorkModel } from "./index";

// Lever public postings API:
// https://api.lever.co/v0/postings/{board}?mode=json
interface LeverPosting {
  id: string;
  text: string; // title
  hostedUrl: string;
  createdAt?: number; // epoch ms
  categories?: { location?: string; team?: string; commitment?: string };
  descriptionPlain?: string;
}

export async function fetchLever(board: string): Promise<Job[]> {
  const url = `https://api.lever.co/v0/postings/${encodeURIComponent(board)}?mode=json`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) {
    throw new Error(`Lever ${board}: HTTP ${res.status}`);
  }
  const data = (await res.json()) as LeverPosting[];
  const now = new Date().toISOString();
  return (data ?? []).map((p) => {
    const location = p.categories?.location ?? "";
    return {
      id: `lever:${board}:${p.id}`,
      provider: "lever",
      board,
      company: board,
      title: p.text,
      location,
      workModel: inferWorkModel(location),
      url: p.hostedUrl,
      postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
      description: p.descriptionPlain ?? "",
      fetchedAt: now,
    } satisfies Job;
  });
}
