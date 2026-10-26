// Minimal typing for the small slice of pdfkit we use. pdfkit ships no types
// and @types/pdfkit pulls in extra deps; this covers our usage.
declare module "pdfkit" {
  interface PDFDocumentOptions {
    size?: string;
    margin?: number;
  }
  class PDFDocument {
    constructor(options?: PDFDocumentOptions);
    on(event: "data", cb: (chunk: Buffer) => void): this;
    on(event: "end", cb: () => void): this;
    on(event: "error", cb: (err: Error) => void): this;
    font(name: string): this;
    fontSize(size: number): this;
    text(text: string, options?: { align?: string; lineGap?: number }): this;
    moveDown(lines?: number): this;
    end(): void;
  }
  export = PDFDocument;
}
