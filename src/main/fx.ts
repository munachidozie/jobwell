import type { FxRates } from "@shared/storage";
import { USER_AGENT } from "./scrapers";

// Fetches current exchange rates (base USD) from open.er-api.com — free, no API
// key, ~166 currencies including NGN. Returns null on failure so callers can
// fall back to cached/hardcoded rates. One call per job refresh; the result is
// cached in the DB, so pay conversion stays instant and works offline after.
//
// The API's `rates` are "units of currency per 1 USD" (e.g. NGN ~ 1334), which
// is exactly the shape FxRates stores.
interface ErApiResponse {
  result: string; // "success" | "error"
  base_code?: string;
  time_last_update_utc?: string;
  rates?: Record<string, number>;
}

export async function fetchFxRates(): Promise<FxRates | null> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD", {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as ErApiResponse;
    if (data.result !== "success" || !data.rates || !data.rates.USD) {
      return null;
    }
    // Sanity check a couple of expected currencies exist.
    if (typeof data.rates.NGN !== "number") return null;
    return {
      base: "USD",
      rates: data.rates,
      fetchedAt: new Date().toISOString(),
      date: data.time_last_update_utc ?? null,
    };
  } catch {
    return null;
  }
}
