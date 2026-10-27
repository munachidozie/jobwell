import { describe, expect, it } from "vitest";
import { SqliteStorage } from "./SqliteStorage";
import type { Job } from "@shared/types";

function makeStorage() {
  return SqliteStorage.create({ memory: true, appVersion: "test" });
}

function job(id: string): Job {
  return {
    id,
    provider: "greenhouse",
    board: "acme",
    company: "Acme",
    title: "Engineer",
    location: "Remote",
    workModel: "remote",
    url: "https://example.com",
    postedAt: null,
    description: "typescript react",
    fetchedAt: new Date().toISOString(),
  };
}

describe("SqliteStorage basics", () => {
  it("saves and reads the profile", async () => {
    const s = await makeStorage();
    expect(await s.getProfile()).toBeNull();
    await s.saveProfile({
      jobFunction: ["Engineer", "Backend Engineer"],
      level: "senior",
      location: "Remote",
      skills: ["typescript"],
      industries: ["fintech"],
      yearsExperience: 6,
      baseCountry: "nigeria",
      workAuthorizations: [],
      supplementaryFacts: ["Led a migration to TypeScript."],
    });
    const p = await s.getProfile();
    expect(p?.level).toBe("senior");
    expect(p?.skills).toEqual(["typescript"]);
    expect(p?.jobFunction).toEqual(["Engineer", "Backend Engineer"]);
    expect(p?.baseCountry).toBe("nigeria");
    expect(p?.supplementaryFacts).toEqual(["Led a migration to TypeScript."]);
  });

  it("migrates a legacy single-string jobFunction to a one-element array", async () => {
    const s = await makeStorage();
    // Simulate an old DB row where jobFunction was stored as plain TEXT.
    await s.saveProfile({
      jobFunction: ["Engineer"],
      level: "mid",
      location: "Remote",
      skills: [],
      industries: [],
      yearsExperience: 3,
      baseCountry: "",
      workAuthorizations: [],
      supplementaryFacts: [],
    });
    // Overwrite the column with a raw legacy value, bypassing saveProfile.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s as any).db.run("UPDATE profile SET jobFunction = 'Data Analyst' WHERE id = 1");
    const p = await s.getProfile();
    expect(p?.jobFunction).toEqual(["Data Analyst"]);
  });

  it("persists supplementary facts across add and remove round-trips", async () => {
    const s = await makeStorage();
    await s.saveProfile({
      jobFunction: ["Engineer"],
      level: "mid",
      location: "Remote",
      skills: ["typescript"],
      industries: ["fintech"],
      yearsExperience: 5,
      baseCountry: "nigeria",
      workAuthorizations: [],
      supplementaryFacts: [],
    });

    // Add two facts by rewriting the profile (mirrors JobService.addSupplementaryFact).
    const base = await s.getProfile();
    expect(base?.supplementaryFacts).toEqual([]);
    const { id: _id, ...rest } = base!;
    await s.saveProfile({
      ...rest,
      supplementaryFacts: ["Led a team of 4.", "Deployed to Kubernetes."],
    });

    // A fresh read reflects what was saved.
    const afterAdd = await s.getProfile();
    expect(afterAdd?.supplementaryFacts).toEqual([
      "Led a team of 4.",
      "Deployed to Kubernetes.",
    ]);

    // Remove one.
    const { id: _id2, ...rest2 } = afterAdd!;
    await s.saveProfile({
      ...rest2,
      supplementaryFacts: afterAdd!.supplementaryFacts.filter(
        (f) => f !== "Led a team of 4.",
      ),
    });
    const afterRemove = await s.getProfile();
    expect(afterRemove?.supplementaryFacts).toEqual(["Deployed to Kubernetes."]);
  });

  it("upsert ignores duplicates by id", async () => {
    const s = await makeStorage();
    expect(await s.upsertJobs([job("a"), job("b")])).toBe(2);
    expect(await s.upsertJobs([job("a"), job("c")])).toBe(1); // only c is new
    expect((await s.listJobs()).length).toBe(3);
  });

  it("tracks application status", async () => {
    const s = await makeStorage();
    await s.upsertJobs([job("a")]);
    await s.setApplicationStatus("a", "Applied", "sent");
    const apps = await s.listApplications();
    expect(apps[0].status).toBe("Applied");
    expect(apps[0].notes).toBe("sent");
    expect(apps[0].reminderAt).toBeNull();
  });

  it("sets and clears a follow-up reminder, preserving it across status changes", async () => {
    const s = await makeStorage();
    await s.upsertJobs([job("a")]);
    await s.setApplicationStatus("a", "Applied", "sent");
    const withRem = await s.setReminder("a", "2026-11-10T09:00:00.000Z");
    expect(withRem.reminderAt).toBe("2026-11-10T09:00:00.000Z");
    // Changing status must not wipe the reminder.
    const afterStatus = await s.setApplicationStatus("a", "Interviewing");
    expect(afterStatus.reminderAt).toBe("2026-11-10T09:00:00.000Z");
    // Clearing works.
    const cleared = await s.setReminder("a", null);
    expect(cleared.reminderAt).toBeNull();
  });

  it("manages custom job sources", async () => {
    const s = await makeStorage();
    await s.addJobSource({
      provider: "workable",
      board: "mycompany",
      label: "My Co",
      enabled: true,
    });
    const sources = await s.listJobSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].board).toBe("mycompany");
  });

  it("logs status transitions but not notes-only edits, and clears on untrack", async () => {
    const s = await makeStorage();
    await s.upsertJobs([job("a")]);
    await s.setApplicationStatus("a", "Applied");
    await s.setApplicationStatus("a", "Applied", "left a note"); // notes only
    await s.setApplicationStatus("a", "Interviewing");
    await s.setApplicationStatus("a", "Offer");

    const hist = await s.listStatusHistory();
    // Applied (once), Interviewing, Offer — the notes-only edit is not logged.
    expect(hist.map((h) => h.status)).toEqual([
      "Applied",
      "Interviewing",
      "Offer",
    ]);

    await s.deleteApplication("a");
    expect(await s.listStatusHistory()).toHaveLength(0);
  });

  it("imports, dedupes, and removes network contacts", async () => {
    const s = await makeStorage();
    const stored = await s.replaceContacts([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        company: "Analytical Engines",
        position: "Engineer",
        profileUrl: "https://linkedin.com/in/ada",
        email: "",
        connectedOn: "2023-01-15",
      },
      {
        firstName: "Grace",
        lastName: "Hopper",
        company: "US Navy",
        position: "Rear Admiral",
        profileUrl: "https://linkedin.com/in/grace",
        email: "grace@navy.mil",
        connectedOn: "2022-03-02",
      },
    ]);
    expect(stored).toBe(2);

    // Re-adding Ada (same profile URL) must not create a duplicate.
    const added = await s.addContacts([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        company: "Analytical Engines",
        position: "Lead Engineer", // updated title
        profileUrl: "https://linkedin.com/in/ada/", // trailing slash
        email: "",
        connectedOn: "2023-01-15",
      },
    ]);
    expect(added).toBe(0);
    const all = await s.listContacts();
    expect(all).toHaveLength(2);
    const ada = all.find((c) => c.firstName === "Ada")!;
    expect(ada.position).toBe("Lead Engineer"); // upsert updated it

    await s.deleteContact(ada.id);
    expect(await s.listContacts()).toHaveLength(1);

    await s.clearContacts();
    expect(await s.listContacts()).toHaveLength(0);
  });

  it("caches and reads FX rates", async () => {
    const s = await makeStorage();
    expect(await s.getFxRates()).toBeNull();
    await s.saveFxRates({
      base: "USD",
      rates: { USD: 1, NGN: 1334.3, GBP: 0.79 },
      fetchedAt: "2026-10-26T00:00:00.000Z",
      date: "2026-10-26",
    });
    const fx = await s.getFxRates();
    expect(fx?.rates.NGN).toBe(1334.3);
    expect(fx?.date).toBe("2026-10-26");
  });
});

describe("export / import round-trip (the 'never start over' guarantee)", () => {
  it("exports everything and reimports into a fresh store identically", async () => {
    const a = await makeStorage();
    await a.saveProfile({
      jobFunction: ["Engineer"],
      level: "mid",
      location: "Berlin",
      skills: ["go", "sql"],
      industries: ["payments"],
      yearsExperience: 4,
      baseCountry: "germany",
      workAuthorizations: ["eu"],
      supplementaryFacts: [],
    });
    await a.upsertJobs([job("a"), job("b")]);
    await a.setApplicationStatus("a", "Interviewing", "round 2");
    await a.createSavedSearch("Remote Go", { text: "go" }, true);
    await a.saveResume("cv.pdf", "Built Go services with SQL.");
    await a.addJobSource({
      provider: "lever",
      board: "coolco",
      label: null,
      enabled: true,
    });
    await a.replaceContacts([
      {
        firstName: "Ada",
        lastName: "Lovelace",
        company: "Stripe",
        position: "Engineer",
        profileUrl: "https://linkedin.com/in/ada",
        email: "",
        connectedOn: "2023-01-15",
      },
    ]);

    const bundle = await a.exportAll();
    expect(bundle.app).toBe("jobwell");
    expect(bundle.schemaVersion).toBe(2);
    expect(bundle.data.contacts).toHaveLength(1);

    // Import into a brand-new store (simulating another device).
    const b = await makeStorage();
    const summary = await b.importAll(bundle, "replace");

    expect(summary.profileImported).toBe(true);
    expect(summary.jobsImported).toBe(2);
    expect(summary.resumeImported).toBe(true);
    expect(summary.contactsImported).toBe(1);

    const p = await b.getProfile();
    expect(p?.location).toBe("Berlin");
    expect(p?.skills).toEqual(["go", "sql"]);
    expect((await b.listJobs()).length).toBe(2);
    expect((await b.listApplications())[0].status).toBe("Interviewing");
    expect((await b.listSavedSearches())[0].name).toBe("Remote Go");
    expect((await b.getResume())?.fileName).toBe("cv.pdf");
    expect((await b.listJobSources())[0].board).toBe("coolco");
    expect((await b.listContacts())[0].company).toBe("Stripe");
  });

  it("rejects a non-JobWell file", async () => {
    const s = await makeStorage();
    await expect(
      // @ts-expect-error intentionally wrong shape
      s.importAll({ app: "somethingelse", data: {} }, "merge"),
    ).rejects.toThrow();
  });
});
