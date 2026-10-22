/**
 * A PDF brought in as one picture per page, laid out in a column. PDF.js is large,
 * so it loads only when someone imports a PDF; it runs on the main thread rather
 * than in a worker, which keeps the single-file preview build working and costs
 * nothing that matters for a one-off import.
 */

/** Pages are drawn this wide, then stored like any other picture. */
const PAGE_WIDTH = 1600;
export const MAX_PDF_PAGES = 50;

export class PdfImportError extends Error {}

async function loadPdfJs() {
  const [pdfjs, worker] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs'),
  ]);
  // PDF.js looks for this before trying to start a worker of its own.
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
  return pdfjs;
}

/** Each page as a PNG, in order. `onPage` reports progress as pages finish. */
export async function pdfToImages(
  file: Blob,
  onPage?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const pdfjs = await loadPdfJs();
  let document;
  try {
    document = await pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      isEvalSupported: false,
    }).promise;
  } catch {
    throw new PdfImportError('That PDF could not be opened.');
  }
  try {
    const total = Math.min(document.numPages, MAX_PDF_PAGES);
    const pages: Blob[] = [];
    for (let number = 1; number <= total; number += 1) {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: PAGE_WIDTH / base.width });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new PdfImportError('This browser cannot draw the PDF.');
      // Pages are paper: white behind whatever the page leaves transparent.
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new PdfImportError(`Page ${number} could not be drawn.`);
      pages.push(blob);
      page.cleanup();
      onPage?.(number, total);
    }
    return pages;
  } finally {
    void document.destroy();
  }
}
