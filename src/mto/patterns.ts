// Detección de patrones sobre el historial de asistencias médicas de un
// jugador. Funciones puras (sin Firestore) para poder probarlas aparte.

export interface MtoEvent {
  id: string;
  player: string;
  playerKey: string;
  /** Línea completa del torneo tal cual llega en el aviso. */
  tournamentRaw?: string;
  tournament: string;
  tournamentKey: string;
  round?: string;
  surface?: string;
  match?: string;
  opponent?: string;
  playedMinutes?: number;
  score?: string;
  /** Fecha del aviso en el canal (ms). */
  timestamp: number;
  /** Semana ISO en horario de Madrid, "2026-W43". */
  week: string;
}

// El bot del canal a veces repite el aviso del mismo jugador en el mismo
// partido con pocos minutos de diferencia: cuenta como una sola asistencia.
const DUPLICATE_WINDOW_MS = 15 * 60 * 1000;
// Muchos torneos (UTR PTT, ITF) se repiten cada semana con el mismo nombre:
// solo cuentan como "mismo torneo" avisos separados por pocos días.
const SAME_EDITION_MS = 8 * 24 * 60 * 60 * 1000;
const SAME_MATCH_MS = 6 * 60 * 60 * 1000;
const RECENT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const RECENT_THRESHOLD = 3;
const EARLY_MINUTES = 20;

export function sameEdition(a: MtoEvent, b: MtoEvent): boolean {
  return a.tournamentKey === b.tournamentKey && Math.abs(a.timestamp - b.timestamp) <= SAME_EDITION_MS;
}

export function isDuplicate(event: MtoEvent, history: MtoEvent[]): boolean {
  return history.some(
    (h) =>
      h.id !== event.id &&
      h.playerKey === event.playerKey &&
      h.tournamentKey === event.tournamentKey &&
      h.match === event.match &&
      Math.abs(h.timestamp - event.timestamp) < DUPLICATE_WINDOW_MS &&
      h.timestamp <= event.timestamp
  );
}

/** Quita los avisos repetidos, quedándose con el primero de cada grupo. */
export function dedupe(events: MtoEvent[]): MtoEvent[] {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  const kept: MtoEvent[] = [];
  for (const e of sorted) {
    if (!isDuplicate(e, kept)) kept.push(e);
  }
  return kept;
}

export interface PatternResult {
  /** Asistencias en esta misma edición del torneo (incluida la actual). */
  sameTournament: MtoEvent[];
  /** Semanas seguidas con asistencia que terminan en la de este aviso. */
  weekStreak: string[];
  /** Asistencias en los últimos 30 días. */
  recent: MtoEvent[];
  /** El aviso llegó antes del minuto 20. */
  early: boolean;
  /** El rival también recibió asistencia en este partido. */
  opponentAlsoTreated: boolean;
  /** Hay al menos un patrón que merece alerta. */
  alert: boolean;
}

/**
 * @param event aviso nuevo
 * @param playerHistory todos los avisos del jugador (puede incluir el nuevo)
 * @param matchEvents avisos del mismo partido (cualquier jugador), para ver si el rival también se atendió
 */
export function detectPatterns(
  event: MtoEvent,
  playerHistory: MtoEvent[],
  matchEvents: MtoEvent[] = []
): PatternResult {
  const history = dedupe([...playerHistory.filter((h) => h.id !== event.id), event]).filter(
    (h) => h.timestamp <= event.timestamp
  );

  const sameTournament = history.filter((h) => sameEdition(h, event));
  const recent = history.filter((h) => event.timestamp - h.timestamp <= RECENT_WINDOW_MS);
  const weekStreak = consecutiveWeeksEndingAt(
    event.week,
    new Set(history.map((h) => h.week))
  );
  const early = event.playedMinutes !== undefined && event.playedMinutes < EARLY_MINUTES;
  const opponentAlsoTreated = matchEvents.some(
    (m) =>
      m.playerKey !== event.playerKey &&
      m.tournamentKey === event.tournamentKey &&
      m.match === event.match &&
      Math.abs(m.timestamp - event.timestamp) <= SAME_MATCH_MS
  );

  return {
    sameTournament,
    weekStreak,
    recent,
    early,
    opponentAlsoTreated,
    alert: sameTournament.length >= 2 || weekStreak.length >= 2 || recent.length >= RECENT_THRESHOLD,
  };
}

function consecutiveWeeksEndingAt(week: string, weeks: Set<string>): string[] {
  const streak: string[] = [];
  let current = week;
  while (weeks.has(current)) {
    streak.unshift(current);
    current = previousIsoWeek(current);
  }
  return streak;
}

/** Semana ISO ("2026-W43") de una fecha, usando el calendario de Madrid. */
export function isoWeek(timestamp: number): string {
  const madrid = new Date(timestamp).toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
  const [y, m, d] = madrid.split("-").map(Number);
  return isoWeekUtc(new Date(Date.UTC(y, m - 1, d)));
}

function previousIsoWeek(week: string): string {
  const [year, w] = week.split("-W").map(Number);
  // Lunes de esa semana ISO, menos 7 días.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (w - 1) * 7 - 7);
  return isoWeekUtc(monday);
}

function isoWeekUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // El jueves de esa semana decide a qué año ISO pertenece.
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
