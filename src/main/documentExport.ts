import { createRequire } from "node:module";

// Render plain text (a cover letter or tailored resume) to a PDF or DOCX file
// buffer. Both libraries are pure-JS (no native build, no large download),
// consistent with the app's "no toolchain" constraint. Loaded via runtime
// require so bundlers don't choke on their internals.
const req: NodeRequire =
  typeof require === "function"
    ? require
    : createRequire(process.cwd() + "/");

export type ExportFormat = "pdf" | "docx";

// Produce a PDF buffer from a title + body. Simple single-column layout with a
// bold title and paragraphs split on blank lines.
export async function renderPdf(title: string, body: string): Promise<Buffer> {
  const PDFDocument = req("pdfkit") as typeof import("pdfkit");
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 64 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).text(title);
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(11);
    for (const para of splitParagraphs(body)) {
      doc.text(para, { align: "left", lineGap: 2 });
      doc.moveDown(0.6);
    }
    doc.end();
  });
}

// Produce a DOCX buffer from a title + body.
export async function renderDocx(title: string, body: string): Promise<Buffer> {
  const docx = req("docx") as typeof import("docx");
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const paras = [
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun({ text: title, bold: true })],
    }),
    ...splitParagraphs(body).map(
      (p) =>
        new Paragraph({
          children: [new TextRun(p)],
          spacing: { after: 160 },
        }),
    ),
  ];
  const doc = new Document({ sections: [{ children: paras }] });
  return Packer.toBuffer(doc);
}

export async function renderDocument(
  format: ExportFormat,
  title: string,
  body: string,
): Promise<Buffer> {
  return format === "pdf" ? renderPdf(title, body) : renderDocx(title, body);
}

// Split body text into paragraphs on blank lines; collapse single newlines
// within a paragraph into spaces so wrapping is handled by the renderer.
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter((p) => p.length > 0);
}
