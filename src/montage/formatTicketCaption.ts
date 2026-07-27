import type { TicketInfo } from "./analyzeTicket";

const SPORT_EMOJI: Record<TicketInfo["sport"], string> = {
  tenis: "🎾",
  futbol: "⚽",
};

const SAME_ODDS_LINK = "https://bdeal.io/Winamax/147910/1";

/**
 * Construye el texto (HTML de Telegram) que acompaña al montaje:
 * línea 1: icono del deporte + competición subrayada.
 * línea 2: 🏆 + selecciones en negrita.
 * línea 3: fija, "📊 Stake 2" sin formato.
 * línea 4: fija, "🔞 Misma cuota aquí" en cursiva con hipervínculo.
 */
export function formatTicketCaption(info: TicketInfo): string {
  const emoji = SPORT_EMOJI[info.sport];
  return (
    `${emoji} <u>${escapeHtml(info.competition)}</u>\n` +
    `🏆 <b>${escapeHtml(info.selections)}</b>\n` +
    `📊 Stake 2\n` +
    `<i><a href="${SAME_ODDS_LINK}">🔞 Misma cuota aquí</a></i>`
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
  const profitLine = `<i>Sumamos <b>+${formatEsNumber(profitEur)}€ / +${formatEsNumber(units)}ud.</b> 🫡</i>`;

  return `${headline}\n${profitLine}`;
}

/** "1,91" (coma decimal, como aparece en el ticket) -> 1.91, o null si no es un número válido. */
function parseOddsNumber(odds: string): number | null {
  const value = Number(odds.replace(",", ".").trim());
  return Number.isFinite(value) ? value : null;
}

/** Número con coma decimal a la española, sin ceros de más (45.5 -> "45,5", 50 -> "50"). */
function formatEsNumber(n: number): string {
  const trimmed = n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return trimmed.replace(".", ",");
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
