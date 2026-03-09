import { useState, useEffect, useCallback, useRef } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface CountdownState {
  nextGradeCountdown: string;
  autoCleanCountdown: string;
  nextGradeSeconds: number;
  autoCleanSeconds: number;
  nextBlockTime: string;
  buildTime: string;
}

// Update every 10 seconds instead of every 1 second to reduce re-renders
const COUNTDOWN_INTERVAL_MS = 10_000;

export function useCountdown() {
  const { config, isRunning } = useRadioStore();
  const [countdown, setCountdown] = useState<CountdownState>({
    nextGradeCountdown: '--:--',
    autoCleanCountdown: '--:--',
    nextGradeSeconds: 0,
    autoCleanSeconds: 0,
    nextBlockTime: '--:--',
    buildTime: '--:--',
  });

  const calculateNextGrade = useCallback(() => {
    if (!isRunning) return { seconds: 0, formatted: '--:--', nextBlockTime: '--:--', buildTime: '--:--' };
    
    const now = new Date();
    const MAX_TOLERANCE = 7;
    const safetyMargin = Math.min(config.safetyMarginMinutes || 7, MAX_TOLERANCE);
    
    const currentMinutes = now.getMinutes();
    const currentHour = now.getHours();
    
    let nextBlockHour = currentHour;
    let nextBlockMinute: number;
    
    if (currentMinutes < 30 - safetyMargin) {
      nextBlockMinute = 30;
    } else if (currentMinutes < 30) {
      nextBlockHour = (currentHour + 1) % 24;
      nextBlockMinute = 0;
    } else if (currentMinutes < 60 - safetyMargin) {
      nextBlockHour = (currentHour + 1) % 24;
      nextBlockMinute = 0;
    } else {
      nextBlockHour = (currentHour + 1) % 24;
      nextBlockMinute = 30;
    }
    
    let buildHour = nextBlockHour;
    let buildMinute = nextBlockMinute - safetyMargin;
    if (buildMinute < 0) {
      buildMinute += 60;
      buildHour = (buildHour - 1 + 24) % 24;
    }
    
    const nextBuildTime = new Date(now);
    nextBuildTime.setHours(buildHour, buildMinute, 0, 0);
    
    if (nextBuildTime <= now) {
      if (nextBlockMinute === 30) {
        nextBlockHour = (nextBlockHour + 1) % 24;
        nextBlockMinute = 0;
      } else {
        nextBlockMinute = 30;
      }
      buildMinute = nextBlockMinute - safetyMargin;
      buildHour = nextBlockHour;
      if (buildMinute < 0) {
        buildMinute += 60;
        buildHour = (buildHour - 1 + 24) % 24;
      }
      nextBuildTime.setHours(buildHour, buildMinute, 0, 0);
      if (nextBuildTime <= now) {
        nextBuildTime.setDate(nextBuildTime.getDate() + 1);
      }
    }
    
    const diffMs = nextBuildTime.getTime() - now.getTime();
    const seconds = Math.max(0, Math.floor(diffMs / 1000));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    const formatTime = (h: number, m: number) => 
      `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    
    return {
      seconds,
      formatted: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
      nextBlockTime: formatTime(nextBlockHour, nextBlockMinute),
      buildTime: formatTime(buildHour, buildMinute),
    };
  }, [config.safetyMarginMinutes, isRunning]);

  const calculateAutoClean = useCallback(() => {
    if (!isRunning) return { seconds: 0, formatted: '--:--' };
    
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    
    const diffMs = nextHour.getTime() - now.getTime();
    const seconds = Math.max(0, Math.floor(diffMs / 1000));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    return {
      seconds,
      formatted: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
    };
  }, [isRunning]);

  // Only run when tab is visible
  const isVisibleRef = useRef(!document.hidden);
  
  useEffect(() => {
    const handler = () => { isVisibleRef.current = !document.hidden; };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  useEffect(() => {
    const updateCountdowns = () => {
      if (!isVisibleRef.current) return; // Skip updates when tab is hidden
      
      const grade = calculateNextGrade();
      const clean = calculateAutoClean();
      
      setCountdown({
        nextGradeCountdown: grade.formatted,
        autoCleanCountdown: clean.formatted,
        nextGradeSeconds: grade.seconds,
        autoCleanSeconds: clean.seconds,
        nextBlockTime: grade.nextBlockTime,
        buildTime: grade.buildTime,
      });
    };

    updateCountdowns();
    const interval = setInterval(updateCountdowns, COUNTDOWN_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [calculateNextGrade, calculateAutoClean]);

  return countdown;
}
