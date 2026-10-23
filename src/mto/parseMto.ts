// Lee los avisos del canal "GRUPO PREMIUM - BOT LESIONES". Formato:
//
//   🚑 Lachlan Brain está recibiendo asistencia médica
//
//   🏆 Torneo: UTR PTT Newport Beach Men 25, 13-16 Playoff (Men) - Hardcourt
//   🎾 Ventre vs Brain
//   ⏱️ Jugado: 00:58:19
//   🔢 Marcador: 6-1, 2-1
//
// Los emojis cambian de variante según el cliente, así que no se usan para
// leer: solo el texto que hay detrás de cada etiqueta.

export interface ParsedMto {
  player: string;
  /** Nombre normalizado (minúsculas, sin acentos): identificador del jugador. */
  playerKey: string;
  /** Línea completa del torneo, tal cual llega. */
  tournamentRaw: string;
  /** Torneo sin la ronda ni la superficie: "UTR PTT Newport Beach Men 25". */
  tournament: string;
  tournamentKey: string;
  round?: string;
  surface?: string;
  match?: string;
  opponent?: string;
  /** Minutos jugados cuando llegó el aviso. */
  playedMinutes?: number;
  score?: string;
}

const PLAYER_RE = /^\W*(.+?)\s+est[aá] recibiendo asistencia m[eé]dica/im;
const TOURNAMENT_RE = /Torneo:\s*(.+)$/im;
const MATCH_RE = /^\W*(.+?\s+vs\.?\s+.+?)\s*$/im;
const PLAYED_RE = /Jugado:\s*(\d+):(\d{2})(?::(\d{2}))?/i;
const SCORE_RE = /Marcador:\s*(.+)$/im;

export function normalizeName(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseMto(text: string): ParsedMto | null {
  const playerMatch = text.match(PLAYER_RE);
  const tournamentMatch = text.match(TOURNAMENT_RE);
  if (!playerMatch || !tournamentMatch) return null;

  const player = playerMatch[1].trim();
  const tournamentRaw = tournamentMatch[1].trim();
  const { tournament, round, surface } = splitTournament(tournamentRaw);

  const parsed: ParsedMto = {
    player,
    playerKey: normalizeName(player),
    tournamentRaw,
    tournament,
    tournamentKey: normalizeName(tournament),
    round,
    surface,
  };

  const matchLine = text.match(MATCH_RE);
  if (matchLine) {
    parsed.match = matchLine[1].trim();
    parsed.opponent = findOpponent(parsed.match, parsed.playerKey);
  }

  const played = text.match(PLAYED_RE);
  if (played) {
    // Con segundos es HH:MM:SS; sin ellos se asume MM:SS.
    parsed.playedMinutes = played[3] !== undefined
      ? Number(played[1]) * 60 + Number(played[2])
      : Number(played[1]);
  }

  const score = text.match(SCORE_RE);
  if (score) parsed.score = score[1].trim();

  return parsed;
}

/**
 * "UTR PTT Newport Beach Men 25, 13-16 Playoff (Men) - Hardcourt" ->
 * torneo "UTR PTT Newport Beach Men 25", ronda "13-16 Playoff (Men)",
 * superficie "Hardcourt". Así las distintas rondas del mismo torneo cuentan juntas.
 */
function splitTournament(raw: string): { tournament: string; round?: string; surface?: string } {
  let rest = raw;
  let surface: string | undefined;
  const dash = rest.lastIndexOf(" - ");
  if (dash !== -1) {
    surface = rest.slice(dash + 3).trim() || undefined;
    rest = rest.slice(0, dash);
  }

  const comma = rest.indexOf(",");
  if (comma === -1) return { tournament: rest.trim(), surface };
  return {
    tournament: rest.slice(0, comma).trim(),
    round: rest.slice(comma + 1).trim() || undefined,
    surface,
  };
}

/** En "Ventre vs Brain" el rival de "Lachlan Brain" es el lado cuyo apellido no aparece en su nombre. */
function findOpponent(match: string, playerKey: string): string | undefined {
  const sides = match.split(/\s+vs\.?\s+/i).map((s) => s.trim());
  if (sides.length !== 2) return undefined;
  const [a, b] = sides;
  const aIsPlayer = playerKey.includes(normalizeName(a));
  const bIsPlayer = playerKey.includes(normalizeName(b));
  if (aIsPlayer && !bIsPlayer) return b;
  if (bIsPlayer && !aIsPlayer) return a;
  return undefined;
}
