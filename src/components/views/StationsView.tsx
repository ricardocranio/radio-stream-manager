import { useState } from 'react';
import { Radio, Plus, Trash2, ExternalLink, Save, X } from 'lucide-react';
import { useRadioStore } from '@/store/radioStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RadioStation } from '@/types/radio';
import { useToast } from '@/hooks/use-toast';

export function StationsView() {
  const { stations, updateStation, setStations } = useRadioStore();
  const { toast } = useToast();
  const [editingStation, setEditingStation] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RadioStation | null>(null);

  const handleEdit = (station: RadioStation) => {
    setEditingStation(station.id);
    setEditForm({ ...station });
  };

  const handleSave = () => {
    if (editForm) {
      updateStation(editForm.id, editForm);
      setEditingStation(null);
      setEditForm(null);
      toast({
        title: 'Emissora atualizada',
        description: `${editForm.name} foi atualizada com sucesso.`,
      });
    }
  };

  const handleCancel = () => {
    setEditingStation(null);
    setEditForm(null);
  };

  const handleAddUrl = () => {
    if (editForm) {
      setEditForm({
        ...editForm,
        urls: [...editForm.urls, ''],
      });
    }
  };

  const handleRemoveUrl = (index: number) => {
    if (editForm) {
      setEditForm({
        ...editForm,
        urls: editForm.urls.filter((_, i) => i !== index),
      });
    }
  };

  const handleUrlChange = (index: number, value: string) => {
    if (editForm) {
      const newUrls = [...editForm.urls];
      newUrls[index] = value;
      setEditForm({ ...editForm, urls: newUrls });
    }
  };

  const handleStyleChange = (style: string) => {
    if (editForm) {
      const styles = editForm.styles.includes(style)
        ? editForm.styles.filter((s) => s !== style)
        : [...editForm.styles, style];
      setEditForm({ ...editForm, styles });
    }
  };

  const allStyles = ['SERTANEJO', 'PAGODE', 'AGRONEJO', 'POP/VARIADO', 'TEEN/HITS', 'DANCE', 'HITS'];

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Emissoras</h2>
          <p className="text-muted-foreground">Gerencie os links e configurações das emissoras de rádio</p>
        </div>
        <Button className="gap-2">
          <Plus className="w-4 h-4" />
          Nova Emissora
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {stations.map((station) => {
          const isEditing = editingStation === station.id;
          const data = isEditing && editForm ? editForm : station;

          return (
            <Card key={station.id} className="glass-card radio-card">
              <CardHeader className="border-b border-border pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Radio className="w-5 h-5 text-primary" />
                    </div>
                    {isEditing ? (
                      <Input
                        value={editForm?.name || ''}
                        onChange={(e) =>
                          setEditForm((prev) => prev && { ...prev, name: e.target.value })
                        }
                        className="w-40"
                      />
                    ) : (
                      <span>{station.name}</span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={data.enabled}
                      onCheckedChange={(checked) =>
                        isEditing
                          ? setEditForm((prev) => prev && { ...prev, enabled: checked })
                          : updateStation(station.id, { enabled: checked })
                      }
                    />
                    <Label className="text-xs text-muted-foreground">
                      {data.enabled ? 'Ativo' : 'Inativo'}
                    </Label>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                {/* URLs */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">URLs</Label>
                  <div className="mt-2 space-y-2">
                    {data.urls.map((url, index) => (
                      <div key={index} className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <Input
                              value={url}
                              onChange={(e) => handleUrlChange(index, e.target.value)}
                              className="flex-1 font-mono text-xs"
                              placeholder="https://..."
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => handleRemoveUrl(index)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-xs font-mono text-primary hover:underline truncate"
                          >
                            <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            <span className="truncate">{url}</span>
                          </a>
                        )}
                      </div>
                    ))}
                    {isEditing && (
                      <Button variant="outline" size="sm" className="w-full mt-2" onClick={handleAddUrl}>
                        <Plus className="w-4 h-4 mr-2" />
                        Adicionar URL
                      </Button>
                    )}
                  </div>
                </div>

                {/* Styles */}
                <div>
                  <Label className="text-xs text-muted-foreground uppercase tracking-wide">Estilos</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {isEditing ? (
                      allStyles.map((style) => (
                        <Badge
                          key={style}
                          variant={data.styles.includes(style) ? 'default' : 'outline'}
                          className="cursor-pointer transition-all"
                          onClick={() => handleStyleChange(style)}
                        >
                          {style}
                        </Badge>
                      ))
                    ) : (
                      data.styles.map((style) => (
                        <Badge key={style} variant="secondary">
                          {style}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex justify-end gap-2 pt-2 border-t border-border">
                  {isEditing ? (
                    <>
                      <Button variant="ghost" size="sm" onClick={handleCancel}>
                        <X className="w-4 h-4 mr-2" />
                        Cancelar
                      </Button>
                      <Button size="sm" onClick={handleSave}>
                        <Save className="w-4 h-4 mr-2" />
                        Salvar
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => handleEdit(station)}>
                      Editar
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
