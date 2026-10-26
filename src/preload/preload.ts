import { contextBridge, ipcRenderer } from "electron";
import type {
  AiConfigInput,
  Application,
  ApplicationStatus,
  BoardRef,
  CustomSourceConfigDTO,
  JobFilter,
  JobWellApi,
  JobWithMatch,
  Profile,
} from "@shared/types";

// Expose a narrow, typed API to the renderer. No Node or ipcRenderer access
// leaks to the page — only these named calls.
const api: JobWellApi = {
  getProfile: () => ipcRenderer.invoke("profile:get"),
  saveProfile: (profile: Omit<Profile, "id">) =>
    ipcRenderer.invoke("profile:save", profile),
  addSupplementaryFact: (fact: string) =>
    ipcRenderer.invoke("profile:addFact", fact),
  removeSupplementaryFact: (fact: string) =>
    ipcRenderer.invoke("profile:removeFact", fact),
  listJobs: (): Promise<JobWithMatch[]> => ipcRenderer.invoke("jobs:list"),
  listStatusHistory: () => ipcRenderer.invoke("status:history"),
  getFxStatus: () => ipcRenderer.invoke("fx:status"),
  refreshJobs: (boards?: BoardRef[]) =>
    ipcRenderer.invoke("jobs:refresh", boards),
  setApplicationStatus: (
    jobId: string,
    status: ApplicationStatus,
    notes?: string,
  ): Promise<Application> =>
    ipcRenderer.invoke("application:set", jobId, status, notes),
  setReminder: (jobId: string, reminderAt: string | null): Promise<Application> =>
    ipcRenderer.invoke("application:reminder", jobId, reminderAt),
  untrack: (jobId: string): Promise<void> =>
    ipcRenderer.invoke("application:untrack", jobId),
  listSavedSearches: () => ipcRenderer.invoke("savedSearch:list"),
  createSavedSearch: (name: string, filter: JobFilter, alert: boolean) =>
    ipcRenderer.invoke("savedSearch:create", name, filter, alert),
  deleteSavedSearch: (id: number) =>
    ipcRenderer.invoke("savedSearch:delete", id),
  markSavedSearchSeen: (id: number) =>
    ipcRenderer.invoke("savedSearch:markSeen", id),
  importResume: () => ipcRenderer.invoke("resume:import"),
  getResume: () => ipcRenderer.invoke("resume:get"),
  analyzeResume: () => ipcRenderer.invoke("resume:analyze"),
  tailorForJob: (jobId: string) => ipcRenderer.invoke("resume:tailor", jobId),
  importContacts: (mode: "replace" | "merge") =>
    ipcRenderer.invoke("contacts:import", mode),
  importContactsFromText: (csvText: string, mode: "replace" | "merge") =>
    ipcRenderer.invoke("contacts:importText", csvText, mode),
  listContacts: () => ipcRenderer.invoke("contacts:list"),
  whoToMessage: () => ipcRenderer.invoke("contacts:whoToMessage"),
  deleteContact: (id: number) => ipcRenderer.invoke("contacts:delete", id),
  clearContacts: () => ipcRenderer.invoke("contacts:clear"),
  draftOutreach: (contactId: number) =>
    ipcRenderer.invoke("contacts:draftOutreach", contactId),
  prepInterview: (jobId: string) =>
    ipcRenderer.invoke("interview:prep", jobId),
  generateCoverLetter: (jobId: string, gapFacts?: string[]) =>
    ipcRenderer.invoke("ai:coverLetter", jobId, gapFacts),
  getAiConfig: () => ipcRenderer.invoke("ai:getConfig"),
  setAiConfig: (config: AiConfigInput) =>
    ipcRenderer.invoke("ai:setConfig", config),
  askAssistant: (question: string) => ipcRenderer.invoke("ai:ask", question),
  getExtensionPairing: () => ipcRenderer.invoke("extension:pairing"),
  listJobSources: () => ipcRenderer.invoke("sources:list"),
  addJobSource: (source: {
    provider: string;
    board: string;
    label: string | null;
    enabled: boolean;
    custom?: CustomSourceConfigDTO | null;
  }) => ipcRenderer.invoke("sources:add", source),
  deleteJobSource: (id: number) => ipcRenderer.invoke("sources:delete", id),
  validateCustomSource: (cfg: CustomSourceConfigDTO) =>
    ipcRenderer.invoke("sources:validateCustom", cfg),
  exportData: (passphrase?: string) =>
    ipcRenderer.invoke("data:export", passphrase),
  importData: (mode: "merge" | "replace", passphrase?: string) =>
    ipcRenderer.invoke("data:import", mode, passphrase),
  deleteAllData: () => ipcRenderer.invoke("data:deleteAll"),
  exportDocument: (
    format: "pdf" | "docx",
    title: string,
    body: string,
    suggestedName: string,
  ) => ipcRenderer.invoke("doc:export", format, title, body, suggestedName),
};

contextBridge.exposeInMainWorld("jobwell", api);
