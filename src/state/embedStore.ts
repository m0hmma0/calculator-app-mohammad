import { create } from 'zustand';

/**
 * Other sites' players (YouTube, Vimeo, SoundCloud, Spotify) started on this screen.
 * Until started, each is a picture with a play button — a frame from another site is
 * heavy to load for every one on a board — and one click starts it. Started, it stays.
 * Playing is personal, like the camera.
 */
export const useEmbeds = create<{ started: readonly string[] }>(() => ({ started: [] }));

export function startPlayer(id: string): void {
  const { started } = useEmbeds.getState();
  if (!started.includes(id)) useEmbeds.setState({ started: [...started, id] });
}
