# JC Analistas — Bot de Telegram

Bot de Telegram para el canal tipster **JC Analistas**. Funciones:

1. **🔍 Analizar**: eliges deporte (⚽ Fútbol / 🎾 Tenis), fecha y
   competiciones/categoría con botones, y el bot te devuelve **un único
   prompt** que hace trabajar a los 3 perfiles (Tipster, Machine Learning
   y Analista cuantitativo) como analistas independientes, con una sección
   final de consenso (selecciones de cada uno, coincidencias, mismo
   partido con distinto mercado y combinada sugerida). Lo copias y lo
   pegas en **Gemini web** (o adjuntas el .txt que manda el bot).
2. **📸 Ticket**: montaje del ticket sobre una foto de fondo, con su texto,
   listo para publicar en el canal.
3. **📝 Pendientes / 📊 Stats**: seguimiento de apuestas registradas.

## Cómo funciona por dentro

El bot **no usa ninguna API de IA**: el Deep Research de la API de Gemini
dejó de estar disponible en el plan gratuito, así que `/analizar` solo
construye el prompt (`buildCombinedPrompt` en `src/config/prompts.ts`) con
la configuración elegida arriba del todo y te lo manda por Telegram. No
hace falta API key de Gemini ni ningún job de Cloud Scheduler.

## Requisitos

- Node.js 20+
- Un bot de Telegram

## 1. Crear el bot de Telegram

1. Habla con [@BotFather](https://t.me/BotFather) en Telegram.
2. Envía `/newbot` y sigue las instrucciones (nombre y username del bot).
3. Guarda el **token** que te da — es tu `TELEGRAM_BOT_TOKEN`.
4. Habla con [@userinfobot](https://t.me/userinfobot) para obtener tu
   propio ID de usuario de Telegram — es tu `TELEGRAM_ALLOWED_USER_ID`
   (así solo tú puedes usar el bot).

## 2. Configurar variables de entorno

```bash
cp .env.example .env
```

Rellena `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USER_ID` y
`TELEGRAM_CHANNEL_ID`. El resto (`PUBLIC_URL`, `WEBHOOK_SECRET_PATH`) se
completan al desplegar (paso 6).

`TELEGRAM_CHANNEL_ID` es el ID de tu canal (consíguelo reenviando un
mensaje del canal a [@userinfobot](https://t.me/userinfobot)); el bot
debe ser **administrador del canal con permiso de publicar mensajes**
para poder usar el botón "Publicar" de `/ticket`.

## 3. Instalar dependencias

```bash
npm install
```

## 4. Ajustar tus 6 prompts (3 de fútbol + 3 de tenis)

Edita `src/config/prompts.ts`: `FOOTBALL_PROMPT_DEFS` y
`TENNIS_PROMPT_DEFS` son los 3 perfiles de cada deporte (Tipster → Machine
Learning → Analista cuantitativo). Las comprobaciones comunes a los 3
(mercados del mismo partido en fútbol; retiradas, vueltas de baja,
desgaste y ELO en tenis) están en `SHARED_CHECKS_BY_SPORT` y se incluyen
una sola vez. `buildCombinedPrompt` monta el prompt final: configuración,
reglas comunes, protocolo de independencia, los 3 analistas y
`FINAL_SECTION` (consenso).

## 5. Probar en local

```bash
npm run dev
```

En local no hay webhook público, así que para probar de verdad necesitas
exponer tu máquina (p. ej. con `ngrok http 8080`) y usar esa URL como
`PUBLIC_URL` temporalmente, o desplegar directo en Cloud Run (siguiente
paso).

## 6. Desplegar en Cloud Run

### 6.1 Subir el secreto del token de Telegram

Se guarda en Secret Manager en vez de como variable de entorno plana,
para que no quede visible en la consola de Cloud Run:

```bash
echo -n "TU_TOKEN_DE_TELEGRAM" | gcloud secrets create telegram-bot-token --data-file=-
```

Si alguna vez lo regeneras, sube una nueva versión:

```bash
echo -n "NUEVO_VALOR" | gcloud secrets versions add telegram-bot-token --data-file=-
```

### 6.2 Construir y desplegar (primera vez)

```bash
gcloud run deploy jc-analistas-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-env-vars TELEGRAM_ALLOWED_USER_ID=TU_ID_DE_TELEGRAM,TELEGRAM_CHANNEL_ID=TU_ID_DE_CANAL,WEBHOOK_SECRET_PATH=UNA_CADENA_ALEATORIA \
  --set-secrets TELEGRAM_BOT_TOKEN=telegram-bot-token:latest
```

Al terminar, `gcloud` imprime la URL pública del servicio (algo como
`https://jc-analistas-bot-xxxxx.a.run.app`). Cópiala para el siguiente
paso.

### 6.3 Segundo despliegue: añadir PUBLIC_URL

El servicio necesita conocer su propia URL pública para registrar el
webhook de Telegram al arrancar:

```bash
gcloud run services update jc-analistas-bot \
  --region europe-southwest1 \
  --update-env-vars PUBLIC_URL=https://TU-URL-DE-CLOUD-RUN.a.run.app
```

### 6.4 Verificar el webhook

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Debe apuntar a `https://<tu-servicio>.a.run.app/telegram/<WEBHOOK_SECRET_PATH>`.

### 6.5 Activar Firestore (lo usan Pendientes y Stats)

Firestore guarda las apuestas registradas. Hace falta crearla una sola
vez y darle permiso a la cuenta de servicio del propio Cloud Run:

```bash
gcloud services enable firestore.googleapis.com

gcloud firestore databases create --location=eur3

PROJECT_NUMBER=$(gcloud projects describe $(gcloud config get-value project) --format="value(projectNumber)")
gcloud projects add-iam-policy-binding $(gcloud config get-value project) \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/datastore.user"
```

`--location=eur3` es una región multi-región de Europa; si tu proyecto ya
tiene una base de datos Firestore, no hace falta repetir el `create`.

### 6.6 Limpieza si venías de la versión con la API de Gemini

Los jobs de Cloud Scheduler `poll-research` y `auto-analizar-tenis` y el
secreto `gemini-api-key` ya no se usan. Bórralos:

```bash
gcloud scheduler jobs delete poll-research --location=europe-west1
gcloud scheduler jobs delete auto-analizar-tenis --location=europe-west1
gcloud run services update jc-analistas-bot --region europe-southwest1 \
  --remove-secrets GEMINI_API_KEY \
  --remove-env-vars DEEP_RESEARCH_TIMEOUT_MINUTES,AUTO_ANALIZAR_SECRET,GEMINI_DEEP_RESEARCH_AGENT
gcloud secrets delete gemini-api-key
```

## Uso

En Telegram, háblale al bot:

El bot deja fijos, siempre debajo del cuadro de texto, los botones
"🏠 Empezar", "🔍 Analizar", "📸 Ticket", "📝 Pendientes" y "📊 Stats".
Cada uno hace lo mismo que su comando equivalente:

- `/start` (o "🏠 Empezar") — mensaje de bienvenida.
- `/analizar` (o "🔍 Analizar") — pregunta el deporte y, después, qué
  partidos analizar: **Hoy** (con la fecha), **Mañana** (con la fecha) o
  **Próximas 24h**. Si eliges Fútbol ⚽, además pregunta si quieres todas
  las competiciones o una selección concreta marcando con botones:
  Selecciones Nacionales, LaLiga 1ª/2ª, 1ª/2ª RFEF, Liga Portugal,
  Premier League, Bundesliga, Ligue 1, MLS, Brasileirão,
  Champions/Europa/Conference League y Ligas Europeas (otras). Si eliges
  Selecciones Nacionales, el prompt añade los ajustes propios del fútbol
  de selecciones (convocatoria real, fatiga de club, riesgo de rotación,
  muestra pequeña, motivación por clasificación). Si eliges Tenis 🎾,
  pregunta **ATP**, **Challenger** o **Todo** (siempre individuales
  masculinos). Cada paso tiene "⬅️ Atrás".

  Al terminar, te manda el prompt de los 3 analistas con la configuración
  ya puesta al principio (fecha y hora actual, ventana, competiciones o
  categoría, fuente de cuotas y número de picks), de dos formas:
  troceado en bloques de código (Telegram tiene un límite de 4096
  caracteres por mensaje; toca cada bloque para copiarlo y pégalos en
  orden en el mismo mensaje de Gemini web) y como archivo `.txt` (puedes
  adjuntarlo en Gemini y escribir "Sigue las instrucciones del archivo
  adjunto").
- `/pendientes` (o "📝 Pendientes") — lista las apuestas registradas que
  aún no se han marcado, cada una con botones **"✅ Ganada"** / **"❌
  Perdida"**. "❌ Perdida" se resuelve al momento (-50€, no hace falta
  cuota). "✅ Ganada" te pide que le mandes la cuota REAL que conseguiste
  en la casa de apuestas (no la que estimó el informe, que puede no
  coincidir exactamente) y calcula el beneficio como 50€ × (cuota − 1).
- `/stats` (o "📊 Stats") — total de apuestas registradas, pendientes,
  ganadas/perdidas, % de acierto y beneficio neto acumulado, siempre
  asumiendo el stake fijo de 50€ por apuesta.

  Las apuestas se registraban desde los resultados de `/analizar` cuando
  el bot lanzaba los Deep Research; ahora que los resultados salen en
  Gemini web, Pendientes y Stats solo muestran las ya registradas.
- `/ticket` (o "📸 Ticket") — pide primero la foto del ticket (la tarjeta
  ya recortada, sin fondo blanco alrededor). Para el fondo, si ya usaste
  uno antes te ofrece un botón "🔁 Usar el mismo fondo de la última vez"
  además de poder mandar uno nuevo (el que mandes queda guardado para la
  próxima). Después te pregunta el deporte (🎾 Tenis / ⚽ Fútbol, o
  "🖼️ Sin texto, solo la imagen") y te pide que escribas los datos del
  ticket en un mensaje, una cosa por línea: competición, selecciones,
  cuota total (opcional) y casa de apuestas (opcional: `Winamax` o `WH`;
  si no se pone, Winamax), p. ej. `ATP Washington`, `Poljicak + Dalla
  Valle Set`, `1,91`, `WH`. La casa decide a dónde apunta el enlace de
  "Misma cuota aquí" (ver `BOOKIES` en `formatTicketCaption.ts` para
  añadir más). No usa Gemini, así que no gasta API. Devuelve:
  1. El montaje con el ticket centrado sobre el fondo (esquinas
     redondeadas) y el logo de JC Analistas en un sello circular blanco en
     la esquina superior derecha (tamaño y margen proporcionales al ancho
     de la foto, para verse igual de bien en fondos pequeños o grandes),
     con un texto generado a partir de los datos que escribiste: icono del deporte +
     competición subrayada, selecciones en negrita, "📊 Stake 2" fijo, y
     una última línea en cursiva "🔞 Misma cuota aquí" enlazada a la casa elegida.
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

## Limitaciones conocidas

- Gemini web es un solo modelo escribiendo las 3 secciones seguidas: el
  prompt le exige que cada analista investigue por su cuenta, pero no es
  tan independiente como 3 investigaciones separadas. Para independencia
  total, abre 3 chats y pega en cada uno la configuración, las reglas
  comunes y un solo analista.
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
    prompts.ts               Los 6 prompts (3 fútbol + 3 tenis) y el prompt combinado de /analizar
  montage/
    composeMontage.ts          Monta el ticket + sello del logo sobre la foto de fondo
    formatTicketCaption.ts     Texto del montaje y del resumen de apuesta acertada
    logoAsset.ts                Logo de JC Analistas embebido en base64 (ver composeMontage.ts)
    assets/logo-circle.png      Fuente del logo (recortado en círculo) por si hay que regenerarlo
  stats/
    firestore.ts              Cliente de Firestore (vía ADC)
    betsStore.ts               Modelo de apuesta + CRUD (pendiente/ganada/perdida) y estadísticas
prompts-chatgpt/            Prompts de los 3 analistas en un solo mensaje para ChatGPT (editables a mano)
```
