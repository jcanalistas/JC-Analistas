/**
 * Los prompts que se lanzan como Deep Research en Gemini, agrupados por
 * deporte. El bot pregunta primero qué deporte analizar (ver bot.ts) y
 * lanza los 3 prompts del deporte elegido.
 *
 * Edita el texto de cada uno con tu enfoque real (ligas, mercados,
 * criterios de análisis, etc.). El bot añade automáticamente al final de
 * cada uno (ver OUTPUT_FORMAT_INSTRUCTIONS) las instrucciones de formato
 * necesarias para poder leer y comparar las selecciones después.
 *
 * No borres ni cambies OUTPUT_FORMAT_INSTRUCTIONS: sin eso el bot no
 * puede parsear los resultados.
 */
export type Sport = "futbol" | "tenis";

export const SPORT_LABELS: Record<Sport, string> = {
  futbol: "Fútbol ⚽️",
  tenis: "Tenis 🎾",
};

// TODO: sustituir por los prompts reales del usuario.
const FOOTBALL_PROMPTS: string[] = [
  `Analiza los partidos de fútbol más relevantes de las próximas 48 horas y
propón tus mejores selecciones de apuestas con enfoque en value bets,
priorizando ligas top europeas.`,

  `Analiza los partidos de fútbol de las próximas 48 horas centrándote en
mercados alternativos (córners, tarjetas, ambos marcan, hándicap asiático)
y propón tus mejores selecciones.`,

  `Analiza los partidos de fútbol de las próximas 48 horas desde un enfoque
estadístico avanzado (xG, forma reciente, bajas de jugadores clave) y
propón tus mejores selecciones.`,
];

// TODO: sustituir por los prompts reales del usuario.
const TENNIS_PROMPTS: string[] = [
  `Analiza los partidos de tenis más relevantes de las próximas 48 horas y
propón tus mejores selecciones de apuestas con enfoque en value bets.`,

  `Analiza los partidos de tenis de las próximas 48 horas centrándote en
mercados de juegos (over/under de juegos, hándicap de juegos o sets) y
propón tus mejores selecciones.`,

  `Analiza los partidos de tenis de las próximas 48 horas desde un enfoque
estadístico (forma reciente, superficie, cara a cara, estado físico) y
propón tus mejores selecciones.`,
];

const PROMPTS_BY_SPORT: Record<Sport, string[]> = {
  futbol: FOOTBALL_PROMPTS,
  tenis: TENNIS_PROMPTS,
};

const OUTPUT_FORMAT_INSTRUCTIONS = `

---
Instrucciones de formato obligatorias para tu respuesta final:
Al terminar tu informe, añade una última sección titulada exactamente
"SELECCIONES FINALES" (sin nada más en esa línea). Debajo, lista cada
selección como una línea numerada con este formato exacto, una selección
por línea:

N. Partido/Jugador vs Jugador | Mercado: <mercado> | Cuota: <cuota> | Explicación: <explicación breve en 1-2 frases>

No uses negritas, encabezados adicionales ni texto extra dentro de esa
sección: solo la lista numerada en ese formato exacto.`;

export function buildPrompt(basePrompt: string): string {
  return `${basePrompt.trim()}${OUTPUT_FORMAT_INSTRUCTIONS}`;
}

export function buildAllPrompts(sport: Sport): string[] {
  return PROMPTS_BY_SPORT[sport].map(buildPrompt);
}
