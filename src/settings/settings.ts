import { create } from 'zustand';
import { DEFAULT_SETTINGS, sanitiseSettings, type Settings } from '@shared/settings';
import { api } from '@/api/client';
import { useBoardAccess } from '@/sharing/boardAccess';
import { useWorkspace } from '@/state/workspaceStore';

/**
 * This person's settings. Signed in, they live on their account and follow them to
 * any device; this browser keeps a copy so they apply from the first instant, and so a
 * change made offline is sent once the server can be reached. Signed out — the local
 * board, or a guest on a shared one — they live in this browser only.
 */
export type SettingsStatus = 'browser' | 'loading' | 'saving' | 'saved' | 'unsaved';

interface SettingsStore {
  settings: Settings;
  status: SettingsStatus;
}

interface Stored {
  /** Whose these are: null for signed out. */
  uid: string | null;
  settings: Settings;
  /** Changed here and not yet confirmed by the server. */
  unsaved: boolean;
}

const KEY = 'sabboura:settings';
/** Changes are sent this long after the last one, so a held stepper sends once. */
const SAVE_DELAY_MS = 300;

function readStored(): Stored {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Stored> | null;
    return {
      uid: typeof raw?.uid === 'string' ? raw.uid : null,
      settings: sanitiseSettings(raw?.settings),
      unsaved: raw?.unsaved === true,
    };
  } catch {
    return { uid: null, settings: DEFAULT_SETTINGS, unsaved: false };
  }
}

function writeStored(stored: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // A private window may refuse; the settings still hold for this visit.
  }
}

const initial = readStored();

export const useSettings = create<SettingsStore>(() => ({
  settings: initial.settings,
  status: 'browser',
}));

/** The account these settings belong to, once the workspace has said. */
let uid: string | null = null;
let unsaved = initial.unsaved;
let timer: ReturnType<typeof setTimeout> | null = null;

const remember = () =>
  writeStored({ uid, settings: useSettings.getState().settings, unsaved: uid !== null && unsaved });

async function send(): Promise<void> {
  timer = null;
  if (uid === null) return;
  const owner = uid;
  const sent = useSettings.getState().settings;
  useSettings.setState({ status: 'saving' });
  try {
    await api.putSettings(sent);
    if (uid !== owner) return;
    // Anything changed while this was in flight goes in the next request.
    if (useSettings.getState().settings !== sent) return schedule();
    unsaved = false;
    remember();
    useSettings.setState({ status: 'saved' });
  } catch {
    if (uid === owner) useSettings.setState({ status: 'unsaved' });
  }
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void send(), SAVE_DELAY_MS);
}

/** Changes the settings: here at once, and on the account a moment later. */
export function updateSettings(change: (current: Settings) => Settings): void {
  const settings = sanitiseSettings(change(useSettings.getState().settings));
  useSettings.setState({ settings });
  unsaved = true;
  remember();
  if (uid === null) return;
  // Saving from now: "saved" would not be true until the server has it.
  useSettings.setState({ status: 'saving' });
  schedule();
}

/** Signing in (or switching account) brings that account's settings in. */
async function attach(next: string | null): Promise<void> {
  if (next === uid) return;
  const stored = readStored();
  uid = next;
  if (next === null) {
    unsaved = false;
    useSettings.setState({ status: 'browser' });
    return;
  }
  // Changes made here, by this person, while the server could not hear: they win.
  if (stored.uid === next && stored.unsaved) {
    unsaved = true;
    useSettings.setState({ settings: stored.settings });
    return void send();
  }
  useSettings.setState({ status: 'loading' });
  try {
    const { settings } = await api.settings();
    if (uid !== next || unsaved) return;
    useSettings.setState({ settings: sanitiseSettings(settings), status: 'saved' });
    remember();
  } catch {
    if (uid === next) useSettings.setState({ status: 'unsaved' });
  }
}

void attach(useWorkspace.getState().account?.uid ?? null);
useWorkspace.subscribe((state) => void attach(state.account?.uid ?? null));

// Back online: whatever was changed meanwhile goes up.
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (uid !== null && unsaved) schedule();
  });
}

/**
 * How a new text box starts here. On someone else's board the size is the one its
 * owner chose for everyone; the box's shape is always this person's own.
 */
export function textDefaults(): { fontSize: number; chars: number; lines: number } {
  const { text } = useSettings.getState().settings;
  const boardSize = useBoardAccess.getState().textSize;
  return { fontSize: boardSize ?? text.fontSize, chars: text.boxChars, lines: text.boxLines };
}
