import { describe, expect, it } from "vitest";
import {
  assessEligibility,
  classifyEligibility,
  type UserEligibilityContext,
} from "./eligibility";

// Baseline: Nigeria-based, no extra work authorizations.
const nigeria: UserEligibilityContext = {
  baseCountry: "nigeria",
  workAuthorizations: [],
};

// Someone who later moved / holds EU right to work.
const euAuthorized: UserEligibilityContext = {
  baseCountry: "nigeria",
  workAuthorizations: ["eu"],
};

// classify(title, description, location, knownWorkModel)
function classify(
  title: string,
  desc: string,
  loc = "",
  wm?: "onsite" | "hybrid" | "remote" | "unknown",
) {
  return classifyEligibility(title, desc, loc, wm);
}

describe("classifyEligibility", () => {
  it("detects worldwide remote from the title/location", () => {
    const f = classify("Engineer (Remote)", "", "Remote - Worldwide");
    expect(f.scope).toBe("worldwide");
  });

  it("detects region-locked remote (US)", () => {
    const f = classify(
      "Engineer",
      "Must be authorized to work in the US.",
      "Remote - US only",
    );
    expect(f.scope === "region" || f.scope === "country").toBe(true);
    expect(f.locations).toContain("us");
    expect(f.countryLocked).toBe(true);
  });

  it("detects onsite with sponsorship", () => {
    const f = classify(
      "Engineer",
      "Visa sponsorship is available.",
      "Berlin, Germany",
      "onsite",
    );
    expect(f.scope).toBe("onsite");
    expect(f.sponsorshipOffered).toBe(true);
  });

  it("detects EMEA remote", () => {
    const f = classify("Engineer", "", "Remote - EMEA");
    expect(f.locations).toContain("emea");
  });

  // Regression: an on-site San Francisco role whose long description contains
  // marketing boilerplate like "global" / "anywhere" must NOT be called
  // worldwide-remote. This is the exact bug seen in the live app.
  it("does NOT call an onsite SF role worldwide just because the JD says 'global'", () => {
    const f = classify(
      "Senior Software Engineer",
      "Join our global team solving problems that matter. We work on challenges anywhere in the world. Remote collaboration is part of our culture.",
      "San Francisco, CA",
      "onsite",
    );
    expect(f.scope).toBe("onsite");
  });

  it("treats a concrete city with no remote word as onsite even without workModel hint", () => {
    const f = classify("Engineer", "Great benefits and culture.", "San Francisco, United States");
    expect(f.scope).toBe("onsite");
  });
});

describe("assessEligibility for a Nigeria-based seeker", () => {
  it("worldwide remote is eligible", () => {
    const f = classify("Engineer (Remote)", "", "Remote - Worldwide");
    expect(assessEligibility(f, nigeria).verdict).toBe("eligible");
  });

  it("US-only remote is likely ineligible", () => {
    const f = classify(
      "Engineer",
      "Must be authorized to work in the US.",
      "Remote - US only",
    );
    expect(assessEligibility(f, nigeria).verdict).toBe("likely-ineligible");
  });

  it("EMEA remote is eligible (covers Nigeria/Africa)", () => {
    const f = classify("Engineer", "", "Remote - EMEA");
    expect(assessEligibility(f, nigeria).verdict).toBe("eligible");
  });

  it("onsite with sponsorship is eligible-with-sponsorship", () => {
    const f = classify(
      "Engineer",
      "Relocation and visa sponsorship offered.",
      "Amsterdam",
      "onsite",
    );
    expect(assessEligibility(f, nigeria).verdict).toBe("eligible-with-sponsorship");
  });

  it("EU remote becomes eligible if the user holds EU authorization", () => {
    const f = classify("Engineer", "", "Remote - EU");
    expect(assessEligibility(f, euAuthorized).verdict).toBe("eligible");
  });

  it("onsite with no sponsorship info is unclear, not a hard no", () => {
    const f = classify("Engineer", "Great team.", "Lagos", "onsite");
    const a = assessEligibility(f, nigeria);
    expect(["unclear", "likely-ineligible"]).toContain(a.verdict);
  });

  // The live-app bug, at the verdict level: an onsite San Francisco role must
  // NOT be "eligible" for a Nigeria-based seeker with no US authorization.
  it("onsite San Francisco role is NOT 'eligible' for a Nigeria seeker", () => {
    const f = classify(
      "Senior Software Engineer",
      "Our global team works on problems anywhere. Remote-friendly culture.",
      "San Francisco, CA",
      "onsite",
    );
    const v = assessEligibility(f, nigeria).verdict;
    expect(v).not.toBe("eligible");
    expect(["unclear", "likely-ineligible"]).toContain(v);
  });

  it("is deterministic", () => {
    const f = classify("Engineer", "x", "Remote - US only");
    expect(assessEligibility(f, nigeria)).toEqual(assessEligibility(f, nigeria));
  });
});
