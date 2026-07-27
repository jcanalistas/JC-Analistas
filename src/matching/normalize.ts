/**
 * Utilidades de normalización de texto para poder comparar selecciones
 * que vienen redactadas de forma ligeramente distinta entre los 3 informes
 * (p. ej. "Real Madrid vs Barcelona" vs "Barcelona - Real Madrid", o
 * "Más de 2.5 goles" vs "Over 2.5").
 */

// Palabra clave que indica sobre qué se cuenta un over/under o hándicap
// (goles, córners, sets, juegos...), para no confundir p. ej. "Hándicap de
// sets -1.5" con "Hándicap de juegos -1.5" solo porque comparten número.
const DIMENSION_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\bsets?\b/i, tag: "sets" },
  { pattern: /\bjuegos?\b|\bgames?\b/i, tag: "games" },
  { pattern: /\bgoles?\b|\bgoals?\b/i, tag: "goals" },
  { pattern: /\bc[oó]rners?\b/i, tag: "corners" },
  { pattern: /\btarjetas?\b|\bcards?\b/i, tag: "cards" },
  { pattern: /\baces?\b/i, tag: "aces" },
];

const MARKET_SYNONYMS: Array<{ pattern: RegExp; canonical: string; useDimension?: boolean }> = [
  { pattern: /\bover\b|\bm[aá]s de\b|\bsuperior a\b|\bpor encima de\b/i, canonical: "over", useDimension: true },
  { pattern: /\bunder\b|\bmenos de\b|\binferior a\b|\bpor debajo de\b/i, canonical: "under", useDimension: true },
  { pattern: /\bambos marcan\b|\bbtts\b|\bgoal-goal\b|\bgg\b/i, canonical: "btts" },
  { pattern: /\bh[aá]ndicap\b|\bahc\b|\bah\b/i, canonical: "hcap", useDimension: true },
  { pattern: /\bdoble oportunidad\b|\bdouble chance\b/i, canonical: "dc" },
  { pattern: /\bc[oó]rners?\b/i, canonical: "corners" },
  { pattern: /\btarjetas?\b|\bcards?\b/i, canonical: "cards" },
  { pattern: /\bempate\b|\bdraw\b/i, canonical: "draw" },
  // Ganador del partido (moneyline): la forma en la que más difieren los
  // 3 perfiles al redactar el mismo mercado.
  { pattern: /\bganador\b|\bgana(r[aá]?)?\b|\bvictoria\b|\bvencedor\b|\bmoneyline\b/i, canonical: "winner" },
  { pattern: /\baces?\b/i, canonical: "aces" },
];

export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeText(text: string): string {
  return stripAccents(text.toLowerCase())
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Separa un "Equipo/Jugador A vs Equipo/Jugador B" en sus dos lados. Se hace
 * sobre el texto ORIGINAL (antes de normalizeText) porque normalizeText
 * elimina el guion "-", que es el separador que usan varios informes en vez
 * de "vs" — normalizar primero y luego intentar partir por "-" nunca
 * encuentra el separador.
 */
function splitMatchupSides(matchup: string): string[] {
  const byVs = matchup.split(/\s+vs\.?\s+|\s+v\.?\s+/i);
  const raw = byVs.length > 1 ? byVs : matchup.split(/-|\|/);
  return raw.map((side) => normalizeText(side)).filter(Boolean);
}

/** Normaliza un nombre de partido para que el orden de los equipos no importe. */
export function normalizeMatchup(matchup: string): string {
  return splitMatchupSides(matchup).sort().join(" - ");
}

/**
 * Extrae, por cada lado del partido, la ÚLTIMA palabra (heurística para el
 * apellido, siguiendo la convención habitual "nombre(s) + apellido": en
 * tenis los 3 informes no siempre nombran a un jugador igual, p. ej.
 * "T. Griekspoor" vs "Tallon Griekspoor" — el apellido es lo único
 * estable). Antes se usaba la palabra más larga, pero eso falla con
 * nombres de pila largos como "Alejandro Tabilo" (elegía "Alejandro" en
 * vez de "Tabilo"). Se usa para comparar partidos entre informes
 * tolerando esas variaciones de nombre, en vez de comparar la cadena
 * completa.
 */
export function matchupSurnames(matchup: string): string[] {
  return splitMatchupSides(matchup)
    .map((side) => {
      const words = side.split(/\s+/).filter(Boolean);
      return words.at(-1) ?? "";
    })
    .sort();
}

/**
 * Normaliza el texto de un mercado a una forma canónica, preservando
 * cualquier número presente (línea de goles, hándicap, etc.) para no
 * confundir p. ej. "Hándicap -1" con "Hándicap +2": solo el término se
 * traduce a sinónimo, el número siempre se conserva tal cual.
 */
export function normalizeMarket(market: string): string {
  // Los signos +/- se extraen ANTES de normalizeText, que los elimina
  // (si no, "-1" y "+1" acabarían siendo el mismo número).
  const numbers = market.match(/[+-]?\d+(\.\d+)?/g) ?? [];
  const normalized = normalizeText(market);

  for (const { pattern, canonical } of MARKET_SYNONYMS) {
    if (pattern.test(normalized)) {
      return [canonical, ...numbers].join(" ").trim();
    }
  }
  return normalized;
}

/**
 * Firma de un mercado que además distingue A QUIÉN respalda la selección,
 * cuando se puede identificar. normalizeMarket() por sí sola colapsa
 * "Ganador Griekspoor" y "Ganador Tabilo" en el mismo "winner" — correcto
 * para comparar el TIPO de mercado, pero letal si dos informes recomiendan
 * lados opuestos del mismo partido (Griekspoor gana vs. Tabilo gana): se
 * mostrarían como si los 3 informes coincidieran en la misma selección
 * cuando en realidad son contradictorios. Se añade el apellido detectado
 * en el texto del mercado (si aparece) para separarlos.
 */
export function marketSignature(market: string, surnames: string[]): string {
  const base = normalizeMarket(market);
  const normalizedMarket = normalizeText(market);
  const side = surnames.find((s) => s && normalizedMarket.includes(s));
  return side ? `${base}::${side}` : base;
}

/** Similitud simple basada en distancia de Levenshtein, entre 0 y 1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0)
  );
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[a.length][b.length];
}
