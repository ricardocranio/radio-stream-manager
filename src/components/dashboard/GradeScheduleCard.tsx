import { useState, useMemo } from 'react';
import { Clock, Eye, Save, X, Music, Newspaper, Edit2, FileText } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useRadioStore, BlockSong, FixedContent } from '@/store/radioStore';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';

interface BlockInfo {
  time: string;
  label: 'anterior' | 'atual' | 'proximo';
  programName: string;
  songs: BlockSong[];
  fixedContent: FixedContent[];
}

export function GradeScheduleCard() {
  const { blockSongs, programs, fixedContent, setBlockSongs } = useRadioStore();
  const { toast } = useToast();
  const [selectedBlock, setSelectedBlock] = useState<BlockInfo | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editedSongs, setEditedSongs] = useState<BlockSong[]>([]);

  // Get current time and calculate blocks
  const blocks = useMemo(() => {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentBlock = currentMinute < 30 ? 0 : 30;

    // Generate 5 blocks: 2 previous, current, 2 next
    const blockList: BlockInfo[] = [];
    
    for (let offset = -2; offset <= 2; offset++) {
      let blockMinute = currentBlock + (offset * 30);
      let blockHour = currentHour;
      
      // Adjust for negative minutes or overflow
      while (blockMinute < 0) {
        blockMinute += 60;
        blockHour -= 1;
      }
      while (blockMinute >= 60) {
        blockMinute -= 60;
        blockHour += 1;
      }
      
      // Handle day overflow
      if (blockHour < 0) blockHour += 24;
      if (blockHour >= 24) blockHour -= 24;
      
      const timeKey = `${blockHour.toString().padStart(2, '0')}:${blockMinute.toString().padStart(2, '0')}`;
      
      // Get program name for this hour
      let programName = 'PROGRAMA';
      for (const prog of programs) {
        const [start, end] = prog.timeRange.split('-').map(Number);
        if (blockHour >= start && blockHour <= end) {
          programName = prog.programName;
          break;
        }
      }
      
      // Get fixed content for this time slot
      const slotFixedContent = fixedContent.filter(fc => 
        fc.enabled && fc.timeSlots.some(ts => ts.hour === blockHour && ts.minute === blockMinute)
      );
      
      // Get songs for this block
      const songs = blockSongs[timeKey] || [];
      
      blockList.push({
        time: timeKey,
        label: offset < 0 ? 'anterior' : offset === 0 ? 'atual' : 'proximo',
        programName,
        songs,
        fixedContent: slotFixedContent,
      });
    }
    
    return blockList;
  }, [blockSongs, programs, fixedContent]);

  // Handle opening block details
  const handleViewBlock = (block: BlockInfo) => {
    setSelectedBlock(block);
    setEditedSongs([...block.songs]);
    setIsEditing(false);
  };

  // Handle edit mode
  const handleStartEdit = () => {
    if (selectedBlock) {
      setEditedSongs([...selectedBlock.songs]);
      setIsEditing(true);
    }
  };

  // Handle save changes
  const handleSaveChanges = () => {
    if (selectedBlock) {
      setBlockSongs(selectedBlock.time, editedSongs);
      setSelectedBlock({ ...selectedBlock, songs: editedSongs });
      setIsEditing(false);
      toast({
        title: '✅ Bloco atualizado',
        description: `Grade das ${selectedBlock.time} foi salva.`,
      });
    }
  };

  // Handle song edit
  const handleEditSong = (index: number, field: keyof BlockSong, value: string) => {
    const updated = [...editedSongs];
    updated[index] = { ...updated[index], [field]: value };
    setEditedSongs(updated);
  };

  // Get label styles
  const getLabelStyle = (label: BlockInfo['label']) => {
    switch (label) {
      case 'anterior':
        return 'bg-muted text-muted-foreground border-border';
      case 'atual':
        return 'bg-emerald-500/20 text-emerald-500 border-emerald-500/30';
      case 'proximo':
        return 'bg-amber-500/20 text-amber-500 border-amber-500/30';
    }
  };

  return (
    <>
      <Card className="glass-card border-emerald-500/20 flex flex-col">
        <CardHeader className="pb-3 border-b border-border shrink-0">
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-500 shrink-0" />
            <span className="truncate">Grades Montadas</span>
            <Badge variant="outline" className="ml-auto text-[10px]">
              5 blocos
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3 flex-1 min-h-0">
          <div className="space-y-2">
            {blocks.map((block) => (
              <div
                key={block.time}
                className={`p-2.5 rounded-lg border transition-all cursor-pointer hover:scale-[1.01] ${getLabelStyle(block.label)}`}
                onClick={() => handleViewBlock(block)}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span className="font-mono font-bold text-sm">{block.time}</span>
                    </div>
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      {block.programName}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="flex items-center gap-1 text-xs">
                      <Music className="w-3 h-3" />
                      <span>{block.songs.length}</span>
                    </div>
                    {block.fixedContent.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-purple-400">
                        <Newspaper className="w-3 h-3" />
                        <span>{block.fixedContent.length}</span>
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleViewBlock(block);
                      }}
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {block.label === 'atual' && (
                  <Badge className="mt-1.5 text-[9px] bg-emerald-500/30 text-emerald-400 border-0">
                    ● BLOCO ATUAL
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Block Details Dialog */}
      <Dialog open={!!selectedBlock} onOpenChange={(open) => !open && setSelectedBlock(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-primary" />
              Bloco {selectedBlock?.time}
              <Badge variant="outline" className="ml-2">
                {selectedBlock?.programName}
              </Badge>
            </DialogTitle>
          </DialogHeader>
          
          {selectedBlock && (
            <div className="space-y-4">
              {/* Fixed Content */}
              {selectedBlock.fixedContent.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2">
                    <Newspaper className="w-4 h-4 text-purple-400" />
                    Conteúdos Fixos ({selectedBlock.fixedContent.length})
                  </h4>
                  <div className="space-y-1">
                    {selectedBlock.fixedContent.map((fc) => (
                      <div
                        key={fc.id}
                        className="p-2 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center gap-2"
                      >
                        <Newspaper className="w-4 h-4 text-purple-400 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{fc.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{fc.fileName}</p>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {fc.type}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Songs */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                    <Music className="w-4 h-4 text-primary" />
                    Músicas ({selectedBlock.songs.length})
                  </h4>
                  {!isEditing ? (
                    <Button variant="outline" size="sm" onClick={handleStartEdit} className="gap-1.5">
                      <Edit2 className="w-3.5 h-3.5" />
                      Editar
                    </Button>
                  ) : (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setIsEditing(false)}>
                        <X className="w-3.5 h-3.5 mr-1" />
                        Cancelar
                      </Button>
                      <Button variant="default" size="sm" onClick={handleSaveChanges} className="gap-1.5">
                        <Save className="w-3.5 h-3.5" />
                        Salvar
                      </Button>
                    </div>
                  )}
                </div>
                
                <ScrollArea className="h-[280px]">
                  <div className="space-y-1.5 pr-2">
                    {(isEditing ? editedSongs : selectedBlock.songs).map((song, index) => (
                      <div
                        key={song.id}
                        className={`p-2 rounded-lg border ${song.isFixed ? 'bg-purple-500/10 border-purple-500/20' : 'bg-secondary/30 border-border'}`}
                      >
                        {isEditing ? (
                          <div className="space-y-1.5">
                            <Input
                              value={song.title}
                              onChange={(e) => handleEditSong(index, 'title', e.target.value)}
                              className="h-7 text-sm"
                              placeholder="Título"
                            />
                            <Input
                              value={song.artist}
                              onChange={(e) => handleEditSong(index, 'artist', e.target.value)}
                              className="h-7 text-sm"
                              placeholder="Artista"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground font-mono w-5 shrink-0">
                              {(index + 1).toString().padStart(2, '0')}
                            </span>
                            {song.isFixed ? (
                              <Newspaper className="w-4 h-4 text-purple-400 shrink-0" />
                            ) : (
                              <Music className="w-4 h-4 text-primary shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground truncate">{song.title}</p>
                              <p className="text-xs text-muted-foreground truncate">{song.artist}</p>
                            </div>
                            <Badge variant="outline" className="text-[10px] shrink-0">
                              {song.source}
                            </Badge>
                          </div>
                        )}
                      </div>
                    ))}
                    
                    {selectedBlock.songs.length === 0 && (
                      <div className="text-center py-8 text-muted-foreground">
                        <Music className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">Nenhuma música neste bloco</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
