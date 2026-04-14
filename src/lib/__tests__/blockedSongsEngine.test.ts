import { describe, it, expect } from 'vitest';
import { buildBlockedEngine } from '../blockedSongsEngine';
import { createDownloadGuard } from '../downloadGuard';

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

  describe('forward alias check in engine', () => {
    it('blocks wrong name that maps to blocked corrected name via alias', () => {
      // "Naldo Lima - Retrovisor" is blocked directly AND has alias → Gusttavo Lima
      // The forward check should detect this
      const match = engine.getBlockMatch('naldo lima', 'retrovisor');
      expect(match).not.toBeNull();
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
    // Naldo Lima → alias → Gusttavo Lima, but Naldo Lima is blocked
    const decision = guard('Naldo Lima', 'Retrovisor');
    expect(decision.downloadArtist).toBe('Gusttavo Lima');
    expect(decision.downloadTitle).toBe('Retrovisor');
    expect(decision.allowed).toBe(false);
  });

  it('blocks wrong artist with wildcard even after alias resolution', () => {
    // "PROMESSA D - PEDIDO DE SOCORRO" has alias → Gustavo Mioto
    // But PROMESSA D - * is blocked by wildcard
    const decision = guard('PROMESSA D', 'PEDIDO DE SOCORRO');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('blocked');
  });

  it('allows correct artist that was alias target of wildcard-blocked artist', () => {
    // Gustavo Mioto should pass even though PROMESSA D (alias source) is wildcard-blocked
    const decision = guard('Gustavo Mioto', 'Pedido De Socorro (Ao Vivo)');
    expect(decision.allowed).toBe(true);
  });
});
