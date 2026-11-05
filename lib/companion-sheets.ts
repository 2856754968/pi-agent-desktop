/** Adapted from Nwflower/dsh-claude-style (2026), sheets.ts.
 * Artwork has a separate notice: public/claude-companion/NOTICE.txt. */
export const COMPANION_FRAME_MS = 80;
export const COMPANION_GUTTER = 1;

export const COMPANION_SHEETS = {
  idle: [24, 24, 20, 24, 16, 0],
  "idle-look": [31, 24, 20, 24, 16, 0],
  "idle-wave": [12, 24, 15, 24, 21, 0],
  "idle-laptop": [43, 14, 13, 34, 23, 0],
  thinking: [48, 20, 0, 30, 36, 24],
  typing: [6, 15, 22, 28, 14, 0],
  music: [16, 19, 9, 31, 27, 0],
  conducting: [24, 20, 12, 29, 24, 0],
  building: [6, 15, 19, 28, 17, 0],
  error: [24, 23, 11, 26, 25, 4],
  happy: [32, 18, 6, 34, 30, 3],
  notification: [16, 24, 8, 24, 28, 0],
  compacting: [20, 21, 20, 30, 16, 3],
  sleeping: [32, 18, 1, 31, 35, 0],
  waking: [12, 24, 4, 24, 32, 11],
  "poke-left": [10, 24, 20, 27, 16, 0],
  "poke-right": [10, 21, 20, 27, 16, 0],
  tickle: [16, 23, 18, 26, 18, 0],
  drag: [8, 23, 12, 26, 22, 0],
} as const;
export type CompanionAnimation = keyof typeof COMPANION_SHEETS;
