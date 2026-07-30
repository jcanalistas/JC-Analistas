import type { MatchupGroup, Selection, SelectionGroup } from "../matching/matchSelections";
import type { CombinadaSuggestion } from "../matching/suggestCombinada";
import type { BetCandidate } from "../stats/betsStore";

const TELEGRAM_MAX_LEN = 4096;

/** Un mensaje ya formateado, con los datos de apuesta a registrar si aplica (para adjuntarle el botón "📝 Registrar apuesta"). */
export interface FormattedBetEntry {
  text: string;
  bet?: BetCandidate;
}

/**
 * Mensaje 1: selecciones finales de cada Deep Research, agrupadas por
 * perfil (Tipster, Machine Learning, Analista cuantitativo), con cuota,
 * EV y % de éxito de cada pick (sin explicación, para no alargar tanto
 * el mensaje — esa se deja solo en Recomendaciones y Mismo partido).
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
    });
  });

  return chunkMessage(lines.join("\n"));
}

/**
 * Recomendaciones: selecciones que se repiten en 2 o 3 de los perfiles
 * analizados, combinadas en una sola entrada por pick (cuota/EV/% éxito
 * de cada informe que coincidió + explicación combinada de todos). Cada
 * una es su PROPIO mensaje (no un bloque único) para poder adjuntarle un
 * botón "📝 Registrar apuesta" que mapee sin ambigüedad a esa recomendación.
 */
export function formatRepeatedSelections(groups: SelectionGroup[]): FormattedBetEntry[] {
  if (groups.length === 0) {
    return [{ text: "🔁 *Recomendaciones*\n\nNinguna selección se repitió en 2 o más informes." }];
  }

  return groups.map((group) => {
    const sorted = [...group.selections].sort((a, b) => a.sourceIndex - b.sourceIndex);

    const lines: string[] = [`🔁 *Recomendación* — *${group.matchup}* — ${group.market}`];
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

    return {
      text: lines.join("\n"),
      bet: {
        matchup: group.matchup,
        tournament: group.tournament,
        market: group.market,
        section: "recomendacion",
        sourceLabel: sorted.map((s) => s.sourceLabel).join(", "),
      },
    };
  });
}

/**
 * Mismo partido, distinto mercado (opcional): partidos que analizaron 2 o 3
 * perfiles pero con mercados distintos entre sí (p. ej. un perfil recomienda
 * "Tiafoe 2-0" y otro "Tiafoe -2.5 juegos") — mismo partido visto como
 * valor, aunque no coincidan en la apuesta exacta. Se muestran todas las
 * opciones, pero el botón "📝 Registrar apuesta" es UNO por partido (no por
 * mercado): el usuario memoriza cuál de las opciones eligió al marcarla.
 */
export function formatMixedMarketMatchups(groups: MatchupGroup[]): FormattedBetEntry[] {
  return groups.map((group) => {
    const sorted = [...group.selections].sort((a, b) => a.sourceIndex - b.sourceIndex);

    const lines: string[] = ["🔀 *Mismo partido, distinto mercado*", `*${group.matchup}*`];
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

    const markets = [...new Set(sorted.map((s) => s.market.trim()).filter(Boolean))].join(" / ");

    return {
      text: lines.join("\n"),
      bet: {
        matchup: group.matchup,
        tournament: group.tournament,
        market: markets,
        section: "mismo_partido",
        sourceLabel: sorted.map((s) => s.sourceLabel).join(", "),
      },
    };
  });
}

/**
 * Combinada sugerida (opcional): 2 picks de cuota individual baja
 * (cualquier mercado, no necesariamente ganador — puede ser "gana el
 * partido" + "gana un set", etc.) de partidos distintos cuya cuota
 * combinada cae entre 1.70 y 2.20 — un complemento a las selecciones
 * simples de cuota alta. Vacío si no hay ninguna combinación válida ese día.
 */
export function formatCombinadaSuggestion(combinada: CombinadaSuggestion | null): FormattedBetEntry[] {
  if (!combinada) return [];

  const { legA, legB, oddsA, oddsB, combinedOdds, sourceLabel } = combinada;
  const origin = sourceLabel ? `según ${sourceLabel}` : "calculada";
  const lines = [
    `🎰 *Combinada sugerida* (2 picks seguros, ${origin})`,
    `\n1. *${legA.matchup}* — ${legA.market} (💰 ${formatOdds(oddsA)})`,
    legA.tournament ? `🏟️ ${legA.tournament}` : null,
    `\n2. *${legB.matchup}* — ${legB.market} (💰 ${formatOdds(oddsB)})`,
    legB.tournament ? `🏟️ ${legB.tournament}` : null,
    `\n💰 Cuota combinada: *${formatOdds(combinedOdds)}*`,
  ].filter((line): line is string => line !== null);

  const tournament = [legA.tournament, legB.tournament].filter(Boolean).join(" / ");

  return [
    {
      text: lines.join("\n"),
      bet: {
        matchup: `${legA.matchup} + ${legB.matchup}`,
        tournament,
        market: `${legA.market} + ${legB.market}`,
        section: "combinada",
        sourceLabel: sourceLabel ?? "Calculada",
      },
    },
  ];
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
