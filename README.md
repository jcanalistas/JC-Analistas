# JC Analistas — Bot de Telegram

Bot de Telegram para el canal tipster **JC Analistas**. Primera función
implementada:

1. Lanza **3 Deep Research distintos en Gemini** (Tipster, Machine
   Learning y Analista cuantitativo), para el deporte que elijas con
   botones (⚽ Fútbol / 🎾 Tenis).
2. Devuelve las **selecciones finales** de cada uno (partido, torneo,
   mercado, cuota, EV, % de éxito y explicación).
3. Resalta qué selecciones **se repiten en 2 o 3** informes, con la
   explicación combinada de cada perfil que coincidió.

El resto de funciones del bot se añadirán más adelante.

## Cómo funciona por dentro

Usa la **API oficial de Gemini Deep Research** (Interactions API,
`@google/genai`) — nada de automatizar un navegador ni depender de tu
sesión personal de Google. Solo hace falta una API key de Google AI
Studio. Cada Deep Research corre en segundo plano en los servidores de
Google.

Los 3 se lanzan **en paralelo** (cada uno es una llamada de API
independiente) y cada uno puede tardar varios minutos. Al lanzar
`/analizar`, el bot solo crea las 3 tareas en Gemini (tarda segundos) y
guarda su progreso en Firestore — **no se queda esperando** a que
terminen dentro de la misma petición. Un job de Cloud Scheduler aparte
(ver 7.7) sondea cada 1-2 minutos si hay tareas pendientes y, en cuanto
alguna termina, manda el aviso por Telegram. Esto es deliberado: Cloud
Run puede reciclar el contenedor por su cuenta en cualquier momento
(inactividad, mantenimiento, redeploys), y una tarea que dependiera de un
único proceso vivo durante 20-30 minutos seguidos se perdía sin avisar
cuando eso pasaba — con el progreso guardado en Firestore, el siguiente
sondeo simplemente continúa donde se quedó.

## Requisitos

- Node.js 20+
- Una API key de Gemini (gratis, Google AI Studio)
- Un bot de Telegram

## 1. Crear el bot de Telegram

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram.
2. Envía `/newbot` y sigue las instrucciones (nombre y username del bot).
3. Guarda el **token** que te da — es tu `TELEGRAM_BOT_TOKEN`.
4. Habla con [@userinfobot](https://t.me/userinfobot) para obtener tu
   propio ID de usuario de Telegram — es tu `TELEGRAM_ALLOWED_USER_ID`
   (así solo tú puedes usar el bot).

## 2. Conseguir la API key de Gemini

1. Ve a [aistudio.google.com/apikey](https://aistudio.google.com/apikey).
2. Inicia sesión con tu Google y pulsa "Create API key".
3. Guarda esa key — es tu `GEMINI_API_KEY`.

## 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Rellena `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID`,
`TELEGRAM_CHANNEL_ID` y `GEMINI_API_KEY`. El resto (`PUBLIC_URL`,
`WEBHOOK_SECRET_PATH`) se completan al desplegar (paso 6).

`TELEGRAM_CHANNEL_ID` es el ID de tu canal (consíguelo reenviando un
mensaje del canal a [@userinfobot](https://t.me/userinfobot)); el bot
debe ser **administrador del canal con permiso de publicar mensajes**
para poder usar el botón "Publicar" de `/ticket`.

## 4. Instalar dependencias

```bash
npm install
```

## 5. Ajustar tus 6 prompts (3 de fútbol + 3 de tenis)

Al escribir `/analizar`, el bot pregunta primero qué deporte analizar
(⚽ Fútbol / 🎾 Tenis) con botones, y lanza los 3 prompts de ese deporte
en el orden Tipster → Machine Learning → Analista cuantitativo.

Edita `src/config/prompts.ts` y sustituye el contenido de
`FOOTBALL_PROMPT_DEFS` y `TENNIS_PROMPT_DEFS` por tus enfoques reales
(ligas, mercados, criterios). No toques `OUTPUT_FORMAT_INSTRUCTIONS`: es
lo que le exige a Gemini terminar con un bloque `SELECCIONES FINALES`
parseable por el bot.

## 6. Probar en local

```bash
npm run dev
```

En local no hay webhook público, así que para probar de verdad necesitas
exponer tu máquina (p. ej. con `ngrok http 8080`) y usar esa URL como
`PUBLIC_URL` temporalmente, o desplegar directo en Cloud Run (siguiente
paso).

## 7. Desplegar en Cloud Run

### 7.1 Subir los secretos (token del bot y API key de Gemini)

Se guardan en Secret Manager en vez de como variables de entorno planas,
para que no queden visibles en la consola de Cloud Run:

```bash
echo -n "TU_TOKEN_DE_TELEGRAM" | gcloud secrets create telegram-bot-token --data-file=-
echo -n "TU_API_KEY_DE_GEMINI" | gcloud secrets create gemini-api-key --data-file=-
```

Si alguna vez regeneras alguna de las dos, sube una nueva versión:

```bash
echo -n "NUEVO_VALOR" | gcloud secrets versions add telegram-bot-token --data-file=-
echo -n "NUEVO_VALOR" | gcloud secrets versions add gemini-api-key --data-file=-
```

### 7.2 Construir y desplegar (primera vez)

```bash
gcloud run deploy jc-analistas-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-env-vars TELEGRAM_ALLOWED_USER_ID=TU_ID_DE_TELEGRAM,TELEGRAM_CHANNEL_ID=TU_ID_DE_CANAL,WEBHOOK_SECRET_PATH=UNA_CADENA_ALEATORIA,DEEP_RESEARCH_TIMEOUT_MINUTES=20,AUTO_ANALIZAR_SECRET=OTRA_CADENA_ALEATORIA \
  --set-secrets TELEGRAM_BOT_TOKEN=telegram-bot-token:latest,GEMINI_API_KEY=gemini-api-key:latest \
  --timeout=3600
```

Al terminar, `gcloud` imprime la URL pública del servicio (algo como
`https://jc-analistas-bot-xxxxx.a.run.app`). Cópiala para el siguiente
paso.

### 7.3 Segundo despliegue: añadir PUBLIC_URL

El servicio necesita conocer su propia URL pública para registrar el
webhook de Telegram al arrancar:

```bash
gcloud run services update jc-analistas-bot \
  --region europe-southwest1 \
  --update-env-vars PUBLIC_URL=https://TU-URL-DE-CLOUD-RUN.a.run.app
```

Nota: `--timeout=3600` porque un `/analizar` con 3 Deep Research puede
tardar bastante más que el timeout HTTP por defecto de Cloud Run. Ya no
hace falta memoria/CPU extra (sin navegador, el contenedor es ligero).

### 7.4 Verificar el webhook

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Debe apuntar a `https://<tu-servicio>.a.run.app/telegram/<WEBHOOK_SECRET_PATH>`.

### 7.5 (Opcional) /analizar de tenis automático cada mañana a las 7:00

El propio bot no puede programarse solo a sí mismo (Cloud Run apaga el
contenedor cuando no hay tráfico), así que quien lo despierta a las 7:00
es Cloud Scheduler, llamando a un endpoint del propio servicio:

```bash
gcloud services enable cloudscheduler.googleapis.com

gcloud scheduler jobs create http auto-analizar-tenis \
  --location=europe-west1 \
  --schedule="0 7 * * *" \
  --time-zone="Europe/Madrid" \
  --uri="https://TU-URL-DE-CLOUD-RUN.a.run.app/internal/auto-analizar-tenis?secret=TU_AUTO_ANALIZAR_SECRET" \
  --http-method=POST
```

`--location` es la región de Cloud Scheduler (no tiene por qué coincidir
con la de Cloud Run); si `europe-west1` da error de región no soportada,
prueba con otra de la [lista de ubicaciones de Cloud
Scheduler](https://cloud.google.com/scheduler/docs/#locations). El
`secret` es el mismo valor que pusiste en `AUTO_ANALIZAR_SECRET` al
desplegar — evita que cualquiera que encuentre la URL pueda lanzar el
análisis.

Para desactivarlo sin borrar el job: `gcloud scheduler jobs pause
auto-analizar-tenis`. Para lanzarlo ya mismo y probarlo: `gcloud
scheduler jobs run auto-analizar-tenis`.

Este job solo lanza las 3 tareas en Gemini — igual que `/analizar`
manual, necesita el job de sondeo de 7.7 para que alguna vez lleguen los
resultados.

### 7.6 Activar Firestore (obligatorio: lo usan tanto Stats como /analizar)

Firestore es la base de datos persistente del proyecto — la usan tanto
"Registrar apuesta" / `/pendientes` / `/stats` como el propio `/analizar`
(para guardar el progreso de cada Deep Research mientras Gemini trabaja,
ver 7.7). Hace falta crearla una sola vez y darle permiso a la cuenta de
servicio del propio Cloud Run:

```bash
gcloud services enable firestore.googleapis.com

gcloud firestore databases create --location=eur3

PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

### 7.7 Cloud Scheduler para el sondeo de /analizar (obligatorio)

`/analizar` ya no espera dentro de la misma petición a que Gemini
termine (ver "Cómo funciona por dentro" al principio) — necesita que
algo externo le pregunte periódicamente "¿ha terminado ya?". Ese algo es
Cloud Scheduler, llamando cada 1-2 minutos a un endpoint interno del
propio servicio:

```bash
gcloud services enable cloudscheduler.googleapis.com

gcloud scheduler jobs create http poll-research \
  --location=europe-west1 \
  --schedule="*/2 * * * *" \
  --uri="https://TU-URL-DE-CLOUD-RUN.a.run.app/internal/poll-research?secret=TU_AUTO_ANALIZAR_SECRET" \
  --http-method=POST
```

Usa la misma `TU-URL-DE-CLOUD-RUN` y el mismo secreto que en 7.5 (el
valor de `AUTO_ANALIZAR_SECRET`). Sin este job, `/analizar` lanza las 3
tareas en Gemini y se queda ahí para siempre: nadie las vuelve a mirar,
así que nunca llegan los mensajes de "✅ completado" ni el resultado
final. Es imprescindible tenerlo activo — no es opcional como el 7.5.

`--location=eur3` es una región multi-región de Europa; si tu proyecto ya
tiene una base de datos Firestore creada en otra región para otra cosa, no
hace falta repetir el `create`. No hace falta ninguna variable de entorno
nueva: la autenticación es automática vía la cuenta de servicio del propio
servicio (Application Default Credentials).

## Uso

En Telegram, háblale al bot:

El bot deja fijos, siempre debajo del cuadro de texto, los botones
"🏠 Empezar", "🔍 Analizar", "📸 Ticket", "📝 Pendientes" y "📊 Stats" (en ese
orden, en dos filas). Cada uno hace lo mismo que su comando equivalente:

- `/start` (o "🏠 Empezar") — mensaje de bienvenida.
- `/analizar` (o "🔍 Analizar") — pregunta el deporte y, después, qué
  partidos analizar: **Hoy** (con la fecha), **Mañana** (con la fecha) o
  **Próximas 24h** (el comportamiento por defecto, ventana móvil desde
  ahora). Si eliges Fútbol ⚽, además pregunta si quieres analizar todas
  las competiciones o restringir a una selección concreta (p. ej. solo
  Champions League) marcando con botones de la lista (con la bandera del
  país de cada una, o de la UEFA en las 4 europeas): LaLiga 1ª/2ª, 1ª/2ª
  RFEF, Liga Portugal, Premier League, Bundesliga, MLS, Brasileirão,
  Champions/Europa/Conference League, Ligas Europeas (otras) — esta
  última agrupa primeras divisiones europeas no cubiertas en el resto
  (Dinamarca, Noruega, Suecia, Bélgica, Países Bajos, Escocia, Austria,
  Suiza). Si eliges Tenis 🎾, pregunta si
  quieres **ATP**, **Challenger**, o **Todo**
  (siempre individuales masculinos). Cada paso tiene un botón "⬅️ Atrás"
  para volver al anterior (p. ej. desde la lista de competiciones puedes
  volver a elegir Tenis en vez de Fútbol). El tenis además se lanza solo,
  sin tocar nada (fecha "Hoy" fija, ambas categorías), todas las mañanas
  a las 7:00 (hora de España) si configuraste el paso 7.5 — los resultados te
  llegan igual que si lo hubieras pulsado tú. Al terminar, envía:
  1. Las selecciones finales de cada perfil (Tipster, Machine Learning,
     Analista cuantitativo): partido, torneo/competición exacta (ej. "ATP
     Washington", "CH Bonn"), mercado, cuota, EV, % de éxito y
     explicación. Si algún perfil falla (p. ej. cuota agotada), se avisa
     de ese perfil en concreto y se muestran igualmente los que sí
     terminaron, en vez de perderlo todo.
  2. Las "Recomendaciones": selecciones que coincidieron en 2 o 3
     informes en el mismo partido Y el mismo mercado, combinadas en una
     sola entrada con la explicación de cada perfil que coincidió.
  3. "Mismo partido, distinto mercado" (si aplica): partidos que
     analizaron 2 o 3 perfiles pero recomendando mercados distintos (p.
     ej. un perfil pide "Tiafoe 2-0" y otro "Tiafoe -2.5 juegos") —
     muestra todas las opciones para ese partido.
  4. "Combinada sugerida" (si aplica): cada uno de los 3 informes busca
     directamente 2 "bankers" (mercados de máxima seguridad — victoria
     clara, gana un set, etc. — no tienen por qué salir entre sus 8
     selecciones de valor) de partidos distintos cuya cuota combinada
     caiga entre 1,70 y 2,20; se usa la primera propuesta válida que
     encuentre (Tipster → Machine Learning → Analista cuantitativo). Si
     ninguno encuentra una, el bot calcula una de red de seguridad
     buscando entre las 24 selecciones de valor ya obtenidas.

  Cada "Recomendación", cada "Mismo partido, distinto mercado" y la
  "Combinada sugerida" se mandan como su **propio mensaje** (no todo junto),
  con un botón **"📝 Registrar apuesta"**: la registra como pendiente en
  Firestore (partido, torneo, mercado y de qué perfil(es) viene) sin
  pedir la cuota todavía. En "Mismo partido, distinto mercado" el botón es
  uno solo por partido aunque haya varias opciones de mercado — memoriza tú
  cuál elegiste, para marcarla luego con el mercado correcto en mente.
- `/pendientes` (o "📝 Pendientes") — lista las apuestas registradas que
  aún no se han marcado, cada una con botones **"✅ Ganada"** / **"❌
  Perdida"**. "❌ Perdida" se resuelve al momento (-50€, no hace falta
  cuota). "✅ Ganada" te pide que le mandes la cuota REAL que conseguiste
  en la casa de apuestas (no la que estimó el informe, que puede no
  coincidir exactamente) y calcula el beneficio como 50€ × (cuota − 1).
- `/stats` (o "📊 Stats") — total de apuestas registradas, pendientes,
  ganadas/perdidas, % de acierto y beneficio neto acumulado, siempre
  asumiendo el stake fijo de 50€ por apuesta.
- `/ticket` (o "📸 Ticket") — pide primero la foto del ticket (la tarjeta
  ya recortada, sin fondo blanco alrededor). Para el fondo, si ya usaste
  uno antes te ofrece un botón "🔁 Usar el mismo fondo de la última vez"
  además de poder mandar uno nuevo (el que mandes queda guardado para la
  próxima). Devuelve:
  1. El montaje con el ticket centrado sobre el fondo (esquinas
     redondeadas) y el logo de JC Analistas en un sello circular blanco en
     la esquina superior derecha (tamaño y margen proporcionales al ancho
     de la foto, para verse igual de bien en fondos pequeños o grandes),
     con un texto generado automáticamente a partir del propio ticket
     (usando la visión de Gemini para leer la imagen: bandera, nombres de
     jugadores/equipos y contexto visible): icono del deporte +
     competición subrayada, selecciones en negrita, "📊 Stake 2" fijo, y
     una última línea fija en cursiva "🔞 Misma cuota aquí" enlazada.
  2. Un segundo mensaje aparte con el resumen corto en negrita y
     subrayado, entre ✅: `✅ Topo + Prado Set @1,91 ✅`, y debajo, en
     cursiva con la cifra en negrita, el beneficio calculado sobre un
     stake fijo de 50€ (25€ = 1ud, redondeado hacia arriba desde ",50"):
     `Sumamos +46€ / +1,8ud. 🫡`.

  El mensaje del montaje trae dos botones: **"✅ Publicar"** (publica solo
  esa foto+texto en tu canal — sin marca de "Reenviado desde", porque es
  un mensaje nuevo del bot, no un reenvío — y no se envía nada hasta que
  lo pulsas) y **"✏️ Editar"** (te pide un texto nuevo y lo sustituye,
  por si hay que corregir algo antes de publicar). El segundo mensaje (el
  del resumen) es totalmente independiente y trae sus propios botones
  **"✅ Publicar"** y **"✏️ Editar"**: pulsar uno no afecta al otro — si
  quieres los dos en el canal, pulsa "Publicar" en cada mensaje por
  separado.

## Limitaciones conocidas de esta primera versión

- El emparejamiento de selecciones repetidas es heurístico (normaliza
  texto y usa similitud de cadenas): revisa siempre el resultado, sobre
  todo si los informes redactan el mismo partido de forma muy distinta.
- El agente Deep Research de la API de Gemini está en preview: Google
  puede cambiar su comportamiento, precios o disponibilidad.
- Solo un `/analizar` puede correr a la vez (incluido el automático de las
  7:00: si coincide con uno que lanzaste tú a mano, avisa y no lo lanza).
  Desde que `/analizar` guarda su progreso en Firestore y se sondea desde
  fuera (ver 7.7), esto ya no depende de que el contenedor de Cloud Run
  siga vivo sin interrupción — un reinicio o redeploy en medio de un
  análisis ya no lo pierde, como sí pasaba antes.
- El último fondo de `/ticket` y los montajes/resúmenes pendientes de
  publicar/editar viven en memoria del proceso: si Cloud Run apaga el
  contenedor por inactividad entre medias, se pierden (el botón de
  reutilizar fondo deja de ofrecerse, y los de publicar/editar caducan).
- Las cuotas reales que se guardan en Firestore se registran a mano al
  marcar "✅ Ganada"; no hay ninguna integración con casas de apuestas.

## Estructura del proyecto

```
src/
  bot.ts                    Lógica del bot de Telegram (comandos)
  server.ts                 Servidor Express + registro del webhook
  config/
    env.ts                  Carga de variables de entorno
    prompts.ts               Los 6 prompts (3 fútbol + 3 tenis) + formato de salida exigido
  gemini/
    deepResearch.ts           Llamadas a la API oficial de Gemini Deep Research
  matching/
    normalize.ts              Normalización de texto para comparar selecciones
    matchSelections.ts        Parseo del bloque "SELECCIONES FINALES" + matching
  format/
    telegramFormat.ts         Construcción de los mensajes de Telegram
  montage/
    analyzeTicket.ts          Lee el ticket con la visión de Gemini (deporte, selección, cuota...)
    composeMontage.ts          Monta el ticket + sello del logo sobre la foto de fondo
    formatTicketCaption.ts     Texto del montaje y del resumen de apuesta acertada
    logoAsset.ts                Logo de JC Analistas embebido en base64 (ver composeMontage.ts)
    assets/logo-circle.png      Fuente del logo (recortado en círculo) por si hay que regenerarlo
  stats/
    firestore.ts              Cliente de Firestore (vía ADC)
    betsStore.ts               Modelo de apuesta + CRUD (pendiente/ganada/perdida) y estadísticas
    researchJobs.ts            Modelo del job de /analizar + CRUD (progreso de cada Deep Research en curso)
```
