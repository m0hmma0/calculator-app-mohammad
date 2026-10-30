import { create } from 'zustand';

export type SettingsSection = 'text' | 'shortcuts';

/** Settings opened over a board, so a change can be tried the moment it is made. */
export const useSettingsDialog = create<{ open: boolean; section: SettingsSection | null }>(() => ({
  open: false,
  section: null,
}));

export const openSettings = (section: SettingsSection | null = null) =>
  useSettingsDialog.setState({ open: true, section });
export const closeSettings = () => useSettingsDialog.setState({ open: false, section: null });
