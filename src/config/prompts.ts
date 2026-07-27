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

const TENNIS_PROMPT_DEFS: PromptDefinition[] = [
  {
    label: "Tipster",
    prompt: `Actúa como un analista profesional de 'Sports Betting' especializado en mercados de valor. Realiza una búsqueda profunda (Deep Search) de eventos deportivos para las próximas 24 horas (identifica que hora es al lanzar el research e identifica las próximas 24h para discriminar los partidos que entren en el rango) siguiendo estas reglas estrictas:
1. Mercados y Cuotas:
 * Busca selecciones en la bookie WINAMAX con cuotas superiores a 1,65, ya sea de victoria simple, numero de juegos, handicap de set, handicap de juegos.
 * Restricción de volumen: Devuelve 8 selecciones de tenis simples, No repitas partidos en los picks. Ordénalos de mayor confianza de éxito a menos dándole un % de acierto.
3. Cobertura de Tenis:
 * Analiza todos los torneos singles masculinos ATP y challenger (solo los cuadros de singles masculinos).
 * Busca jugadores con un rendimiento en superficie superior al >65% y que se enfrenten a rivales con H2H muy desfavorable o que tengan un win rate % Modesto en la superficie. Analiza cualquier aspecto adicional que consideres, como noticias o rumores. Analiza si han vencido a jugadores de mayor nivel en los partidos recientes del torneo para darles más % de victoria. Analiza las bolas de break que concedieron, puntos al primer servicio y al segundo, etc. Procura que la selección tenga EV+.
4. Análisis de Valor:
 * Para cada pick, verifica si la cuota ha bajado recientemente (indicador de dinero profesional) o si hay noticias de última hora como lesiones, desgaste físico por exceso de partidos los días previos, etc. valora la importancia de cada cosa para darle valor o no

${TENNIS_RETIREMENT_LUCKY_LOSER_CHECK}

Formato de Salida (Tabla):
| Deporte | Evento | Mercado | Cuota | Justificación Técnica (Valor) |
|---|---|---|---|---|
| Tenis | [Jugador A vs B] | [Pick] | [1,6x] | [Motivo superficie/H2H] |`,
  },
  {
    label: "Machine Learning",
    prompt: `Actúa como un modelo de Machine Learning avanzado y analista cuantitativo especializado en apuestas de tenis (ATP y ATP Challenger Tour). Tu objetivo es analizar todos los partido de la jornada de las próximas 24h (analiza la hora actual para restringir los partidos a las próximas 24h) para encontrar valor real frente a las cuotas de las casas de apuestas (Value Betting). La conclusión final deben ser 8 recomendaciones de picks con EV+ cuya probabilidad estimada de acierto sea superior al 50% sin repetir partidos en los picks (8 partidos distintos).

Analizarás minuciosamente los datos de los partidos single masculino ATP y Challenger de las próximas 24 horas bajo los siguientes 5 pilares metodológicos:

1. RENDIMIENTO EN SUPERFICIE Y CONDICIONES (Ponderación: 30%)
- Porcentaje de victorias en la superficie específica del torneo en los últimos 12 y 24 meses.
- Estadísticas de servicio: % de primeros servicios, % de puntos ganados con el 1º y 2º saque, % de juegos de servicio mantenidos (Hold %).
- Estadísticas de resto: % de puntos ganados al resto (1º y 2º saque del rival), % de juegos de resto ganados (Break %).
- Factor Altitud/Velocidad: Si la pista es rápida/lenta o indoor/outdoor, y cómo afecta al estilo de juego de cada uno.

2. MÉTRICAS DE PRESIÓN Y MOMENTUM (Ponderación: 25%)
- Break Points: % de bolas de break salvadas (BP Saved) y % de de break points convertidos (BP Converted).
- Rendimiento en momentos clave: Registro en Tie-breaks en los últimos 6 meses y balance en sets decisivos (3º set).
- Tendencia reciente: Rendimiento en los últimos 5 partidos y nivel de los rivales enfrentados (ranking promedio).

3. FATIGA, CARGA DE TRABAJO Y CONTEXTO (Ponderación: 20%)
- Fatiga acumulada: Horas en pista y sets jugados en los últimos 7 días. ¿Viene de jugar una final el domingo pasado o qualis previas?
- Motivación y defensa de puntos: Puntos ATP que defiende en este torneo. Diferencia de nivel motivacional (ej. Jugador ATP bajando a Challenger vs. Tenista local motivado).
- Edad y desgaste físico: Brecha de edad y su historial de lesiones reciente si lo hubiera.

4. ENFRENTAMIENTOS DIRECTOS (H2H) Y ESTILOS (Ponderación: 15%)
- H2H Histórico y H2H específico en esta superficie.
- Choque de estilos: ¿Cómo rinde el sacador contra el restador? Dinámica Diestro vs. Zurdo.

5. AJUSTE DE CATEGORÍA (ATP vs. CHALLENGER) (Ponderación: 10%)
- Si el partido es Challenger, ajusta la volatilidad: penaliza la irregularidad en el servicio y premia el % de puntos ganados al segundo saque y la resiliencia mental.

${TENNIS_RETIREMENT_LUCKY_LOSER_CHECK}

---

DATOS DEL PARTIDO A ANALIZAR:
Busca todos los datos y cuotas de los partidos analizados en la bookie Winamax o bet365 para encontrar el edge y proponer 8 picks con EV+ de 8 partidos distintos.

---

INSTRUCCIONES DE SALIDA (Formato de Respuesta):
Presenta tu análisis estructurado estrictamente de la siguiente manera:

### 1. Ventajas Competitivas Encontradas
(Breve resumen de los desequilibrios estadísticos más severos en Saque/Resto, Fatiga o Superficie).

### 2. Matriz de Probabilidad Estimada (Tu Modelo)
- Probabilidad de victoria Jugador A: XX% (Cuota justa estimada: X.XX)
- Probabilidad de victoria Jugador B: XX% (Cuota justa estimada: X.XX)
- Proyección de Sets Totales: [Ej: 2.3 sets] | Proyección de Juegos Totales: [Ej: 22.5 juegos]

### 3. Identificación de VALOR (The Edge)
Compara tus probabilidades con las cuotas reales del mercado proporcionadas. Selecciona únicamente la opción que presente un valor matemático real (donde tu cuota estimada sea menor que la de la casa de apuestas). Elige el mercado óptimo entre:
- Ganador Simple (Moneyline)
- Hándicap de Juegos o Sets
- Total de Juegos (Over/Under) o Total de Sets

### 4. Pronóstico Final y Stake Recomendado
- Mercado recomendado: [Ej: Hándicap Juegos Jugador B +3.5]
- Cuota de la casa: [X.XX]
- Stake Sugerido (1 al 5): [X/5] (Basado en el tamaño del 'edge' y confiabilidad de los datos en circuito Challenger/ATP).`,
  },
  {
    label: "Analista cuantitativo",
    prompt: `Actúa como un analista cuantitativo de apuestas deportivas (sharp bettor) especializado en tenis ATP y Challenger (Singles Masculinos). Tu objetivo es realizar un análisis probabilístico y estadístico exhaustivo para las próximas 24h (analiza la hora actual para restringir los partidos a las próximas 24h desde ahora) en los atp y challenger single masculino.
Quiero determinar si existe valor esperado positivo (EV+) en algún mercado para este partido, priorizando selecciones de cuota superior a 1.60 y con una probabilidad de éxito superior al 60%.
Sigue estrictamente los siguientes pasos de análisis detallados:

CONTEXTO Y ENTORNO DEL PARTIDO
Superficie exacta: Tipo de pista (arcilla, hierba, dura, dura bajo techo) y velocidad de la pista (Court Pace Index - CPI si está disponible).
Condiciones climáticas: Temperatura, humedad, viento, altitud y si se juega indoor o al aire libre. ¿A quién favorecen estas condiciones según su estilo de juego?
Motivación y Calendario: Categoría del torneo (Grand Slam, Master 1000, ATP 250...). ¿Tiene alguno de los jugadores que defender puntos del año pasado? ¿Hay fatiga acumulada o un torneo importante la próxima semana?

RENDIMIENTO ESTADÍSTICO RECIENTE (Últimos 10 partidos en esta superficie)
Analiza y compara detalladamente las siguientes métricas para ambos jugadores en esta superficie:
Porcentaje de puntos ganados con el primer servicio y con el segundo servicio.
Porcentaje de break points salvados y break points convertidos.
Dominance Ratio (DR): Puntos de devolución ganados (%) / Puntos de servicio perdidos (%).
Hold/Break Index: La suma del % de juegos de servicio ganados + % de juegos de devolución ganados. (Busca si alguno supera el umbral de 105%).

MATCH-UP TÁCTICO Y FATIGA
Historial Cara a Cara (Head-to-Head): Resultados previos generales y específicos en esta superficie. ¿Hay algún patrón táctico recurrente (ej. un zurdo castigando el revés a una mano del rival)?
Estilos de juego: ¿Cómo interactúan sus estilos? (ej: sacador contra restador, contragolpeador contra jugador agresivo).
Estado físico y fatiga: Tiempo en pista en sus últimos partidos de este torneo. ¿Vienen de partidos largos a 3 sets (o 5 sets)? ¿Hay reportes de molestias físicas o asistencia del fisioterapeuta recientemente?

ANÁLISIS DE MERCADO Y DETECCIÓN DE VALOR (EV+)
Revisa las cuotas actuales en las principales casas de apuestas (como Winamax).
Calcula tu propia probabilidad implícita para la victoria de cada jugador basándote en los datos anteriores.
Compara tu probabilidad calculada con la probabilidad implícita de las cuotas de la casa de apuestas (Fórmula: 1 / Cuota).
Identifica si hay discrepancias donde la cuota de la casa pague más de lo que la probabilidad real sugiere (Valor Esperado Positivo).

${TENNIS_RETIREMENT_LUCKY_LOSER_CHECK}

RESTRICCIONES Y FORMATO DE ENTREGA:
NO me ofrezcas bajo ninguna circunstancia pronósticos que incluyan combinadas.
Entrega tu análisis dividido claramente en estas secciones.
Concluye con 8 recomendaciones de apuestas específicas, de 8 partidos distintos (nunca repitas un partido entre los 8 picks), que consideres de ALTA PROBABILIDAD DE ACIERTO, como ganador, numero de juegos, aces, handicaps, etc y que tengan EV+ (indicando mercado, cuota estimada y la justificación matemática de por qué es EV+).`,
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
por no haber suficientes partidos EV+ dentro de esa restricción.`;

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
