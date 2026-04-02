import { buildAliasEngine } from './aliasEngine';
import { buildBlockedEngine } from './blockedSongsEngine';
import { isVinhetaOrJingle } from './vinhetaFilter';

type SongAlias = {
  fromArtist: string;
  fromTitle: string;
  toArtist: string;
  toTitle: string;
};

type DownloadGuardConfig = {
  blockedSongs?: string[];
  forbiddenWords?: string[];
  songAliases?: SongAlias[];
};

export type DownloadDecision = {
  allowed: boolean;
  reason: 'ok' | 'blocked' | 'vinheta';
  blockRule?: 'exact' | 'alias' | 'vinheta';
  originalArtist: string;
  originalTitle: string;
  downloadArtist: string;
  downloadTitle: string;
};

export function createDownloadGuard({
  blockedSongs = [],
  forbiddenWords = [],
  songAliases = [],
}: DownloadGuardConfig) {
  const aliasEngine = buildAliasEngine(songAliases);
  const blockedEngine = buildBlockedEngine(blockedSongs, forbiddenWords, songAliases);

  return (artist: string, title: string): DownloadDecision => {
    const originalArtist = artist || '';
    const originalTitle = title || '';
    const resolved = aliasEngine.resolve(originalArtist, originalTitle);
    const aliasChanged = resolved.artist !== originalArtist || resolved.title !== originalTitle;

    if (isVinhetaOrJingle(originalArtist, originalTitle) || isVinhetaOrJingle(resolved.artist, resolved.title)) {
      return {
        allowed: false,
        reason: 'vinheta',
        blockRule: 'vinheta',
        originalArtist,
        originalTitle,
        downloadArtist: resolved.artist,
        downloadTitle: resolved.title,
      };
    }

    const aliasBlocked = aliasChanged && blockedEngine.isBlocked(resolved.artist, resolved.title);
    if (blockedEngine.isBlocked(originalArtist, originalTitle) || aliasBlocked) {
      return {
        allowed: false,
        reason: 'blocked',
        blockRule: aliasBlocked ? 'alias' : 'exact',
        originalArtist,
        originalTitle,
        downloadArtist: resolved.artist,
        downloadTitle: resolved.title,
      };
    }

    return {
      allowed: true,
      reason: 'ok',
      originalArtist,
      originalTitle,
      downloadArtist: resolved.artist,
      downloadTitle: resolved.title,
    };
  };
}

export function getDownloadDecision(
  artist: string,
  title: string,
  config: DownloadGuardConfig,
): DownloadDecision {
  return createDownloadGuard(config)(artist, title);
}