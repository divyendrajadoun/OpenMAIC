/**
 * Stable fingerprint of a narration line (FNV-1a, 32-bit). The server stores it
 * with every avatar clip and the player checks it before using one, so an
 * edited line never plays a stale clip. Shared by both sides: no Node imports.
 */
export function narrationTextHash(text: string): string {
  const normalized = text.trim().replace(/\s+/g, ' ');
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
