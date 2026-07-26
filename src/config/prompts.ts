/**
 * Los 3 prompts que se lanzan como Deep Research en Gemini.
 *
 * Edita el texto de cada uno con tu enfoque real (ligas, mercados,
 * criterios de análisis, etc.). El bot añade automáticamente al final de
 * cada uno (ver OUTPUT_FORMAT_INSTRUCTIONS) las instrucciones de formato
 * necesarias para poder leer y comparar las selecciones después.
 *
 * No borres ni cambies el placeholder {{OUTPUT_FORMAT_INSTRUCTIONS}} del
 * final de buildPrompt(): sin él el bot no puede parsear los resultados.
 */
export const RESEARCH_PROMPTS: string[] = [
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

const OUTPUT_FORMAT_INSTRUCTIONS = `

---
Instrucciones de formato obligatorias para tu respuesta final:
Al terminar tu informe, añade una última sección titulada exactamente
"SELECCIONES FINALES" (sin nada más en esa línea). Debajo, lista cada
selección como una línea numerada con este formato exacto, una selección
por línea:

N. Equipo local vs Equipo visitante | Mercado: <mercado> | Cuota: <cuota> | Explicación: <explicación breve en 1-2 frases>

No uses negritas, encabezados adicionales ni texto extra dentro de esa
sección: solo la lista numerada en ese formato exacto.`;

export function buildPrompt(basePrompt: string): string {
  return `${basePrompt.trim()}${OUTPUT_FORMAT_INSTRUCTIONS}`;
}

export function buildAllPrompts(): string[] {
  return RESEARCH_PROMPTS.map(buildPrompt);
}
