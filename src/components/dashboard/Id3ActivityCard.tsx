import { useState, useEffect, useCallback } from 'react';
import { Tags, Loader2, CheckCircle2, Music, FileText, Wrench, FolderOpen, Database } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { useRadioStore } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { normalizeId3Genre, genreToEnergy } from '@/lib/id3GenreUtils';

interface FixProgress {
  scanned: number;
  renamed: number;
  current: string;
}

export function Id3ActivityCard() {
  const { config, deezerConfig } = useRadioStore();
  const dailyStats = useAutoDownloadStore((s) => s.dailyStats);
  const activeDownload = useAutoDownloadStore((s) => s.activeDownload);
  const { toast } = useToast();

  const [isFixing, setIsFixing] = useState(false);
  const [fixProgress, setFixProgress] = useState<FixProgress | null>(null);
  const [fixResult, setFixResult] = useState<{ scanned: number; renamed: number; errors: number; purged: number } | null>(null);

  // Catalog scan state
  const [isCataloging, setIsCataloging] = useState(false);
  const [catalogResult, setCatalogResult] = useState<{ scanned: number; enriched: number; genres: number; years: number; inserted: number } | null>(null);

  const id3ProcessedToday = dailyStats.downloaded + dailyStats.skipped;

  const handleScanFix = useCallback(async () => {
    if (!window.electronAPI?.scanFixLibrary) {
      toast({ title: '⚠️ Disponível apenas no desktop', variant: 'destructive' });
      return;
    }
    setIsFixing(true);
    setFixProgress(null);
    setFixResult(null);

    window.electronAPI.onLibFixProgress?.((progress) => {
      setFixProgress(progress);
    });

    try {
      const result = await window.electronAPI.scanFixLibrary({ musicFolders: config.musicFolders }) as any;
      setFixResult({ scanned: result.scanned, renamed: result.renamed, errors: result.errors, purged: result.purged || 0 });
      setFixProgress(null);
      const purgeMsg = result.purged > 0 ? ` · ${result.purged} apagados (sem ID3)` : '';
      toast({
        title: '✅ ID3 Scan Completo',
        description: `${result.scanned} escaneados · ${result.renamed} renomeados · ${result.errors} erros${purgeMsg}`,
      });
    } catch (err) {
      toast({ title: '❌ Erro no scan ID3', description: String(err), variant: 'destructive' });
    } finally {
      setIsFixing(false);
    }
  }, [config.musicFolders, toast]);

  /**
   * Catalog scan: reads ID3 genre/year from ALL music folders and updates
   * the scraped_songs table in the database. Does NOT modify any files.
   */
  const handleCatalogScan = useCallback(async () => {
    if (!window.electronAPI?.scanLibraryMetadata) {
      toast({ title: '⚠️ Disponível apenas no desktop', variant: 'destructive' });
      return;
    }

    setIsCataloging(true);
    setCatalogResult(null);

    try {
      const allFolders = [
        ...(config.musicFolders || []),
        deezerConfig?.downloadFolder,
      ].filter(Boolean) as string[];

      if (allFolders.length === 0) {
        toast({ title: '⚠️ Nenhuma pasta configurada', description: 'Configure o Banco Musical em Configurações.', variant: 'destructive' });
        setIsCataloging(false);
        return;
      }

      toast({ title: '🔍 Catalogando acervo...', description: `Escaneando ${allFolders.length} pasta(s) para gênero e ano.` });

      const result = await window.electronAPI.scanLibraryMetadata({ musicFolders: allFolders });
      if (!result?.success || !result.songs?.length) {
        toast({ title: '⚠️ Nenhum arquivo encontrado', variant: 'destructive' });
        setIsCataloging(false);
        return;
      }

      // Build lookup map from library files
      const libraryMap = new Map<string, { genre: string | null; year: string | null }>();
      for (const song of result.songs as Array<{ artist: string; title: string; genre: string | null; year?: string | null; filename: string }>) {
        const key = `${(song.artist || '').toLowerCase().trim()}|${(song.title || '').toLowerCase().trim()}`;
        if (key === '|' || key.startsWith('desconhecido|')) continue;
        libraryMap.set(key, {
          genre: song.genre ? normalizeId3Genre(song.genre) : null,
          year: (song as any).year || null,
        });
      }

      // === Phase 1: Update existing songs missing genre or year ===
      const { data: dbSongs, error } = await supabase
        .from('scraped_songs')
        .select('id, artist, title, ai_genre, year')
        .or('ai_genre.is.null,year.is.null')
        .limit(5000);

      let enriched = 0;
      let genresUpdated = 0;
      let yearsUpdated = 0;
      let inserted = 0;
      const BATCH_SIZE = 50;

      if (dbSongs?.length) {
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
              genresUpdated++;
            }
            if (!dbSong.year && libData.year) {
              updates.year = libData.year;
              yearsUpdated++;
            }

            if (Object.keys(updates).length > 0) {
              await supabase.from('scraped_songs').update(updates).eq('id', dbSong.id);
              enriched++;
            }
          }

          if (i + BATCH_SIZE < dbSongs.length) {
            await new Promise(r => setTimeout(r, 50));
          }
        }
      }

      // === Phase 2: Insert local library songs NOT yet in scraped_songs ===
      // Build set of existing artist|title in DB
      const { data: allDbSongs } = await supabase
        .from('scraped_songs')
        .select('artist, title')
        .limit(10000);

      const existingKeys = new Set<string>();
      if (allDbSongs) {
        for (const s of allDbSongs) {
          existingKeys.add(`${s.artist.toLowerCase().trim()}|${s.title.toLowerCase().trim()}`);
        }
      }

      // Find library songs not in DB that have useful metadata
      const toInsert: Array<{ artist: string; title: string; ai_genre: string; ai_energy: string; year: string | null; station_name: string; source: string }> = [];
      for (const [key, libData] of libraryMap) {
        if (existingKeys.has(key)) continue;
        const [artist, title] = key.split('|');
        if (!artist || !title || artist === 'desconhecido') continue;
        
        const genre = libData.genre || null;
        if (!genre && !libData.year) continue; // skip if no useful data

        toInsert.push({
          artist,
          title,
          ai_genre: genre || 'OUTRO',
          ai_energy: genre ? genreToEnergy(genre) : 'MEDIUM',
          year: libData.year || null,
          station_name: 'ACERVO_LOCAL',
          source: 'library_catalog',
        });
      }

      // Batch insert
      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase.from('scraped_songs').insert(batch);
        if (!insertError) inserted += batch.length;
        if (i + BATCH_SIZE < toInsert.length) {
          await new Promise(r => setTimeout(r, 50));
        }
      }

      setCatalogResult({ scanned: result.songs.length, enriched, genres: genresUpdated, years: yearsUpdated });
      toast({
        title: '✅ Catalogação Completa',
        description: `${result.songs.length} arquivos lidos · ${enriched} atualizados (${genresUpdated} gêneros, ${yearsUpdated} anos)`,
      });
    } catch (err) {
      console.error('[CATALOG] Erro:', err);
      toast({ title: '❌ Erro na catalogação', description: String(err), variant: 'destructive' });
    } finally {
      setIsCataloging(false);
    }
  }, [config.musicFolders, deezerConfig?.downloadFolder, toast]);

  useEffect(() => {
    if (fixResult) {
      const timer = setTimeout(() => setFixResult(null), 30000);
      return () => clearTimeout(timer);
    }
  }, [fixResult]);

  useEffect(() => {
    if (catalogResult) {
      const timer = setTimeout(() => setCatalogResult(null), 30000);
      return () => clearTimeout(timer);
    }
  }, [catalogResult]);

  const isActive = isFixing || isCataloging || !!activeDownload;

  return (
    <Card className="glass-card border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          {/* Left: Icon + Info */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-indigo-500/20' : 'bg-indigo-500/10'}`}>
              {isFixing || isCataloging ? (
                <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
              ) : (
                <Tags className="w-5 h-5 text-indigo-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-foreground text-sm">Sistema ID3</span>
                {isActive ? (
                  <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 text-[10px]">
                    <Loader2 className="w-2.5 h-2.5 mr-1 animate-spin" />
                    {isCataloging ? 'Catalogando' : 'Processando'}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-500">
                    <CheckCircle2 className="w-2.5 h-2.5 mr-1" />
                    Ativo
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Leitura automática de Artist, Title, Genre e BPM das tags ID3v2
              </p>
            </div>
          </div>

          {/* Right: Stats + Actions */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-3 text-center">
              <div>
                <p className="text-lg font-bold font-mono text-indigo-400 tabular-nums">{id3ProcessedToday}</p>
                <p className="text-[9px] text-muted-foreground uppercase tracking-wide">ID3 Hoje</p>
              </div>
              {fixResult && (
                <div>
                  <p className="text-lg font-bold font-mono text-emerald-400 tabular-nums">{fixResult.renamed}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Renomeados</p>
                </div>
              )}
              {catalogResult && (
                <div>
                  <p className="text-lg font-bold font-mono text-amber-400 tabular-nums">{catalogResult.enriched}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Catalogados</p>
                </div>
              )}
            </div>

            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCatalogScan}
                disabled={isCataloging || isFixing}
                className="gap-1.5 text-xs border-amber-500/30 hover:bg-amber-500/10 text-amber-400"
                title="Catalogar gênero e ano do acervo local no banco de dados (não altera arquivos)"
              >
                {isCataloging ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Database className="w-3.5 h-3.5" />
                )}
                Catalogar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanFix}
                disabled={isFixing || isCataloging || !window.electronAPI?.scanFixLibrary}
                className="gap-1.5 text-xs border-indigo-500/30 hover:bg-indigo-500/10"
              >
                {isFixing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Wrench className="w-3.5 h-3.5" />
                )}
                Scan ID3
              </Button>
            </div>
          </div>
        </div>

        {/* Fix Progress */}
        {isFixing && fixProgress && (
          <div className="mt-3 space-y-2 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Escaneando biblioteca...</span>
              <span className="font-mono text-indigo-400 font-bold">
                {fixProgress.scanned} escaneados · {fixProgress.renamed} renomeados{(fixProgress as any).purged > 0 ? ` · ${(fixProgress as any).purged} apagados` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Music className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="text-muted-foreground truncate">{fixProgress.current}</span>
            </div>
          </div>
        )}

        {/* Catalog Progress */}
        {isCataloging && (
          <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
            <Database className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-pulse" />
            <span className="text-muted-foreground">Lendo tags ID3 do acervo e atualizando gênero/ano no banco...</span>
          </div>
        )}

        {/* Catalog Result */}
        {catalogResult && !isCataloging && (
          <div className="mt-3 flex items-center gap-3 text-xs p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
            <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium">{catalogResult.scanned}</span> arquivos lidos ·{' '}
              <span className="text-amber-400 font-medium">{catalogResult.genres}</span> gêneros ·{' '}
              <span className="text-amber-400 font-medium">{catalogResult.years}</span> anos atualizados
            </span>
          </div>
        )}

        {/* Active Download ID3 */}
        {activeDownload && !isFixing && !isCataloging && (
          <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
            <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0 animate-pulse" />
            <span className="text-muted-foreground">Lendo ID3:</span>
            <span className="text-foreground font-medium truncate">
              {activeDownload.artist} - {activeDownload.title}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
