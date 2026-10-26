import type { JobWellApi } from "@shared/types";

declare global {
  interface Window {
    jobwell: JobWellApi;
  }
}

export {};
