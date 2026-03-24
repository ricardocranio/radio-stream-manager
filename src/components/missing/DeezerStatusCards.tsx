/**
 * DeezerStatusCards - Sub-component for Deezer/deemix status display
 * Handles: Python status, deemix install, version, test buttons
 */
import { AlertCircle, CheckCircle, Download, ExternalLink, Loader2, PlayCircle, RefreshCw, Search, AlertTriangle, Wrench } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DeezerStatusCardsProps {
  isElectron: boolean;
  deezerEnabled: boolean;
  deemixInstalled: boolean | null;
  deemixCommand: string | null;
  deemixVersion: string | null;
  isTestingDeemix: boolean;
  isCheckingDeemix: boolean;
  isInstallingDeemix: boolean;
  deemixInstallMessage: string | null;
  pythonStatus: { available: boolean; command: string | null } | null;
  isCheckingPython: boolean;
  pythonMissingAlert: boolean;
  onTestDeemix: () => void;
  onTestSearch: () => void;
  onCheckDeemix: () => void;
  onCheckPython: () => void;
  onInstallDeemix: () => void;
}

export function DeezerStatusCards({
  isElectron, deezerEnabled,
  deemixInstalled, deemixCommand, deemixVersion,
  isTestingDeemix, isCheckingDeemix, isInstallingDeemix, deemixInstallMessage,
  pythonStatus, isCheckingPython, pythonMissingAlert,
  onTestDeemix, onTestSearch, onCheckDeemix, onCheckPython, onInstallDeemix,
}: DeezerStatusCardsProps) {
  if (!isElectron || !deezerEnabled) return null;

  return (
    <>
      {/* Python/Deemix Missing Alert */}
      {(pythonMissingAlert || deemixInstalled === false) && (
        <Card className={`glass-card border-2 ${pythonMissingAlert ? 'border-red-500/50 bg-red-500/5' : 'border-amber-500/50 bg-amber-500/5'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${pythonMissingAlert ? 'bg-red-500/20' : 'bg-amber-500/20'}`}>
                  <AlertCircle className={`w-6 h-6 ${pythonMissingAlert ? 'text-red-500' : 'text-amber-500'}`} />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    {pythonMissingAlert ? 'Python Não Encontrado' : 'deemix Não Instalado'}
                    <Badge variant="outline" className={pythonMissingAlert ? 'bg-red-500/10 text-red-500 border-red-500/30' : 'bg-amber-500/10 text-amber-500 border-amber-500/30'}>
                      Ação Necessária
                    </Badge>
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {pythonMissingAlert
                      ? 'O Python é necessário para instalar e usar o deemix para downloads do Deezer.'
                      : 'O deemix precisa ser instalado para baixar músicas do Deezer.'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {pythonMissingAlert ? (
                  <Button variant="default" className="bg-red-500 hover:bg-red-600" onClick={() => window.electronAPI?.openExternal('https://www.python.org/downloads/')}>
                    <ExternalLink className="w-4 h-4 mr-2" />
                    Baixar Python
                  </Button>
                ) : (
                  <>
                    {isInstallingDeemix ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">{deemixInstallMessage || 'Instalando...'}</span>
                      </div>
                    ) : (
                      <Button variant="default" className="bg-amber-500 hover:bg-amber-600 text-white" onClick={onInstallDeemix} disabled={isInstallingDeemix}>
                        <Download className="w-4 h-4 mr-2" />
                        Instalar deemix
                      </Button>
                    )}
                  </>
                )}
                <Button variant="outline" size="icon" onClick={() => { onCheckPython(); onCheckDeemix(); }} disabled={isCheckingPython || isCheckingDeemix}>
                  <RefreshCw className={`w-4 h-4 ${(isCheckingPython || isCheckingDeemix) ? 'animate-spin' : ''}`} />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deemix OK Status */}
      {deemixInstalled === true && !pythonMissingAlert && (
        <Card className="glass-card border-green-500/30 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-green-500/20">
                  <CheckCircle className="w-6 h-6 text-green-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-foreground flex items-center gap-2">
                    deemix Pronto
                    <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/30">Funcionando</Badge>
                  </h3>
                  <div className="text-sm text-muted-foreground space-y-0.5">
                    <p className="font-mono">Comando: <span className="text-green-500">{deemixCommand || 'deemix'}</span></p>
                    {deemixVersion && <p className="font-mono">Versão: <span className="text-green-500">{deemixVersion}</span></p>}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={onTestSearch} disabled={isTestingDeemix} title="Testar busca no Deezer">
                  {isTestingDeemix ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Search className="w-4 h-4 mr-2" />}
                  Testar Busca
                </Button>
                <Button variant="outline" size="sm" onClick={onTestDeemix} disabled={isTestingDeemix} title="Testar comando deemix">
                  {isTestingDeemix ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <PlayCircle className="w-4 h-4 mr-2" />}
                  Testar deemix
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Installation Instructions */}
      {deemixInstalled === false && (
        <Card className="glass-card border-destructive/50 bg-destructive/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              {isInstallingDeemix && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {!isInstallingDeemix && <AlertCircle className="h-5 w-5 text-destructive" />}
              Configuração do deemix
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pythonStatus !== null && !pythonStatus.available && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground flex items-center gap-2">
                      Python não encontrado
                      <Badge className="bg-amber-500/20 text-amber-500 border-amber-500/30">Requisito</Badge>
                    </h4>
                    <p className="text-sm text-muted-foreground">O Python é necessário para instalar e executar o deemix</p>
                  </div>
                  <Button onClick={() => window.electronAPI?.openExternal('https://www.python.org/downloads/')} variant="outline" className="gap-2 border-amber-500/50 text-amber-500 hover:bg-amber-500/10">
                    <ExternalLink className="w-4 h-4" />
                    Baixar Python
                  </Button>
                </div>
                <Button variant="outline" size="sm" onClick={onCheckPython} disabled={isCheckingPython} className="w-full">
                  {isCheckingPython ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  Verificar Python novamente
                </Button>
              </div>
            )}

            {pythonStatus?.available && (
              <div className="flex items-center gap-2 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
                <CheckCircle className="w-4 h-4 text-green-500" />
                <span className="text-green-500">Python detectado:</span>
                <code className="text-xs bg-background/50 px-2 py-0.5 rounded">{pythonStatus.command}</code>
              </div>
            )}

            {(pythonStatus === null || pythonStatus.available) && (
              <div className="bg-primary/10 border border-primary/30 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <Wrench className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-foreground">Instalação Automática</h4>
                    <p className="text-sm text-muted-foreground">
                      {pythonStatus?.available ? 'Python detectado! Clique para instalar o deemix' : 'Verificando Python...'}
                    </p>
                  </div>
                  <Button onClick={onInstallDeemix} disabled={isInstallingDeemix || (pythonStatus !== null && !pythonStatus.available)} className="gap-2">
                    {isInstallingDeemix ? <><Loader2 className="w-4 h-4 animate-spin" />Instalando...</> : <><Download className="w-4 h-4" />Instalar deemix</>}
                  </Button>
                </div>
                {isInstallingDeemix && deemixInstallMessage && (
                  <div className="bg-background/50 rounded px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {deemixInstallMessage}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-between pt-2 border-t border-border/50">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Status:</span>
                {isInstallingDeemix ? <Badge className="bg-primary/20 text-primary border-primary/30">Instalando...</Badge> : <Badge variant="destructive">Não encontrado</Badge>}
              </div>
              <Button variant="outline" size="sm" onClick={onCheckDeemix} disabled={isCheckingDeemix || isInstallingDeemix}>
                {isCheckingDeemix ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                Verificar deemix
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">⏱️ Delay de 30s entre downloads para evitar rate limiting do Deezer</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
