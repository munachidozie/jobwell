import { dialog } from "electron";
import { readFile } from "node:fs/promises";
import { parseLinkedInCsv, type ContactImportResult } from "@shared/contacts";

// Open a file dialog for a LinkedIn Connections.csv export and parse it.
// Parsing is pure (lives in @shared/contacts); this only handles the Electron
// file picker and reading bytes off disk. Returns null if the user cancels.
export async function pickAndParseContactsCsv(): Promise<ContactImportResult | null> {
  const result = await dialog.showOpenDialog({
    title: "Import LinkedIn connections (Connections.csv)",
    properties: ["openFile"],
    filters: [{ name: "CSV", extensions: ["csv"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const text = await readFile(result.filePaths[0], "utf8");
  return parseLinkedInCsv(text);
}
