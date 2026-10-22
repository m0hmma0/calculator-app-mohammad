/**
 * The share link this tab came in by, and — for someone without an account — the
 * name they chose. Both go with every request and with the room handshake; the
 * server decides what they are worth.
 *
 * The link lives in sessionStorage: it belongs to this tab's visit, survives a
 * reload, and is not carried into unrelated tabs. The guest's name is remembered
 * across visits, which is a convenience and nothing more.
 */
const LINK_KEY = 'sabboura:link';
const GUEST_KEY = 'sabboura:guest';

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(storage: Storage | undefined, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private windows can refuse storage; the link then lasts until reload.
  }
}

let memoryLink: string | null = null;

export function shareLink(): string | null {
  return memoryLink ?? read(globalThis.sessionStorage, LINK_KEY);
}

export function setShareLink(token: string | null): void {
  memoryLink = token;
  write(globalThis.sessionStorage, LINK_KEY, token);
}

export interface GuestIdentity {
  id: string;
  name: string;
}

export function guestIdentity(): GuestIdentity | null {
  const raw = read(globalThis.localStorage, GUEST_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GuestIdentity>;
    return parsed.id && parsed.name ? { id: parsed.id, name: parsed.name } : null;
  } catch {
    return null;
  }
}

export function setGuestName(name: string): GuestIdentity {
  const existing = guestIdentity();
  const identity = {
    id: existing?.id ?? crypto.randomUUID().replace(/-/g, '').slice(0, 16),
    name: name.replace(/\s+/g, ' ').trim().slice(0, 40),
  };
  write(globalThis.localStorage, GUEST_KEY, JSON.stringify(identity));
  return identity;
}
