import { useState, useEffect } from 'react';
import { Folder, FolderPlus, Trash2, Save, HardDrive, Music, Wrench, Loader2 } from 'lucide-react';
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
  const [isFixing, setIsFixing] = useState(false);
  const [fixProgress, setFixProgress] = useState<{ scanned: number; renamed: number; current: string } | null>(null);

  const handleSave = () => {
    setConfig(localConfig);
    toast({
      title: 'Configurações salvas',
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
          <p className="text-muted-foreground text-sm">Configure os caminhos das pastas do sistema</p>
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

        {/* Library Fix Tool */}
        <Card className="glass-card border-primary/20">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-primary" />
              Corrigir Nomes da Biblioteca
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Escaneia todos os MP3 das pastas musicais, lê as <strong>ID3 tags</strong> reais 
              (artista e título embutidos no arquivo) e renomeia automaticamente os que estiverem errados.
            </p>
            {fixProgress && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20 space-y-1">
                <p className="text-sm font-mono text-primary">
                  📂 {fixProgress.scanned} escaneados · ✅ {fixProgress.renamed} renomeados
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {fixProgress.current}
                </p>
              </div>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={isFixing || !window.electronAPI?.scanFixLibrary}
              onClick={async () => {
                if (!window.electronAPI?.scanFixLibrary) {
                  toast({ title: '⚠️ Disponível apenas no Electron', variant: 'destructive' });
                  return;
                }
                setIsFixing(true);
                setFixProgress(null);
                
                // Listen for progress
                const cleanup = window.electronAPI.onLibFixProgress?.((progress) => {
                  setFixProgress(progress);
                });
                
                try {
                  const result = await window.electronAPI.scanFixLibrary({ musicFolders: config.musicFolders });
                  toast({
                    title: '✅ Biblioteca corrigida',
                    description: `${result.scanned} arquivos escaneados, ${result.renamed} renomeados, ${result.errors} erros`,
                  });
                  setFixProgress({ scanned: result.scanned, renamed: result.renamed, current: 'Concluído!' });
                } catch (err) {
                  toast({ title: '❌ Erro ao corrigir biblioteca', description: String(err), variant: 'destructive' });
                } finally {
                  setIsFixing(false);
                }
              }}
              className="w-full"
            >
              {isFixing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Corrigindo...
                </>
              ) : (
                <>
                  <Wrench className="w-4 h-4 mr-2" />
                  Corrigir Nomes Automaticamente
                </>
              )}
            </Button>
            <p className="text-xs text-muted-foreground">
              ⚡ Não baixa nada — apenas renomeia arquivos existentes baseado nas ID3 tags.
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
              <Label className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <Music className="w-3 h-3" />
                Pasta de Vinhetas (VHT)
              </Label>
              <div className="flex gap-2 mt-2">
                <Input
                  value={localConfig.vinhetasFolder || 'C:\\Playlist\\Vinhetas'}
                  onChange={(e) =>
                    setLocalConfig((prev) => ({ ...prev, vinhetasFolder: e.target.value }))
                  }
                  className="font-mono text-sm flex-1"
                  placeholder="C:\Playlist\Vinhetas"
                />
                {typeof window !== 'undefined' && window.electronAPI?.selectFolder && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={async () => {
                      const folder = await window.electronAPI!.selectFolder();
                      if (folder) {
                        setLocalConfig((prev) => ({ ...prev, vinhetasFolder: folder }));
                        toast({ title: '📂 Pasta de vinhetas selecionada', description: folder });
                      }
                    }}
                  >
                    <Folder className="w-4 h-4" />
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Arquivos .mp3 de vinhetas usados entre músicas na grade (VHT)
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
