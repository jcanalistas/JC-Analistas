import { marketSignature, matchupSurnames, similarity } from "./normalize";

export interface Selection {
  sourceIndex: number; // qué deep research (0, 1, 2) la produjo
  sourceLabel: string; // p.ej. "Tipster", "Analista cuantitativo", "Machine Learning"
  raw: string; // línea original tal cual la escribió Gemini
  matchup: string;
  tournament: string;
  market: string;
  odds: string;
  ev: string;
  successRate: string;
  explanation: string;
}

export interface SelectionGroup {
  matchup: string;
  tournament: string;
  market: string;
  count: number; // en cuántos de los 3 informes aparece
  selections: Selection[]; // una por cada informe en el que aparece
}

const SECTION_TITLE_RE = /selecciones finales/i;
const COMBINADA_TITLE_RE = /combinada sugerida/i;
// N. Equipo local vs Equipo visitante | Torneo: X | Mercado: Y | Cuota: Z | EV: W | % Éxito: V | Explicación: U
// El campo final admite "Explicación" o "Justificación" como etiqueta: los
// prompts de Tipster y Analista cuantitativo usan "justificación" en su
// propio texto y a veces el informe arrastra esa palabra al listado final.
const LINE_RE =
  /^\s*\d+[.)]\s*(.+?)\s*\|\s*torneo:\s*(.+?)\s*\|\s*mercado:\s*(.+?)\s*\|\s*cuota:\s*(.+?)\s*\|\s*ev:\s*(.+?)\s*\|\s*%?\s*[eé]xito:\s*(.+?)\s*\|\s*(?:explicaci[oó]n|justificaci[oó]n(?:\s+t[eé]cnica)?(?:\s*\(?valor\)?)?):\s*(.+?)\s*$/i;

/**
 * Extrae las selecciones de la sección "SELECCIONES FINALES" de un informe.
 * Si el formato no viene exactamente como se pidió en el prompt, intenta
 * un parseo más permisivo línea por línea antes de rendirse.
 */
export function parseSelections(
  reportText: string,
  sourceIndex: number,
  sourceLabel: string
): Selection[] {
  const section = extractSection(reportText);
  if (!section) return [];

  const selections: Selection[] = [];
  for (const line of section.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const strict = LINE_RE.exec(trimmed);
    if (strict) {
      const [, matchup, tournament, market, odds, ev, successRate, explanation] = strict;
      selections.push({
        sourceIndex,
        sourceLabel,
        raw: trimmed,
        matchup,
        tournament,
        market,
        odds,
        ev,
        successRate,
        explanation,
      });
      continue;
    }

    const loose = parseLoose(trimmed);
    if (loose) selections.push({ sourceIndex, sourceLabel, raw: trimmed, ...loose });
  }
  return selections;
}

function extractSection(reportText: string): string | null {
  const lines = reportText.split("\n");
  const startIdx = lines.findIndex((l) => SECTION_TITLE_RE.test(l));
  if (startIdx === -1) return null;
  const rest = lines.slice(startIdx + 1);
  // Se corta antes de "COMBINADA SUGERIDA" (viene justo debajo en el mismo
  // informe) para que sus 2 líneas no se cuelen como selecciones 9 y 10.
  const combinadaIdx = rest.findIndex((l) => COMBINADA_TITLE_RE.test(l));
  return (combinadaIdx === -1 ? rest : rest.slice(0, combinadaIdx)).join("\n");
}

export interface CombinadaLegInfo {
  matchup: string;
  tournament: string;
  market: string;
  odds: string;
}

// Mismo estilo de línea que SELECCIONES FINALES pero solo 4 campos, y la
// cuota debe ser el último trozo de la línea (nada de texto después) para
// no confundirla con una línea de SELECCIONES FINALES si algo saliera mal
// con el corte de sección de arriba.
const COMBINADA_LEG_RE =
  /^\s*\d+[.)]\s*(.+?)\s*\|\s*torneo:\s*(.+?)\s*\|\s*mercado:\s*(.+?)\s*\|\s*cuota:\s*([\d.,]+)\s*$/i;

/**
 * Extrae las 2 patas de la sección "COMBINADA SUGERIDA" de un informe, si
 * las hay (puede no haberlas si ese perfil no encontró bankers en el
 * rango pedido). Ignora cualquier línea que no cuadre exactamente con el
 * formato de 4 campos, incluida la línea fija "Ninguna disponible hoy."
 */
export function parseCombinadaLegs(reportText: string): [CombinadaLegInfo, CombinadaLegInfo] | null {
  const lines = reportText.split("\n");
  const startIdx = lines.findIndex((l) => COMBINADA_TITLE_RE.test(l));
  if (startIdx === -1) return null;

  const legs: CombinadaLegInfo[] = [];
  for (const line of lines.slice(startIdx + 1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = COMBINADA_LEG_RE.exec(trimmed);
    if (!match) continue;

    const [, matchup, tournament, market, odds] = match;
    legs.push({ matchup, tournament, market, odds });
    if (legs.length === 2) break;
  }

  return legs.length === 2 ? [legs[0], legs[1]] : null;
}

function parseLoose(
  line: string
):
  | {
      matchup: string;
      tournament: string;
      market: string;
      odds: string;
      ev: string;
      successRate: string;
      explanation: string;
    }
  | null {
  const withoutNumber = line.replace(/^\s*\d+[.)]\s*/, "");
  const parts = withoutNumber.split("|").map((p) => p.trim());
  if (parts.length < 2) return null;

  const matchup = parts[0] ?? "";
  const tournament = (parts.find((p) => /torneo|competici[oó]n/i.test(p)) ?? "")
    .replace(/torneo:?|competici[oó]n:?/i, "")
    .trim();
  const market = (parts.find((p) => /mercado/i.test(p)) ?? parts[1] ?? "").replace(/mercado:?/i, "").trim();
  const odds = (parts.find((p) => /cuota/i.test(p)) ?? "").replace(/cuota:?/i, "").trim();
  const ev = (parts.find((p) => /^ev\b/i.test(p)) ?? "").replace(/^ev:?/i, "").trim();
  const successRate = (parts.find((p) => /[eé]xito/i.test(p)) ?? "").replace(/%?\s*[eé]xito:?/i, "").trim();
  const explanation = (parts.find((p) => /explicaci|justificaci/i.test(p)) ?? "")
    .replace(/explicaci[oó]n:?|justificaci[oó]n(\s+t[eé]cnica)?(\s*\(?valor\)?)?:?/i, "")
    .trim();

  if (!matchup || !market) return null;
  return { matchup, tournament, market, odds, ev, successRate, explanation };
}

const SURNAME_SIMILARITY_THRESHOLD = 0.8;

/** Compara dos partidos por apellido de cada lado (ver matchupSurnames), sin importar el orden. */
function matchupsMatch(a: string, b: string): boolean {
  const surnamesA = matchupSurnames(a);
  const surnamesB = matchupSurnames(b);
  if (!surnamesA.length || surnamesA.length !== surnamesB.length) return false;
  return surnamesA.every((s, i) => similarity(s, surnamesB[i]) >= SURNAME_SIMILARITY_THRESHOLD);
}

/**
 * Agrupa selecciones equivalentes entre los distintos informes (mismo
 * partido + mismo mercado, con tolerancia a redacción distinta) y
 * devuelve solo los grupos que se repiten en 2 o 3 informes.
 */
export function findRepeatedSelections(allSelections: Selection[]): SelectionGroup[] {
  const groups: SelectionGroup[] = [];

  for (const selection of allSelections) {
    const signature = marketSignature(selection.market, matchupSurnames(selection.matchup));

    const existingGroup = groups.find(
      (g) =>
        marketSignature(g.market, matchupSurnames(g.matchup)) === signature && matchupsMatch(g.matchup, selection.matchup)
    );

    if (existingGroup) {
      // Evita contar dos veces si el mismo informe repitiera la misma selección
      const alreadyFromThisSource = existingGroup.selections.some(
        (s) => s.sourceIndex === selection.sourceIndex
      );
      if (!alreadyFromThisSource) {
        existingGroup.selections.push(selection);
        existingGroup.count += 1;
      }
    } else {
      groups.push({
        matchup: selection.matchup,
        tournament: selection.tournament,
        market: selection.market,
        count: 1,
        selections: [selection],
      });
    }
  }

  return groups.filter((g) => g.count >= 2).sort((a, b) => b.count - a.count);
}

export interface MatchupGroup {
  matchup: string;
  tournament: string;
  selections: Selection[]; // una por cada informe distinto que analizó este partido
}

/**
 * Agrupa selecciones por PARTIDO únicamente (ignorando el mercado) y
 * devuelve los partidos que aparecen en 2 o 3 informes pero con mercados
 * distintos entre sí (p. ej. un informe recomienda "Tiafoe 2-0" y otro
 * "Tiafoe -2.5 juegos"): mismo partido visto como valor por varios
 * perfiles, aunque no coincidan en la apuesta exacta. Los que sí coinciden
 * en partido Y mercado ya se muestran en findRepeatedSelections.
 */
export function findRepeatedMatchupsWithDifferentMarkets(allSelections: Selection[]): MatchupGroup[] {
  const groups: MatchupGroup[] = [];

  for (const selection of allSelections) {
    const existingGroup = groups.find((g) => matchupsMatch(g.matchup, selection.matchup));

    if (existingGroup) {
      const alreadyFromThisSource = existingGroup.selections.some(
        (s) => s.sourceIndex === selection.sourceIndex
      );
      if (!alreadyFromThisSource) {
        existingGroup.selections.push(selection);
      }
    } else {
      groups.push({ matchup: selection.matchup, tournament: selection.tournament, selections: [selection] });
    }
  }

  return groups
    .filter((g) => g.selections.length >= 2)
    .filter((g) => new Set(g.selections.map((s) => marketSignature(s.market, matchupSurnames(s.matchup)))).size > 1)
    .sort((a, b) => b.selections.length - a.selections.length);
}
