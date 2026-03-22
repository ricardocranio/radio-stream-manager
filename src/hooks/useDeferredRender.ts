import { useState, useRef } from 'react';

/**
 * Defers heavy component rendering by waiting for 2 animation frames.
 * Prevents black screen / freeze in Electron when navigating to heavy views.
 */
export function useDeferredRender(): boolean {
  const [isReady, setIsReady] = useState(false);
  const initRef = useRef(false);

  if (!initRef.current) {
    initRef.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsReady(true);
      });
    });
  }

  return isReady;
}
