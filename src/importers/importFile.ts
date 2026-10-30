import { create } from 'zustand';
import { copiesOf } from '@/model/copies';
import { createElement, type BoardElement } from '@/model/element';
import { initialImageBox, pictureBox } from '@/media/images';
import { insertMedia, isMediaFile, MEDIA_ACCEPT } from '@/media/mediaFiles';
import { storeImage } from '@/media/storeImage';
import { boardDoc, useBoardStore } from '@/state/boardStore';
import { framesInOrder, slidePatches } from '@/workshop/presentation';

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

/**
 * Where the next imported file goes: under the last one, when several are imported
 * together, so they make a column rather than a pile.
 */
let below: { x: number; y: number } | null = null;

/** Starts a fresh batch: the next import is centred in view again. */
export function startImportBatch(): void {
  below = null;
}

function place(elements: BoardElement[]): BoardElement[] {
  const store = useBoardStore.getState();
  const minX = Math.min(...elements.map((element) => element.x));
  const minY = Math.min(...elements.map((element) => element.y));
  const maxX = Math.max(...elements.map((element) => element.x + element.w));
  const maxY = Math.max(...elements.map((element) => element.y + element.h));
  const centre = viewCentre();
  const target = below ?? { x: centre.x - (maxX - minX) / 2, y: centre.y - (maxY - minY) / 2 };
  const placed = copiesOf(elements, target, store.elements.at(-1)?.z ?? null);
  store.addElements(placed);
  below = { x: target.x, y: target.y + (maxY - minY) + PAGE_GAP };
  return placed;
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
  // Each page is a slide: a frame holding the page's picture, named for the page and
  // numbered after the frames already on the board, so presenting walks through it.
  const elements: BoardElement[] = [];
  const name = file.name.replace(/\.pdf$/i, '');
  let y = 0;
  for (const [index, page] of pages.entries()) {
    const image = await storeImage(page);
    const box = initialImageBox(image, 800);
    const frame = createElement({ type: 'frame', box: { x: 0, y, ...box }, z: 'a0' });
    frame.text = pages.length > 1 ? `${name} · ${index + 1}` : name;
    const picture = createElement({ type: 'image', box: { x: 0, y, ...box }, z: 'a0' });
    picture.image = image;
    elements.push(frame, picture);
    y += box.h + PAGE_GAP;
  }
  if (elements.length === 0) return;
  const placed = place(elements);
  const store = useBoardStore.getState();
  const before = framesInOrder(store.elements).filter(
    (frame) => !placed.some((each) => each.id === frame.id),
  );
  const added = placed.filter((element) => element.type === 'frame');
  store.applyDiscrete(slidePatches([...before, ...added].map((frame) => frame.id)));
}

async function importImage(file: File) {
  const image = await storeImage(file);
  const element = createElement({
    type: 'image',
    box: { x: 0, y: 0, ...pictureBox(image, useBoardStore.getState().stageSize.height) },
    z: 'a0',
  });
  element.image = image;
  place([element]);
}

/** A video or a sound, in the column with whatever else came in with it. */
async function importMedia(file: File) {
  const element = await insertMedia(file);
  if (!element) return;
  const at = below ?? { x: element.x, y: element.y };
  if (below) useBoardStore.getState().applyDiscrete(new Map([[element.id, at]]));
  below = { x: at.x, y: at.y + element.h + PAGE_GAP };
}

/** What the Import button offers to open. */
export const IMPORT_ACCEPT = [
  ...RASTER_TYPES,
  '.png,.jpg,.jpeg,.webp,.gif,.avif',
  '.svg',
  'image/svg+xml',
  '.pdf',
  'application/pdf',
  MEDIA_ACCEPT,
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
 * be edited, a PDF as a numbered frame per page, a video or a sound as something to
 * play. Anything else is refused, with a reason.
 */
export async function importFile(file: File): Promise<void> {
  if (boardDoc().readOnly) return;
  useImport.setState({ status: `Importing ${file.name}…`, error: null });
  try {
    if (isSvgFile(file)) await importSvg(file);
    else if (isPdfFile(file)) await importPdf(file);
    else if (isRasterImage(file)) await importImage(file);
    else if (isMediaFile(file)) await importMedia(file);
    else throw new Error(`${file.name} is not a picture, an SVG, a PDF, a video or a sound.`);
    useImport.setState({ status: null });
  } catch (error) {
    useImport.setState({ status: null, error: (error as Error).message });
  }
}
