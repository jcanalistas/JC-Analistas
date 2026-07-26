/**
 * Utilidades de normalización de texto para poder comparar selecciones
 * que vienen redactadas de forma ligeramente distinta entre los 3 informes
 * (p. ej. "Real Madrid vs Barcelona" vs "Barcelona - Real Madrid", o
 * "Más de 2.5 goles" vs "Over 2.5").
 */

const MARKET_SYNONYMS: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /\bover\b|\bmás de\b|\bmas de\b/i, canonical: "over" },
  { pattern: /\bunder\b|\bmenos de\b/i, canonical: "under" },
  { pattern: /\bambos marcan\b|\bbtts\b|\bgoal-goal\b|\bgg\b/i, canonical: "btts" },
  { pattern: /\bh[aá]ndicap asi[aá]tico\b|\bahc\b|\bah\b/i, canonical: "hcap" },
  { pattern: /\bdoble oportunidad\b|\bdouble chance\b/i, canonical: "dc" },
  { pattern: /\bcórners?\b|\bcorners?\b/i, canonical: "corners" },
  { pattern: /\btarjetas?\b|\bcards?\b/i, canonical: "cards" },
  { pattern: /\bempate\b|\bdraw\b/i, canonical: "draw" },
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

/** Normaliza un nombre de partido para que el orden de los equipos no importe. */
export function normalizeMatchup(matchup: string): string {
  const normalized = normalizeText(matchup).replace(/\bvs\b|\bv\b/g, "-");
  const teams = normalized
    .split(/-|\|/)
    .map((t) => t.trim())
    .filter(Boolean)
    .sort();
  return teams.join(" - ");
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
