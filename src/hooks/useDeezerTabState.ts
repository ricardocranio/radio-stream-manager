/**
 * useDeezerTabState - Manages deemix daemon status, version checks, pip install, Python detection
 */
import { useState, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';
import { useToast } from '@/hooks/use-toast';

const isElectron = typeof window !== 'undefined' && window.electronAPI?.isElectron;

export function useDeezerTabState() {
  const { deezerConfig } = useRadioStore();
  const { toast } = useToast();

  const [deemixInstalled, setDeemixInstalled] = useState<boolean | null>(null);
  const [deemixCommand, setDeemixCommand] = useState<string | null>(null);
  const [deemixVersion, setDeemixVersion] = useState<string | null>(null);
  const [isTestingDeemix, setIsTestingDeemix] = useState(false);
  const [isCheckingDeemix, setIsCheckingDeemix] = useState(false);
  const [isInstallingDeemix, setIsInstallingDeemix] = useState(false);
  const [deemixInstallMessage, setDeemixInstallMessage] = useState<string | null>(null);
  const [pythonStatus, setPythonStatus] = useState<{ available: boolean; command: string | null } | null>(null);
  const [isCheckingPython, setIsCheckingPython] = useState(false);
  const [pythonMissingAlert, setPythonMissingAlert] = useState(false);

  const fetchDeemixCommand = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.getDeemixCommand) return;
    try {
      const command = await window.electronAPI.getDeemixCommand();
      setDeemixCommand(command);
    } catch {
      setDeemixCommand(null);
    }
  }, []);

  const checkPythonStatus = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.checkPython) return;
    setIsCheckingPython(true);
    try {
      const status = await window.electronAPI.checkPython();
      setPythonStatus(status);
      if (!status.available) setPythonMissingAlert(true);
    } catch {
      setPythonStatus({ available: false, command: null });
    }
    setIsCheckingPython(false);
  }, []);

  const testDeemix = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.testDeemix) return { success: false };
    setIsTestingDeemix(true);
    try {
      const result = await window.electronAPI.testDeemix();
      if (result.success) {
        setDeemixVersion(result.version || null);
        setDeemixCommand(result.command || null);
        toast({ title: '✅ deemix Testado!', description: result.message || `Versão: ${result.version}` });
      } else {
        toast({ title: '⚠️ Teste do deemix falhou', description: result.error || 'Erro desconhecido', variant: 'destructive' });
      }
      return result;
    } catch (err) {
      toast({ title: 'Erro no teste', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
      return { success: false };
    } finally {
      setIsTestingDeemix(false);
    }
  }, [toast]);

  const testDeemixSearch = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.testDeemixSearch) return { success: false };
    setIsTestingDeemix(true);
    try {
      const result = await window.electronAPI.testDeemixSearch({ artist: 'Queen', title: 'Bohemian Rhapsody' });
      if (result.success && result.track) {
        toast({ title: '✅ Busca Deezer OK!', description: `Encontrado: ${result.track.artist} - ${result.track.title}` });
      } else {
        toast({ title: '⚠️ Busca falhou', description: result.error || 'Música não encontrada', variant: 'destructive' });
      }
      return result;
    } catch (err) {
      toast({ title: 'Erro na busca', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
      return { success: false };
    } finally {
      setIsTestingDeemix(false);
    }
  }, [toast]);

  const checkDeemixStatus = useCallback(async () => {
    if (!isElectron) return;
    setIsCheckingDeemix(true);
    try {
      const installed = await window.electronAPI?.checkDeemix();
      setDeemixInstalled(installed ?? false);
      if (installed) {
        fetchDeemixCommand();
        await testDeemix();
      }
    } catch {
      setDeemixInstalled(false);
    }
    setIsCheckingDeemix(false);
  }, [fetchDeemixCommand, testDeemix]);

  const handleInstallDeemix = useCallback(async () => {
    if (!isElectron || !window.electronAPI?.installDeemix) return;
    setIsInstallingDeemix(true);
    setDeemixInstallMessage('Iniciando instalação...');
    try {
      const result = await window.electronAPI.installDeemix();
      if (result.success) {
        setDeemixInstalled(true);
        setDeemixInstallMessage('Testando instalação...');
        const testResult = await testDeemix();
        toast({
          title: testResult.success ? '✅ deemix Instalado e Testado!' : '⚠️ deemix Instalado',
          description: testResult.success
            ? `${result.message || 'Instalação concluída.'} Versão: ${testResult.version || 'detectada'}`
            : 'Instalação concluída, mas o teste falhou. Pode ser necessário reiniciar.',
        });
      } else {
        toast({ title: '❌ Erro na instalação', description: result.error || 'Falha ao instalar deemix.', variant: 'destructive' });
        if (result.needsPython) window.electronAPI?.openExternal('https://www.python.org/downloads/');
        if (result.needsRestart) toast({ title: '🔄 Reinicie o aplicativo', description: 'O deemix foi instalado. Reinicie o aplicativo para detectá-lo.' });
      }
    } catch (err) {
      toast({ title: 'Erro', description: err instanceof Error ? err.message : 'Erro desconhecido', variant: 'destructive' });
    } finally {
      setIsInstallingDeemix(false);
      setDeemixInstallMessage(null);
    }
  }, [testDeemix, toast]);

  // Listen for events on mount
  useEffect(() => {
    if (!isElectron) return;

    if (window.electronAPI?.onDeemixInstallProgress) {
      window.electronAPI.onDeemixInstallProgress((progress) => {
        setDeemixInstallMessage(progress.message);
        if (progress.status === 'success' || progress.status === 'error') {
          setIsInstallingDeemix(false);
          if (progress.status === 'success') {
            setDeemixInstalled(true);
            fetchDeemixCommand();
          }
        }
      });
    }

    if (window.electronAPI?.onPythonStatus) {
      window.electronAPI.onPythonStatus((status) => {
        if (!status.available) {
          setPythonMissingAlert(true);
          setPythonStatus({ available: false, command: null });
        }
      });
    }

    if (window.electronAPI?.onDeemixStatus) {
      window.electronAPI.onDeemixStatus((status) => {
        setDeemixInstalled(status.installed);
        setDeemixCommand(status.command);
      });
    }
  }, [fetchDeemixCommand]);

  // Check on mount if deezer enabled
  useEffect(() => {
    if (isElectron && deezerConfig.enabled) {
      checkDeemixStatus();
      checkPythonStatus();
      fetchDeemixCommand();
    }
  }, [deezerConfig.enabled, checkDeemixStatus, checkPythonStatus, fetchDeemixCommand]);

  return {
    deemixInstalled, deemixCommand, deemixVersion,
    isTestingDeemix, isCheckingDeemix, isInstallingDeemix, deemixInstallMessage,
    pythonStatus, isCheckingPython, pythonMissingAlert,
    testDeemix, testDeemixSearch, checkDeemixStatus, checkPythonStatus,
    handleInstallDeemix, fetchDeemixCommand,
    isElectron: !!isElectron,
  };
}
