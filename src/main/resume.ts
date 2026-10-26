import { dialog } from "electron";
import { readFile } from "node:fs/promises";
import { extname, basename } from "node:path";

// Extract plain text from a resume file. PDF and DOCX are parsed with
// dedicated libraries; .txt is read directly. Returns null if the user
// cancels the dialog.
export async function pickAndExtractResume(): Promise<{
  fileName: string;
  text: string;
} | null> {
  const result = await dialog.showOpenDialog({
    title: "Import resume",
    properties: ["openFile"],
    filters: [
      { name: "Resume", extensions: ["pdf", "docx", "txt"] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const text = await extractText(filePath);
  return { fileName: basename(filePath), text };
}

export async function extractText(filePath: string): Promise<string> {
  const ext = extname(filePath).toLowerCase();
  if (ext === ".txt") {
    return (await readFile(filePath, "utf8")).trim();
  }
  if (ext === ".docx") {
    // Lazy import keeps startup fast and avoids loading the parser unless used.
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ path: filePath });
    return value.trim();
  }
  if (ext === ".pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const buf = await readFile(filePath);
    const data = await pdfParse(buf);
    return data.text.trim();
  }
  throw new Error(`Unsupported resume format: ${ext}`);
}
