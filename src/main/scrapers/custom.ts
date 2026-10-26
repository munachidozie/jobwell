import type { Job } from "@shared/types";
import type { CustomSourceConfig } from "@shared/storage";
import { parseCustomSource } from "@shared/customSource";
import { USER_AGENT, mayFetch } from "./index";

// Fetches a user-configured custom source (RSS/Atom or JSON) and maps it to
// Job records. Runs through the same mayFetch guard (never-contact list +
// robots.txt) as built-in providers, so a user can't point it at a blocked
// host. `sourceKey` is the stored source's board value (used in job ids).
export async function fetchCustom(
  cfg: CustomSourceConfig,
  sourceKey: string,
): Promise<Job[]> {
  let origin: string;
  let path: string;
  try {
    const u = new URL(cfg.url);
    origin = `${u.protocol}//${u.host}`;
    path = u.pathname || "/";
  } catch {
    console.warn(`Custom source ${sourceKey}: invalid URL ${cfg.url}`);
    return [];
  }

  const guard = await mayFetch(origin, path);
  if (!guard.ok) {
    console.warn(`Custom source ${sourceKey} skipped — ${guard.reason}`);
    return [];
  }

  const res = await fetch(cfg.url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Custom ${sourceKey}: HTTP ${res.status}`);

  if (cfg.format === "json") {
    const json = await res.json();
    return parseCustomSource(cfg, { json }, sourceKey);
  }
  const text = await res.text();
  return parseCustomSource(cfg, { text }, sourceKey);
}
