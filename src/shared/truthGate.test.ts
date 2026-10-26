import { describe, expect, it } from "vitest";
import { checkTruth, type TruthSources } from "./truthGate";

const sources: TruthSources = {
  resumeText:
    "Software engineer. Built React and TypeScript apps. Worked at Acme Corp. Shipped a feature used by 1000 users.",
  profileSkills: ["react", "typescript", "sql"],
  profileIndustries: ["fintech"],
  jobFunction: "Software Engineer",
  yearsExperience: 5,
  jobTitle: "Senior Frontend Engineer",
  jobCompany: "Globex",
};

describe("checkTruth", () => {
  it("passes a draft that only uses facts from the sources", () => {
    const draft =
      "I am a software engineer with 5 years of experience. I built React and TypeScript applications at Acme Corp.";
    const r = checkTruth(draft, sources);
    expect(r.ok).toBe(true);
    expect(r.violations).toHaveLength(0);
  });

  it("flags a fabricated percentage", () => {
    const draft = "I improved performance by 40% at my last role.";
    const r = checkTruth(draft, sources);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.kind === "percentage" && v.value === "40%")).toBe(
      true,
    );
  });

  it("allows a number that appears in the sources", () => {
    const draft = "I built a feature used by 1000 users.";
    const r = checkTruth(draft, sources);
    expect(r.violations.some((v) => v.value === "1000")).toBe(false);
  });

  it("flags a skill the user never claimed", () => {
    const draft = "I am an expert in Kubernetes and Rust.";
    const r = checkTruth(draft, sources);
    const skillViol = r.violations.filter((v) => v.kind === "skill").map((v) => v.value);
    expect(skillViol).toContain("kubernetes");
    expect(skillViol).toContain("rust");
  });

  it("does not flag skills the user does have", () => {
    const draft = "I use React, TypeScript and SQL daily.";
    const r = checkTruth(draft, sources);
    expect(r.violations.some((v) => v.kind === "skill")).toBe(false);
  });

  it("does not flag a skill the user has under a synonym (k8s ⇒ kubernetes)", () => {
    const synSources = { ...sources, profileSkills: ["k8s", "react"] };
    const draft = "I have strong Kubernetes experience.";
    const r = checkTruth(draft, synSources);
    // "kubernetes" isn't literally in the profile, but "k8s" is a synonym.
    expect(r.violations.some((v) => v.value === "kubernetes")).toBe(false);
  });

  it("still flags a skill with no synonym present", () => {
    const draft = "I am an expert in Rust.";
    const r = checkTruth(draft, sources); // sources has no rust/synonym
    expect(r.violations.some((v) => v.value === "rust")).toBe(true);
  });

  it("guided gap-fill: a user-supplied fact in sources clears the flag", () => {
    const draft = "I am an expert in Rust.";
    // Simulate the gap-fill flow: the user's typed fact is appended to the
    // resume text the gate validates against.
    const withFact = {
      ...sources,
      resumeText: `${sources.resumeText}\nBuilt a CLI tool in Rust for log parsing.`,
    };
    const r = checkTruth(draft, withFact);
    expect(r.violations.some((v) => v.value === "rust")).toBe(false);
  });

  it("allows the job's own company name but flags a fabricated employer", () => {
    const draft =
      "I am excited to apply to Globex. In my time at Initech I led a team.";
    const r = checkTruth(draft, sources);
    // Globex is the job company — allowed.
    expect(r.violations.some((v) => v.value.includes("Globex"))).toBe(false);
    // Initech is not in the resume — flagged.
    expect(
      r.violations.some((v) => v.kind === "proper-noun" && v.value.includes("Initech")),
    ).toBe(true);
  });

  it("allows an employer that is in the resume", () => {
    const draft = "At Acme Corp I shipped features.";
    const r = checkTruth(draft, sources);
    expect(r.violations.some((v) => v.value.includes("Acme"))).toBe(false);
  });

  it("flags a fabricated calendar year", () => {
    const draft = "From 2015 to 2019 I worked abroad.";
    const r = checkTruth(draft, sources);
    expect(r.violations.some((v) => v.kind === "year")).toBe(true);
  });

  it("is deterministic", () => {
    const draft = "I improved things by 30% using Kubernetes in 2020.";
    expect(checkTruth(draft, sources)).toEqual(checkTruth(draft, sources));
  });
});
