import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  AiConfigInput,
  ApplicationStatus,
  JobFilter,
  Profile,
} from "@shared/types";
import type { ImportMode, StoredJobSource } from "@shared/storage";
import { SqliteStorage } from "./SqliteStorage";
import { JobService } from "./JobService";
import { fetchBoards } from "./scrapers";
import { fetchCustom } from "./scrapers/custom";
import { pickAndExtractResume } from "./resume";
import { pickAndParseContactsCsv } from "./contacts";
import { chat, clearApiKey, hasApiKey, storeApiKey } from "./ai";
import { fetchFxRates } from "./fx";
import { decryptBackup, encryptBackup, isEncryptedEnvelope } from "./cryptoBackup";
import { renderDocument } from "./documentExport";
import {
  getLocalPort,
  getPairingToken,
  startLocalServer,
  stopLocalServer,
} from "./localServer";

// Use the Vite dev server ONLY when explicitly in watch/dev mode (the `dev`
// script sets JOBWELL_DEV=1 and runs the server). `pnpm start` builds the
// renderer to dist/ and loads that file — so it must NOT use the dev server,
// even though the app is unpackaged.
const useDevServer = process.env.JOBWELL_DEV === "1";

// The single application-core instance. Built once at startup from a concrete
// Storage (SQLite here). Swapping storage/shell later touches only this wiring.
let service: JobService;

async function createService(): Promise<JobService> {
  const storage = await SqliteStorage.create({
    dataDir: app.getPath("userData"),
    appVersion: app.getVersion(),
  });
  return new JobService({
    storage,
    fetchBoards,
    chat,
    secrets: { hasApiKey, storeApiKey, clearApiKey },
    pickAndExtractResume,
    pickAndParseContactsCsv,
    fetchFxRates,
    fetchCustom,
  });
}

// Resolve the app icon for the window. When packaged, electron-builder ships
// icon.png as an extraResource at resources/icon.png (process.resourcesPath).
// In dev there's no resourcesPath layout, so fall back to the build/ folder in
// the source tree (two levels up from dist/main).
function iconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "icon.png");
  }
  return join(__dirname, "..", "..", "build", "icon.png");
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "JobWell",
    // Window/taskbar icon. Set in code so the running app shows the JobWell
    // icon even when the packaged .exe keeps a default embedded icon (icon
    // embedding via rcedit needs privileges this build host may lack). In dev
    // the path resolves from source; when packaged, icon.png is shipped via
    // electron-builder "files".
    icon: iconPath(),
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (useDevServer) {
    win.loadURL("http://localhost:5273");
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  // Surface a load failure instead of a blank window, so problems are visible.
  win.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Renderer failed to load (${errorCode} ${errorDescription}): ${validatedURL}`,
      );
    },
  );
}

// IPC handlers are thin: they forward to the service. No business logic here.
function registerIpc(): void {
  ipcMain.handle("profile:get", () => service.getProfile());
  ipcMain.handle("profile:save", (_e, p: Omit<Profile, "id">) =>
    service.saveProfile(p),
  );
  ipcMain.handle("profile:addFact", (_e, fact: string) =>
    service.addSupplementaryFact(fact),
  );
  ipcMain.handle("profile:removeFact", (_e, fact: string) =>
    service.removeSupplementaryFact(fact),
  );

  ipcMain.handle("jobs:list", () => service.listJobs());
  ipcMain.handle("status:history", () => service.listStatusHistory());
  ipcMain.handle("fx:status", () => service.getFxStatus());
  // No board list passed — the service fetches the user's enabled sources.
  ipcMain.handle("jobs:refresh", () => service.refreshJobs());

  ipcMain.handle(
    "application:set",
    (_e, jobId: string, status: ApplicationStatus, notes?: string) =>
      service.setApplicationStatus(jobId, status, notes),
  );
  ipcMain.handle(
    "application:reminder",
    (_e, jobId: string, reminderAt: string | null) =>
      service.setReminder(jobId, reminderAt),
  );
  ipcMain.handle("application:untrack", (_e, jobId: string) =>
    service.untrack(jobId),
  );

  ipcMain.handle("savedSearch:list", () => service.listSavedSearches());
  ipcMain.handle(
    "savedSearch:create",
    (_e, name: string, filter: JobFilter, alert: boolean) =>
      service.createSavedSearch(name, filter, alert),
  );
  ipcMain.handle("savedSearch:delete", (_e, id: number) =>
    service.deleteSavedSearch(id),
  );
  ipcMain.handle("savedSearch:markSeen", (_e, id: number) =>
    service.markSavedSearchSeen(id),
  );

  ipcMain.handle("resume:import", () => service.importResume());
  ipcMain.handle("resume:get", () => service.getResume());
  ipcMain.handle("resume:analyze", () => service.analyzeResume());
  ipcMain.handle("resume:tailor", (_e, jobId: string) =>
    service.tailorForJob(jobId),
  );

  // Network (LinkedIn connections import, who-to-message, outreach drafts)
  ipcMain.handle("contacts:import", (_e, mode: "replace" | "merge") =>
    service.importContacts(mode),
  );
  ipcMain.handle(
    "contacts:importText",
    (_e, csvText: string, mode: "replace" | "merge") =>
      service.importContactsFromText(csvText, mode),
  );
  ipcMain.handle("contacts:list", () => service.listContacts());
  ipcMain.handle("contacts:whoToMessage", () => service.whoToMessage());
  ipcMain.handle("contacts:delete", (_e, id: number) =>
    service.deleteContact(id),
  );
  ipcMain.handle("contacts:clear", () => service.clearContacts());
  ipcMain.handle("contacts:draftOutreach", (_e, contactId: number) =>
    service.draftOutreach(contactId),
  );

  // Interview prep
  ipcMain.handle("interview:prep", (_e, jobId: string) =>
    service.prepInterview(jobId),
  );

  ipcMain.handle("ai:getConfig", () => service.getAiConfig());
  ipcMain.handle("ai:setConfig", (_e, config: AiConfigInput) =>
    service.setAiConfig(config),
  );
  ipcMain.handle(
    "ai:coverLetter",
    (_e, jobId: string, gapFacts?: string[]) =>
      service.generateCoverLetter(jobId, gapFacts),
  );
  ipcMain.handle("ai:ask", (_e, question: string) =>
    service.askAssistant(question),
  );

  // Job sources (user-managed board list — groundwork for "add other sources")
  ipcMain.handle("sources:list", () => service.listJobSources());
  ipcMain.handle("sources:add", (_e, s: Omit<StoredJobSource, "id">) =>
    service.addJobSource(s),
  );
  ipcMain.handle("sources:delete", (_e, id: number) =>
    service.deleteJobSource(id),
  );
  ipcMain.handle("sources:validateCustom", (_e, cfg) =>
    service.validateCustomSource(cfg),
  );

  // Portable backup: write an encrypted-in-future, JSON-now bundle to disk.
  // Export: when a passphrase is given, write an encrypted .jobwell file (safe
  // to drop in a synced cloud folder); otherwise a plain .json backup.
  ipcMain.handle(
    "data:export",
    async (
      _e,
      passphrase?: string,
    ): Promise<{ saved: boolean; path?: string; encrypted?: boolean }> => {
      const bundle = await service.exportAll();
      const encrypted = !!passphrase;
      const result = await dialog.showSaveDialog({
        title: "Export JobWell data",
        defaultPath: encrypted ? "jobwell-backup.jobwell" : "jobwell-backup.json",
        filters: encrypted
          ? [{ name: "JobWell encrypted backup", extensions: ["jobwell"] }]
          : [{ name: "JobWell backup", extensions: ["json"] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      const contents = encrypted
        ? JSON.stringify(encryptBackup(bundle, passphrase!), null, 2)
        : JSON.stringify(bundle, null, 2);
      await writeFile(result.filePath, contents, "utf8");
      return { saved: true, path: result.filePath, encrypted };
    },
  );

  // Import: auto-detects encrypted vs plain. If encrypted, the passphrase is
  // required (passed from the renderer prompt).
  ipcMain.handle(
    "data:import",
    async (_e, mode: ImportMode, passphrase?: string) => {
      const result = await dialog.showOpenDialog({
        title: "Import JobWell data",
        properties: ["openFile"],
        filters: [
          { name: "JobWell backup", extensions: ["json", "jobwell"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) return null;
      const raw = await readFile(result.filePaths[0], "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("That file isn't a valid JobWell backup.");
      }
      let bundle = parsed;
      if (isEncryptedEnvelope(parsed)) {
        if (!passphrase) {
          // Signal the renderer that a passphrase is needed for this file.
          return { needsPassphrase: true };
        }
        bundle = decryptBackup(parsed, passphrase); // throws on wrong passphrase
      }
      return service.importAll(bundle as never, mode);
    },
  );

  // Permanently delete all local data (with the renderer confirming first).
  ipcMain.handle("data:deleteAll", () => service.deleteAllData());

  // Export a text document (cover letter / tailored resume) to PDF or DOCX.
  ipcMain.handle(
    "doc:export",
    async (
      _e,
      format: "pdf" | "docx",
      title: string,
      body: string,
      suggestedName: string,
    ): Promise<{ saved: boolean; path?: string }> => {
      const result = await dialog.showSaveDialog({
        title: "Export document",
        defaultPath: `${suggestedName}.${format}`,
        filters:
          format === "pdf"
            ? [{ name: "PDF", extensions: ["pdf"] }]
            : [{ name: "Word document", extensions: ["docx"] }],
      });
      if (result.canceled || !result.filePath) return { saved: false };
      const buf = await renderDocument(format, title, body);
      await writeFile(result.filePath, buf);
      return { saved: true, path: result.filePath };
    },
  );
}

// Default sources seeded on first run — curated for a global-remote seeker.
// The public feeds (RemoteOK, Remotive) need no company slug; a few ATS boards
// add breadth. Users edit this list from the Sources tab afterward.
const DEFAULT_SOURCES = [
  { provider: "remoteok", board: "feed", label: "RemoteOK (global remote)" },
  { provider: "remotive", board: "feed", label: "Remotive (global remote)" },
  { provider: "greenhouse", board: "stripe", label: "Stripe" },
  { provider: "lever", board: "netflix", label: "Netflix" },
  { provider: "ashby", board: "ramp", label: "Ramp" },
];

app.whenReady().then(async () => {
  service = await createService();
  await service.seedDefaultSourcesIfEmpty(DEFAULT_SOURCES);
  registerIpc();
  const port = await startLocalServer(service);
  ipcMain.handle("extension:pairing", () => ({
    port: getLocalPort(),
    token: getPairingToken(),
  }));
  console.log(`JobWell local service on 127.0.0.1:${port}`);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  stopLocalServer();
  if (process.platform !== "darwin") app.quit();
});
