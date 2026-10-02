export type TicketSport = "tenis" | "futbol";

/** Datos del ticket que escribe el usuario a mano tras mandar las fotos (ver /ticket en bot.ts). */
export interface TicketInfo {
  sport: TicketSport;
  competition: string;
  selections: string;
  /** Cuota total combinada (ej. "1,91"). Vacío si no se indicó. */
  odds: string;
  bookie: BookieId;
}

/**
 * Casas de apuestas: el enlace de "Misma cuota aquí" cambia según la que
 * escribas en el texto del ticket. `aliases` son las formas aceptadas
 * (sin distinguir mayúsculas ni espacios) y `hint` cómo se le sugiere al
 * usuario. Para añadir otra casa basta con añadir una entrada aquí.
 */
export const BOOKIES = {
  winamax: {
    label: "Winamax",
    hint: "Winamax",
    link: "https://bdeal.io/Winamax/147910/1",
    aliases: ["winamax", "wina"],
  },
  williamhill: {
    label: "William Hill",
    hint: "WH",
    link: "https://bdeal.io/WilliamHill/153389/1",
    aliases: ["wh", "williamhill"],
  },
} as const;

export type BookieId = keyof typeof BOOKIES;

export const DEFAULT_BOOKIE: BookieId = "winamax";

/** "WH", "William Hill", "winamax"... → id de la casa, o null si no es ninguna conocida. */
export function parseBookie(text: string): BookieId | null {
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  for (const [id, bookie] of Object.entries(BOOKIES) as Array<[BookieId, (typeof BOOKIES)[BookieId]]>) {
    if ((bookie.aliases as readonly string[]).includes(normalized)) return id;
  }
  return null;
}

const SPORT_EMOJI: Record<TicketInfo["sport"], string> = {
  tenis: "🎾",
  futbol: "⚽",
};

/**
 * Construye el texto (HTML de Telegram) que acompaña al montaje:
 * línea 1: icono del deporte + competición subrayada.
 * línea 2: 🏆 + selecciones en negrita.
 * línea 3: fija, "📊 Stake 2" sin formato.
 * línea 4: fija, "🔞 Misma cuota aquí" en cursiva con el enlace de la casa elegida.
 */
export function formatTicketCaption(info: TicketInfo): string {
  const emoji = SPORT_EMOJI[info.sport];
  return (
    `${emoji} <u>${escapeHtml(info.competition)}</u>\n` +
    `🏆 <b>${escapeHtml(info.selections)}</b>\n` +
    `📊 Stake 2\n` +
    `🔞 <i><a href="${BOOKIES[info.bookie].link}">Misma cuota aquí</a></i>`
  );
}

// Stake fijo de referencia para calcular el beneficio del segundo mensaje:
// 50€ apostados, y 25€ de beneficio neto = 1 unidad.
const STAKE_EUR = 50;
const UNIT_EUR = 25;

/** Segundo mensaje, aparte del montaje: resumen corto con las selecciones, la cuota total y el beneficio en € y unidades. */
export function formatSelectionsSummary(info: TicketInfo): string {
  const headline = `✅ <u><b>${escapeHtml(info.selections)} @${escapeHtml(info.odds)}</b></u> ✅`;

  const odds = parseOddsNumber(info.odds);
  if (odds === null || odds <= 1) return headline;

  const profitEur = STAKE_EUR * (odds - 1);
  const units = profitEur / UNIT_EUR;
  const profitLine = `<i>Sumamos <b>+${formatEuros(profitEur)}€ / +${formatUnits(units)}ud.</b> 🫡</i>`;

  return `${headline}\n\n${profitLine}`;
}

/** "1,91" (coma decimal, como aparece en el ticket) -> 1.91, o null si no es un número válido. */
function parseOddsNumber(odds: string): number | null {
  const value = Number(odds.replace(",", ".").trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * Corrige el ruido de coma flotante antes de redondear: 50 * (1.91 - 1)
 * da 45.49999999999999 en JS en vez de 45.5, lo que redondearía para
 * abajo justo en el caso límite que más importa (",50").
 */
function cleanFloat(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Euros redondeados a entero (",50" para arriba), sin decimales: 45.5 -> "46". */
function formatEuros(n: number): string {
  return String(Math.round(cleanFloat(n)));
}

/** Unidades redondeadas a 1 decimal (",50" del segundo decimal para arriba), siempre con ese decimal: 1.56 -> "1,6". */
function formatUnits(n: number): string {
  const rounded = Math.round(cleanFloat(n) * 10) / 10;
  return rounded.toFixed(1).replace(".", ",");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
