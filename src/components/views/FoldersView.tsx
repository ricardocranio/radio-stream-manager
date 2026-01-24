import { useState, useEffect, useRef, useCallback } from 'react';
import { Folder, FolderPlus, Trash2, Save, HardDrive, CheckCircle } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';

export function FoldersView() {
  const { config, setConfig } = useRadioStore();
  const { toast } = useToast();
  const [localConfig, setLocalConfig] = useState(config);
  const [isSaved, setIsSaved] = useState(true);
  
  // Track if initial load is complete to avoid auto-save on mount
  const isInitialMount = useRef(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-save localConfig when it changes (with debounce)
  const autoSaveConfig = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    
    setIsSaved(false);
    
    saveTimeoutRef.current = setTimeout(() => {
      setConfig(localConfig);
      setIsSaved(true);
      console.log('[FOLDERS] ✓ Auto-saved paths:', {
        gradeFolder: localConfig.gradeFolder,
        contentFolder: localConfig.contentFolder,
      });
    }, 800); // 800ms debounce
  }, [localConfig, setConfig]);

  useEffect(() => {
    // Skip auto-save on initial mount
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    
    autoSaveConfig();
    
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [localConfig, autoSaveConfig]);

  // Sync localConfig when store config changes externally
  useEffect(() => {
    setLocalConfig(config);
  }, [config]);

  const handleSave = () => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    setConfig(localConfig);
    setIsSaved(true);
    toast({
      title: '✓ Configurações salvas',
      description: 'Os caminhos das pastas foram atualizados.',
    });
  };

  const handleAddMusicFolder = () => {
    setLocalConfig((prev) => ({
      ...prev,
      musicFolders: [...prev.musicFolders, ''],
    }));
  };

  const handleRemoveMusicFolder = (index: number) => {
    setLocalConfig((prev) => ({
      ...prev,
      musicFolders: prev.musicFolders.filter((_, i) => i !== index),
    }));
  };

  const handleMusicFolderChange = (index: number, value: string) => {
    setLocalConfig((prev) => ({
      ...prev,
      musicFolders: prev.musicFolders.map((f, i) => (i === index ? value : f)),
    }));
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold text-foreground">Pastas e Arquivos</h2>
          <p className="text-muted-foreground text-sm">
            Configure os caminhos das pastas do sistema
            {isSaved ? (
              <span className="text-emerald-500 ml-2 inline-flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Salvo
              </span>
            ) : (
              <span className="text-amber-500 ml-2">Salvando...</span>
            )}
          </p>
        </div>
        <Button size="sm" onClick={handleSave} className="shrink-0">
          <Save className="w-4 h-4 sm:mr-2" />
          <span className="hidden sm:inline">Salvar Caminhos</span>
          <span className="sm:hidden">Salvar</span>
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Info about Music Folders */}
        <Card className="glass-card border-blue-500/20">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Folder className="w-5 h-5 text-blue-500" />
              Banco Musical
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              As pastas do banco musical agora são configuradas na aba <strong>Configurações</strong>.
            </p>
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <p className="text-sm text-blue-400 font-medium">
                📁 {config.musicFolders.length} {config.musicFolders.length === 1 ? 'pasta configurada' : 'pastas configuradas'}
              </p>
              <div className="mt-2 space-y-1">
                {config.musicFolders.map((folder, idx) => (
                  <p key={idx} className="text-xs text-muted-foreground font-mono truncate">
                    {folder || '(vazia)'}
                  </p>
                ))}
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Vá para <strong>Configurações → Banco Musical</strong> para adicionar ou remover pastas.
            </p>
          </CardContent>
        </Card>

        {/* Other Paths */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Folder className="w-5 h-5 text-accent" />
              Outros Caminhos
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Pasta de Grades
              </Label>
              <Input
                value={localConfig.gradeFolder}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, gradeFolder: e.target.value }))
                }
                className="mt-2 font-mono text-sm"
                placeholder="C:\Playlist\pgm\Grades"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Onde os arquivos de grade (.txt) serão salvos
              </p>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Pasta de Conteúdos
              </Label>
              <Input
                value={localConfig.contentFolder}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, contentFolder: e.target.value }))
                }
                className="mt-2 font-mono text-sm"
                placeholder="G:\Conteudos KF"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Conteúdos fixos como notícias, horóscopo, etc.
              </p>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Arquivo de Ranking
              </Label>
              <Input
                value={localConfig.rankingFile}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, rankingFile: e.target.value }))
                }
                className="mt-2 font-mono text-sm"
                placeholder="C:\Playlist\pgm\ranking_sucessos.json"
              />
              <p className="text-xs text-muted-foreground mt-1">
                JSON com ranking de músicas mais tocadas
              </p>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                Código Coringa
              </Label>
              <Input
                value={localConfig.coringaCode}
                onChange={(e) =>
                  setLocalConfig((prev) => ({ ...prev, coringaCode: e.target.value }))
                }
                className="mt-2 font-mono text-sm w-32"
                placeholder="mus"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Código usado quando não há música disponível
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
