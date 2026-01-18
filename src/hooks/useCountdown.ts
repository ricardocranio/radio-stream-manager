import { useState, useEffect, useCallback } from 'react';
import { useRadioStore } from '@/store/radioStore';

interface CountdownState {
  nextGradeCountdown: string;
  autoCleanCountdown: string;
  nextGradeSeconds: number;
  autoCleanSeconds: number;
  nextBlockTime: string; // The block time that will be built (e.g., "18:30")
  buildTime: string; // When the grade will be built (e.g., "18:20")
}

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

  // Calculate next grade time - MAX 7 minutes before the next block
  // Blocks are every 30 minutes: 00:00, 00:30, 01:00, 01:30, etc.
  const calculateNextGrade = useCallback(() => {
    if (!isRunning) return { seconds: 0, formatted: '--:--', nextBlockTime: '--:--', buildTime: '--:--' };
    
    const now = new Date();
    const MAX_TOLERANCE = 7; // Maximum 7 minutes before block
    const safetyMargin = Math.min(config.safetyMarginMinutes || 7, MAX_TOLERANCE);
    
    // Find the next block time (blocks are at :00 and :30 of each hour)
    const currentMinutes = now.getMinutes();
    const currentHour = now.getHours();
    
    let nextBlockHour = currentHour;
    let nextBlockMinute: number;
    
    if (currentMinutes < 30 - safetyMargin) {
      // Next block is at :30, build at :30 - safetyMargin
      nextBlockMinute = 30;
    } else if (currentMinutes < 30) {
      // Between :20 and :30, next block is at next hour :00
      nextBlockHour = (currentHour + 1) % 24;
      nextBlockMinute = 0;
    } else if (currentMinutes < 60 - safetyMargin) {
      // Next block is at :00 of next hour, build at :00 - safetyMargin
      nextBlockHour = (currentHour + 1) % 24;
      nextBlockMinute = 0;
    } else {
      // Between :50 and :00, next block is at next hour :30
      nextBlockHour = (currentHour + 1) % 24;
      nextBlockMinute = 30;
    }
    
    // Calculate build time (safetyMargin minutes before block)
    let buildHour = nextBlockHour;
    let buildMinute = nextBlockMinute - safetyMargin;
    if (buildMinute < 0) {
      buildMinute += 60;
      buildHour = (buildHour - 1 + 24) % 24;
    }
    
    // Create the build time date
    const nextBuildTime = new Date(now);
    nextBuildTime.setHours(buildHour, buildMinute, 0, 0);
    
    // If build time is in the past, it means we're waiting for the next cycle
    if (nextBuildTime <= now) {
      // Move to next block
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
      // If still in the past (crossed midnight), add a day
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

  // Calculate auto-clean countdown (runs every hour on the hour)
  const calculateAutoClean = useCallback(() => {
    if (!isRunning) return { seconds: 0, formatted: '--:--' };
    
    const now = new Date();
    
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
  }, [isRunning]);

  useEffect(() => {
    const updateCountdowns = () => {
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

    // Update immediately
    updateCountdowns();

    // Update every second
    const interval = setInterval(updateCountdowns, 1000);

    return () => clearInterval(interval);
  }, [calculateNextGrade, calculateAutoClean]);

  return countdown;
}
