import { describe, expect, it } from "vitest";
import {
  displayName,
  normalizeDate,
  parseCsvLine,
  parseLinkedInCsv,
  rankContacts,
  type Contact,
} from "./contacts";

describe("parseCsvLine", () => {
  it("splits plain fields", () => {
    expect(parseCsvLine("a,b,c")).toEqual(["a", "b", "c"]);
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsvLine('Smith,"CEO, Founder",Acme')).toEqual([
      "Smith",
      "CEO, Founder",
      "Acme",
    ]);
  });

  it("unescapes doubled quotes", () => {
    expect(parseCsvLine('"He said ""hi""",x')).toEqual(['He said "hi"', "x"]);
  });

  it("produces empty strings for empty fields", () => {
    expect(parseCsvLine("a,,c")).toEqual(["a", "", "c"]);
  });
});

describe("normalizeDate", () => {
  it("converts a parseable date to ISO yyyy-mm-dd", () => {
    expect(normalizeDate("15 Jan 2023")).toBe("2023-01-15");
  });

  it("keeps an unparseable value as-is", () => {
    expect(normalizeDate("sometime last year")).toBe("sometime last year");
  });

  it("returns empty for blank", () => {
    expect(normalizeDate("  ")).toBe("");
  });
});

describe("parseLinkedInCsv", () => {
  const header =
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On";

  it("parses a standard export, skipping the Notes preamble", () => {
    const csv = [
      "Notes:",
      '"When exporting your connection data, you may notice..."',
      "",
      header,
      "Ada,Lovelace,https://linkedin.com/in/ada,,Analytical Engines,Engineer,15 Jan 2023",
      "Grace,Hopper,https://linkedin.com/in/grace,grace@navy.mil,US Navy,Rear Admiral,02 Mar 2022",
    ].join("\n");
    const { contacts, notes } = parseLinkedInCsv(csv);
    expect(contacts).toHaveLength(2);
    expect(contacts[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      company: "Analytical Engines",
      position: "Engineer",
      profileUrl: "https://linkedin.com/in/ada",
      connectedOn: "2023-01-15",
    });
    expect(contacts[1].email).toBe("grace@navy.mil");
    expect(notes.some((n) => n.includes("Parsed 2"))).toBe(true);
  });

  it("handles quoted fields containing commas", () => {
    const csv = [
      header,
      'Jane,Doe,https://linkedin.com/in/jane,,"Stripe, Inc.","Head of People, Talent",01 Jan 2024',
    ].join("\n");
    const { contacts } = parseLinkedInCsv(csv);
    expect(contacts[0].company).toBe("Stripe, Inc.");
    expect(contacts[0].position).toBe("Head of People, Talent");
  });

  it("skips rows with no name and notes it", () => {
    const csv = [header, ",,,,,,", "Sam,Smith,,,Acme,Dev,"].join("\n");
    const { contacts, notes } = parseLinkedInCsv(csv);
    expect(contacts).toHaveLength(1);
    expect(notes.some((n) => n.includes("Skipped 1"))).toBe(true);
  });

  it("reports a helpful note when the header is missing", () => {
    const { contacts, notes } = parseLinkedInCsv("just,some,random\n1,2,3");
    expect(contacts).toHaveLength(0);
    expect(notes[0]).toMatch(/header/i);
  });

  it("reports empty files", () => {
    expect(parseLinkedInCsv("   ").notes[0]).toMatch(/empty/i);
  });
});

// ---- ranking -------------------------------------------------------------

function contact(over: Partial<Contact>): Contact {
  return {
    id: 1,
    firstName: "A",
    lastName: "B",
    company: "",
    position: "",
    profileUrl: "",
    email: "",
    connectedOn: "2023-01-01",
    importedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("rankContacts", () => {
  it("ranks a connection at a target company highest", () => {
    const contacts = [
      contact({ id: 1, company: "Random Co", position: "Accountant" }),
      contact({ id: 2, company: "Stripe", position: "Engineer" }),
    ];
    const ranked = rankContacts(contacts, {
      targetCompanies: ["stripe"],
      jobFunction: "software engineer",
    });
    expect(ranked[0].contact.id).toBe(2);
    expect(ranked[0].matchedCompany).toBe("stripe");
    // The accountant at a non-target company with no role overlap is dropped.
    expect(ranked.some((r) => r.contact.id === 1)).toBe(false);
  });

  it("boosts recruiters and leaders even without a company match", () => {
    const contacts = [
      contact({ id: 3, company: "Globex", position: "Technical Recruiter" }),
      contact({ id: 4, company: "Globex", position: "Engineering Manager" }),
    ];
    const ranked = rankContacts(contacts, {
      targetCompanies: [],
      jobFunction: "software engineer",
    });
    // Recruiter (25) outranks a plain leader (15).
    expect(ranked[0].contact.id).toBe(3);
    expect(ranked.map((r) => r.contact.id)).toContain(4);
  });

  it("recognizes role overlap with the target function", () => {
    const ranked = rankContacts(
      [contact({ id: 5, position: "Senior Software Engineer" })],
      { targetCompanies: [], jobFunction: "software engineer" },
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0].reasons.some((r) => /similar work/i.test(r))).toBe(true);
  });

  it("matches company substrings in both directions", () => {
    const ranked = rankContacts(
      [contact({ id: 6, company: "Stripe Inc." })],
      { targetCompanies: ["stripe"], jobFunction: "" },
    );
    expect(ranked[0].matchedCompany).toBe("stripe");
  });

  it("is deterministic and caps the score at 100", () => {
    const c = [
      contact({
        id: 7,
        company: "Stripe",
        position: "Head of Engineering Recruiting",
      }),
    ];
    const ctx = { targetCompanies: ["stripe"], jobFunction: "engineering" };
    const a = rankContacts(c, ctx);
    const b = rankContacts(c, ctx);
    expect(a).toEqual(b);
    expect(a[0].score).toBeLessThanOrEqual(100);
  });
});

describe("displayName", () => {
  it("joins first and last, trimming blanks", () => {
    expect(displayName({ firstName: "Ada", lastName: "" })).toBe("Ada");
    expect(displayName({ firstName: "Ada", lastName: "Lovelace" })).toBe(
      "Ada Lovelace",
    );
  });
});
