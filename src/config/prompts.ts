/**
 * Los prompts que se lanzan como Deep Research en Gemini, agrupados por
 * deporte. El bot pregunta primero qué deporte analizar (ver bot.ts) y
 * lanza los 3 prompts del deporte elegido, en este orden fijo:
 * 1. Tipster, 2. Machine Learning, 3. Analista cuantitativo.
 *
 * El bot añade automáticamente al final de cada uno (ver
 * OUTPUT_FORMAT_INSTRUCTIONS) las instrucciones de formato necesarias
 * para poder leer y comparar las selecciones después.
 *
 * No borres ni cambies OUTPUT_FORMAT_INSTRUCTIONS: sin eso el bot no
 * puede parsear los resultados.
 */
export type Sport = "futbol" | "tenis";

export const SPORT_LABELS: Record<Sport, string> = {
  futbol: "Fútbol ⚽",
  tenis: "Tenis 🎾",
};

export interface PromptDefinition {
  /** Nombre del perfil/rol, se usa como título de sección en Telegram. */
  label: string;
  prompt: string;
}

/**
 * Competiciones de fútbol que cubren los 3 prompts (ver bot.ts: el
 * selector de competiciones antes de lanzar /analizar solo aplica a
 * fútbol, ya que en tenis los prompts ya están acotados a ATP/Challenger).
 */
export const FOOTBALL_COMPETITIONS: Array<{
  id: string;
  label: string;
  flag: string;
  /**
   * Texto que se manda a Gemini en la restricción de competiciones en vez
   * del label corto del botón, para entradas "paraguas" que agrupan varias
   * ligas (Gemini necesita saber exactamente cuáles, el label del botón no
   * da suficiente contexto por sí solo). Si no se indica, se usa el label.
   */
  searchHint?: string;
}> = [
  { id: "laliga1", label: "LaLiga 1ª", flag: "🇪🇸" },
  { id: "laliga2", label: "LaLiga 2ª", flag: "🇪🇸" },
  { id: "rfef1", label: "1ª RFEF", flag: "🇪🇸" },
  { id: "rfef2", label: "2ª RFEF", flag: "🇪🇸" },
  { id: "portugal", label: "Liga Portugal", flag: "🇵🇹" },
  { id: "premier", label: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "bundesliga", label: "Bundesliga", flag: "🇩🇪" },
  {
    id: "mls",
    label: "MLS",
    flag: "🇺🇸",
    searchHint: "MLS (incluye también la Leagues Cup, el torneo entre clubes de MLS y Liga MX)",
  },
  { id: "brasileirao", label: "Brasileirão", flag: "🇧🇷" },
  // Competiciones de la UEFA: se usa la bandera de la UE como referencia visual.
  { id: "champions", label: "Champions League", flag: "🇪🇺" },
  { id: "europa", label: "Europa League", flag: "🇪🇺" },
  { id: "conference", label: "Conference League", flag: "🇪🇺" },
  {
    id: "european_others",
    label: "Ligas Europeas (otras)",
    flag: "🇪🇺",
    searchHint:
      "Ligas Europeas (otras) — primeras divisiones nacionales europeas de fútbol masculino no cubiertas en las demás opciones, como la Superliga de Dinamarca, la Eliteserien de Noruega, la Allsvenskan de Suecia, la Jupiler Pro League de Bélgica, la Eredivisie de Países Bajos, la Scottish Premiership, la Bundesliga austriaca o la Super League suiza",
  },
];

// Ejemplo real que motivó este bloque: la victoria del Copenhague a 1,58 no
// tenía valor por sí sola, pero el partido de ida había terminado 3-3 (señal
// de que ambos equipos conceden mucho) — combinar esa misma victoria con
// "+1.5 goles" en el MISMO partido subía la cuota conjunta a 1,85 sin bajar
// apenas la probabilidad de acierto real. Un análisis centrado solo en el
// mercado principal (1X2/hándicap) descarta el partido entero por no tener
// valor ahí, sin llegar a probar esta combinación.
const FOOTBALL_SAME_MATCH_COMBO_CHECK = `IMPORTANTE - Mercados relacionados dentro del MISMO partido: antes de descartar un partido por no tener valor en su mercado principal (1X2, hándicap asiático, etc.), comprueba si combinar dos mercados relacionados del MISMO partido —nunca de partidos distintos, eso ya lo cubre la Combinada Sugerida al final del informe— puede convertirlo en una selección con valor real. Ejemplo: la victoria de un equipo a 1,58 no tiene valor por sí sola, pero si el contexto apunta también a un partido con muchos goles (p. ej. la ida de la eliminatoria terminó 3-3, ambos equipos conceden mucho, o el ritmo reciente de ambos es alto), añadir "+1.5 goles" a esa misma victoria puede subir la cuota conjunta a 1,85 manteniendo una probabilidad de acierto similar — eso sí tiene valor. Otras combinaciones habituales del mismo partido a valorar: Doble oportunidad + Ambos marcan, Victoria + Over de córners, Hándicap + Under de goles (si el partido pinta cerrado y con pocas ocasiones). Solo combina dos mercados si AMBOS están respaldados por el mismo análisis que ya has hecho — no los juntes solo para maquillar la cuota. Si encuentras una combinación así con valor, inclúyela como una de tus 8 selecciones normales, describiendo el mercado completo en el campo Mercado (p. ej. "Victoria Equipo A + Más de 1.5 goles") con su cuota conjunta, y explica en la Explicación por qué las dos partes de la combinación están justificadas.`;

const FOOTBALL_PROMPT_DEFS: PromptDefinition[] = [
  {
    label: "Tipster",
    prompt: `Actúa como un analista profesional de 'Sports Betting' especializado en mercados de valor (EV+). Utiliza tus herramientas de búsqueda web para realizar una investigación profunda (Deep Search) de eventos de fútbol para las próximas 24 horas. (Identifica la fecha y hora actual al lanzar el research para discriminar los partidos que entren en el rango temporal).

Sigue estas reglas estrictas:

1. Mercados y Cuotas:
 * Busca selecciones en la casa de apuestas WINAMAX con cuotas superiores a 1.65. Mercados permitidos: resultado (1X2), hándicap asiático, más/menos de goles, ambos marcan, córners o tarjetas.
 * Restricción de volumen: Devuelve exactamente 8 selecciones simples. NO repitas partidos.
 * Ordénalos obligatoriamente de mayor a menor confianza de éxito (asignando un % de probabilidad de acierto a cada uno).

2. Cobertura y Filtros Estadísticos:
 * Ligas permitidas: MLS (incluye también la Leagues Cup, el torneo entre clubes de MLS y Liga MX), LaLiga (1ª y 2ª), 1ª RFEF, 2ª RFEF, Liga Portugal, Premier League, Bundesliga, Brasileirão y competiciones europeas (Champions, Europa, Conference).
 * Criterio de selección: Busca equipos con un win-rate local/visitante > 65% frente a rivales con H2H desfavorable o rendimiento modesto en esa condición.
 * Métricas avanzadas: Apoya tu decisión en datos como el xG (generado/concedido), tiros a puerta y posesión. Revisa si han vencido a rivales de la parte alta de la tabla recientemente.

3. Análisis de Valor (EV+) y Mercado:
 * Para que un pick sea válido, su Probabilidad Real Estimada debe ser mayor que la Probabilidad Implícita de la cuota.
 * Market Drop: Verifica si la cuota ha bajado recientemente (indicador de dinero profesional/sharp money).
 * Contexto: Busca noticias de última hora (lesiones, sanciones, rotaciones por calendario congestionado) y factores motivacionales (derbis, necesidad de puntos por título/descenso). Pondera esto en tu decisión final.

${FOOTBALL_SAME_MATCH_COMBO_CHECK}

Formato de Salida:
Antes de la tabla, escribe un breve párrafo resumiendo qué ligas tenían más valor hoy y qué partido descartaste en el último momento y por qué. Luego, presenta los resultados estrictamente en esta tabla:

| Confianza | Evento (Liga) | Mercado y Pick | Cuota | EV+ y Justificación (Estadística + Contexto) |
|---|---|---|---|---|
| [XX%] | [Equipo A vs Equipo B] ([Liga]) | [Pick] | [1.6x] | [Ej: Cuota bajó de 1.80 a 1.68. Equipo A promedia 2.1 xG en casa. Rival con 3 bajas en defensa...] |`,
  },
  {
    label: "Machine Learning",
    prompt: `Actúa como un modelo de Machine Learning avanzado y analista cuantitativo (Quant) especializado en apuestas de fútbol. Utiliza tus herramientas de búsqueda web para analizar la jornada de las próximas 24 horas (identifica la fecha/hora actual al lanzar el research para delimitar el calendario de partidos).

Tu objetivo es analizar los datos para encontrar valor matemático real (Value Betting) frente a las cuotas de Winamax o Bet365. Debes proporcionar exactamente 8 selecciones de picks con EV+ (Expected Value positivo) de 8 partidos distintos. La probabilidad estimada de acierto del PICK (ya sea 1X2, hándicap, goles, etc.) debe ser estrictamente superior al 50%.

Ligas cubiertas: MLS (incluye también la Leagues Cup, el torneo entre clubes de MLS y Liga MX), LaLiga (1ª y 2ª), 1ª RFEF, 2ª RFEF, Liga Portugal, Premier League, Bundesliga, Brasileirão y competiciones europeas (Champions, Europa y Conference League).

Analizarás minuciosamente los partidos bajo estos 5 pilares metodológicos:

1. RENDIMIENTO COMO LOCAL/VISITANTE Y CONTEXTO (Ponderación: 30%)
- Win-rate local/visitante (últimos 12 y 24 meses).
- Estadísticas avanzadas: xG (generado/concedido), tiros a puerta a favor/en contra, control de posesión.
- Factor campo: impacto del estadio, desplazamientos largos (especialmente en MLS).

2. MÉTRICAS DE PRESIÓN Y MOMENTUM (Ponderación: 25%)
- Rendimiento en el "Clutch": Goles a favor/en contra en los últimos 15 min, remontadas.
- Tendencia (Form): Últimos 5 partidos contextualizados según el ranking de los rivales.
- Presión psicológica: Derbis, lucha por título/descenso/ascenso/plazas europeas.

3. FATIGA, CARGA DE TRABAJO Y CONTEXTO (Ponderación: 20%)
- Fatiga acumulada y congestión de calendario (partidos en los últimos 7-10 días, intersemanales europeos).
- Riesgo de rotaciones por minutos acumulados o por falta de objetivos en juego (partidos intrascendentes).
- Bajas confirmadas por lesión/sanción de jugadores clave (Deep Search de noticias).

4. ENFRENTAMIENTOS DIRECTOS (H2H) Y ESTILOS (Ponderación: 15%)
- H2H histórico reciente.
- Choque táctico: Presión alta vs Contragolpe, Posesión vs Bloque bajo.

5. AJUSTE DE CATEGORÍA/VOLATILIDAD (Ponderación: 10%)
- Penaliza la varianza e irregularidad en divisiones inferiores (1ª/2ª RFEF, 2ª Div) o ligas de alta volatilidad (MLS).
- Premia la consistencia de datos en divisiones élite (Premier League, LaLiga, rondas finales europeas).

${FOOTBALL_SAME_MATCH_COMBO_CHECK}

---
INSTRUCCIONES DE SALIDA (Formato de Respuesta):
Presenta tu análisis estructurado estrictamente de la siguiente manera. Primero un resumen global y luego 8 bloques individuales.

### 1. Macro-Resumen de Ventajas Competitivas
(Breve párrafo resumiendo los desequilibrios estadísticos o de fatiga más severos encontrados en la jornada de hoy que alimentan el algoritmo).

### 2. Análisis Cuantitativo de los 8 Picks (Fichas)
Para CADA UNO de los 8 partidos seleccionados, genera el siguiente bloque:

--- MATCH [1 al 8]: [Equipo A] vs [Equipo B] ([Liga]) ---
* Matriz de Probabilidad (Modelo ML):
  - Victoria Local: XX% (Cuota justa: X.XX) | Empate: XX% (Cuota justa: X.XX) | Victoria Vis: XX% (Cuota justa: X.XX)
  - Proyección de Goles: [X.X] | Proyección de Córners: [X.X]
* Identificación de VALOR (The Edge):
  - Mercado detectado con ineficiencia: [Ej: Over 2.5 goles / Hándicap...]
  - Probabilidad de acierto del pick: [XX%] (Debe ser >50%)
  - Comparativa: Cuota Bookie [X.XX] vs Cuota Justa [X.XX]
  - Cálculo EV: [(Probabilidad Decimal * Cuota Bookie) - 1] = +[X.XX]% EV
* Pronóstico Final y Stake:
  - Pick: [Selección final] a cuota [X.XX] en [Bookie]
  - Justificación algorítmica: [1-2 líneas cruzando los pilares. Ej: 30% ventaja en xG local + 20% penalización visitante por fatiga europea].
  - Stake: [1/5 a 5/5] (Ajustado por el pilar 5 de volatilidad).`,
  },
  {
    label: "Analista cuantitativo",
    prompt: `Actúa como un analista cuantitativo de apuestas deportivas (sharp bettor) especializado en fútbol. Utiliza tus herramientas de búsqueda para identificar la fecha y hora actual, y filtra los partidos que se disputarán en las próximas 24 horas en las siguientes competiciones: MLS (incluye también la Leagues Cup, el torneo entre clubes de MLS y Liga MX), LaLiga (1ª y 2ª), 1ª RFEF, 2ª RFEF, Liga Portugal, Premier League, Bundesliga, Brasileirão y competiciones europeas (Champions, Europa y Conference League).

Tu objetivo es encontrar Valor Esperado Positivo (EV+) puro. Selecciona exactamente 8 partidos distintos. NO se permiten apuestas combinadas.

REGLA MATEMÁTICA ESTRICTA PARA LOS 8 PICKS:
- La probabilidad real de éxito calculada por tu modelo debe ser estrictamente SUPERIOR AL 60% (Cuota justa estimada < 1.66).
- La cuota real ofrecida por la casa de apuestas (ej. Winamax) debe ser SUPERIOR A 1.60, y siempre mayor que tu cuota justa estimada, para garantizar el EV+.

${FOOTBALL_SAME_MATCH_COMBO_CHECK}

Selecciona los 8 picks y redacta tu informe presentando cada partido bajo esta estructura de 4 pasos analíticos:

---
FORMATO DE SALIDA (Repite esta estructura para cada uno de los 8 picks):

### 🎯 PICK [1-8]: [Equipo A] vs [Equipo B] | Competición
* Mercado y Selección: [Ej: Hándicap Asiático -1 Local / Over 2.5...]
* Comparativa Sharp: Cuota Bookie [X.XX] | Tu Cuota Justa [X.XX] | Probabilidad Real [XX%] (Debe ser >60%)
* Cálculo EV+: [(Probabilidad Real Decimal * Cuota Bookie) - 1] = +[XX.X]% EV

1. CONTEXTO Y ENTORNO
* Localía y Condiciones: Impacto real del estadio, desplazamiento (especial foco en MLS/Europa) y factores climáticos si aplican.
* Motivación y Calendario: Qué hay en juego (títulos, descenso, clasificación) y riesgo de rotaciones por partidos europeos intersemanales.

2. RENDIMIENTO ESTADÍSTICO (Últimos 10 partidos L/V)
* Métricas Clave: xG generado vs xG concedido, Tiros a puerta y control de balón.
* Índice Ofensivo/Defensivo (Dominance Ratio): Relación entre generación y concesión de peligro.
* Rachas: Contexto del rendimiento reciente (W-D-L).

3. MATCH-UP TÁCTICO Y FATIGA
* H2H y Choque de Estilos: ¿Cómo interactúan tácticamente? (Ej: Bloque bajo vs Posesión ineficiente, Presión alta castigando la salida del rival).
* Fatiga y Bajas: Minutos acumulados por titulares, sobrecargas, lesiones clave o sanciones confirmadas mediante búsqueda web.

4. JUSTIFICACIÓN DEL VALOR (El "Edge")
* Explica en 2 líneas exactamente por qué la casa de apuestas se equivoca en el precio de esta cuota basándote en los 3 puntos anteriores (Ej: "El mercado sobrevalora al visitante por su nombre, ignorando que su Dominance Ratio cae un 40% fuera de casa y hoy juegan con el portero suplente").
---`,
  },
];

// Compartido por los 3 prompts de tenis: retiradas, walkovers, Time Out
// Médico y Lucky Loser son señales que el mercado suele sobrerreaccionar
// (o infravalorar) y que un análisis puramente estadístico puede pasar
// por alto si no se le pide explícitamente que las busque.
const TENNIS_RETIREMENT_LUCKY_LOSER_CHECK = `IMPORTANTE - Retiradas, walkovers, Time Out Médico y Lucky Loser: antes de dar por buena una selección, comprueba si alguno de los dos jugadores se retiró (RET), tuvo un walkover (WO) o pidió un Time Out Médico (MTO) en su partido más reciente. Si es así, investiga el motivo exacto (golpe de calor, calambres, lesión muscular/articular, etc.) y si es un problema puntual/ambiental (normalmente resuelto en 24-48h) o una lesión estructural con riesgo real de recaída — no penalices automáticamente a un jugador por una retirada de un solo día por calor si hoy las condiciones son mejores y no hay lesión estructural reportada; si crees que el mercado ha inflado su cuota por miedo injustificado, señálalo como posible valor (EV+). Comprueba también si alguno de los dos entró en el cuadro principal como Lucky Loser (promovido desde la fase de clasificación por la baja de otro jugador) y qué implica eso en su carga de partidos reciente. Si detectas cualquiera de estas circunstancias en un partido que recomiendes, menciónalo expresamente en la Explicación de ese pick para que se pueda revisar a mano.`;

// Ejemplo real que motivó este bloque: Olivieri vs Taberner, donde Taberner
// volvía de 6 meses de baja por lesión sin competir a nivel profesional —
// ningún perfil lo detectó porque un análisis basado solo en estadísticas
// recientes no tiene datos (o tiene datos "viejos", de antes de la lesión)
// del jugador que vuelve, así que el desequilibrio real pasa desapercibido
// si no se busca activamente. Un hándicap de juegos/sets amplio a favor del
// rival en forma fue una selección fácil a cuota alta.
const TENNIS_INJURY_COMEBACK_CHECK = `IMPORTANTE - Regalos por vuelta de una baja larga confirmada: además de los picks que salgan de tu análisis estadístico normal, busca ACTIVAMENTE en cada partido si alguno de los dos jugadores vuelve de una baja larga confirmada (orientativamente 1 mes o más sin competir a nivel profesional) por lesión, operación, sanción u otro motivo — verifícalo con una fuente fiable (web oficial ATP/ITF, comunicado del torneo, prensa especializada de tenis), nunca lo asumas solo por no verlo en el ranking o el calendario reciente. Este tipo de partido es fácil de pasar por alto en un análisis puramente estadístico: el jugador que vuelve no tiene datos recientes, o tiene datos "viejos" de antes de la baja que ya no reflejan su nivel real, así que un modelo centrado solo en el rendimiento de los últimos partidos puede infravalorar el desequilibrio real que hay sobre la pista.

Si confirmas un caso así:
- Anota cuánto tiempo ha estado de baja el jugador y el motivo exacto.
- Ten en cuenta que un jugador recién vuelto de una baja larga suele arrastrar falta de ritmo de competición, menos resistencia física y riesgo de recaída, sobre todo cuanto más largo sea el partido (mejor de 3 o 5 sets).
- Si el rival llega en buena forma y el desequilibrio de nivel/ranking ya era favorable de por sí, valora mercados de hándicap de juegos o de sets (no solo el ganador del partido): a veces dan más valor que la victoria simple porque el mercado no ha terminado de ajustar la cuota a esta circunstancia.
- Menciona expresamente en la Explicación de ese pick que el jugador vuelve de una baja larga confirmada y desde cuándo, para que se entienda por qué es una selección de valor aunque las estadísticas recientes del rival por sí solas no lo justifiquen del todo.

No trates una ausencia del calendario como un "regalo" si no puedes confirmar el motivo con una fuente: sin confirmación, ignóralo y sigue con el resto del análisis.`;

const TENNIS_PROMPT_DEFS: PromptDefinition[] = [
  {
    label: "Tipster",
    prompt: `Actúa como un cuantitativo especializado en Sports Betting y analista de valor (+EV) en tenis. Tu objetivo es identificar oportunidades de apuestas con valor esperado positivo en la casa de apuestas WINAMAX para la jornada de tenis indicada por la ventana de fechas que se detalla más abajo en este mismo mensaje.

Aplica estrictamente las siguientes reglas metodológicas:

1. FILTROS DE MERCADO Y COBERTURA:
   * Cobertura: Exclusivamente cuadros individuales masculinos (Singles) de torneos ATP y Challenger activos hoy.
   * Bookie principal: WINAMAX (Cuotas iguales o superiores a 1.70).
   * Mercados permitidos: Victoria simple (Moneyline), Hándicap de Juegos, Hándicap de Sets y Total de Juegos.
   * Volumen de salida: Devuelve exactamente 8 selecciones simples. Sin repetir partidos (máximo 1 pick por partido).

2. CRITERIOS DE VALOR (+EV) Y RECOLECCIÓN DE DATOS:
   * Benchmark Sharp: Compara la cuota de Winamax con la cuota actual en Pinnacle o Betfair Exchange. Solo considera selecciones donde la cuota de Winamax sea superior a la cuota fair/sharp estimada (Value Bet).
   * Rendimiento Contextual: Prioriza jugadores con un win rate >60% en la superficie específica en los últimos 12 meses (no métricas históricas globales) o un rendimiento reciente destacado en partidos de la misma categoría.
   * Métricas de Servidor/Restador: Analiza en sus últimos 3-5 partidos el % de puntos ganados con el 1º/2º servicio y el % de bolas de break salvadas/convertidas.
   * Dinámica de Mercado y Noticias: Verifica si la cuota ha bajado recientemente en portales como Oddsportal (indicador de dinero profesional) y evalúa factores físicos críticos (acumulación de minutos/partidos en los últimos 3 días, molestias físicas o retiradas recientes).

3. ORDENACIÓN Y MATEMÁTICA DEL PICK:
   * Ordena las 8 selecciones de MAYOR a MENOR Valor Esperado (EV%).
   * Calcula la probabilidad real estimada (% acierto) sin margen y contrástala con la probabilidad implícita de la cuota de Winamax.

${TENNIS_RETIREMENT_LUCKY_LOSER_CHECK}

${TENNIS_INJURY_COMEBACK_CHECK}

FORMATO DE SALIDA (Responde exclusivamente con esta estructura):

### 📊 SELECCIONES +EV - WINAMAX

| # | Torneo | Partido | Mercado / Selección | Cuota Winamax | Cuota Sharp / Fair | Prob. Real Est. | EV Estimado % |
|---|---|---|---|---|---|---|---|
| 1 | ATP [Nombre] | [Jugador A vs Jugador B] | [Ej: Jugador A (-1.5 Sets)] | [1.85] | [1.75] | [57%] | [+5.4%] |

---

### 🔍 ANÁLISIS TÉCNICO DETALLADO POR PICK

Para cada una de las 8 selecciones, incluye un breve desglose cuantitativo:
1. **[Jugador A vs Jugador B] - [Mercado Escolado]**
   * **Métricas Clave:** (Estadísticas de servicio/resto recientes + win rate en superficie en los últimos 12 meses).
   * **Justificación de Valor (+EV):** (Por qué la cuota de Winamax está desajustada vs Pinnacle/Mercado + tendencia de cuota/noticias).
   * **Factor de Riesgo:** (Principal amenaza o contexto físico/desgaste).`,
  },
  {
    label: "Machine Learning",
    prompt: `Actúa como un modelo de Machine Learning avanzado y analista cuantitativo especializado en apuestas de tenis (ATP y ATP Challenger Tour). Tu objetivo es analizar la jornada de tenis indicada por la ventana de fechas que se detalla más abajo en este mismo mensaje para encontrar valor real frente a las cuotas de las casas de apuestas (Value Betting).

La conclusión final deben ser exactamente 8 recomendaciones de picks con EV+ (sin repetir partidos), utilizando cuotas superiores a 1,80 en la casa de apuestas WINAMAX.

Analiza minuciosamente los datos de los partidos de singles masculinos (ATP y Challenger) bajo los siguientes 5 pilares metodológicos y sus ponderaciones:

1. RENDIMIENTO EN SUPERFICIE Y CONDICIONES (Ponderación: 30%)
- Porcentaje de victorias en la superficie específica en los últimos 12 meses.
- Estadísticas de servicio y resto: % de primeros servicios, puntos ganados con 1º/2º saque, Hold % y Break %.
- Factor Altitud/Velocidad: Pista rápida/lenta o indoor/outdoor y su impacto en los estilos de juego.

2. MÉTRICAS DE PRESIÓN Y MOMENTUM (Ponderación: 25%)
- Break Points: % de BP salvadas y BP convertidas.
- Rendimiento bajo presión: Registro en Tie-breaks y sets decisivos recientes.
- Tendencia reciente: Rendimiento en los últimos 5 partidos y nivel de los rivales.

3. FATIGA, CARGA DE TRABAJO Y CONTEXTO (Ponderación: 20%)
- Fatiga acumulada: Horas en pista y sets jugados en los últimos 7 días.
- Motivación y defensa de puntos: Puntos ATP que defiende y contexto de categoría (ej. jugador ATP en Challenger).
- Desgaste físico: Historial de lesiones recientes o molestias reportadas.

4. ENFRENTAMIENTOS DIRECTOS (H2H) Y ESTILOS (Ponderación: 15%)
- H2H general y específico en esta superficie.
- Choque de estilos (ej. sacador vs restador, zurdo vs diestro).

5. AJUSTE DE CATEGORÍA (ATP vs. CHALLENGER) (Ponderación: 10%)
- Penaliza la irregularidad en el servicio en torneos Challenger y premia la resiliencia mental y el % de puntos al segundo saque.

${TENNIS_RETIREMENT_LUCKY_LOSER_CHECK}

${TENNIS_INJURY_COMEBACK_CHECK}

---

INSTRUCCIONES DE SALIDA (Formato de Respuesta):
Presenta tu análisis estructurado estrictamente con este formato para cada uno de los 8 picks seleccionados:

### 🎾 [Partido: Jugador A vs Jugador B] ([Torneo / Categoría])

1. **Ventajas Competitivas Encontradas**
   * (Resumen breve de los desequilibrios estadísticos severos en Saque/Resto, Fatiga o Superficie).

2. **Matriz de Probabilidad Estimada (Modelo)**
   * Probabilidad estimada Jugador A: XX% (Cuota justa: X.XX)
   * Probabilidad estimada Jugador B: XX% (Cuota justa: X.XX)
   * Proyección: [Ej: 2.5 sets | 22.5 juegos]

3. **Identificación de VALOR (The Edge)**
   * Mercado seleccionado: [Ej: Ganador Simple / Hándicap Juegos / Total de Juegos]
   * Cuota Winamax: [X.XX] vs Cuota Justa Estimada: [Y.YY]
   * Margen de EV+: [+X.X%] (Demostrando que la probabilidad real estimada supera la probabilidad implícita de la cuota de la casa).

4. **Pronóstico Final y Stake**
   * Apuesta recomendada: [Detalle exacto del pick]
   * Cuota: [X.XX]
   * Stake Sugerido (1 al 5): [X/5]`,
  },
  {
    label: "Analista cuantitativo",
    prompt: `Actúa como un analista cuantitativo de apuestas deportivas (sharp bettor) especializado en tenis ATP y Challenger (Singles Masculinos). Tu objetivo es realizar un análisis probabilístico y estadístico exhaustivo para la jornada de tenis indicada por la ventana de fechas que se detalla más abajo en este mismo mensaje.

Quiero determinar si existe Valor Esperado Positivo (EV+) en el mercado, priorizando selecciones con cuotas superiores a 1.70 en la casa de apuestas WINAMAX.

Sigue estrictamente esta metodología de análisis:

1. FILTRADO Y BENCHMARK DE MERCADO (Detección de Valor)
* Compara las cuotas actuales de Winamax con las cuotas de cierre/actuales de casas Sharp (Pinnacle) o Exchanges (Betfair).
* Selecciona únicamente aquellos partidos donde Winamax ofrezca una cuota superior a la de la casa Sharp (descontando el margen/vig). Esa discrepancia será nuestra base matemática para el EV+.

2. AUDITORÍA ESTADÍSTICA (Últimos 10 partidos en la superficie actual)
Para los partidos filtrados en el paso 1, analiza las siguientes métricas clave de ambos jugadores:
* Hold/Break Index: Suma del % de juegos de servicio ganados + % de juegos al resto ganados. (Destaca si algún jugador supera el 105%).
* Dominance Ratio (DR): Puntos de devolución ganados (%) / Puntos de servicio perdidos (%).
* Rendimiento bajo presión: % de Break Points salvados y convertidos.

3. CONTEXTO, MATCH-UP Y FATIGA
* Condiciones y Superficie: Velocidad estimada de la pista (si aplica) y a qué estilo de juego beneficia (ej. sacadores vs terrícolas puros).
* H2H Táctico: Patrones de juego recurrentes (ej. zurdo cruzando al revés a una mano).
* Fatiga Acumulada: Minutos en pista en los últimos 3 días, partidos a 3 sets recientes o historial de molestias físicas en el torneo.

4. RESTRICCIONES DE ENTREGA
* NINGUNA apuesta combinada. Solo selecciones simples (Ganador, Hándicap, Total de Juegos).
* Volumen de salida: Devuelve exactamente 8 recomendaciones, de 8 partidos distintos (nunca repitas un partido), enfocadas 100% en el mayor EV+ matemático (no busques la "apuesta segura", busca el error de la casa de apuestas).

${TENNIS_RETIREMENT_LUCKY_LOSER_CHECK}

${TENNIS_INJURY_COMEBACK_CHECK}

FORMATO DE SALIDA (Genera la respuesta con esta estructura exacta para cada pick):

🎾 [Torneo] | [Jugador A vs Jugador B]
* 🎯 Mercado: [Ej: Gana Jugador A / Hándicap +3.5 Juegos]
* 📈 Cuota Winamax: [X.XX] | ⚖️ Cuota Sharp (Pinnacle/Betfair): [Y.YY]
* 💎 EV Estimado: [+X.X%]

📊 Justificación Cuantitativa:
* Hold/Break Index y DR: [Breve comparativa de los datos de los últimos 10 partidos].
* Contexto y Fatiga: [Datos relevantes de tiempo en pista o match-up táctico].
* Motivo del Valor: [Por qué el mercado de Winamax está desajustado respecto a la línea real].`,
  },
];

const PROMPT_DEFS_BY_SPORT: Record<Sport, PromptDefinition[]> = {
  futbol: FOOTBALL_PROMPT_DEFS,
  tenis: TENNIS_PROMPT_DEFS,
};

const OUTPUT_FORMAT_INSTRUCTIONS = `

---
Instrucciones de formato obligatorias para tu respuesta final:
Al terminar tu informe, añade una última sección titulada exactamente
"SELECCIONES FINALES" (sin nada más en esa línea). Debajo, lista cada
selección como una línea numerada con este formato exacto, una selección
por línea:

N. Partido/Jugador vs Jugador | Torneo: <torneo o competición exacta, ej. "ATP Washington", "CH Bonn" o "Champions League" — nunca solo "ATP" o "Challenger" a secas> | Mercado: <mercado> | Cuota: <cuota> | EV: <valor EV+ estimado, ej. +8% o el indicador que uses> | % Éxito: <probabilidad de acierto estimada, ej. 65%> | Explicación: <explicación breve en 1-2 frases>

El campo Torneo es OBLIGATORIO en las 8 líneas y debe ser el nombre
concreto del torneo/competición de ese partido (el que hayas identificado
en tu propia investigación), nunca solo la categoría genérica.

El campo Explicación es OBLIGATORIO en las 8 líneas: nunca lo dejes vacío,
ni pongas un guion o "ver análisis arriba". Resume ahí, en 1-2 frases
concretas, el motivo real de ese pick (el mismo motivo que ya hayas
argumentado antes en el informe para ese partido/jugador: estadística
clave, contexto, lesión, motivación, etc.) — no lo dejes solo en la parte
narrativa del informe, tiene que estar repetido/resumido en esta línea
porque es la única parte que se le reenvía al usuario final.

No uses negritas, encabezados adicionales ni texto extra dentro de esa
sección: solo la lista numerada en ese formato exacto.

Debes devolver EXACTAMENTE 8 selecciones, de 8 partidos/jugadores
distintos — nunca repitas el mismo partido dos veces en la lista. Esto es
obligatorio salvo que alguna restricción de competición, categoría o
fecha de este mismo mensaje te autorice explícitamente a devolver menos
por no haber suficientes partidos EV+ dentro de esa restricción.

Justo debajo de las 8 selecciones, añade otra sección aparte titulada
exactamente "COMBINADA SUGERIDA" (sin nada más en esa línea). Busca 2
"bankers" — mercados de máxima seguridad posible (victoria clara o "gana
al menos un set"/hándicap muy cómodo, nunca algo dudoso), de 2 partidos
DISTINTOS entre sí. No tienen que ser parte de las 8 selecciones
anteriores: búscalos específicamente por ser los más seguros del día,
aunque su EV individual sea bajo — el objetivo aquí es seguridad, no
valor. Su cuota combinada (cuota A × cuota B) debe caer, a ser posible,
entre 1.70 y 2.20. Escribe esas 2 selecciones con el mismo formato de
línea numerada que arriba pero solo estos 4 campos (sin EV, % Éxito ni
Explicación):

1. Partido/Jugador vs Jugador | Torneo: <torneo> | Mercado: <mercado> | Cuota: <cuota>
2. Partido/Jugador vs Jugador | Torneo: <torneo> | Mercado: <mercado> | Cuota: <cuota>

Si no encuentras ninguna pareja de bankers cuya cuota combinada caiga en
ese rango, no escribas las 2 líneas: escribe únicamente esta línea en su
lugar: "COMBINADA SUGERIDA: Ninguna disponible hoy."`;

/** "martes, 28 de julio de 2026, 11:32" en hora de España, sin depender de ninguna librería externa. */
function formatMadridNow(now: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(now);
}

function buildCompetitionRestriction(competitions?: string[]): string {
  if (!competitions || competitions.length === 0) return "";
  return `\n\nRESTRICCIÓN OBLIGATORIA DE COMPETICIONES: para este análisis en concreto, analiza ÚNICAMENTE estas competiciones: ${competitions.join(", ")}. Ignora cualquier otra liga o torneo mencionado en las instrucciones generales de arriba aunque tenga partidos en las próximas 24h — si no hay suficientes partidos EV+ en las competiciones indicadas, devuelve menos de 8 picks en vez de rellenar con otras competiciones.`;
}

export type DateFilter = "hoy" | "manana" | "24h";

/** "27 de julio" en hora de España, para las etiquetas de los botones Hoy/Mañana. */
export function formatMadridShortDate(date: Date): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    day: "numeric",
    month: "long",
  }).format(date);
}

/**
 * Bloque temporal único (fecha actual + ventana + verificación), en vez de
 * dos párrafos separados: antes el contexto temporal genérico ("usa esto
 * para calcular las próximas 24h") se colaba DESPUÉS del override de fecha
 * fija, re-reforzando la interpretación de ventana móvil justo después de
 * habérsela prohibido — resultado real observado: con "Mañana" elegido,
 * devolvía partidos de HOY ya jugados. Ahora es un solo bloque coherente,
 * siempre termina en la instrucción de verificar que el partido no haya
 * empezado ni terminado ya.
 */
function buildTemporalInstructions(dateFilter: DateFilter | undefined, now: Date): string {
  const header = `CONTEXTO TEMPORAL OBLIGATORIO: ahora mismo es ${formatMadridNow(now)} (hora de España, Europe/Madrid). No calcules ni busques la hora actual por tu cuenta, usa este dato tal cual.`;

  let window: string;
  if (dateFilter === "hoy" || dateFilter === "manana") {
    const targetDate = new Date(now);
    if (dateFilter === "manana") targetDate.setDate(targetDate.getDate() + 1);
    const fechaLabel = formatMadridShortDate(targetDate);
    const momento = dateFilter === "hoy" ? "HOY" : "MAÑANA";
    const rango =
      dateFilter === "hoy"
        ? "desde ahora mismo hasta las 23:59 (hora de España) de hoy"
        : "durante todo el día, de 00:00 a 23:59 (hora de España)";
    window = `VENTANA DE PARTIDOS PARA ESTE ANÁLISIS EN CONCRETO: analiza ÚNICAMENTE partidos que se juegan ${momento}, ${fechaLabel}, ${rango}. Ignora partidos de cualquier otro día, aunque el resto de instrucciones mencionen genéricamente "las próximas 24 horas" — para este análisis en concreto, esa expresión debe entenderse como esta ventana, no como un plazo literal de 24h desde ahora.`;
  } else {
    window = `VENTANA DE PARTIDOS: calcula "las próximas 24 horas" tomando como punto de partida exacto el momento indicado arriba, no ninguna otra hora.`;
  }

  const verification = `VERIFICACIÓN OBLIGATORIA ANTES DE ENTREGAR CADA PICK: comprueba la hora de inicio real de cada partido contra el momento indicado arriba. Si el partido ya ha empezado o ya ha terminado a esa hora, DESCÁRTALO por completo y busca otro dentro de la ventana — nunca incluyas en las 8 selecciones un partido que ya se esté jugando o que ya se haya jugado.`;

  return `\n\n${header}\n\n${window}\n\n${verification}`;
}

export type TennisCategory = "atp" | "challenger" | "ambos";

function buildTennisCategoryRestriction(category?: TennisCategory): string {
  if (!category || category === "ambos") return "";
  const label = category === "atp" ? "ATP (excluye Challenger)" : "Challenger (excluye ATP)";
  return `\n\nRESTRICCIÓN OBLIGATORIA DE CATEGORÍA: para este análisis en concreto, analiza ÚNICAMENTE partidos de categoría ${label}, siempre cuadro individual (singles) masculino. Ignora la otra categoría aunque el resto de instrucciones la mencione — si no hay suficientes partidos EV+ en la categoría indicada, devuelve menos de 8 picks en vez de rellenar con la otra categoría.`;
}

export interface BuildPromptOptions {
  /** Solo para fútbol: si se indica, restringe el análisis a estas competiciones (ver FOOTBALL_COMPETITIONS). */
  competitions?: string[];
  /** Solo para tenis: restringe a ATP, Challenger, o ambos (por defecto). */
  tennisCategory?: TennisCategory;
  /** Ventana de partidos a analizar: hoy, mañana, o el comportamiento por defecto de "próximas 24h desde ahora". */
  dateFilter?: DateFilter;
  now?: Date;
}

export function buildPrompt(basePrompt: string, options: BuildPromptOptions = {}): string {
  const now = options.now ?? new Date();
  const restriction = buildCompetitionRestriction(options.competitions);
  const categoryRestriction = buildTennisCategoryRestriction(options.tennisCategory);
  const temporal = buildTemporalInstructions(options.dateFilter, now);
  return `${basePrompt.trim()}${restriction}${categoryRestriction}${temporal}${OUTPUT_FORMAT_INSTRUCTIONS}`;
}

/** Devuelve los 3 prompts del deporte, en orden Tipster → Machine Learning → Analista cuantitativo. */
export function buildAllPrompts(sport: Sport, options: BuildPromptOptions = {}): PromptDefinition[] {
  return PROMPT_DEFS_BY_SPORT[sport].map((def) => ({
    label: def.label,
    prompt: buildPrompt(def.prompt, options),
  }));
}
