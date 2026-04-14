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
      // The alias data has trailing space "Xand Aviao " — resolve returns raw value
      expect(result.artist.trim()).toBe('Xand Aviao');
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

describe('suffix normalisation', () => {
  it('strips (Ao Vivo) suffix', () => {
    expect(normalizeStr('Retrovisor (Ao Vivo)')).toBe(normalizeStr('Retrovisor'));
  });

  it('strips [Live] suffix', () => {
    expect(normalizeStr('River [Live]')).toBe(normalizeStr('River'));
  });

  it('strips (Acústico) suffix', () => {
    expect(normalizeStr('Mala (Acústico)')).toBe(normalizeStr('Mala'));
  });

  it('strips (Remix) suffix', () => {
    expect(normalizeStr('Blinding Lights (Remix)')).toBe(normalizeStr('Blinding Lights'));
  });

  it('strips (Radio Edit) suffix', () => {
    expect(normalizeStr('Song (Radio Edit)')).toBe(normalizeStr('Song'));
  });

  it('strips (Remastered) suffix', () => {
    expect(normalizeStr('Bohemian Rhapsody (Remastered)')).toBe(normalizeStr('Bohemian Rhapsody'));
  });

  it('strips (Ao Vivo em Lisboa) suffix', () => {
    expect(normalizeStr('Olho Marrom (Ao Vivo em Lisboa)')).toBe(normalizeStr('Olho Marrom'));
  });

  it('matches songs with vs without version suffix', () => {
    const k1 = songKey('Gustavo Mioto', 'Pedido De Socorro');
    const k2 = songKey('Gustavo Mioto', 'Pedido De Socorro (Ao Vivo)');
    expect(k1).toBe(k2);
  });

  it('blocked song matches even with extra suffix', () => {
    const engine = buildBlockedEngine(
      ["Artista X - Musica Y"],
      [],
      []
    );
    expect(engine.getBlockMatch('Artista X', 'Musica Y (Ao Vivo)')).not.toBeNull();
  });
});

describe('integration: scraping → alias → block → grade pipeline', () => {
  // Simulates scraped songs arriving from radios
  const scrapedSongs = [
    { artist: 'Naldo Lima', title: 'Retrovisor', station: 'BH FM' },                       // blocked (exact) + has alias
    { artist: 'PROMESSA D', title: 'PEDIDO DE SOCORRO', station: 'Band FM' },               // blocked (wildcard)
    { artist: 'BALACHIC', title: 'ERA UMA VEZ(AO VIVO)', station: 'Globo RJ' },             // alias → Xand Aviao, NOT blocked
    { artist: 'Gusttavo Lima', title: 'Retrovisor', station: 'BH FM' },                     // correct artist, NOT blocked
    { artist: 'Simone Mendes', title: 'Saudade Proibida (Ao Vivo)', station: 'Band FM' },   // NOT blocked (was false positive before)
    { artist: 'Ikaro Mendes', title: 'SAUDADE PROIBIDA', station: 'Globo RJ' },             // blocked (wildcard) + has alias
    { artist: 'MC Kevin', title: 'Cavalgada', station: 'BH FM' },                           // blocked (exact)
    { artist: 'MC Kevinho', title: 'Cavalgada', station: 'BH FM' },                         // NOT blocked (different artist)
    { artist: 'Artista Limpo', title: 'Musica Legal', station: 'Band FM' },                  // NOT blocked
    { artist: 'Artista Ganja', title: 'Party Time', station: 'Band FM' },                   // blocked (forbidden word)
  ];

  const guard = createDownloadGuard({
    blockedSongs,
    forbiddenWords,
    songAliases: aliases,
  });

  it('correctly filters blocked songs from grade candidates', () => {
    const gradeSongs: Array<{ artist: string; title: string; station: string }> = [];
    const blockedEvents: Array<{ artist: string; title: string; reason: string }> = [];

    for (const song of scrapedSongs) {
      const decision = guard(song.artist, song.title);
      if (decision.allowed) {
        gradeSongs.push({
          artist: decision.downloadArtist,
          title: decision.downloadTitle,
          station: song.station,
        });
      } else {
        blockedEvents.push({
          artist: song.artist,
          title: song.title,
          reason: decision.reason,
        });
      }
    }

    // Verify correct songs made it through
    expect(gradeSongs).toHaveLength(5);
    expect(gradeSongs.map(s => s.artist)).toContain('Gusttavo Lima');
    expect(gradeSongs.map(s => s.artist)).toContain('Simone Mendes');
    expect(gradeSongs.map(s => s.artist)).toContain('MC Kevinho');
    expect(gradeSongs.map(s => s.artist)).toContain('Artista Limpo');

    // Verify BALACHIC was resolved to Xand Aviao via alias
    const xandSong = gradeSongs.find(s => s.artist.trim() === 'Xand Aviao');
    expect(xandSong).toBeDefined();

    // Verify blocked songs were caught
    expect(blockedEvents).toHaveLength(5);
    expect(blockedEvents.map(s => s.artist)).toContain('Naldo Lima');
    expect(blockedEvents.map(s => s.artist)).toContain('PROMESSA D');
    expect(blockedEvents.map(s => s.artist)).toContain('Ikaro Mendes');
    expect(blockedEvents.map(s => s.artist)).toContain('MC Kevin');
    expect(blockedEvents.map(s => s.artist)).toContain('Artista Ganja');

    // CRITICAL: Gusttavo Lima must NEVER be blocked
    expect(blockedEvents.map(s => s.artist)).not.toContain('Gusttavo Lima');
    // CRITICAL: Simone Mendes must NEVER be blocked
    expect(blockedEvents.map(s => s.artist)).not.toContain('Simone Mendes');
    // CRITICAL: MC Kevinho must NEVER be blocked
    expect(blockedEvents.map(s => s.artist)).not.toContain('MC Kevinho');
  });

  it('alias-resolved songs use corrected metadata', () => {
    const balachicDecision = guard('BALACHIC', 'ERA UMA VEZ(AO VIVO)');
    expect(balachicDecision.allowed).toBe(true);
    expect(balachicDecision.downloadArtist.trim()).toBe('Xand Aviao');

    const promessaDecision = guard('PROMESSA D', 'PEDIDO DE SOCORRO');
    expect(promessaDecision.allowed).toBe(false);
    // Even though blocked, download fields show the corrected name
    expect(promessaDecision.downloadArtist).toBe('Gustavo Mioto');
  });

  it('suffix variations do not bypass blocking', () => {
    // Even with (Ao Vivo) appended, Naldo Lima should still be blocked
    const decision = guard('Naldo Lima', 'Retrovisor (Ao Vivo)');
    expect(decision.allowed).toBe(false);
  });
});
