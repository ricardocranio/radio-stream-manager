import { useState, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface CountdownState {
  nextGradeCountdown: string;
  autoCleanCountdown: string;
  nextGradeSeconds: number;
  autoCleanSeconds: number;
}

export function useCountdown() {
  const { config, lastUpdate, isRunning } = useRadioStore();
  const [countdown, setCountdown] = useState<CountdownState>({
    nextGradeCountdown: '--:--',
    autoCleanCountdown: '--:--',
    nextGradeSeconds: 0,
    autoCleanSeconds: 0,
  });

  // Calculate next grade time based on last update + interval
  const calculateNextGrade = useCallback(() => {
    if (!isRunning) return { seconds: 0, formatted: '--:--' };
    
    const now = new Date();
    const intervalMs = config.updateIntervalMinutes * 60 * 1000;
    
    // If we have lastUpdate, calculate from there
    // Otherwise, calculate from the next interval boundary
    let nextGradeTime: Date;
    
    if (lastUpdate) {
      nextGradeTime = new Date(new Date(lastUpdate).getTime() + intervalMs);
      // If nextGradeTime is in the past, calculate next occurrence
      while (nextGradeTime <= now) {
        nextGradeTime = new Date(nextGradeTime.getTime() + intervalMs);
      }
    } else {
      // Calculate next interval from current time
      const minutes = now.getMinutes();
      const nextInterval = Math.ceil(minutes / config.updateIntervalMinutes) * config.updateIntervalMinutes;
      nextGradeTime = new Date(now);
      nextGradeTime.setMinutes(nextInterval, 0, 0);
      if (nextGradeTime <= now) {
        nextGradeTime = new Date(nextGradeTime.getTime() + intervalMs);
      }
    }
    
    const diffMs = nextGradeTime.getTime() - now.getTime();
    const seconds = Math.max(0, Math.floor(diffMs / 1000));
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    
    return {
      seconds,
      formatted: `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
    };
  }, [config.updateIntervalMinutes, lastUpdate, isRunning]);

  // Calculate auto-clean countdown (runs at hardResetInterval - default 1 hour)
  const calculateAutoClean = useCallback(() => {
    if (!isRunning) return { seconds: 0, formatted: '--:--' };
    
    const now = new Date();
    const hardResetInterval = config.hardResetInterval || 3600; // seconds
    
    // Auto-clean runs every hour on the hour
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
  }, [config.hardResetInterval, isRunning]);

  useEffect(() => {
    const updateCountdowns = () => {
      const grade = calculateNextGrade();
      const clean = calculateAutoClean();
      
      setCountdown({
        nextGradeCountdown: grade.formatted,
        autoCleanCountdown: clean.formatted,
        nextGradeSeconds: grade.seconds,
        autoCleanSeconds: clean.seconds,
      });
    };

    // Update immediately
    updateCountdowns();

    // Update every second
    const interval = setInterval(updateCountdowns, 1000);

    return () => clearInterval(interval);
  }, [calculateNextGrade, calculateAutoClean]);

  return countdown;
}
