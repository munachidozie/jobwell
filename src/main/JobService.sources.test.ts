import { describe, expect, it } from "vitest";
import { SqliteStorage } from "./SqliteStorage";
import { JobService } from "./JobService";

// Minimal deps: storage is real (in-memory), the rest are no-op stubs since
// these tests only exercise source seeding + active-board resolution.
async function makeService() {
  const storage = await SqliteStorage.create({ memory: true, appVersion: "test" });
  const service = new JobService({
    storage,
    fetchBoards: async () => [],
    chat: async () => ({ ok: false, text: "", usedProvider: "none" }),
    secrets: { hasApiKey: () => false, storeApiKey: () => {}, clearApiKey: () => {} },
    pickAndExtractResume: async () => null,
    pickAndParseContactsCsv: async () => null,
    fetchFxRates: async () => null,
    fetchCustom: async () => [],
  });
  return { service, storage };
}

const DEFAULTS = [
  { provider: "remoteok", board: "feed", label: "RemoteOK" },
  { provider: "greenhouse", board: "stripe", label: "Stripe" },
];

describe("job source management", () => {
  it("seeds defaults only when empty, never overwriting user changes", async () => {
    const { service } = await makeService();
    await service.seedDefaultSourcesIfEmpty(DEFAULTS);
    expect((await service.listJobSources()).length).toBe(2);

    // Second seed is a no-op (list already populated).
    await service.seedDefaultSourcesIfEmpty([
      { provider: "lever", board: "netflix", label: "Netflix" },
    ]);
    const after = await service.listJobSources();
    expect(after.length).toBe(2);
    expect(after.some((s) => s.board === "netflix")).toBe(false);
  });

  it("getActiveBoards returns only enabled sources", async () => {
    const { service } = await makeService();
    await service.seedDefaultSourcesIfEmpty(DEFAULTS);
    const all = await service.listJobSources();
    const stripe = all.find((s) => s.board === "stripe")!;
    // Disable stripe.
    await service.addJobSource({
      provider: stripe.provider,
      board: stripe.board,
      label: stripe.label,
      enabled: false,
    });
    const active = await service.getActiveBoards();
    expect(active.map((b) => b.board)).toEqual(["feed"]); // only remoteok left
  });

  it("add then remove a source", async () => {
    const { service } = await makeService();
    const added = await service.addJobSource({
      provider: "ashby",
      board: "ramp",
      label: "Ramp",
      enabled: true,
    });
    expect((await service.listJobSources()).length).toBe(1);
    await service.deleteJobSource(added.id);
    expect((await service.listJobSources()).length).toBe(0);
  });
});
