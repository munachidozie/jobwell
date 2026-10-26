import { describe, expect, it } from "vitest";
import {
  formatPay,
  parseLevel,
  parsePay,
  parsePosting,
  parseWorkAuth,
  parseWorkModel,
  parseYearsRequired,
} from "./parsers";

describe("parsePay", () => {
  it("parses a USD annual range", () => {
    const p = parsePay("Salary: $120,000 - $150,000 per year");
    expect(p.min).toBe(120000);
    expect(p.max).toBe(150000);
    expect(p.currency).toBe("USD");
    expect(p.period).toBe("year");
    expect(p.annualMinUsd).toBe(120000);
    expect(p.annualMaxUsd).toBe(150000);
  });

  it("parses k-notation", () => {
    const p = parsePay("Comp is $95k–$130k");
    expect(p.min).toBe(95000);
    expect(p.max).toBe(130000);
  });

  it("annualizes hourly USD pay", () => {
    const p = parsePay("$55 per hour");
    expect(p.period).toBe("hour");
    expect(p.min).toBe(55);
    expect(p.annualMinUsd).toBe(55 * 2080);
  });

  it("converts non-USD pay via approximate FX and flags it", () => {
    const p = parsePay("£80,000 - £95,000 per year");
    expect(p.currency).toBe("GBP");
    expect(p.fxApproximate).toBe(true);
    // ~1.27 USD per GBP
    expect(p.annualMinUsd).toBeGreaterThan(90000);
    expect(p.annualMinUsd).toBeLessThan(110000);
  });

  it("parses Nigerian naira with the ₦ symbol and converts to USD", () => {
    const p = parsePay("₦400,000 per month");
    expect(p.currency).toBe("NGN");
    expect(p.period).toBe("month");
    expect(p.min).toBe(400000);
    expect(p.fxApproximate).toBe(true);
    // 400k NGN/mo * 12 * ~0.00065 ≈ $3,120/yr
    expect(p.annualMinUsd).toBeGreaterThan(2000);
    expect(p.annualMinUsd).toBeLessThan(5000);
  });

  it("parses a currency CODE like NGN", () => {
    const p = parsePay("Compensation: NGN 500000 monthly");
    expect(p.currency).toBe("NGN");
    expect(p.min).toBe(500000);
  });

  it("USD pay is not flagged as approximate", () => {
    const p = parsePay("$120,000 per year");
    expect(p.fxApproximate).toBe(false);
    expect(p.annualMinUsd).toBe(120000);
  });

  it("uses live rates when provided (units per USD)", () => {
    // 1 USD = 1000 NGN here → 1,200,000 NGN/yr ≈ $1,200/yr.
    const live = { USD: 1, NGN: 1000 };
    const p = parsePay("₦1,200,000 per year", live);
    expect(p.currency).toBe("NGN");
    expect(p.annualMinUsd).toBe(1200);
  });

  it("falls back to built-in rates when live rates omit the currency", () => {
    const live = { USD: 1 }; // no NGN
    const p = parsePay("₦1,540,000 per year", live);
    // fallback ~1540 NGN/USD → ≈ $1000/yr
    expect(p.annualMinUsd).toBeGreaterThan(800);
    expect(p.annualMinUsd).toBeLessThan(1200);
  });

  it("returns nulls when no pay is present", () => {
    const p = parsePay("Great role, competitive pay");
    expect(p.min).toBeNull();
    expect(p.raw).toBeNull();
  });

  // Regression: the live-app misparse. "$1k per task" is piecework, not salary;
  // the real salary "$10k per year" should win.
  it("ignores per-task piecework and picks the real annual salary", () => {
    const p = parsePay(
      "Pay is $1k per task, with around $10k per year possible for active contributors.",
    );
    expect(p.min).toBe(10000);
    expect(p.period).toBe("year");
  });

  it("ignores a stray per-task rate entirely when no salary is stated", () => {
    const p = parsePay("Earn $1,000 per task. Flexible schedule.");
    expect(p.min).toBeNull();
  });

  it("does not treat a signing bonus as salary", () => {
    const p = parsePay(
      "$5,000 signing bonus. Base salary $130,000 per year.",
    );
    expect(p.min).toBe(130000);
    expect(p.period).toBe("year");
  });

  it("prefers the figure with an explicit salary period", () => {
    const p = parsePay(
      "Perks include a $2k home-office budget. Compensation: $95,000–$120,000 annually.",
    );
    expect(p.min).toBe(95000);
    expect(p.max).toBe(120000);
  });

  it("is deterministic", () => {
    const text = "$100k - $120k per year";
    expect(parsePay(text)).toEqual(parsePay(text));
  });
});

describe("formatPay", () => {
  it("formats USD without an FX note", () => {
    const s = formatPay(parsePay("$120k - $150k per year"));
    expect(s).toContain("$120k");
    expect(s).toContain("/yr");
    expect(s).not.toContain("≈");
  });

  it("formats naira with an approximate USD note", () => {
    const s = formatPay(parsePay("₦400,000 per month"));
    expect(s).toContain("₦400k");
    expect(s).toContain("/mo");
    expect(s).toContain("≈ $");
  });

  it("returns null when there is no pay", () => {
    expect(formatPay(parsePay("no pay listed"))).toBeNull();
  });
});

describe("parseLevel", () => {
  it("reads common title signals", () => {
    expect(parseLevel("Senior Software Engineer")).toBe("senior");
    expect(parseLevel("Staff Engineer")).toBe("staff");
    expect(parseLevel("Software Engineering Intern")).toBe("intern");
    expect(parseLevel("Junior Developer")).toBe("entry");
    expect(parseLevel("Software Engineer")).toBe("unknown");
  });

  it("falls back to description only when title is silent", () => {
    expect(parseLevel("Engineer", "Requires 6+ years experience")).toBe(
      "senior",
    );
  });
});

describe("parseYearsRequired", () => {
  it("parses plus, range, and minimum forms", () => {
    expect(parseYearsRequired("5+ years of experience").min).toBe(5);
    const r = parseYearsRequired("3-5 years required");
    expect(r.min).toBe(3);
    expect(r.max).toBe(5);
    expect(parseYearsRequired("minimum of 4 years").min).toBe(4);
  });

  it("returns null when unspecified", () => {
    expect(parseYearsRequired("No experience requirement listed").min).toBeNull();
  });
});

describe("parseWorkModel", () => {
  it("classifies models with hybrid winning over stray remote", () => {
    expect(parseWorkModel("This is a hybrid role, 2 days remote")).toBe(
      "hybrid",
    );
    expect(parseWorkModel("Fully remote position")).toBe("remote");
    expect(parseWorkModel("On-site in Seattle")).toBe("onsite");
    expect(parseWorkModel("Location: Austin")).toBe("unknown");
  });
});

describe("parseWorkAuth", () => {
  it("only reports facts the text states (never guesses)", () => {
    const silent = parseWorkAuth("Join our growing team of engineers.");
    expect(silent.clearanceRequired).toBe(false);
    expect(silent.usCitizenOnly).toBe(false);
    expect(silent.sponsorshipOffered).toBeNull(); // unstated, not "no"
    expect(silent.evidence).toHaveLength(0);
  });

  it("detects clearance, citizenship, and explicit no-sponsorship", () => {
    const a = parseWorkAuth(
      "Must be a US citizen. Active TS/SCI security clearance required. We do not offer sponsorship.",
    );
    expect(a.clearanceRequired).toBe(true);
    expect(a.usCitizenOnly).toBe(true);
    expect(a.sponsorshipOffered).toBe(false);
    expect(a.evidence.length).toBeGreaterThan(0);
  });

  it("detects offered sponsorship", () => {
    const a = parseWorkAuth("Visa sponsorship is available for this role.");
    expect(a.sponsorshipOffered).toBe(true);
  });
});

describe("parsePosting", () => {
  it("combines all parsers over title + description", () => {
    const parsed = parsePosting(
      "Senior Backend Engineer",
      "$140k-$170k per year. 5+ years required. Hybrid in NYC. Sponsorship available.",
    );
    expect(parsed.level).toBe("senior");
    expect(parsed.pay.min).toBe(140000);
    expect(parsed.years.min).toBe(5);
    expect(parsed.workModel).toBe("hybrid");
    expect(parsed.workAuth.sponsorshipOffered).toBe(true);
  });
});
