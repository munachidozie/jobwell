import { describe, expect, it } from "vitest";
import {
  parseCustomSource,
  validateCustomConfig,
} from "./customSource";
import type { CustomSourceConfig } from "./storage";

describe("validateCustomConfig", () => {
  it("requires https url", () => {
    expect(validateCustomConfig({ url: "http://x.com", format: "rss" })).toMatch(
      /https/,
    );
  });
  it("requires a known format", () => {
    expect(
      // @ts-expect-error bad format on purpose
      validateCustomConfig({ url: "https://x.com", format: "xml" }),
    ).toMatch(/format/i);
  });
  it("json needs a title mapping", () => {
    expect(
      validateCustomConfig({
        url: "https://x.com",
        format: "json",
        mapping: { itemsPath: "", title: "" },
      }),
    ).toMatch(/title/i);
  });
  it("accepts a valid rss config", () => {
    expect(
      validateCustomConfig({ url: "https://x.com/feed", format: "rss" }),
    ).toBeNull();
  });
});

describe("parseCustomSource — RSS", () => {
  const cfg: CustomSourceConfig = {
    url: "https://x.com/feed",
    format: "rss",
    defaultWorkModel: "remote",
  };
  const xml = `
    <rss><channel>
      <item>
        <title>Senior Solidity Engineer</title>
        <link>https://jobs.example/1</link>
        <description><![CDATA[Build <b>web3</b> contracts. Remote.]]></description>
        <pubDate>Wed, 22 Oct 2025 10:00:00 GMT</pubDate>
        <guid>abc-1</guid>
      </item>
      <item>
        <title>Rust Protocol Developer</title>
        <link>https://jobs.example/2</link>
        <description>Core protocol work.</description>
      </item>
    </channel></rss>`;

  it("extracts items with title/link/description", () => {
    const jobs = parseCustomSource(cfg, { text: xml }, "cryptojobs", "NOW");
    expect(jobs).toHaveLength(2);
    expect(jobs[0].title).toBe("Senior Solidity Engineer");
    expect(jobs[0].url).toBe("https://jobs.example/1");
    expect(jobs[0].description).toContain("web3");
    expect(jobs[0].workModel).toBe("remote"); // from defaultWorkModel
    expect(jobs[0].provider).toBe("custom");
    expect(jobs[0].id).toContain("custom:cryptojobs:");
  });

  it("skips items without a title", () => {
    const jobs = parseCustomSource(
      cfg,
      { text: "<rss><channel><item><link>x</link></item></channel></rss>" },
      "k",
      "NOW",
    );
    expect(jobs).toHaveLength(0);
  });
});

describe("parseCustomSource — JSON", () => {
  const cfg: CustomSourceConfig = {
    url: "https://api.example/jobs",
    format: "json",
    mapping: {
      itemsPath: "data.results",
      title: "name",
      company: "org.name",
      location: "where",
      url: "apply_url",
      description: "body",
    },
  };
  const json = {
    data: {
      results: [
        {
          name: "Backend Engineer",
          org: { name: "Acme" },
          where: "Remote - Worldwide",
          apply_url: "https://a.co/1",
          body: "<p>Great role</p>",
        },
        { name: "", org: { name: "Skip" } }, // no title → skipped
      ],
    },
  };

  it("maps nested JSON fields by dot-path", () => {
    const jobs = parseCustomSource(cfg, { json }, "acmeapi", "NOW");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].title).toBe("Backend Engineer");
    expect(jobs[0].company).toBe("Acme");
    expect(jobs[0].location).toBe("Remote - Worldwide");
    expect(jobs[0].url).toBe("https://a.co/1");
    expect(jobs[0].description).toBe("Great role");
  });

  it("handles response-is-array (empty itemsPath)", () => {
    const flatCfg: CustomSourceConfig = {
      ...cfg,
      mapping: { itemsPath: "", title: "name" },
    };
    const jobs = parseCustomSource(
      flatCfg,
      { json: [{ name: "Role A" }, { name: "Role B" }] },
      "k",
      "NOW",
    );
    expect(jobs.map((j) => j.title)).toEqual(["Role A", "Role B"]);
  });

  it("is deterministic", () => {
    const a = parseCustomSource(cfg, { json }, "k", "NOW");
    const b = parseCustomSource(cfg, { json }, "k", "NOW");
    expect(a).toEqual(b);
  });
});
