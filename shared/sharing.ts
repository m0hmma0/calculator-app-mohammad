/** Sharing, comments and notifications: the shapes the browser and the Worker agree on. */

/**
 * What someone may do with a board, weakest first. `answer` is a commenter who may
 * also type in placeholders — and change nothing else; the room checks every change.
 */
export type Role = 'viewer' | 'commenter' | 'answer' | 'editor' | 'owner';
export type GrantRole = Exclude<Role, 'owner'>;
export type Audience = 'anyone' | 'signed-in' | 'domain';
export type ResourceType = 'board' | 'folder';

export const ROLE_LABEL: Record<Role, string> = {
  viewer: 'Can view',
  commenter: 'Can comment',
  answer: 'Can answer',
  editor: 'Can edit',
  owner: 'Owner',
};

export const canEdit = (role: Role | null) => role === 'editor' || role === 'owner';
export const canComment = (role: Role | null) =>
  canEdit(role) || role === 'commenter' || role === 'answer';
/** Someone who may type in placeholders: anyone who edits, and anyone who answers. */
export const canAnswer = (role: Role | null) => canEdit(role) || role === 'answer';

export interface LinkSettings {
  token: string;
  role: GrantRole;
  audience: Audience;
  domain: string | null;
  expiresAt: number | null;
}

export interface PersonGrant {
  id: string;
  email: string;
  role: GrantRole;
  /** Their name, once they have signed in at least once. */
  name: string | null;
}

export interface AuditEntry {
  at: number;
  actor: string;
  action: string;
  detail: string;
}

export interface ShareState {
  link: LinkSettings | null;
  people: PersonGrant[];
  /** Boards only: whether viewers and commenters may export. */
  viewerExport: boolean | null;
  audit: AuditEntry[];
}

export interface PutLinkBody {
  role: GrantRole;
  audience: Audience;
  domain?: string | null;
  /** Minutes from now; null for a link that does not expire. */
  expiresInMinutes: number | null;
}

/** What a share link leads to, as seen by whoever opened it. */
export interface LinkInfo {
  resource: { type: ResourceType; id: string; title: string };
  role: GrantRole;
  audience: Audience;
  /** False when this person cannot use it as they are — usually: sign in first. */
  admitted: boolean;
  needsSignIn: boolean;
  /** Why not, in words, when not admitted. */
  reason: string | null;
}

/** Opening a board: what it is, and what this person may do with it. */
export interface OpenBoardResponse {
  board: {
    id: string;
    title: string;
    /** Only for the owner: other people do not see where it lives in someone's folders. */
    folderId: string | null;
  };
  role: Role;
  canExport: boolean;
  ownerName: string | null;
  /** The size new text starts at on this board: the owner's choice for everyone on it. */
  textSize: number;
}

export interface SharedItem {
  type: ResourceType;
  id: string;
  title: string;
  role: GrantRole;
  ownerName: string | null;
  thumbnailUrl: string | null;
}

export interface FolderContents {
  folder: { id: string; name: string };
  role: Role;
  folders: Array<{ id: string; name: string }>;
  boards: Array<{ id: string; title: string; thumbnailUrl: string | null }>;
}

export interface CommentRecord {
  id: string;
  threadId: string;
  authorUid: string;
  authorName: string;
  body: string;
  x: number | null;
  y: number | null;
  createdAt: number;
  /** On a thread's first comment. */
  resolvedAt: number | null;
}

export interface NewCommentBody {
  body: string;
  /** Replying to a thread, or starting one at (x, y). */
  threadId?: string;
  x?: number;
  y?: number;
  /** Emails of people @mentioned. Only people who can open the board are notified. */
  mentions?: string[];
}

export interface Person {
  email: string;
  name: string | null;
}

export interface NotificationRecord {
  id: string;
  kind: 'shared' | 'mention';
  boardId: string | null;
  folderId: string | null;
  actorName: string;
  text: string;
  createdAt: number;
  readAt: number | null;
}

export const EXPIRY_CHOICES: Array<{ label: string; minutes: number | null }> = [
  { label: 'Never', minutes: null },
  { label: '1 minute', minutes: 1 },
  { label: '1 hour', minutes: 60 },
  { label: '1 day', minutes: 60 * 24 },
  { label: '1 week', minutes: 60 * 24 * 7 },
  { label: '30 days', minutes: 60 * 24 * 30 },
];
