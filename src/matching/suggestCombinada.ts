import type { Selection } from "./matchSelections";
import { normalizeMatchup } from "./normalize";

export interface CombinadaSuggestion {
  legA: Selection;
  legB: Selection;
  oddsA: number;
  oddsB: number;
  combinedOdds: number;
}

const MIN_COMBINED_ODDS = 1.8;

/** "1,50" / "1.50" / "@1.50" -> 1.5, o null si no se puede leer como cuota. */
function parseOddsNumber(raw: string): number | null {
  const match = raw.replace(",", ".").match(/\d+(\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) && value > 1 ? value : null;
}

/**
 * Sugiere una combinada de 2 picks de partidos distintos ("victorias
 * claras" de cuota individual baja) cuya cuota combinada (producto) sea
 * >= 1.80 — para complementar las selecciones simples de cuota alta con
 * una opción de cuota más ajustada por pick pero atractiva combinada,
 * como los picks sueltos de cuota baja no llegan solos al listón de las
 * 8 selecciones (1.60/1.65). Entre todas las combinaciones válidas,
 * devuelve la de cuota combinada más baja que aún así supere el mínimo
 * (la más "segura" posible) — o null si ninguna llega a 1.80.
 */
export function suggestCombinada(allSelections: Selection[]): CombinadaSuggestion | null {
  const candidates = allSelections
    .map((selection) => ({ selection, odds: parseOddsNumber(selection.odds) }))
    .filter((c): c is { selection: Selection; odds: number } => c.odds !== null)
    .sort((a, b) => a.odds - b.odds);

  let best: CombinadaSuggestion | null = null;

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i];
      const b = candidates[j];
      if (normalizeMatchup(a.selection.matchup) === normalizeMatchup(b.selection.matchup)) continue;

      const combinedOdds = a.odds * b.odds;
      if (combinedOdds < MIN_COMBINED_ODDS) continue;

      if (!best || combinedOdds < best.combinedOdds) {
        best = { legA: a.selection, legB: b.selection, oddsA: a.odds, oddsB: b.odds, combinedOdds };
      }
    }
  }

  return best;
}
