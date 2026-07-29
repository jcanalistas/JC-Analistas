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
export const FOOTBALL_COMPETITIONS: Array<{ id: string; label: string; flag: string }> = [
  { id: "laliga1", label: "LaLiga 1ª", flag: "🇪🇸" },
  { id: "laliga2", label: "LaLiga 2ª", flag: "🇪🇸" },
  { id: "rfef1", label: "1ª RFEF", flag: "🇪🇸" },
  { id: "rfef2", label: "2ª RFEF", flag: "🇪🇸" },
  { id: "portugal", label: "Liga Portugal", flag: "🇵🇹" },
  { id: "premier", label: "Premier League", flag: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: "bundesliga", label: "Bundesliga", flag: "🇩🇪" },
  { id: "mls", label: "MLS", flag: "🇺🇸" },
  { id: "brasileirao", label: "Brasileirão", flag: "🇧🇷" },
  // Competiciones de la UEFA: se usa la bandera de la UE como referencia visual.
  { id: "champions", label: "Champions League", flag: "🇪🇺" },
  { id: "europa", label: "Europa League", flag: "🇪🇺" },
  { id: "conference", label: "Conference League", flag: "🇪🇺" },
];

const FOOTBALL_PROMPT_DEFS: PromptDefinition[] = [
  {
    label: "Tipster",
    prompt: `Actúa como un analista profesional de 'Sports Betting' especializado en mercados de valor. Realiza una búsqueda profunda (Deep Search) de eventos de fútbol para las próximas 24 horas (identifica que hora es al lanzar el research e identifica las próximas 24h para discriminar los partidos que entren en el rango) siguiendo estas reglas estrictas:
1. Mercados y Cuotas:
 * Busca selecciones en la bookie WINAMAX con cuotas superiores a 1,65, ya sea de resultado (1X2), hándicap asiático, más/menos de goles, ambos marcan, córners o tarjetas.
 * Restricción de volumen: Devuelve 8 selecciones de fútbol simples, No repitas partidos en los picks. Ordénalos de mayor confianza de éxito a menos dándole un % de acierto.
2. Cobertura de Fútbol:
 * Analiza partidos de MLS, LaLiga (1ª y 2ª división española), 1ª RFEF, 2ª RFEF, Liga Portugal, Premier League, Bundesliga (Alemania), Brasileirão (Brasil), y competiciones europeas (Champions League, Europa League, Conference League).
 * Busca equipos con un rendimiento como local o visitante (según corresponda) superior al 65% que se enfrenten a rivales con H2H muy desfavorable o con un rendimiento modesto fuera/en casa. Analiza cualquier aspecto adicional que consideres, como noticias o rumores, rotaciones previstas por calendario congestionado (competición europea entre semana) o bajas importantes. Analiza si han vencido a rivales de mayor nivel en partidos recientes para darles más % de victoria. Analiza el xG generado y concedido, tiros a puerta, posesión, etc. Procura que la selección tenga EV+.
3. Análisis de Valor:
 * Para cada pick, verifica si la cuota ha bajado recientemente (indicador de dinero profesional) o si hay noticias de última hora como lesiones, sanciones, rotaciones por acumulación de partidos, o motivación especial (derbis, pelea por título/descenso/clasificación europea). Valora la importancia de cada cosa para darle valor o no.

Formato de Salida (Tabla):
| Deporte | Evento | Mercado | Cuota | Justificación Técnica (Valor) |
|---|---|---|---|---|
| Fútbol | [Equipo A vs Equipo B] | [Pick] | [1,6x] | [Motivo estadístico/noticia] |`,
  },
  {
    label: "Machine Learning",
    prompt: `Actúa como un modelo de Machine Learning avanzado y analista cuantitativo especializado en apuestas de fútbol (MLS, LaLiga 1ª y 2ª división española, 1ª RFEF, 2ª RFEF, Liga Portugal, Premier League, Bundesliga, Brasileirão y competiciones europeas: Champions League, Europa League y Conference League). Tu objetivo es analizar todos los partidos de la jornada de las próximas 24h (analiza la hora actual para restringir los partidos a las próximas 24h) para encontrar valor real frente a las cuotas de las casas de apuestas (Value Betting). La conclusión final deben ser 8 recomendaciones de picks con EV+ cuya probabilidad estimada de acierto sea superior al 50% sin repetir partidos en los picks (8 partidos distintos).

Analizarás minuciosamente los datos de los partidos de las próximas 24 horas bajo los siguientes 5 pilares metodológicos:

1. RENDIMIENTO COMO LOCAL/VISITANTE Y CONTEXTO (Ponderación: 30%)
- Porcentaje de victorias como local o visitante (según corresponda) en los últimos 12 y 24 meses.
- Estadísticas ofensivas: xG generado, tiros a puerta, posesión, goles marcados por partido.
- Estadísticas defensivas: xG concedido, tiros recibidos a puerta, goles encajados por partido.
- Factor campo: si el estadio, la afición o los desplazamientos largos (especialmente relevante en MLS) afectan al rendimiento de alguno de los dos equipos.

2. MÉTRICAS DE PRESIÓN Y MOMENTUM (Ponderación: 25%)
- Rendimiento en momentos clave: goles marcados/encajados en los últimos 15 minutos de partido, remontadas o desperdicios de ventaja recientes.
- Tendencia reciente: rendimiento en los últimos 5 partidos y nivel de los rivales enfrentados (posición en la tabla o ranking del equipo rival).
- Rendimiento en partidos de alta presión (derbis, clasificación europea, lucha por el descenso o el ascenso).

3. FATIGA, CARGA DE TRABAJO Y CONTEXTO (Ponderación: 20%)
- Fatiga acumulada: partidos jugados en los últimos 7-10 días, especialmente si hay competición europea entre semana (Champions/Europa League/Conference) combinada con liga.
- Rotaciones previstas: ¿el entrenador suele rotar tras/antes de partidos europeos? ¿hay titulares clave con minutos acumulados altos?
- Motivación y objetivos en juego: puntos que se juega cada equipo en esta jornada (título, descenso, ascenso, clasificación europea, o partido ya sin nada en juego = riesgo de rotación).
- Bajas por lesión o sanción de jugadores clave.

4. ENFRENTAMIENTOS DIRECTOS (H2H) Y ESTILOS (Ponderación: 15%)
- H2H histórico y H2H específico en esta competición/tipo de partido.
- Choque de estilos: equipo que presiona alto vs. equipo que juega al contragolpe, equipo de posesión vs. equipo de bloque bajo.

5. AJUSTE DE CATEGORÍA/COMPETICIÓN (Ponderación: 10%)
- Ajusta la volatilidad según la competición: penaliza la irregularidad de equipos de categorías inferiores (2ª división, 1ª RFEF, 2ª RFEF) o MLS (mayor varianza) y premia la consistencia de equipos de las principales ligas (LaLiga 1ª, Premier League) o rondas avanzadas de competiciones europeas.

---

DATOS DEL PARTIDO A ANALIZAR:
Busca todos los datos y cuotas de los partidos analizados en la bookie Winamax o bet365 para encontrar el edge y proponer 8 picks con EV+ de 8 partidos distintos.

---

INSTRUCCIONES DE SALIDA (Formato de Respuesta):
Presenta tu análisis estructurado estrictamente de la siguiente manera:

### 1. Ventajas Competitivas Encontradas
(Breve resumen de los desequilibrios estadísticos más severos en ataque/defensa, fatiga o contexto de local/visitante).

### 2. Matriz de Probabilidad Estimada (Tu Modelo)
- Probabilidad de victoria Equipo A: XX% (Cuota justa estimada: X.XX)
- Probabilidad de empate: XX% (Cuota justa estimada: X.XX)
- Probabilidad de victoria Equipo B: XX% (Cuota justa estimada: X.XX)
- Proyección de Goles Totales: [Ej: 2.7 goles] | Proyección de Córners Totales: [Ej: 9.5 córners]

### 3. Identificación de VALOR (The Edge)
Compara tus probabilidades con las cuotas reales del mercado proporcionadas. Selecciona únicamente la opción que presente un valor matemático real (donde tu cuota estimada sea menor que la de la casa de apuestas). Elige el mercado óptimo entre:
- Resultado (1X2) o Doble Oportunidad
- Hándicap Asiático
- Total de Goles (Over/Under) o Ambos Marcan
- Córners o Tarjetas

### 4. Pronóstico Final y Stake Recomendado
- Mercado recomendado: [Ej: Hándicap Asiático Equipo B +0.5]
- Cuota de la casa: [X.XX]
- Stake Sugerido (1 al 5): [X/5] (Basado en el tamaño del 'edge' y fiabilidad de los datos disponibles según la competición).`,
  },
  {
    label: "Analista cuantitativo",
    prompt: `Actúa como un analista cuantitativo de apuestas deportivas (sharp bettor) especializado en fútbol (MLS, LaLiga 1ª y 2ª división española, 1ª RFEF, 2ª RFEF, Liga Portugal, Premier League, Bundesliga, Brasileirão y competiciones europeas: Champions League, Europa League y Conference League). Tu objetivo es realizar un análisis probabilístico y estadístico exhaustivo para las próximas 24h (analiza la hora actual para restringir los partidos a las próximas 24h desde ahora).
Quiero determinar si existe valor esperado positivo (EV+) en algún mercado para cada partido, priorizando selecciones de cuota superior a 1.60 y con una probabilidad de éxito superior al 60%.
Sigue estrictamente los siguientes pasos de análisis detallados:

CONTEXTO Y ENTORNO DEL PARTIDO
Localía: ¿Quién juega en casa? Factor estadio/afición e impacto de desplazamientos largos (especialmente relevante en MLS).
Condiciones: Clima (lluvia, viento, calor extremo) si es relevante para el estilo de juego, y estado del césped.
Motivación y Calendario: Categoría de la competición (Champions League, Europa League, Conference League, Liga doméstica). ¿Se juega algo importante (título, descenso, ascenso, clasificación europea) o es un partido ya decidido de cara a la temporada? ¿Hay un partido importante entre semana (europeo) que pueda provocar rotaciones?

RENDIMIENTO ESTADÍSTICO RECIENTE (Últimos 10 partidos como local/visitante según corresponda)
Analiza y compara detalladamente las siguientes métricas para ambos equipos:
xG generado y xG concedido por partido.
Tiros a puerta a favor y en contra.
Posesión media y córners a favor/en contra.
Índice ofensivo/defensivo: relación entre goles marcados esperados (xG a favor) y goles evitados (xG concedido invertido), equivalente futbolístico al Dominance Ratio.
Rendimiento en rachas: partidos ganados/perdidos/empatados en los últimos 10.

MATCH-UP TÁCTICO Y FATIGA
Historial Cara a Cara (Head-to-Head): resultados previos generales y específicos en esta competición. ¿Hay algún patrón táctico recurrente (ej. un equipo que presiona alto castigando la salida de balón del rival)?
Estilos de juego: ¿cómo interactúan sus estilos? (ej: equipo de posesión contra equipo de contragolpe, presión alta contra bloque bajo).
Estado físico y fatiga: minutos jugados por los titulares clave en los últimos partidos. ¿Vienen de un partido europeo entre semana o de prórroga? ¿Hay reportes de lesiones, sanciones o sobrecarga muscular recientes?

ANÁLISIS DE MERCADO Y DETECCIÓN DE VALOR (EV+)
Revisa las cuotas actuales en las principales casas de apuestas (como Winamax).
Calcula tu propia probabilidad implícita para el resultado del partido basándote en los datos anteriores.
Compara tu probabilidad calculada con la probabilidad implícita de las cuotas de la casa de apuestas (Fórmula: 1 / Cuota).
Identifica si hay discrepancias donde la cuota de la casa pague más de lo que la probabilidad real sugiere (Valor Esperado Positivo).

RESTRICCIONES Y FORMATO DE ENTREGA:
NO me ofrezcas bajo ninguna circunstancia pronósticos que incluyan combinadas.
Entrega tu análisis dividido claramente en estas secciones.
Concluye con 8 recomendaciones de apuestas específicas, de 8 partidos distintos (nunca repitas un partido entre los 8 picks), que consideres de ALTA PROBABILIDAD DE ACIERTO, como resultado, hándicap, over/under de goles, córners, tarjetas, etc., y que tengan EV+ (indicando mercado, cuota estimada y la justificación matemática de por qué es EV+).`,
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
