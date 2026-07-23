import { extractText, getDocumentProxy } from 'unpdf';

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_PAGES = 12;

/** Boundary port: PDF decoding stays outside the deterministic parser core. */
export interface DocumentTextExtractor {
  extractPdfText(content: Uint8Array, options?: { password?: string }): Promise<string>;
}

export class PdfTextExtractionError extends Error {
  constructor(
    readonly code:
      | 'PDF_TOO_LARGE'
      | 'PDF_TOO_MANY_PAGES'
      | 'PDF_HAS_NO_TEXT'
      | 'PDF_PASSWORD_REQUIRED'
      | 'PDF_PASSWORD_INVALID'
  ) {
    super(code);
    this.name = 'PdfTextExtractionError';
  }
}

export const unpdfTextExtractor: DocumentTextExtractor = {
  async extractPdfText(content, options) {
    if (content.byteLength > MAX_PDF_BYTES) {
      throw new PdfTextExtractionError('PDF_TOO_LARGE');
    }
    let pdf;
    try {
      pdf = await getDocumentProxy(
        content,
        options?.password ? { password: options.password } : undefined
      );
    } catch (error) {
      const passwordCode =
        typeof error === 'object' && error !== null && 'code' in error ? Number(error.code) : null;
      if (passwordCode === 1) throw new PdfTextExtractionError('PDF_PASSWORD_REQUIRED');
      if (passwordCode === 2) throw new PdfTextExtractionError('PDF_PASSWORD_INVALID');
      throw error;
    }
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new PdfTextExtractionError('PDF_TOO_MANY_PAGES');
    }
    const extracted = await extractText(pdf, { mergePages: true });
    const text = Array.isArray(extracted.text) ? extracted.text.join('\n') : extracted.text;
    if (!text.trim()) throw new PdfTextExtractionError('PDF_HAS_NO_TEXT');
    return text;
  },
};
