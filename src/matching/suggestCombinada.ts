import type { CombinadaLegInfo, Selection } from "./matchSelections";
import { normalizeMatchup } from "./normalize";

export interface CombinadaSuggestion {
  legA: CombinadaLegInfo;
  legB: CombinadaLegInfo;
  oddsA: number;
  oddsB: number;
  combinedOdds: number;
  /** Perfil que la propuso directamente, o undefined si la calculó el bot como red de seguridad. */
  sourceLabel?: string;
}

const MIN_COMBINED_ODDS = 1.7;
const MAX_COMBINED_ODDS = 2.2;

/** "1,50" / "1.50" / "@1.50" -> 1.5, o null si no se puede leer como cuota. */
function parseOddsNumber(raw: string): number | null {
  const match = raw.replace(",", ".").match(/\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 1 ? value : null;
}

function toValidSuggestion(
  legA: CombinadaLegInfo,
  legB: CombinadaLegInfo,
  sourceLabel?: string
): CombinadaSuggestion | null {
  const oddsA = parseOddsNumber(legA.odds);
  const oddsB = parseOddsNumber(legB.odds);
  if (oddsA === null || oddsB === null) return null;
  if (normalizeMatchup(legA.matchup) === normalizeMatchup(legB.matchup)) return null;

  const combinedOdds = oddsA * oddsB;
  if (combinedOdds < MIN_COMBINED_ODDS || combinedOdds > MAX_COMBINED_ODDS) return null;

  return { legA, legB, oddsA, oddsB, combinedOdds, sourceLabel };
}

/**
 * Sugiere una combinada de 2 "bankers" (mercados de máxima seguridad, de
 * cualquier tipo — no tienen por qué ser los dos ganador) de partidos
 * distintos cuya cuota combinada esté entre 1.70 y 2.20.
 *
 * Prioridad:
 * 1. La combinada que cada perfil propone directamente en su propia
 *    sección "COMBINADA SUGERIDA" (busca bankers de forma específica,
 *    no solo entre sus 8 picks de valor) — se valida igualmente aquí por
 *    si la cuota combinada que calculó Gemini no cuadrara exactamente.
 * 2. Si ningún perfil propuso una válida, se calcula como red de
 *    seguridad entre las 24 selecciones de valor ya parseadas, buscando
 *    la pareja de cuota combinada más baja que aún así caiga en el rango.
 */
export function suggestCombinada(
  allSelections: Selection[],
  promptedCombinadas: Array<{ label: string; legs: [CombinadaLegInfo, CombinadaLegInfo] | null }>
): CombinadaSuggestion | null {
  for (const { label, legs } of promptedCombinadas) {
    if (!legs) continue;
    const suggestion = toValidSuggestion(legs[0], legs[1], label);
    if (suggestion) return suggestion;
  }

  return suggestFromSelections(allSelections);
}

/** Red de seguridad: busca entre las selecciones de valor ya parseadas la pareja de cuota combinada más baja dentro del rango. */
function suggestFromSelections(allSelections: Selection[]): CombinadaSuggestion | null {
  const candidates = allSelections
    .map((selection) => ({ selection, odds: parseOddsNumber(selection.odds) }))
    .filter((c): c is { selection: Selection; odds: number } => c.odds !== null)
    .sort((a, b) => a.odds - b.odds);

  let best: CombinadaSuggestion | null = null;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      const suggestion = toValidSuggestion(a.selection, b.selection);
      if (!suggestion) continue;

      if (!best || suggestion.combinedOdds < best.combinedOdds) {
        best = suggestion;
      }
    }
  }

  return best;
}
