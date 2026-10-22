import { create } from 'zustand';

/** The one video playing on this screen, if any. Playing is personal, like the camera. */
export const useEmbeds = create<{ playing: string | null }>(() => ({ playing: null }));
