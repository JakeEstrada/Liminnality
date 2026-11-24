/** Degrees to rotate a page so the blue shop header lands on top. */
export function headerRotation(scores: { top: number; right: number; bottom: number; left: number }) {
  const ranked = (Object.entries(scores) as Array<[keyof typeof scores, number]>).sort((a, b) => b[1] - a[1]);
  const [edge, score] = ranked[0];
  if (score < 0.08) return 0;
  if (edge === 'right') return -90;
  if (edge === 'left') return 90;
  if (edge === 'bottom') return 180;
  return 0;
}

/** Parts of an upright SCWW worksheet sent zoomed so small handwriting stays legible. */
export const WORKSHEET_ZOOMS = [
  { label: 'customer block', x: 0.45, y: 0, w: 0.55, h: 0.3 },
  { label: 'materials, scope, and total', x: 0, y: 0.08, w: 0.5, h: 0.84 },
] as const;
