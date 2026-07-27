import { matchupSurnames, normalizeMarket, similarity } from "./normalize";

export interface Selection {
  sourceIndex: number; // qué deep research (0, 1, 2) la produjo
  sourceLabel: string; // p.ej. "Tipster", "Analista cuantitativo", "Machine Learning"
  raw: string; // línea original tal cual la escribió Gemini
  matchup: string;
  market: string;
  odds: string;
  ev: string;
  successRate: string;
  explanation: string;
}

export interface SelectionGroup {
  matchup: string;
  market: string;
  count: number; // en cuántos de los 3 informes aparece
  selections: Selection[]; // una por cada informe en el que aparece
}

const SECTION_TITLE_RE = /selecciones finales/i;
// N. Equipo local vs Equipo visitante | Mercado: X | Cuota: Y | EV: Z | % Éxito: W | Explicación: V
// El campo final admite "Explicación" o "Justificación" como etiqueta: los
// prompts de Tipster y Analista cuantitativo usan "justificación" en su
// propio texto y a veces el informe arrastra esa palabra al listado final.
const LINE_RE =
  /^\s*\d+[.)]\s*(.+?)\s*\|\s*mercado:\s*(.+?)\s*\|\s*cuota:\s*(.+?)\s*\|\s*ev:\s*(.+?)\s*\|\s*%?\s*[eé]xito:\s*(.+?)\s*\|\s*(?:explicaci[oó]n|justificaci[oó]n(?:\s+t[eé]cnica)?(?:\s*\(?valor\)?)?):\s*(.+?)\s*$/i;

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
      const [, matchup, market, odds, ev, successRate, explanation] = strict;
      selections.push({
        sourceIndex,
        sourceLabel,
        raw: trimmed,
        matchup,
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
  return lines.slice(startIdx + 1).join("\n");
}

function parseLoose(
  line: string
): { matchup: string; market: string; odds: string; ev: string; successRate: string; explanation: string } | null {
  const withoutNumber = line.replace(/^\s*\d+[.)]\s*/, "");
  const parts = withoutNumber.split("|").map((p) => p.trim());
  if (parts.length < 2) return null;

  const matchup = parts[0] ?? "";
  const market = (parts.find((p) => /mercado/i.test(p)) ?? parts[1] ?? "").replace(/mercado:?/i, "").trim();
  const odds = (parts.find((p) => /cuota/i.test(p)) ?? "").replace(/cuota:?/i, "").trim();
  const ev = (parts.find((p) => /^ev\b/i.test(p)) ?? "").replace(/^ev:?/i, "").trim();
  const successRate = (parts.find((p) => /[eé]xito/i.test(p)) ?? "").replace(/%?\s*[eé]xito:?/i, "").trim();
  const explanation = (parts.find((p) => /explicaci|justificaci/i.test(p)) ?? "")
    .replace(/explicaci[oó]n:?|justificaci[oó]n(\s+t[eé]cnica)?(\s*\(?valor\)?)?:?/i, "")
    .trim();

  if (!matchup || !market) return null;
  return { matchup, market, odds, ev, successRate, explanation };
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
    const normMarket = normalizeMarket(selection.market);

    const existingGroup = groups.find(
      (g) => normalizeMarket(g.market) === normMarket && matchupsMatch(g.matchup, selection.matchup)
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
        market: selection.market,
        count: 1,
        selections: [selection],
      });
    }
  }

  return groups.filter((g) => g.count >= 2).sort((a, b) => b.count - a.count);
}
