import { useState, useEffect, useCallback } from 'react';
import { Tags, Loader2, CheckCircle2, Music, FileText, Wrench, Database, Shield } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRadioStore } from '@/store/radioStore';
import { useAutoDownloadStore } from '@/store/autoDownloadStore';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { normalizeId3Genre, genreToEnergy } from '@/lib/id3GenreUtils';

interface FixProgress {
  scanned: number;
  renamed?: number;
  quarantined?: number;
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

  const [isCataloging, setIsCataloging] = useState(false);
  const [catalogResult, setCatalogResult] = useState<{ scanned: number; enriched: number; genres: number; years: number; inserted: number } | null>(null);

  const [isQuarantining, setIsQuarantining] = useState(false);
  const [quarantineProgress, setQuarantineProgress] = useState<FixProgress | null>(null);
  const [quarantineResult, setQuarantineResult] = useState<{ scanned: number; quarantined: number; errors: number } | null>(null);

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

      const libraryMap = new Map<string, { genre: string | null; year: string | null }>();
      for (const song of result.songs as Array<{ artist: string; title: string; genre: string | null; year?: string | null; filename: string }>) {
        const key = `${(song.artist || '').toLowerCase().trim()}|${(song.title || '').toLowerCase().trim()}`;
        if (key === '|' || key.startsWith('desconhecido|')) continue;
        libraryMap.set(key, {
          genre: song.genre ? normalizeId3Genre(song.genre) : null,
          year: (song as any).year || null,
        });
      }

      const { data: dbSongs } = await supabase
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

      const toInsert: Array<{ artist: string; title: string; ai_genre: string; ai_energy: string; year: string | null; station_name: string; source: string }> = [];
      for (const [key, libData] of libraryMap) {
        if (existingKeys.has(key)) continue;
        const [artist, title] = key.split('|');
        if (!artist || !title || artist === 'desconhecido') continue;

        const genre = libData.genre || null;
        if (!genre && !libData.year) continue;

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

      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase.from('scraped_songs').insert(batch);
        if (!insertError) inserted += batch.length;
        if (i + BATCH_SIZE < toInsert.length) {
          await new Promise(r => setTimeout(r, 50));
        }
      }

      setCatalogResult({ scanned: result.songs.length, enriched, genres: genresUpdated, years: yearsUpdated, inserted });
      const insertMsg = inserted > 0 ? ` · ${inserted} novas inseridas` : '';
      toast({
        title: '✅ Catalogação Completa',
        description: `${result.songs.length} arquivos lidos · ${enriched} atualizados (${genresUpdated} gêneros, ${yearsUpdated} anos)${insertMsg}`,
      });
    } catch (err) {
      console.error('[CATALOG] Erro:', err);
      toast({ title: '❌ Erro na catalogação', description: String(err), variant: 'destructive' });
    } finally {
      setIsCataloging(false);
    }
  }, [config.musicFolders, deezerConfig?.downloadFolder, toast]);

  const handleQuarantineScan = useCallback(async () => {
    if (!window.electronAPI?.scanQuarantineLibrary) {
      toast({ title: '⚠️ Disponível apenas no desktop', variant: 'destructive' });
      return;
    }

    const allFolders = [
      ...(config.musicFolders || []),
      deezerConfig?.downloadFolder,
    ].filter(Boolean) as string[];

    if (allFolders.length === 0) {
      toast({ title: '⚠️ Nenhuma pasta configurada', description: 'Configure o Banco Musical antes de rodar a quarentena.', variant: 'destructive' });
      return;
    }

    setIsQuarantining(true);
    setQuarantineProgress(null);
    setQuarantineResult(null);

    window.electronAPI.onLibFixProgress?.((progress) => {
      setQuarantineProgress(progress);
    });

    try {
      const result = await window.electronAPI.scanQuarantineLibrary({ musicFolders: allFolders }) as any;
      setQuarantineResult({ scanned: result.scanned, quarantined: result.quarantined, errors: result.errors });
      setQuarantineProgress(null);
      toast({
        title: '🛡️ Quarentena concluída',
        description: `${result.quarantined} arquivo(s) suspeito(s) movidos para ${result.quarantineFolderName} · ${result.errors} erro(s)`,
      });
    } catch (err) {
      toast({ title: '❌ Erro na quarentena', description: String(err), variant: 'destructive' });
    } finally {
      setIsQuarantining(false);
    }
  }, [config.musicFolders, deezerConfig?.downloadFolder, toast]);

  useEffect(() => {
    if (!fixResult) return;
    const timer = setTimeout(() => setFixResult(null), 30000);
    return () => clearTimeout(timer);
  }, [fixResult]);

  useEffect(() => {
    if (!catalogResult) return;
    const timer = setTimeout(() => setCatalogResult(null), 30000);
    return () => clearTimeout(timer);
  }, [catalogResult]);

  useEffect(() => {
    if (!quarantineResult) return;
    const timer = setTimeout(() => setQuarantineResult(null), 30000);
    return () => clearTimeout(timer);
  }, [quarantineResult]);

  const isActive = isFixing || isCataloging || isQuarantining || !!activeDownload;

  return (
    <Card className="glass-card border-indigo-500/20 bg-gradient-to-r from-indigo-500/5 to-transparent">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isActive ? 'bg-indigo-500/20' : 'bg-indigo-500/10'}`}>
              {isFixing || isCataloging || isQuarantining ? (
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
                    {isCataloging ? 'Catalogando' : isQuarantining ? 'Quarentena' : 'Processando'}
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
              {quarantineResult && (
                <div>
                  <p className="text-lg font-bold font-mono text-rose-400 tabular-nums">{quarantineResult.quarantined}</p>
                  <p className="text-[9px] text-muted-foreground uppercase tracking-wide">Quarentena</p>
                </div>
              )}
            </div>

            <div className="flex gap-1.5 flex-wrap justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCatalogScan}
                disabled={isCataloging || isFixing || isQuarantining}
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
                onClick={handleQuarantineScan}
                disabled={isFixing || isCataloging || isQuarantining || !window.electronAPI?.scanQuarantineLibrary}
                className="gap-1.5 text-xs border-rose-500/30 hover:bg-rose-500/10 text-rose-400"
                title="Mover arquivos suspeitos para _QUARENTENA_SUSPEITAS sem apagar a biblioteca"
              >
                {isQuarantining ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Shield className="w-3.5 h-3.5" />
                )}
                Quarentena
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleScanFix}
                disabled={isFixing || isCataloging || isQuarantining || !window.electronAPI?.scanFixLibrary}
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

        {isFixing && fixProgress && (
          <div className="mt-3 space-y-2 p-3 rounded-lg bg-indigo-500/5 border border-indigo-500/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Escaneando biblioteca...</span>
              <span className="font-mono text-indigo-400 font-bold">
                {fixProgress.scanned} escaneados · {fixProgress.renamed || 0} renomeados
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Music className="w-3 h-3 text-indigo-400 shrink-0" />
              <span className="text-muted-foreground truncate">{fixProgress.current}</span>
            </div>
          </div>
        )}

        {isCataloging && (
          <div className="mt-3 flex items-center gap-2 text-xs p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
            <Database className="w-3.5 h-3.5 text-amber-400 shrink-0 animate-pulse" />
            <span className="text-muted-foreground">Lendo tags ID3 do acervo e atualizando gênero/ano no banco...</span>
          </div>
        )}

        {isQuarantining && quarantineProgress && (
          <div className="mt-3 space-y-2 p-3 rounded-lg bg-rose-500/5 border border-rose-500/10">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Verificando divergência entre nome do arquivo e ID3...</span>
              <span className="font-mono text-rose-400 font-bold">
                {quarantineProgress.scanned} escaneados · {quarantineProgress.quarantined || 0} movidos
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <Shield className="w-3 h-3 text-rose-400 shrink-0" />
              <span className="text-muted-foreground truncate">{quarantineProgress.current}</span>
            </div>
          </div>
        )}

        {catalogResult && !isCataloging && (
          <div className="mt-3 flex items-center gap-3 text-xs p-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
            <CheckCircle2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium">{catalogResult.scanned}</span> arquivos lidos ·{' '}
              <span className="text-amber-400 font-medium">{catalogResult.genres}</span> gêneros ·{' '}
              <span className="text-amber-400 font-medium">{catalogResult.years}</span> anos ·{' '}
              <span className="text-emerald-400 font-medium">{catalogResult.inserted}</span> inseridas no banco
            </span>
          </div>
        )}

        {quarantineResult && !isQuarantining && (
          <div className="mt-3 flex items-center gap-3 text-xs p-2 rounded-lg bg-rose-500/5 border border-rose-500/10">
            <CheckCircle2 className="w-3.5 h-3.5 text-rose-400 shrink-0" />
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium">{quarantineResult.scanned}</span> arquivos verificados ·{' '}
              <span className="text-rose-400 font-medium">{quarantineResult.quarantined}</span> movidos para{' '}
              <span className="text-foreground font-medium">_QUARENTENA_SUSPEITAS</span> ·{' '}
              <span className="text-amber-400 font-medium">{quarantineResult.errors}</span> erros
            </span>
          </div>
        )}

        {activeDownload && !isFixing && !isCataloging && !isQuarantining && (
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
