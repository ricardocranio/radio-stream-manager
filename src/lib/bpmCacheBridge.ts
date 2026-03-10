/**
 * BPM Cache Bridge
 * 
 * In-memory + persistent cache for BPM values.
 * Option A: Updated when songs are downloaded (ID3 tag read).
 * Option B: Loaded from Electron BPM cache at grade generation time.
 * 
 * The grade builder queries this cache as fallback when a song
 * has no BPM in the database record.
 */

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

// In-memory BPM lookup: "artist|title" → bpm
const bpmMemoryCache = new Map<string, number>();
let cacheLoaded = false;

function makeKey(artist: string, title: string): string {
  return `${artist.toLowerCase().trim()}|${title.toLowerCase().trim()}`;
}

/** Called by download services after reading ID3 BPM tag */
export function updateBpmCacheEntry(artist: string, title: string, bpm: number): void {
  if (bpm > 0 && bpm < 300) {
    bpmMemoryCache.set(makeKey(artist, title), bpm);
  }
}

/** Look up BPM from in-memory cache */
export function getBpmFromCache(artist: string, title: string): number | null {
  return bpmMemoryCache.get(makeKey(artist, title)) || null;
}

/**
 * Load the full BPM cache from Electron's persistent JSON file.
 * Should be called once before grade generation starts.
 */
export async function loadBpmCacheFromDisk(): Promise<void> {
  if (cacheLoaded || !isElectron || !window.electronAPI?.loadBpmCache) return;

  try {
    const { useRadioStore } = await import('@/store/radioStore');
    const folder = useRadioStore.getState().deezerConfig.downloadFolder || '';
    if (!folder) return;

    const result = await window.electronAPI.loadBpmCache({ folder });
    if (result?.success && result.data && typeof result.data === 'object') {
      let count = 0;
      for (const [filename, entry] of Object.entries(result.data)) {
        const bpm = entry?.bpm;
        if (bpm && bpm > 0 && bpm < 300) {
          // Store by filename key (lowercase)
          bpmMemoryCache.set(filename.toLowerCase().trim(), bpm);
          // Also try to extract artist|title from filename pattern "Artist - Title.mp3"
          const baseName = filename.replace(/\.[^/.]+$/, '');
          const parts = baseName.split(' - ');
          if (parts.length >= 2) {
            const artist = parts[0].trim().toLowerCase();
            const title = parts.slice(1).join(' - ').trim().toLowerCase();
            bpmMemoryCache.set(`${artist}|${title}`, bpm);
          }
          count++;
        }
      }
      cacheLoaded = true;
      console.log(`[BPM-CACHE] ✅ Loaded ${count} BPM entries from disk`);
    }
  } catch (e) {
    console.warn('[BPM-CACHE] Failed to load from disk:', e);
  }
}

/** Enrich an array of song candidates with BPM from cache */
export function enrichSongsWithBpmCache<T extends { artist: string; title: string; bpm?: number | null }>(
  songs: T[]
): T[] {
  let enriched = 0;
  for (const song of songs) {
    if (song.bpm && song.bpm > 0) continue; // Already has BPM
    const cached = getBpmFromCache(song.artist, song.title);
    if (cached) {
      (song as any).bpm = cached;
      enriched++;
    }
  }
  if (enriched > 0) {
    console.log(`[BPM-CACHE] 🎯 Enriched ${enriched} songs with cached BPM`);
  }
  return songs;
}

/** Get cache stats */
export function getBpmCacheSize(): number {
  return bpmMemoryCache.size;
}
