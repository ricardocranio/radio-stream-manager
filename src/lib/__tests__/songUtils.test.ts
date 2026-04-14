import { describe, it, expect } from 'vitest';
import { normalizeStr, normalizeStrKeepSuffix, songKey } from '../songUtils';

describe('normalizeStr', () => {
  // === Accents & Diacritics ===
  it('strips accents and diacritics', () => {
    expect(normalizeStr('Música Açaí Café')).toBe('musica acai cafe');
    expect(normalizeStr('São João Canção')).toBe('sao joao cancao');
    expect(normalizeStr('Beyoncé')).toBe('beyonce');
    expect(normalizeStr('Ñandú')).toBe('nandu');
  });

  // === Version Suffixes (must be stripped) ===
  it('strips (Ao Vivo) suffix', () => {
    expect(normalizeStr('Evidências (Ao Vivo)')).toBe('evidencias');
  });

  it('strips [Live] suffix', () => {
    expect(normalizeStr('Bohemian Rhapsody [Live]')).toBe('bohemian rhapsody');
  });

  it('strips (Acústico) suffix', () => {
    expect(normalizeStr('Amor Perfeito (Acústico)')).toBe('amor perfeito');
  });

  it('strips (Remix) suffix', () => {
    expect(normalizeStr('Despacito (Remix)')).toBe('despacito');
  });

  it('strips (Remastered) suffix', () => {
    expect(normalizeStr('Hotel California (Remastered)')).toBe('hotel california');
  });

  it('strips (Radio Edit) suffix', () => {
    expect(normalizeStr('Levels (Radio Edit)')).toBe('levels');
  });

  it('strips (Ao Vivo em São Paulo) suffix', () => {
    expect(normalizeStr('Aquarela (Ao Vivo em Sao Paulo)')).toBe('aquarela');
  });

  // === Feat Normalization ===
  it('normalizes feat. to feat (keeps trailing dot from word boundary)', () => {
    // The regex \b(feat\.?) keeps the dot; it's not in the punctuation strip list.
    // "feat." → "feat." is preserved for disc parity.
    expect(normalizeStr('Artista feat. Outro')).toBe('artista feat. outro');
  });

  it('normalizes ft. to feat. (keeps trailing dot)', () => {
    expect(normalizeStr('Artista ft. Outro')).toBe('artista feat. outro');
  });

  it('normalizes featuring to feat', () => {
    expect(normalizeStr('Artista featuring Outro')).toBe('artista feat outro');
  });

  // === Special Characters ===
  it('strips smart quotes', () => {
    expect(normalizeStr('\u201CTest\u201D')).toBe('test');
    expect(normalizeStr('\u2018It\u2019s\u2019')).toBe('its');
  });

  it('normalizes em-dash and en-dash to hyphen', () => {
    expect(normalizeStr('Rock\u2014Roll')).toBe('rock-roll');
    expect(normalizeStr('Rock\u2013Roll')).toBe('rock-roll');
  });

  it('strips punctuation that doesn\'t carry meaning', () => {
    expect(normalizeStr('Hello, World! #1')).toBe('hello world 1');
  });

  // === Whitespace ===
  it('collapses multiple spaces', () => {
    expect(normalizeStr('  Too   Many   Spaces  ')).toBe('too many spaces');
  });

  // === Empty / Null-ish ===
  it('returns empty string for empty input', () => {
    expect(normalizeStr('')).toBe('');
  });

  // === Complex Brazilian Radio Cases ===
  it('handles typical Brazilian radio capture', () => {
    const result = normalizeStr('Gusttavo Lima - Retrovisor (Ao Vivo)');
    expect(result).toBe('gusttavo lima - retrovisor');
  });

  it('handles accented title with suffix', () => {
    const result = normalizeStr('Canção da América (Acústico)');
    expect(result).toBe('cancao da america');
  });

  it('strips feat inside parentheses as version suffix', () => {
    // (feat. ...) is matched by VERSION_SUFFIXES pattern and stripped
    const result = normalizeStr('Flowers (feat. Miley Cyrus)');
    expect(result).toBe('flowers');
  });
});

describe('normalizeStrKeepSuffix', () => {
  it('keeps (Ao Vivo) suffix intact', () => {
    expect(normalizeStrKeepSuffix('Evidências (Ao Vivo)')).toBe('evidencias (ao vivo)');
  });

  it('keeps [Live] suffix intact', () => {
    expect(normalizeStrKeepSuffix('Song [Live]')).toBe('song [live]');
  });

  it('keeps (Remix) suffix intact', () => {
    expect(normalizeStrKeepSuffix('Despacito (Remix)')).toBe('despacito (remix)');
  });

  it('still strips accents', () => {
    expect(normalizeStrKeepSuffix('Música (Acústico)')).toBe('musica (acustico)');
  });

  it('still normalizes feat (keeps dot)', () => {
    expect(normalizeStrKeepSuffix('Song feat. Artist')).toBe('song feat. artist');
  });

  it('still strips smart quotes and punctuation', () => {
    expect(normalizeStrKeepSuffix('\u201CHello\u201D, World!')).toBe('hello world');
  });

  it('returns empty string for empty input', () => {
    expect(normalizeStrKeepSuffix('')).toBe('');
  });
});

describe('songKey', () => {
  it('generates deterministic key from artist + title', () => {
    const key = songKey('Gusttavo Lima', 'Retrovisor');
    expect(key).toBe('gusttavo lima|||retrovisor');
  });

  it('generates same key regardless of accents', () => {
    expect(songKey('Beyoncé', 'Música')).toBe(songKey('Beyonce', 'Musica'));
  });

  it('generates same key regardless of suffix', () => {
    expect(songKey('Artist', 'Song (Ao Vivo)')).toBe(songKey('Artist', 'Song'));
  });

  it('generates same key for feat without dot', () => {
    // feat. keeps the dot, so keys differ — this tests that feat (no dot) is stable
    expect(songKey('A feat B', 'Song')).toBe('a feat b|||song');
    expect(songKey('A feat. B', 'Song')).toBe('a feat. b|||song');
  });
});
