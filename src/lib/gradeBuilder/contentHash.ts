/**
 * Stable lightweight hash for grade content.
 * Avoids false negatives from slice-based comparisons when a middle block changes.
 */
export function computeStableContentHash(content: string): string {
  let hash = 2166136261;

  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return `${content.length}:${(hash >>> 0).toString(16)}`;
}