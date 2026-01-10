import { useState } from 'react';
import { Folder, FolderPlus, Trash2, Save, HardDrive } from 'lucide-react';
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Pastas e Arquivos</h2>
          <p className="text-muted-foreground">Configure os caminhos das pastas do sistema</p>
        </div>
        <Button onClick={handleSave}>
          <Save className="w-4 h-4 mr-2" />
          Salvar Caminhos
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Music Folders */}
        <Card className="glass-card">
          <CardHeader className="border-b border-border">
            <CardTitle className="flex items-center gap-2">
              <Folder className="w-5 h-5 text-primary" />
              Pastas de Músicas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Pastas onde o sistema irá buscar os arquivos MP3 para a programação.
            </p>
            {localConfig.musicFolders.map((folder, index) => (
              <div key={index} className="flex items-center gap-2">
                <div className="w-8 h-8 rounded bg-secondary flex items-center justify-center">
                  <HardDrive className="w-4 h-4 text-muted-foreground" />
                </div>
                <Input
                  value={folder}
                  onChange={(e) => handleMusicFolderChange(index, e.target.value)}
                  className="flex-1 font-mono text-sm"
                  placeholder="C:\Caminho\Para\Músicas"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive"
                  onClick={() => handleRemoveMusicFolder(index)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" className="w-full" onClick={handleAddMusicFolder}>
              <FolderPlus className="w-4 h-4 mr-2" />
              Adicionar Pasta
            </Button>
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
