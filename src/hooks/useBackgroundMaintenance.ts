/**
 * Background Maintenance Hook
 * 
 * Runs periodic tasks:
 * - AI song classification every 30 minutes
 * - Auto-purge blocked files from disk every 12 hours (Electron only)
 * - Auto-deduplicate music library every 24 hours (Electron only)
 * - Library ID3 metadata scan once per session (Electron only)
 * - History compression daily at 4:00 AM
 * 
 * NOTE: ARL validation is handled by useGlobalDownloadService (every 15 min)
 */

import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useRadioStore } from '@/store/radioStore';
import { normalizeId3Genre, genreToEnergy } from '@/lib/id3GenreUtils';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;
const CLASSIFY_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const PURGE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEDUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TEMP_PROCESS_INTERVAL_MS = 2 * 60 * 1000; // Every 2 minutes
const MAINTENANCE_CHECK_MS = 60 * 1000; // Check every minute
const ID3_SCAN_KEY = 'pgmr_last_id3_scan'; // localStorage key for scan date

export function useBackgroundMaintenance() {
  const lastClassifyRef = useRef<number>(0);
  const lastPurgeRef = useRef<number>(0);
  const lastDedupRef = useRef<number>(0);
  const lastTempProcessRef = useRef<number>(0);
  const lastCompressRef = useRef<string>(''); // Date string of last compression
  const intervalRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id3ScanRunningRef = useRef(false);

  const classifySongs = useCallback(async () => {
    try {
      console.log('[MAINTENANCE] 🎯 Classificando músicas com IA...');
      const { data, error } = await supabase.functions.invoke('classify-song', {
        body: { action: 'classify-batch' },
      });

      if (error) {
        console.error('[MAINTENANCE] Erro na classificação:', error);
        return;
      }

      if (data?.classified > 0) {
        console.log(`[MAINTENANCE] ✅ ${data.classified}/${data.total} músicas classificadas`);
      } else {
        console.log('[MAINTENANCE] Nenhuma música pendente de classificação');
      }
    } catch (error) {
      console.error('[MAINTENANCE] Erro na classificação:', error);
    }
  }, []);

  const purgeBlockedFiles = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.purgeBlockedFiles) return;

    try {
      const { config, deezerConfig } = useRadioStore.getState();
      const allFolders = [
        ...config.musicFolders,
        deezerConfig.downloadFolder,
      ].filter(Boolean);

      if (allFolders.length === 0) return;

      const blockedSongs = config.blockedSongs || [];
      const forbiddenWords = config.forbiddenWords || [];

      if (blockedSongs.length === 0 && forbiddenWords.length === 0) return;

      console.log('[MAINTENANCE] 🗑️ Verificando arquivos bloqueados no disco...');
      const result = await window.electronAPI.purgeBlockedFiles({
        musicFolders: allFolders,
        blockedSongs,
        forbiddenWords,
      });

      if (result.deletedCount > 0) {
        console.log(`[MAINTENANCE] 🗑️ ${result.deletedCount} arquivo(s) bloqueado(s) removido(s) do disco`);
      } else {
        console.log('[MAINTENANCE] ✅ Nenhum arquivo bloqueado encontrado no disco');
      }
    } catch (error) {
      console.error('[MAINTENANCE] Erro no purge automático:', error);
    }
  }, []);

  const autoDeduplicateLibrary = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.scanDuplicates || !window.electronAPI?.deleteDuplicates) return;

    try {
      const { config, deezerConfig } = useRadioStore.getState();
      const allFolders = [
        ...config.musicFolders,
        deezerConfig.downloadFolder,
      ].filter(Boolean);

      if (allFolders.length === 0) return;

      console.log('[MAINTENANCE] 🔍 Escaneando duplicatas na biblioteca...');
      const scanResult = await window.electronAPI.scanDuplicates({ musicFolders: allFolders });

      if (!scanResult?.duplicates || scanResult.duplicates.length === 0) {
        console.log('[MAINTENANCE] ✅ Nenhuma duplicata encontrada na biblioteca');
        return;
      }

      console.log(`[MAINTENANCE] 🗑️ ${scanResult.duplicates.length} grupo(s) de duplicatas encontrado(s), removendo cópias de menor qualidade...`);
      
      const filesToDelete = scanResult.duplicates.flatMap((group: any) => 
        group.remove.map((f: any) => f.path)
      );

      const deleteResult = await window.electronAPI.deleteDuplicates({ filePaths: filesToDelete });
      console.log(`[MAINTENANCE] ✅ ${deleteResult.deleted} arquivo(s) duplicado(s) removido(s) automaticamente`);
    } catch (error) {
      console.error('[MAINTENANCE] Erro na deduplicação automática:', error);
    }
  }, []);

  const compressHistory = useCallback(async () => {
    try {
      console.log('[MAINTENANCE] 🗜️ Comprimindo histórico...');
      const { data, error } = await supabase.functions.invoke('classify-song', {
        body: { action: 'compress-history' },
      });

      if (error) {
        console.error('[MAINTENANCE] Erro na compressão:', error);
        return;
      }

      console.log(`[MAINTENANCE] ✅ Histórico comprimido:`, data?.result);
    } catch (error) {
      console.error('[MAINTENANCE] Erro na compressão:', error);
    }
  }, []);

  const processTempFiles = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.processTempFiles) return;
    try {
      const { config, deezerConfig } = useRadioStore.getState();
      const folders = config.musicFolders || [];
      if (folders.length === 0) return;

      const result = await window.electronAPI.processTempFiles({ musicFolders: folders });
      if (result.moved > 0) {
        console.log(`[MAINTENANCE] 📂 _temp ID3: ${result.moved} arquivo(s) processado(s) e movido(s)`);

        // Genre-route newly moved files (Rock/Metal → subfolders)
        const movedFiles = (result as any).movedFiles as Array<{ filename: string; folder: string; genre: string | null; year: string | null; artist: string; title: string }> | undefined;
        if (deezerConfig.genreRoutingEnabled && movedFiles?.length) {
          const routes = deezerConfig.genreRoutes || [];
          let routedCount = 0;

          for (const file of movedFiles) {
            if (!file.genre) continue;
            const normalized = normalizeId3Genre(file.genre);
            const matchedRoute = routes.find(r => r.genre.toUpperCase() === normalized.toUpperCase());
            if (!matchedRoute) continue;

            // Already in correct folder?
            if (file.folder.replace(/[\\/]+$/, '').endsWith(matchedRoute.folderName)) continue;

            try {
              const moveResult = await (window.electronAPI as any).moveFileToGenreFolder({
                sourceFolder: file.folder,
                fileName: file.filename,
                targetSubfolder: matchedRoute.folderName,
              });
              if (moveResult?.success) {
                routedCount++;
                console.log(`[MAINTENANCE] 📂 _temp route: ${file.filename} → ${matchedRoute.folderName}/`);
              }
            } catch { /* non-critical */ }

            // Also enrich DB
            try {
              const updates: Record<string, string> = {
                ai_genre: normalized,
                ai_energy: genreToEnergy(normalized),
              };
              if (file.year) updates.year = file.year;
              await supabase
                .from('scraped_songs')
                .update(updates)
                .eq('artist', file.artist)
                .eq('title', file.title);
            } catch { /* non-critical */ }
          }

          if (routedCount > 0) {
            console.log(`[MAINTENANCE] 📂 _temp: ${routedCount} arquivo(s) roteado(s) por gênero`);
          }
        }
      }
    } catch (error) {
      // Silent — runs frequently
    }
  }, []);

  /**
   * Scan entire music library ID3 tags and enrich scraped_songs in the database.
   * Runs once per day silently in the background.
   * Matches library files to DB records by artist+title and updates genre/energy/year.
   */
  const scanLibraryId3 = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.scanLibraryMetadata || id3ScanRunningRef.current) return;

    // Check if already scanned today
    try {
      const lastScan = localStorage.getItem(ID3_SCAN_KEY);
      const today = new Date().toDateString();
      if (lastScan === today) return;
    } catch { /* proceed */ }

    id3ScanRunningRef.current = true;
    console.log('[MAINTENANCE] 🏷️ Iniciando scan ID3 da biblioteca (silencioso)...');

    try {
      const { config, deezerConfig } = useRadioStore.getState();
      const allFolders = [
        ...config.musicFolders,
        deezerConfig.downloadFolder,
      ].filter(Boolean);

      if (allFolders.length === 0) {
        id3ScanRunningRef.current = false;
        return;
      }

      const result = await window.electronAPI.scanLibraryMetadata({ musicFolders: allFolders });
      if (!result?.success || !result.songs?.length) {
        console.log('[MAINTENANCE] 🏷️ Scan ID3: nenhum arquivo encontrado');
        id3ScanRunningRef.current = false;
        return;
      }

      console.log(`[MAINTENANCE] 🏷️ Scan ID3: ${result.songs.length} arquivos escaneados, enriquecendo banco...`);

      // Build a map of normalized artist+title → genre/year from library files
      const libraryMap = new Map<string, { genre: string | null; year: string | null; bpm: number | null }>();
      for (const song of result.songs as Array<{ artist: string; title: string; genre: string | null; year?: string | null; bpm: number | null; filename: string; folder: string }>) {
        const key = `${(song.artist || '').toLowerCase().trim()}|${(song.title || '').toLowerCase().trim()}`;
        if (key === '|' || key.startsWith('desconhecido|')) continue;
        libraryMap.set(key, {
          genre: song.genre ? normalizeId3Genre(song.genre) : null,
          year: song.year || null,
          bpm: song.bpm || null,
        });
      }

      // Fetch songs from DB that are missing genre or year (aggressive year population)
      const { data: dbSongs, error } = await supabase
        .from('scraped_songs')
        .select('id, artist, title, ai_genre, year')
        .or('ai_genre.is.null,year.is.null')
        .limit(5000);

      if (error || !dbSongs?.length) {
        console.log(`[MAINTENANCE] 🏷️ Scan ID3: ${error ? 'erro no DB' : 'nenhuma música sem gênero/ano no DB'}`);
        localStorage.setItem(ID3_SCAN_KEY, new Date().toDateString());
        id3ScanRunningRef.current = false;
        return;
      }

      // Match and batch update
      let enrichedCount = 0;
      const BATCH_SIZE = 50;
      
      for (let i = 0; i < dbSongs.length; i += BATCH_SIZE) {
        const batch = dbSongs.slice(i, i + BATCH_SIZE);
        
        for (const dbSong of batch) {
          const key = `${dbSong.artist.toLowerCase().trim()}|${dbSong.title.toLowerCase().trim()}`;
          const libData = libraryMap.get(key);
          if (!libData) continue;

          const updates: Record<string, string> = {};
          if (!dbSong.ai_genre && libData.genre && libData.genre !== 'OUTRO') {
            updates.ai_genre = libData.genre;
            updates.ai_energy = genreToEnergy(libData.genre);
          }
          if (!dbSong.year && libData.year) {
            updates.year = libData.year;
          }

          if (Object.keys(updates).length > 0) {
            await supabase
              .from('scraped_songs')
              .update(updates)
              .eq('id', dbSong.id);
            enrichedCount++;
          }
        }

        // Yield to event loop between batches
        if (i + BATCH_SIZE < dbSongs.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      // Also update BPM cache from library scan
      try {
        const { updateBpmCacheEntry } = await import('@/lib/bpmCacheBridge');
        let bpmCount = 0;
        for (const song of result.songs as Array<{ artist: string; title: string; bpm: number | null; [k: string]: any }>) {
          if (song.bpm && song.bpm > 0 && song.bpm < 300 && song.artist && song.title) {
            updateBpmCacheEntry(song.artist, song.title, song.bpm);
            bpmCount++;
          }
        }
        if (bpmCount > 0) {
          console.log(`[MAINTENANCE] 🥁 BPM cache atualizado com ${bpmCount} valores da biblioteca`);
        }
      } catch { /* non-critical */ }

      // === Auto-reorganize Rock/Metal files to genre folders ===
      try {
        const { deezerConfig } = useRadioStore.getState();
        if (deezerConfig.genreRoutingEnabled && (window.electronAPI as any)?.moveFileToGenreFolder) {
          const routes = deezerConfig.genreRoutes || [];
          const defaultFolder = deezerConfig.genreDefaultFolder || 'Musicas';
          let movedCount = 0;

          for (const song of result.songs as Array<{ artist: string; title: string; genre: string | null; filename: string; folder: string; [k: string]: any }>) {
            if (!song.genre || !song.filename || !song.folder) continue;
            const normalized = normalizeId3Genre(song.genre);
            const matchedRoute = routes.find(r => r.genre.toUpperCase() === normalized.toUpperCase());
            if (!matchedRoute) continue; // Only move if there's a specific route (Rock/Metal)

            // Check if file is already in the correct subfolder
            const currentFolder = song.folder.replace(/[\\/]+$/, '');
            const expectedFolder = matchedRoute.folderName;
            if (currentFolder.endsWith(expectedFolder)) continue; // Already in correct folder

            // Don't move files from non-download folders (e.g. Românticas, custom folders)
            // Only move files from the root download folder or default folder
            const downloadFolder = deezerConfig.downloadFolder?.replace(/[\\/]+$/, '');
            const isInDownloadRoot = currentFolder === downloadFolder;
            const isInDefaultFolder = currentFolder.endsWith(defaultFolder);
            if (!isInDownloadRoot && !isInDefaultFolder) continue;

            try {
              const moveResult = await (window.electronAPI as any).moveFileToGenreFolder({
                sourceFolder: currentFolder,
                fileName: song.filename,
                targetSubfolder: expectedFolder,
              });
              if (moveResult?.success) {
                movedCount++;
              }
            } catch { /* non-critical */ }

            // Yield every 10 moves
            if (movedCount % 10 === 0 && movedCount > 0) {
              await new Promise(r => setTimeout(r, 50));
            }
          }

          if (movedCount > 0) {
            console.log(`[MAINTENANCE] 📂 Reorganização ID3: ${movedCount} arquivo(s) movido(s) para pastas de gênero`);
          }
        }
      } catch (e) {
        console.warn('[MAINTENANCE] Genre reorganization failed (non-critical):', e);
      }

      console.log(`[MAINTENANCE] 🏷️ Scan ID3 concluído: ${enrichedCount} músicas enriquecidas no banco`);
      localStorage.setItem(ID3_SCAN_KEY, new Date().toDateString());
    } catch (error) {
      console.error('[MAINTENANCE] Erro no scan ID3:', error);
    } finally {
      id3ScanRunningRef.current = false;
    }
  }, []);

  const start = useCallback(() => {
    // Initial classification after 2 minutes
    setTimeout(() => classifySongs(), 2 * 60 * 1000);

    // Initial purge after 3 minutes
    if (isElectron) {
      setTimeout(() => purgeBlockedFiles(), 3 * 60 * 1000);
    }

    // Initial dedup after 10 minutes
    if (isElectron) {
      setTimeout(() => autoDeduplicateLibrary(), 10 * 60 * 1000);
    }

    // Initial temp processing after 1 minute
    if (isElectron) {
      setTimeout(() => processTempFiles(), 60 * 1000);
    }

    // Library ID3 scan after 5 minutes (silent, once per day)
    if (isElectron) {
      setTimeout(() => scanLibraryId3(), 5 * 60 * 1000);
    }

    intervalRef.current = setInterval(() => {
      const now = Date.now();

      // Process _temp files every 2 minutes (Electron only)
      if (isElectron && now - lastTempProcessRef.current >= TEMP_PROCESS_INTERVAL_MS) {
        lastTempProcessRef.current = now;
        processTempFiles();
      }

      // Classify every 30 minutes
      if (now - lastClassifyRef.current >= CLASSIFY_INTERVAL_MS) {
        lastClassifyRef.current = now;
        classifySongs();
      }

      // Purge blocked files every 12 hours (Electron only)
      if (isElectron && now - lastPurgeRef.current >= PURGE_INTERVAL_MS) {
        lastPurgeRef.current = now;
        purgeBlockedFiles();
      }

      // Auto-deduplicate every 24 hours (Electron only)
      if (isElectron && now - lastDedupRef.current >= DEDUP_INTERVAL_MS) {
        lastDedupRef.current = now;
        autoDeduplicateLibrary();
      }

      // Compress history once per day at ~4:00 AM
      const currentHour = new Date().getHours();
      const today = new Date().toDateString();
      if (currentHour === 4 && lastCompressRef.current !== today) {
        lastCompressRef.current = today;
        compressHistory();
      }
    }, MAINTENANCE_CHECK_MS);

    console.log('[MAINTENANCE] ✅ Serviço de manutenção iniciado (temp 2min, classificação 30min, ID3 scan diário, purge 12h, dedup 24h, compressão 4h)');

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [classifySongs, compressHistory, purgeBlockedFiles, autoDeduplicateLibrary, processTempFiles, scanLibraryId3]);

  return { start, classifySongs, compressHistory, purgeBlockedFiles, autoDeduplicateLibrary, processTempFiles, scanLibraryId3 };
}
