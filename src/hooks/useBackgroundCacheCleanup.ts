import { useEffect } from 'react';
import { clearVerificationCache, getVerificationCacheSize } from '@/lib/libraryVerificationCache';

/**
 * Hook that automatically clears the library verification cache
 * when the application goes to background (tab hidden)
 * 
 * This helps reduce memory usage when the user switches to another app
 */
export function useBackgroundCacheCleanup() {
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        const cacheSize = getVerificationCacheSize();
        if (cacheSize > 0) {
          clearVerificationCache();
          console.log(`[BACKGROUND] Cache cleared on hide (was ${cacheSize} entries)`);
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);
}
