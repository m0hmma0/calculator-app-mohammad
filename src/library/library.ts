import { useEffect, type RefObject } from 'react';
import { create } from 'zustand';
import { api } from '@/api/client';
import { currentIdToken } from '@/auth/session';
import { screenToBoard } from '@/canvas/viewport';
import type { Point } from '@/geometry';
import { copiesOf } from '@/model/copies';
import type { BoardElement } from '@/model/element';
import { useBoardStore } from '@/state/boardStore';

export interface LibraryItem {
  id: string;
  name: string;
  elements: BoardElement[];
  createdAt: number;
}

interface LibraryStore {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
}

export const useLibrary = create<LibraryStore>(() => ({ items: [], loading: false, error: null }));

/** The drag type a library item carries onto the canvas. */
export const LIBRARY_DRAG_TYPE = 'application/x-sabboura-library';

/** Signed out — the local board, or a guest — the library is this browser's own. */
const LOCAL_KEY = 'sabboura:library';

function readLocal(): LibraryItem[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as LibraryItem[];
  } catch {
    return [];
  }
}

function writeLocal(items: LibraryItem[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(items));
  } catch {
    useLibrary.setState({ error: 'This browser would not keep the library.' });
  }
}

const signedIn = async () => (await currentIdToken()) !== null;

export async function loadLibrary(): Promise<void> {
  useLibrary.setState({ loading: true, error: null });
  try {
    const items = (await signedIn()) ? ((await api.library()).items as LibraryItem[]) : readLocal();
    useLibrary.setState({ items, loading: false });
  } catch (error) {
    useLibrary.setState({ loading: false, error: (error as Error).message });
  }
}

/** The selection with everything inside it — a group's children, and theirs. */
function selectionWithChildren(): BoardElement[] {
  const { elements, selection } = useBoardStore.getState();
  const chosen = new Set(selection);
  let grew = true;
  while (grew) {
    grew = false;
    for (const element of elements) {
      if (element.parentId && chosen.has(element.parentId) && !chosen.has(element.id)) {
        chosen.add(element.id);
        grew = true;
      }
    }
  }
  // In stacking order, so the copies stack the same way.
  return elements.filter((element) => chosen.has(element.id));
}

export async function saveSelection(name: string): Promise<boolean> {
  const elements = selectionWithChildren();
  if (elements.length === 0) return false;
  useLibrary.setState({ error: null });
  try {
    if (await signedIn()) {
      const { item } = await api.addToLibrary(name, elements);
      useLibrary.setState((state) => ({ items: [item as LibraryItem, ...state.items] }));
    } else {
      const item: LibraryItem = {
        id: `local-${Date.now().toString(36)}`,
        name: name.trim() || 'Untitled',
        elements,
        createdAt: Date.now(),
      };
      const items = [item, ...readLocal()];
      writeLocal(items);
      useLibrary.setState({ items });
    }
    return true;
  } catch (error) {
    useLibrary.setState({ error: (error as Error).message });
    return false;
  }
}

export async function removeItem(id: string): Promise<void> {
  try {
    if (await signedIn()) await api.removeFromLibrary(id);
    else writeLocal(readLocal().filter((item) => item.id !== id));
    useLibrary.setState((state) => ({ items: state.items.filter((item) => item.id !== id) }));
  } catch (error) {
    useLibrary.setState({ error: (error as Error).message });
  }
}

/** Puts a copy of the item on the board, its top-left corner at `at` — or centred in view. */
export function insertItem(item: LibraryItem, at?: Point): void {
  const store = useBoardStore.getState();
  if (item.elements.length === 0) return;
  const minX = Math.min(...item.elements.map((element) => element.x));
  const minY = Math.min(...item.elements.map((element) => element.y));
  const maxX = Math.max(...item.elements.map((element) => element.x + element.w));
  const maxY = Math.max(...item.elements.map((element) => element.y + element.h));
  const { viewport, stageSize } = store;
  const target = at ?? {
    x: viewport.x + stageSize.width / (2 * viewport.zoom) - (maxX - minX) / 2,
    y: viewport.y + stageSize.height / (2 * viewport.zoom) - (maxY - minY) / 2,
  };
  store.addElements(copiesOf(item.elements, target, store.elements.at(-1)?.z ?? null));
}

/** A library item dragged from the panel lands where it is dropped. */
export function useLibraryDrop(hostRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onDrop = (event: DragEvent) => {
      const id = event.dataTransfer?.getData(LIBRARY_DRAG_TYPE);
      const item = id ? useLibrary.getState().items.find((each) => each.id === id) : undefined;
      if (!item) return;
      event.preventDefault();
      const rect = host.getBoundingClientRect();
      const point = screenToBoard(useBoardStore.getState().viewport, {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      });
      insertItem(item, point);
    };
    host.addEventListener('drop', onDrop);
    return () => host.removeEventListener('drop', onDrop);
  }, [hostRef]);
}
