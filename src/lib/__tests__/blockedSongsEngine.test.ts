import { describe, it, expect } from 'vitest';
import { buildBlockedEngine } from '../blockedSongsEngine';
import { createDownloadGuard } from '../downloadGuard';
import { normalizeStr, songKey } from '../songUtils';
import { buildAliasEngine } from '../aliasEngine';

const blockedSongs = [
  "Naldo Lima - Retrovisor",
  "Ikaro Mendes - *",
  "Wellington Paixone - *",
  "PROMESSA D - *",
  "tayh - *",
  "BLACKBIRDS - Meus Herois",
  "thiago jose - balançou balançou(ao vivo)",
  "BALACHIC - ERA UMA VEZ (AO VIVO)",
  "YGOR E KELVEN - O QUE EU FACO AGORA",
  "Kaize - Olha onde eu to",
  "MC Kevin - Cavalgada",
  "Jefi - Marquinha De Fita",
  "JEFFINHO - MARQUINHA DE FITINHA",
  "Eurides Nunes - FARROUPILHA",
];

const forbiddenWords = ["ganja", "mega sena"];

const aliases = [
  { fromArtist: "naldo lima", fromTitle: "retrovisor", toArtist: "Gusttavo Lima", toTitle: "Retrovisor" },
  { fromArtist: "Ikaro Mendes", fromTitle: "SAUDADE PROIBIDA", toArtist: "Simone Mendes", toTitle: "Saudade Proibida (Ao Vivo)" },
  { fromArtist: "Wellington Paixone", fromTitle: "Eu Vou na Sua Casa", toArtist: "felipe amorim", toTitle: "Vou na Sua Casa" },
  { fromArtist: "PROMESSA D", fromTitle: "PEDIDO DE SOCORRO", toArtist: "Gustavo Mioto", toTitle: "Pedido De Socorro (Ao Vivo)" },
  { fromArtist: "thiago jose", fromTitle: "balancou balançou(ao vivo)", toArtist: "Thiaguinho", toTitle: "me balancou(ao vivo)" },
  { fromArtist: "TAYH", fromTitle: "voce nao me merece", toArtist: "Fabinho", toTitle: "voce nao me merece" },
  { fromArtist: "BLACKBIRDS", fromTitle: "Meus Herois", toArtist: "Tiee", toTitle: "Meus Herois" },
  { fromArtist: "BALACHIC", fromTitle: "ERA UMA VEZ (AO VIVO)", toArtist: "Xand Aviao", toTitle: "ERA UMA VEZ (AO VIVO)" },
  { fromArtist: "YGOR E KELVEN", fromTitle: "O QUE EU FACO AGORA", toArtist: "Dilsinho", toTitle: "O Que Eu Faco Agora" },
  { fromArtist: "Kaize", fromTitle: "Olha onde eu to", toArtist: "Ana Castela", toTitle: "Olha onde eu to" },
];

describe('blockedSongsEngine', () => {
  const engine = buildBlockedEngine(blockedSongs, forbiddenWords, aliases);

  describe('direct blocking', () => {
    it('blocks exact match', () => {
      expect(engine.getBlockMatch('Naldo Lima', 'Retrovisor')).toEqual({ rule: 'exact' });
    });

    it('blocks wildcard artist', () => {
      expect(engine.getBlockMatch('Ikaro Mendes', 'qualquer musica')).toEqual({ rule: 'wildcard' });
      expect(engine.getBlockMatch('PROMESSA D', 'outra musica')).toEqual({ rule: 'wildcard' });
    });

    it('blocks forbidden words', () => {
      expect(engine.getBlockMatch('Artista X', 'Ganja Party')).toEqual({ rule: 'forbidden' });
    });
  });

  describe('NO false positives — correct artists must pass', () => {
    it.each([
      ['Gusttavo Lima', 'Retrovisor'],
      ['Gusttavo Lima', 'Balada'],
      ['Simone Mendes', 'Saudade Proibida (Ao Vivo)'],
      ['Simone Mendes', 'Erro Gostoso'],
      ['Felipe Amorim', 'Vou na Sua Casa'],
      ['Gustavo Mioto', 'Pedido De Socorro (Ao Vivo)'],
      ['Thiaguinho', 'me balancou(ao vivo)'],
      ['Fabinho', 'voce nao me merece'],
      ['Tiee', 'Meus Herois'],
      ['Xand Aviao', 'ERA UMA VEZ (AO VIVO)'],
      ['Dilsinho', 'O Que Eu Faco Agora'],
      ['Ana Castela', 'Olha onde eu to'],
    ])('%s - %s should NOT be blocked', (artist, title) => {
      expect(engine.getBlockMatch(artist, title)).toBeNull();
    });
  });

  describe('partial matching — shared surnames must NOT cause false positives', () => {
    it('Gusttavo Lima is NOT blocked by "Naldo Lima - Retrovisor" partial match', () => {
      // "Lima" is shared but "Naldo" ≠ "Gusttavo" — all words must match
      expect(engine.getBlockMatch('Gusttavo Lima', 'Retrovisor')).toBeNull();
    });

    it('Simone Mendes is NOT blocked by "Ikaro Mendes - *" wildcard', () => {
      // Wildcard checks exact artist name, not partial
      expect(engine.getBlockMatch('Simone Mendes', 'Qualquer Musica')).toBeNull();
    });

    it('MC Kevinho is NOT blocked by "MC Kevin - Cavalgada"', () => {
      // "Kevin" ≠ "Kevinho", partial word match must fail
      expect(engine.getBlockMatch('MC Kevinho', 'Cavalgada')).toBeNull();
    });

    it('Jefi does NOT block Jefferson Moraes via partial', () => {
      expect(engine.getBlockMatch('Jefferson Moraes', 'Marquinha De Fita')).toBeNull();
    });

    it('Thiago Brava is NOT blocked by "thiago jose" entry', () => {
      // Different multi-word artist — "jose" ≠ "brava"
      expect(engine.getBlockMatch('Thiago Brava', 'balançou balançou(ao vivo)')).toBeNull();
    });
  });

  describe('acentuation edge cases', () => {
    it('blocks regardless of accent differences', () => {
      // "balançou" vs "balancou" — NFD normalization strips accents
      expect(engine.getBlockMatch('thiago jose', 'balancou balancou(ao vivo)')).not.toBeNull();
    });

    it('blocks "Eurides Nunes - FARROUPILHA" with accent variations', () => {
      expect(engine.getBlockMatch('EURIDES NUNES', 'Farroupilha')).not.toBeNull();
      expect(engine.getBlockMatch('eurides nunes', 'farroupilha')).not.toBeNull();
    });

    it('blocks forbidden word with accents', () => {
      expect(engine.getBlockMatch('Artista', 'Mega Sena ao vivo')).toEqual({ rule: 'forbidden' });
    });

    it('handles mixed case and extra spaces', () => {
      expect(engine.getBlockMatch('  NALDO LIMA  ', '  retrovisor  ')).not.toBeNull();
  });

  describe('enhanced normalisation — special chars, punctuation, feat', () => {
    it('matches despite missing space before parenthesis', () => {
      // "balancou(ao vivo)" vs "balancou (ao vivo)"
      expect(normalizeStr('balancou(ao vivo)')).toBe(normalizeStr('balancou (ao vivo)'));
    });

    it('matches despite smart quotes and curly quotes', () => {
      expect(normalizeStr("it\u2019s")).toBe(normalizeStr("it's"));
      expect(normalizeStr('it\u2019s')).toBe(normalizeStr('its'));
    });

    it('normalises feat variations', () => {
      expect(normalizeStr('Artist feat. Other')).toBe(normalizeStr('Artist ft. Other'));
      expect(normalizeStr('Artist feat Other')).toBe(normalizeStr('Artist featuring Other'));
    });

    it('normalises em-dash and en-dash to hyphen', () => {
      expect(normalizeStr('A \u2013 B')).toBe(normalizeStr('A - B'));
      expect(normalizeStr('A \u2014 B')).toBe(normalizeStr('A - B'));
    });

    it('strips commas, semicolons, and decorative punctuation', () => {
      expect(normalizeStr('Hello, World!')).toBe(normalizeStr('Hello World'));
    });

    it('songKey matches across accent + punctuation variations', () => {
      const k1 = songKey('Gustavo Mioto', 'Pedido De Socorro (Ao Vivo)');
      const k2 = songKey('GUSTAVO MIOTO', 'PEDIDO DE SOCORRO(AO VIVO)');
      expect(k1).toBe(k2);
    });
  });

  describe('aliasEngine — enhanced matching', () => {
    const aliasEngine = buildAliasEngine(aliases);

    it('resolves alias with accent differences', () => {
      const result = aliasEngine.resolve('THIAGO JOSE', 'BALANCOU BALANÇOU(AO VIVO)');
      expect(result.artist).toBe('Thiaguinho');
    });

    it('resolves alias with extra spaces', () => {
      const result = aliasEngine.resolve('  BLACKBIRDS  ', ' Meus Herois ');
      expect(result.artist).toBe('Tiee');
    });

    it('resolves alias with missing space before parenthesis', () => {
      const result = aliasEngine.resolve('BALACHIC', 'ERA UMA VEZ(AO VIVO)');
      expect(result.artist).toBe('Xand Aviao ');
    });
  });
});
});

describe('downloadGuard — forward alias integration', () => {
  const guard = createDownloadGuard({
    blockedSongs,
    forbiddenWords,
    songAliases: aliases,
  });

  it('blocks Naldo Lima - Retrovisor (exact blocked)', () => {
    const decision = guard('Naldo Lima', 'Retrovisor');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('blocked');
  });

  it('allows Gusttavo Lima - Retrovisor (correct artist, not blocked)', () => {
    const decision = guard('Gusttavo Lima', 'Retrovisor');
    expect(decision.allowed).toBe(true);
  });

  it('resolves alias and uses corrected name for download', () => {
    const decision = guard('Naldo Lima', 'Retrovisor');
    expect(decision.downloadArtist).toBe('Gusttavo Lima');
    expect(decision.downloadTitle).toBe('Retrovisor');
    expect(decision.allowed).toBe(false);
  });

  it('blocks wrong artist with wildcard even after alias resolution', () => {
    const decision = guard('PROMESSA D', 'PEDIDO DE SOCORRO');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('blocked');
  });

  it('allows correct artist that was alias target of wildcard-blocked artist', () => {
    const decision = guard('Gustavo Mioto', 'Pedido De Socorro (Ao Vivo)');
    expect(decision.allowed).toBe(true);
  });

  it('allows Felipe Amorim even though Wellington Paixone is wildcard-blocked', () => {
    const decision = guard('Felipe Amorim', 'Vou na Sua Casa');
    expect(decision.allowed).toBe(true);
  });
});
