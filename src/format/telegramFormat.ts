import type { Selection, SelectionGroup } from "../matching/matchSelections";

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
      const details = [
        s.odds ? `Cuota: ${s.odds}` : null,
        s.ev ? `EV: ${s.ev}` : null,
        s.successRate ? `% Éxito: ${s.successRate}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
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
    lines.push(`Coincide en ${group.count} de 3 informes (${sorted.map((s) => s.sourceLabel).join(", ")})`);

    const details = [
      uniqueJoin(sorted.map((s) => s.odds), "Cuota"),
      uniqueJoin(sorted.map((s) => s.ev), "EV"),
      uniqueJoin(sorted.map((s) => s.successRate), "% Éxito"),
    ]
      .filter(Boolean)
      .join(" · ");
    if (details) lines.push(details);

    const combinedExplanation = sorted
      .filter((s) => s.explanation)
      .map((s) => `*${s.sourceLabel}:* ${s.explanation}`)
      .join(" ");
    lines.push(`_${combinedExplanation || "Sin explicación detallada."}_`);
  });

  return chunkMessage(lines.join("\n"));
}

/** Junta valores únicos (no vacíos) con " / ", con una etiqueta delante (p.ej. "Cuota: 1.85 / 1.90"). */
function uniqueJoin(values: string[], label: string): string {
  const unique = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
  if (unique.length === 0) return "";
  return `${label}: ${unique.join(" / ")}`;
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
