/**
 * The audience window: a second window opened from presenter view, showing only the
 * slide on show, for sharing or recording a screen. It is this same app, opened at
 * the presenter's address with `#audience=<channel>`, and it gets everything — the
 * board, the slide, the laser, the media — from the presenter's window over a
 * BroadcastChannel of that name. It has no account, no room and no storage of its own,
 * so it costs the server nothing and leaves the presenter's saved camera and undo
 * history alone.
 */
const PREFIX = '#audience=';

/** The channel this window listens on, when it is an audience window. */
export function audienceChannel(): string | null {
  if (typeof location === 'undefined') return null;
  if (!location.hash.startsWith(PREFIX)) return null;
  const name = location.hash.slice(PREFIX.length);
  return /^[\w-]{6,64}$/.test(name) ? name : null;
}

export const isAudienceWindow = (): boolean => audienceChannel() !== null;

/** Where the audience window for this channel opens: this page, with the hash. */
export function audienceUrl(channel: string): string {
  const here = new URL(location.href);
  here.hash = `${PREFIX.slice(1)}${channel}`;
  return here.toString();
}
