// Managed blocks: the only part of a project-owned file the kit may rewrite.
// Everything outside the markers belongs to the project and is never touched.

/** Begin/end markers delimiting a managed block. */
export interface BlockMarkers {
  begin: string;
  end: string;
}

export const MD: BlockMarkers = { begin: '<!-- agent-setup:begin -->', end: '<!-- agent-setup:end -->' };
export const HASH: BlockMarkers = { begin: '# agent-setup:begin', end: '# agent-setup:end' };

const find = (text: string, m: BlockMarkers): { start: number; stop: number } | null => {
  const b = text.indexOf(m.begin);
  if (b < 0) return null;
  const e = text.indexOf(m.end, b);
  if (e < 0) return null;
  return { start: b, stop: e + m.end.length };
};

/**
 * Replace the managed block, or append it when absent. `block` must include
 * its own markers. The rest of the file is preserved byte-for-byte, apart from
 * the blank line separating an appended block.
 */
export function upsertBlock(text: unknown, block: string, m: BlockMarkers = MD): string {
  const t = String(text ?? '');
  const f = find(t, m);
  const clean = block.replace(/\s+$/, '');
  if (f) return t.slice(0, f.start) + clean + t.slice(f.stop);
  if (!t.trim()) return `${clean}\n`;
  return `${t.replace(/\s+$/, '')}\n\n${clean}\n`;
}

/** Remove the managed block and the blank lines it leaves behind. */
export function removeBlock(text: unknown, m: BlockMarkers = MD): string {
  const t = String(text ?? '');
  const f = find(t, m);
  if (!f) return t;
  const before = t.slice(0, f.start).replace(/\s+$/, '');
  const after = t.slice(f.stop).replace(/^\s+/, '');
  if (!before) return after ? `${after.replace(/\s+$/, '')}\n` : '';
  return after ? `${before}\n\n${after.replace(/\s+$/, '')}\n` : `${before}\n`;
}
