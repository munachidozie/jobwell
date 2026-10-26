import { describe, expect, it } from "vitest";
import {
  containsTerm,
  mentionsRelated,
  relatedTerms,
  roleSimilarity,
} from "./synonyms";

describe("containsTerm (word-boundary aware)", () => {
  it("matches whole tokens, not substrings", () => {
    expect(containsTerm("we use java at work", "java")).toBe(true);
    expect(containsTerm("we use javascript", "java")).toBe(false);
  });
  it("handles punctuated/multi-word terms by inclusion", () => {
    expect(containsTerm("stack: c# and .net", "c#")).toBe(true);
    expect(containsTerm("spring boot microservices", "spring boot")).toBe(true);
  });
});

describe("relatedTerms", () => {
  it("returns the synonym group for a known term", () => {
    expect(relatedTerms("react")).toContain("frontend");
    expect(relatedTerms("k8s")).toContain("kubernetes");
  });
  it("returns just the term itself when unknown", () => {
    expect(relatedTerms("widgetry")).toEqual(["widgetry"]);
  });
});

describe("mentionsRelated", () => {
  it("credits a related term, not just the exact one", () => {
    expect(mentionsRelated("looking for a frontend developer", "react")).toBe(true);
    expect(mentionsRelated("kubernetes experience required", "k8s")).toBe(true);
  });
  it("does not credit unrelated text", () => {
    expect(mentionsRelated("accounting and finance role", "react")).toBe(false);
  });
});

describe("roleSimilarity", () => {
  it("is high for the same role with seniority words", () => {
    expect(roleSimilarity("Software Engineer", "Senior Software Engineer")).toBe(1);
  });
  it("is partial for an overlapping role", () => {
    const s = roleSimilarity("Software Engineer", "Backend Software Engineer");
    expect(s).toBeGreaterThan(0.5);
  });
  it("resolves abbreviations", () => {
    expect(roleSimilarity("SWE", "Software Engineer")).toBeGreaterThan(0.5);
    expect(roleSimilarity("Product Manager", "Senior PM")).toBeGreaterThan(0);
  });
  it("is zero for unrelated roles", () => {
    expect(roleSimilarity("Software Engineer", "Warehouse Associate")).toBe(0);
  });
  it("is deterministic", () => {
    expect(roleSimilarity("Data Scientist", "Senior Data Scientist")).toBe(
      roleSimilarity("Data Scientist", "Senior Data Scientist"),
    );
  });
});
