import { extractText, getDocumentProxy } from 'unpdf';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 12;

/** Boundary port: PDF decoding stays outside the deterministic parser core. */
export interface DocumentTextExtractor {
  extractPdfText(content: Uint8Array): Promise<string>;
}

export class PdfTextExtractionError extends Error {
  constructor(readonly code: 'PDF_TOO_LARGE' | 'PDF_TOO_MANY_PAGES' | 'PDF_HAS_NO_TEXT') {
    super(code);
    this.name = 'PdfTextExtractionError';
  }
}

export const unpdfTextExtractor: DocumentTextExtractor = {
  async extractPdfText(content) {
    if (content.byteLength > MAX_PDF_BYTES) {
      throw new PdfTextExtractionError('PDF_TOO_LARGE');
    }
    const pdf = await getDocumentProxy(content);
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new PdfTextExtractionError('PDF_TOO_MANY_PAGES');
    }
    const extracted = await extractText(pdf, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
    if (!text.trim()) throw new PdfTextExtractionError('PDF_HAS_NO_TEXT');
    return text;
  },
};
