import { create } from 'zustand';
import type { CommentRecord, Person } from '@shared/sharing';
import { api } from '@/api/client';

export interface Thread {
  root: CommentRecord;
  replies: CommentRecord[];
}

interface CommentsStore {
  boardId: string | null;
  comments: CommentRecord[];
  people: Person[];
  /** Showing comment pins and the panel. */
  visible: boolean;
  /** The next click on the board starts a thread there. */
  placing: boolean;
  /** Where a new thread is being written, in board coordinates. */
  draftAt: { x: number; y: number } | null;
  openThread: string | null;
  showResolved: boolean;
  error: string | null;

  open: (boardId: string) => Promise<void>;
  close: () => void;
  refresh: () => Promise<void>;
  loadPeople: () => Promise<void>;
  post: (
    body: string,
    mentions: string[],
    where: { threadId: string } | { x: number; y: number },
  ) => Promise<boolean>;
  resolve: (threadId: string, resolved: boolean) => Promise<void>;
}

/**
 * Comment threads on the open board. The server holds them; when anyone changes one,
 * the board's room says so and every open copy fetches them again.
 */
export const useComments = create<CommentsStore>((set, get) => ({
  boardId: null,
  comments: [],
  people: [],
  visible: false,
  placing: false,
  draftAt: null,
  openThread: null,
  showResolved: false,
  error: null,

  open: async (boardId) => {
    set({
      boardId,
      comments: [],
      people: [],
      openThread: null,
      draftAt: null,
      placing: false,
      error: null,
    });
    await get().refresh();
  },

  close: () =>
    set({
      boardId: null,
      comments: [],
      people: [],
      visible: false,
      placing: false,
      draftAt: null,
      openThread: null,
    }),

  refresh: async () => {
    const boardId = get().boardId;
    if (!boardId) return;
    try {
      const { comments } = await api.comments(boardId);
      if (get().boardId === boardId) set({ comments });
    } catch {
      // Comments are secondary; the board stays usable without them.
    }
  },

  loadPeople: async () => {
    const boardId = get().boardId;
    if (!boardId || get().people.length > 0) return;
    try {
      const { people } = await api.people(boardId);
      if (get().boardId === boardId) set({ people });
    } catch {
      // Without the list, mentions simply have nobody to suggest.
    }
  },

  post: async (body, mentions, where) => {
    const boardId = get().boardId;
    if (!boardId) return false;
    try {
      const { comments } = await api.addComment(boardId, { body, mentions, ...where });
      const threadId =
        'threadId' in where
          ? where.threadId
          : (comments.filter((comment) => comment.threadId === comment.id).at(-1)?.id ?? null);
      set({ comments, draftAt: null, placing: false, openThread: threadId, error: null });
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not post that' });
      return false;
    }
  },

  resolve: async (threadId, resolved) => {
    try {
      const { comments } = await api.resolveThread(threadId, resolved);
      set({ comments, openThread: resolved ? null : threadId });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Could not change that' });
    }
  },
}));

export function threadsOf(comments: readonly CommentRecord[]): Thread[] {
  const roots = comments.filter((comment) => comment.threadId === comment.id);
  return roots.map((root) => ({
    root,
    replies: comments.filter((comment) => comment.threadId === root.id && comment.id !== root.id),
  }));
}

/**
 * Finds @mentions of people who can see the board. A mention is "@" followed by a
 * person's name or email as the suggestion list inserted it.
 */
export function mentionsIn(body: string, people: readonly Person[]): string[] {
  const found = new Set<string>();
  for (const person of people) {
    const handles = [person.email, person.name].filter((handle): handle is string => !!handle);
    if (handles.some((handle) => body.includes(`@${handle}`))) found.add(person.email);
  }
  return [...found];
}
