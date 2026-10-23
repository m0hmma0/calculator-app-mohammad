import { create } from 'zustand';
import { copiesOf } from '@/model/copies';
import { createElement, type BoardElement } from '@/model/element';
import { initialImageBox } from '@/media/images';
import { storeImage } from '@/media/storeImage';
import { boardDoc, useBoardStore } from '@/state/boardStore';

/** What an import is doing, for the status line: "Page 3 of 12", or what went wrong. */
export const useImport = create<{ status: string | null; error: string | null }>(() => ({
  status: null,
  error: null,
}));

const PAGE_GAP = 40;
const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'] as const;

function viewCentre() {
  const { viewport, stageSize } = useBoardStore.getState();
  return {
    x: viewport.x + stageSize.width / (2 * viewport.zoom),
    y: viewport.y + stageSize.height / (2 * viewport.zoom),
  };
}

function place(elements: BoardElement[]) {
  const store = useBoardStore.getState();
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.w));
  const maxY = Math.max(...elements.map((element) => element.y + element.h));
  const centre = viewCentre();
  const target = { x: centre.x - (maxX - minX) / 2, y: centre.y - (maxY - minY) / 2 };
  store.addElements(copiesOf(elements, target, store.elements.at(-1)?.z ?? null));
}

async function importSvg(file: File) {
  const { svgToElements } = await import('./svg');
  place(svgToElements(await file.text()));
}

async function importPdf(file: File) {
  const { pdfToImages } = await import('./pdf');
  useImport.setState({ status: 'Opening the PDF…' });
  const pages = await pdfToImages(file, (done, total) =>
    useImport.setState({ status: `Page ${done} of ${total}…` }),
  );
  const elements: BoardElement[] = [];
  let y = 0;
  for (const page of pages) {
    const image = await storeImage(page);
    const box = initialImageBox(image, 800);
    const element = createElement({ type: 'image', box: { x: 0, y, ...box }, z: 'a0' });
    element.image = image;
    elements.push(element);
    y += box.h + PAGE_GAP;
  }
  if (elements.length > 0) place(elements);
}

async function importImage(file: File) {
  const image = await storeImage(file);
  const element = createElement({
    type: 'image',
    box: { x: 0, y: 0, ...initialImageBox(image) },
    z: 'a0',
  });
  element.image = image;
  place([element]);
}

/** What the Import button offers to open. */
export const IMPORT_ACCEPT = [
  ...RASTER_TYPES,
  '.png,.jpg,.jpeg,.webp,.gif,.avif',
  '.svg',
  'image/svg+xml',
  '.pdf',
  'application/pdf',
].join(',');

export const isSvgFile = (file: File) =>
  file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
export const isPdfFile = (file: File) =>
  file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

/** A picture: stored as it is, like a pasted or dropped one. */
export const isRasterImage = (file: File) =>
  (RASTER_TYPES as readonly string[]).includes(file.type) ||
  /\.(png|jpe?g|webp|gif|avif)$/i.test(file.name);

/**
 * Any file the board understands: a picture as a picture, an SVG as shapes that can
 * be edited, a PDF as a picture per page. Anything else is refused, with a reason.
 */
export async function importFile(file: File): Promise<void> {
  if (boardDoc().readOnly) return;
  useImport.setState({ status: `Importing ${file.name}…`, error: null });
  try {
    if (isSvgFile(file)) await importSvg(file);
    else if (isPdfFile(file)) await importPdf(file);
    else if (isRasterImage(file)) await importImage(file);
    else throw new Error(`${file.name} is not a picture, an SVG or a PDF.`);
    useImport.setState({ status: null });
  } catch (error) {
    useImport.setState({ status: null, error: (error as Error).message });
  }
}
