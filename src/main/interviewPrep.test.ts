import { describe, expect, it } from "vitest";
import { parseInterviewJson } from "./JobService";

describe("parseInterviewJson", () => {
  it("parses a clean JSON object", () => {
    const text = JSON.stringify({
      questions: [
        {
          kind: "behavioral",
          question: "Tell me about a time you shipped under pressure.",
          rationale: "The role mentions tight deadlines.",
        },
      ],
      talkingPoints: ["Led a migration to TypeScript."],
    });
    const r = parseInterviewJson(text)!;
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].kind).toBe("behavioral");
    expect(r.talkingPoints).toEqual(["Led a migration to TypeScript."]);
  });

  it("extracts JSON wrapped in prose / markdown fences", () => {
    const text =
      "Sure! Here is your prep:\n```json\n" +
      '{"questions":[{"kind":"technical","question":"Explain event loops.","rationale":"Node role."}],"talkingPoints":["Built async services."]}' +
      "\n```\nGood luck!";
    const r = parseInterviewJson(text)!;
    expect(r.questions[0].question).toBe("Explain event loops.");
    expect(r.talkingPoints).toEqual(["Built async services."]);
  });

  it("defaults an unknown kind to role-specific and drops empty questions", () => {
    const text = JSON.stringify({
      questions: [
        { kind: "nonsense", question: "Why this company?" },
        { kind: "about-you", question: "   " }, // empty -> dropped
      ],
      talkingPoints: [],
    });
    const r = parseInterviewJson(text)!;
    expect(r.questions).toHaveLength(1);
    expect(r.questions[0].kind).toBe("role-specific");
  });

  it("filters non-string talking points", () => {
    const text = '{"questions":[],"talkingPoints":["real", 42, null, "  "]}';
    const r = parseInterviewJson(text)!;
    expect(r.talkingPoints).toEqual(["real"]);
  });

  it("returns null when there's no JSON", () => {
    expect(parseInterviewJson("no json here")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseInterviewJson("{ not valid json ")).toBeNull();
  });

  it("returns null when both arrays are empty", () => {
    expect(parseInterviewJson('{"questions":[],"talkingPoints":[]}')).toBeNull();
  });
});
