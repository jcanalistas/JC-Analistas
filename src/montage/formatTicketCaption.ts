import type { TicketInfo } from "./analyzeTicket";

const SPORT_EMOJI: Record<TicketInfo["sport"], string> = {
  tenis: "🎾",
  futbol: "⚽",
};

/**
 * Construye el texto (HTML de Telegram) que acompaña al montaje:
 * línea 1: icono del deporte + competición subrayada.
 * línea 2: selecciones en negrita.
 * línea 3: fija, "📊 Stake 2" sin formato.
 */
export function formatTicketCaption(info: TicketInfo): string {
  const emoji = SPORT_EMOJI[info.sport];
  return (
    `${emoji} <u>${escapeHtml(info.competition)}</u>\n` +
    `<b>${escapeHtml(info.selections)}</b>\n` +
    `📊 Stake 2`
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
