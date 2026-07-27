import type { MatchupGroup, Selection, SelectionGroup } from "../matching/matchSelections";
import type { CombinadaSuggestion } from "../matching/suggestCombinada";

const TELEGRAM_MAX_LEN = 4096;

/**
 * Mensaje 1: selecciones finales de cada Deep Research, agrupadas por
 * perfil (Tipster, Machine Learning, Analista cuantitativo), con cuota,
 * EV, % de éxito y explicación de cada pick.
 */
export function formatIndividualSelections(
  labels: string[],
  selectionsBySource: Selection[][]
): string[] {
  const lines: string[] = ["📋 *Selecciones finales*\n"];

  labels.forEach((label, idx) => {
    lines.push(`\n*${idx + 1}. ${label}*`);
    const selections = selectionsBySource[idx];
    if (!selections || selections.length === 0) {
      lines.push("_No se pudieron extraer selecciones de este informe._");
      return;
    }
    selections.forEach((s, i) => {
      lines.push(`\n*${i + 1}. ${s.matchup}* — ${s.market}`);
      if (s.tournament) lines.push(`🏟️ ${s.tournament}`);
      const details = [
        s.odds ? `💰 ${s.odds}` : null,
        s.ev ? `📈 ${s.ev}` : null,
        s.successRate ? `🎯 ${s.successRate}` : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      if (details) lines.push(details);
      lines.push(`_${s.explanation || "Sin explicación detallada."}_`);
    });
  });

  return chunkMessage(lines.join("\n"));
}

/**
 * Mensaje 2: selecciones que se repiten en 2 o 3 de los perfiles
 * analizados, combinadas en una sola entrada por pick (cuota/EV/% éxito
 * de cada informe que coincidió + explicación combinada de todos).
 */
export function formatRepeatedSelections(groups: SelectionGroup[]): string[] {
  if (groups.length === 0) {
    return ["🔁 *Recomendaciones*\n\nNinguna selección se repitió en 2 o más informes."];
  }

  const lines: string[] = ["🔁 *Recomendaciones*\n"];

  groups.forEach((group, idx) => {
    const sorted = [...group.selections].sort((a, b) => a.sourceIndex - b.sourceIndex);

    lines.push(`\n*${idx + 1}. ${group.matchup} — ${group.market}*`);
    if (group.tournament) lines.push(`🏟️ ${group.tournament}`);
    lines.push(`Coincide en ${group.count} de 3 informes (${sorted.map((s) => s.sourceLabel).join(", ")})`);

    const details = [
      uniqueJoin(sorted.map((s) => s.odds), "💰"),
      uniqueJoin(sorted.map((s) => s.ev), "📈"),
      uniqueJoin(sorted.map((s) => s.successRate), "🎯"),
    ]
      .filter(Boolean)
      .join("  ·  ");
    if (details) lines.push(details);

    const combinedExplanation = sorted
      .filter((s) => s.explanation)
      .map((s) => `*${s.sourceLabel}:* ${s.explanation}`)
      .join(" ");
    lines.push(`_${combinedExplanation || "Sin explicación detallada."}_`);
  });

  return chunkMessage(lines.join("\n"));
}

/**
 * Mensaje 3 (opcional): partidos que analizaron 2 o 3 perfiles pero con
 * mercados distintos entre sí (p. ej. un perfil recomienda "Tiafoe 2-0" y
 * otro "Tiafoe -2.5 juegos") — mismo partido visto como valor, aunque no
 * coincidan en la apuesta exacta. Se muestran todas las opciones.
 */
export function formatMixedMarketMatchups(groups: MatchupGroup[]): string[] {
  if (groups.length === 0) return [];

  const lines: string[] = ["🔀 *Mismo partido, distinto mercado*\n"];

  groups.forEach((group, idx) => {
    const sorted = [...group.selections].sort((a, b) => a.sourceIndex - b.sourceIndex);
    lines.push(`\n*${idx + 1}. ${group.matchup}*`);
    if (group.tournament) lines.push(`🏟️ ${group.tournament}`);

    sorted.forEach((s) => {
      lines.push(`\n*${s.sourceLabel}:* ${s.market}`);
      const details = [
        s.odds ? `💰 ${s.odds}` : null,
        s.ev ? `📈 ${s.ev}` : null,
        s.successRate ? `🎯 ${s.successRate}` : null,
      ]
        .filter(Boolean)
        .join("  ·  ");
      if (details) lines.push(details);
      lines.push(`_${s.explanation || "Sin explicación detallada."}_`);
    });
  });

  return chunkMessage(lines.join("\n"));
}

/**
 * Mensaje 4 (opcional): combinada de 2 "victorias claras" (cuota
 * individual baja) de partidos distintos cuya cuota combinada llega a
 * 1.80+ — un complemento a las selecciones simples de cuota alta. Vacío
 * si no hay ninguna combinación válida ese día.
 */
export function formatCombinadaSuggestion(combinada: CombinadaSuggestion | null): string[] {
  if (!combinada) return [];

  const { legA, legB, oddsA, oddsB, combinedOdds } = combinada;
  const lines = [
    "🎰 *Combinada sugerida* (2 victorias claras)\n",
    `1. *${legA.matchup}* — ${legA.market} (💰 ${formatOdds(oddsA)})`,
    legA.tournament ? `🏟️ ${legA.tournament}` : null,
    `\n2. *${legB.matchup}* — ${legB.market} (💰 ${formatOdds(oddsB)})`,
    legB.tournament ? `🏟️ ${legB.tournament}` : null,
    `\n💰 Cuota combinada: *${formatOdds(combinedOdds)}*`,
  ].filter((line): line is string => line !== null);

  return chunkMessage(lines.join("\n"));
}

function formatOdds(n: number): string {
  return n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
}

/** Junta valores únicos (no vacíos) con " / ", con un icono delante (p.ej. "💰 1.85 / 1.90"). */
function uniqueJoin(values: string[], icon: string): string {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  return `${icon} ${unique.join(" / ")}`;
}

/** Parte un texto largo en trozos que caben en un mensaje de Telegram. */
function chunkMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LEN) return [text];

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LEN) {
      chunks.push(remaining);
      break;
    }
    let cut = remaining.lastIndexOf("\n", TELEGRAM_MAX_LEN);
    if (cut <= 0) cut = TELEGRAM_MAX_LEN;
    chunks.push(remaining.slice(0, cut));
    remaining = remaining.slice(cut).trimStart();
  }
  return chunks;
}
