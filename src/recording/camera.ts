import { create } from 'zustand';

/**
 * The presenter's camera on the slide, in presenter view: where it sits, how big it is
 * and its shape. It is the presenter's own, like the board's camera, so it is kept in
 * this browser rather than in the board. Positions are fractions of the slide, so the
 * camera sits in the same place on the presenter's slide and the audience window's,
 * whatever the two windows' sizes.
 */
export type CameraShape = 'circle' | 'square' | 'wide';

export const CAMERA_SHAPES: ReadonlyArray<{ shape: CameraShape; label: string }> = [
  { shape: 'circle', label: 'Circle' },
  { shape: 'square', label: 'Rounded square' },
  { shape: 'wide', label: 'Wide rectangle' },
];

export interface CameraLayout {
  /** Left and top edges, as fractions of the slide's width and height. */
  x: number;
  y: number;
  /** Width, as a fraction of the slide's width. */
  w: number;
  shape: CameraShape;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Height over width, on screen. */
export const ASPECT: Record<CameraShape, number> = { circle: 1, square: 1, wide: 9 / 16 };

/** Smallest and largest, as a fraction of the slide's width. */
export const MIN_W = 0.06;
export const MAX_W = 0.9;

export const DEFAULT_LAYOUT: CameraLayout = { x: 0.76, y: 0.62, w: 0.2, shape: 'circle' };

const KEY = 'sabboura:camera-layout';

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : low));

/**
 * Keeps a layout whole and on the slide: a width within bounds, and the box inside
 * the slide's edges for a slide of this shape (height over width).
 */
export function tidyLayout(layout: Partial<CameraLayout>, slideAspect = 9 / 16): CameraLayout {
  const shape = CAMERA_SHAPES.some((each) => each.shape === layout.shape)
    ? layout.shape!
    : DEFAULT_LAYOUT.shape;
  let w = clamp(layout.w ?? DEFAULT_LAYOUT.w, MIN_W, MAX_W);
  // As a fraction of the slide's height, the box is this tall.
  let h = (w * ASPECT[shape]) / slideAspect;
  if (h > 1) {
    w = slideAspect / ASPECT[shape];
    h = 1;
  }
  return {
    shape,
    w,
    x: clamp(layout.x ?? DEFAULT_LAYOUT.x, 0, 1 - w),
    y: clamp(layout.y ?? DEFAULT_LAYOUT.y, 0, 1 - h),
  };
}

/** Where the camera goes on a slide shown at this rectangle (any units). */
export function cameraRect(layout: CameraLayout, slide: Rect): Rect {
  const w = layout.w * slide.w;
  return {
    x: slide.x + layout.x * slide.w,
    y: slide.y + layout.y * slide.h,
    w,
    h: w * ASPECT[layout.shape],
  };
}

/** Corner rounding, in CSS. */
export function cameraRadius(shape: CameraShape): string {
  return shape === 'circle' ? '50%' : '14%';
}

function load(): CameraLayout {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return tidyLayout(JSON.parse(stored) as Partial<CameraLayout>);
  } catch {
    // Unreadable or refused: the default.
  }
  return DEFAULT_LAYOUT;
}

interface CameraStore {
  layout: CameraLayout;
  /** The camera, while it is on (presenter view's Camera switch). */
  stream: MediaStream | null;
  /** The microphone, while it is on. */
  mic: MediaStream | null;
  /** Record the slides' own sound too — videos, sounds and celebrations on them. */
  slideSound: boolean;
  /** Why the camera or microphone could not be had, to say so. */
  problem: string | null;
}

export const useCamera = create<CameraStore>(() => ({
  layout: typeof localStorage === 'undefined' ? DEFAULT_LAYOUT : load(),
  stream: null,
  mic: null,
  slideSound: true,
  problem: null,
}));

export function setCameraLayout(next: Partial<CameraLayout>, slideAspect?: number): void {
  const layout = tidyLayout({ ...useCamera.getState().layout, ...next }, slideAspect);
  useCamera.setState({ layout });
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // It still works; it is just not remembered.
  }
}

const stopAll = (stream: MediaStream | null) =>
  stream?.getTracks().forEach((track) => track.stop());

const reason = (error: unknown, what: string) =>
  error instanceof DOMException && error.name === 'NotAllowedError'
    ? `The browser was not allowed to use the ${what}. Allow it from the address bar, then try again.`
    : error instanceof DOMException && error.name === 'NotFoundError'
      ? `No ${what} was found.`
      : `The ${what} could not be started.`;

/** Turns the camera on or off. */
export async function setCameraOn(on: boolean): Promise<void> {
  stopAll(useCamera.getState().stream);
  useCamera.setState({ stream: null, problem: null });
  if (!on) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    useCamera.setState({ stream });
  } catch (error) {
    useCamera.setState({ problem: reason(error, 'camera') });
  }
}

/** Turns the microphone on or off. It is never played back here, only recorded. */
export async function setMicOn(on: boolean): Promise<void> {
  stopAll(useCamera.getState().mic);
  useCamera.setState({ mic: null, problem: null });
  if (!on) return;
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    useCamera.setState({ mic });
  } catch (error) {
    useCamera.setState({ problem: reason(error, 'microphone') });
  }
}

/** Presenter view is over: the camera and microphone go off. */
export function releaseDevices(): void {
  const { stream, mic } = useCamera.getState();
  stopAll(stream);
  stopAll(mic);
  useCamera.setState({ stream: null, mic: null, problem: null });
}
