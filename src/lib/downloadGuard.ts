import { buildAliasEngine } from './aliasEngine';
import { buildBlockedEngine, type BlockedRule } from './blockedSongsEngine';
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

type DownloadDecisionBase = {
  originalArtist: string;
  originalTitle: string;
  downloadArtist: string;
  downloadTitle: string;
};

export type DownloadDecision =
  | (DownloadDecisionBase & {
      allowed: true;
      reason: 'ok';
    })
  | (DownloadDecisionBase & {
      allowed: false;
      reason: 'blocked';
      blockRule: BlockedRule;
    })
  | (DownloadDecisionBase & {
      allowed: false;
      reason: 'vinheta';
    });

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
        originalArtist,
        originalTitle,
        downloadArtist: resolved.artist,
        downloadTitle: resolved.title,
      };
    }

    // Check original name against blocklist
    const blockMatch = blockedEngine.getBlockMatch(originalArtist, originalTitle);
    if (blockMatch) {
      return {
        allowed: false,
        reason: 'blocked',
        blockRule: blockMatch.rule,
        originalArtist,
        originalTitle,
        downloadArtist: resolved.artist,
        downloadTitle: resolved.title,
      };
    }

    // Check alias-resolved name against blocklist (rule = 'alias')
    if (aliasChanged) {
      const aliasBlockMatch = blockedEngine.getBlockMatch(resolved.artist, resolved.title);
      if (aliasBlockMatch) {
        return {
          allowed: false,
          reason: 'blocked',
          blockRule: 'alias',
          originalArtist,
          originalTitle,
          downloadArtist: resolved.artist,
          downloadTitle: resolved.title,
        };
      }
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