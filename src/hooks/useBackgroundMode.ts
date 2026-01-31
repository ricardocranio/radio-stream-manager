import { useState, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface BackgroundModeState {
  isInBackground: boolean;
  powerSavingEnabled: boolean;
  reducedRefreshInterval: number; // multiplier for intervals when in background
}

/**
 * Hook to detect when the app is in the background and enable power saving mode
 * Reduces update frequencies when the tab/window is not visible
 */
export function useBackgroundMode() {
  const [state, setState] = useState<BackgroundModeState>({
    isInBackground: false,
    powerSavingEnabled: false,
    reducedRefreshInterval: 1, // 1x = normal, 3x = 3 times slower
  });

  // Get power saving setting from store (enabled by default for lighter resource usage)
  const config = useRadioStore((s) => s.config);
  const powerSavingEnabled = (config as any).powerSavingMode ?? true;

  // Detect visibility change
  useEffect(() => {
    const handleVisibilityChange = () => {
      const isHidden = document.hidden;
      
      setState(prev => ({
        ...prev,
        isInBackground: isHidden,
        reducedRefreshInterval: isHidden && powerSavingEnabled ? 3 : 1,
      }));

      if (isHidden && powerSavingEnabled) {
        console.log('[POWER-SAVING] App in background - reducing update frequency');
      } else if (!isHidden) {
        console.log('[POWER-SAVING] App in foreground - normal update frequency');
      }
    };

    // Handle window blur/focus (for Electron)
    const handleWindowBlur = () => {
      if (powerSavingEnabled) {
        setState(prev => ({
          ...prev,
          isInBackground: true,
          reducedRefreshInterval: 3,
        }));
      }
    };

    const handleWindowFocus = () => {
      setState(prev => ({
        ...prev,
        isInBackground: false,
        reducedRefreshInterval: 1,
      }));
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);

    // Initial check
    handleVisibilityChange();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [powerSavingEnabled]);

  // Update power saving enabled state
  useEffect(() => {
    setState(prev => ({
      ...prev,
      powerSavingEnabled,
      reducedRefreshInterval: prev.isInBackground && powerSavingEnabled ? 3 : 1,
    }));
  }, [powerSavingEnabled]);

  // Get adjusted interval based on background state
  const getAdjustedInterval = useCallback((baseIntervalMs: number) => {
    return baseIntervalMs * state.reducedRefreshInterval;
  }, [state.reducedRefreshInterval]);

  return {
    isInBackground: state.isInBackground,
    powerSavingEnabled: state.powerSavingEnabled,
    reducedRefreshInterval: state.reducedRefreshInterval,
    getAdjustedInterval,
  };
}

// Singleton for global access without hook
let globalBackgroundState = {
  isInBackground: false,
  powerSavingEnabled: false,
};

export function initGlobalBackgroundDetection(powerSavingEnabled: boolean) {
  globalBackgroundState.powerSavingEnabled = powerSavingEnabled;

  const handleVisibilityChange = () => {
    globalBackgroundState.isInBackground = document.hidden;
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  handleVisibilityChange();

  return () => {
    document.removeEventListener('visibilitychange', handleVisibilityChange);
  };
}

export function getGlobalBackgroundState() {
  return globalBackgroundState;
}

export function shouldReduceUpdates(): boolean {
  return globalBackgroundState.isInBackground && globalBackgroundState.powerSavingEnabled;
}
