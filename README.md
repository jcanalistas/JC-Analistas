# JC Analistas — Bot de Telegram

Bot de Telegram para el canal tipster **JC Analistas**. Primera función
implementada:

1. Lanza **3 Deep Research distintos en Gemini** (uno por cada prompt
   configurado).
2. Devuelve, en formato simple, las **selecciones finales** de cada uno.
3. Resalta qué selecciones **se repiten en 2 o 3** de los Deep Research,
   junto con la explicación que dio cada informe para esa selección.

El resto de funciones del bot se añadirán más adelante.

## Cómo funciona por dentro (y por qué)

Gemini **Deep Research** (el modo de investigación larga con informe
final) no tiene hoy una API pública sencilla: solo existe dentro de la
web/app de Gemini. Por eso este bot usa **Playwright** para controlar un
navegador real con tu sesión de Google ya logueada, en vez de llamar a un
endpoint. Esto tiene implicaciones importantes que debes conocer:

- **Es frágil por diseño**: si Google cambia el HTML de Gemini, la
  automatización puede romperse. Todos los selectores están centralizados
  en `src/gemini/selectors.ts` para que ajustarlos sea rápido.
- **Es lento**: cada Deep Research puede tardar varios minutos. Los 3 se
  ejecutan **en secuencia** (no en paralelo) para no forzar varias
  pestañas simultáneas sobre la misma cuenta de Google, lo que suele ser
  inestable o disparar bloqueos.
- **No maneja tu contraseña ni el 2FA**: inicias sesión tú mismo una vez,
  de forma manual, con un script que abre un navegador visible
  (`npm run gemini:login`). Ese script guarda la sesión (cookies) en
  `storage/gemini-session.json`, que el bot reutiliza en modo headless.
  Ese archivo **nunca** se sube al repositorio (ya está en `.gitignore`).
- Revisa los términos de servicio de Google antes de automatizar tu
  cuenta de esta forma; úsalo bajo tu propia responsabilidad.

## Requisitos

- Node.js 20+
- Una cuenta de Google con acceso a Gemini (idealmente Gemini Advanced,
  que es donde Deep Research está disponible con más cuota)
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

Rellena `TELEGRAM_BOT_TOKEN` y `TELEGRAM_ALLOWED_USER_ID`. El resto
(`PUBLIC_URL`, `WEBHOOK_SECRET_PATH`) se completan al desplegar (paso 5).

## 3. Instalar dependencias

```bash
npm install
```

## 4. Capturar la sesión de Gemini

```bash
npm run gemini:login
```

Se abrirá una ventana de Chromium. Inicia sesión con la cuenta de Google
que quieres que use el bot, espera a ver el chat de Gemini cargado, y
pulsa ENTER en la terminal. Esto genera
`storage/gemini-session.json`.

> Las sesiones de Google caducan. Si el bot empieza a fallar en el paso
> de login, vuelve a correr `npm run gemini:login` y actualiza el secreto
> en Cloud Run (paso 5).

### 4.1 Alternativa sin PC: todo desde el móvil con Google Cloud Shell (gratis)

Si no tienes un ordenador a mano, puedes hacer este paso (y el despliegue
del paso 7) enteramente desde el navegador del móvil, gratis, usando
[Google Cloud Shell](https://console.cloud.google.com) — 50 horas/semana
gratuitas, de sobra para esto. Requiere tener un proyecto de GCP con
facturación vinculada (no se cobra nada si te mantienes en la capa
gratuita, pero Google pide una tarjeta para verificar identidad).

1. Desde el móvil, entra en [console.cloud.google.com](https://console.cloud.google.com)
   con la misma cuenta de Google que quieres usar para Gemini, y abre el
   icono de terminal ("Activar Cloud Shell") arriba a la derecha.
2. Clona el repo y entra en la rama:
   ```bash
   git clone <URL_DE_TU_REPO> JC-Analistas
   cd JC-Analistas
   git checkout claude/telegram-tipster-bot-b2reun
   npm install
   npx playwright install --with-deps chromium
   ```
3. Monta el escritorio virtual con el script incluido:
   ```bash
   bash scripts/cloud-shell-gui-login.sh
   ```
   Sigue las instrucciones que imprime: abrir la "Vista previa en la Web"
   en el puerto 8080 te da un escritorio virtual en una pestaña nueva.
4. En la terminal (no en la pestaña del escritorio), ejecuta:
   ```bash
   export DISPLAY=:99
   npm run gemini:login
   ```
5. Cambia a la pestaña del escritorio virtual: ahí verás Chromium
   abierto. Inicia sesión con tu Google normalmente, tocando los campos
   con el dedo (el teclado de tu móvil funciona igual que en cualquier
   web). Cuando cargue el chat de Gemini, vuelve a la terminal y pulsa
   ENTER — esto guarda `storage/gemini-session.json`.
6. Sigue en la misma sesión de Cloud Shell con el paso 7 (desplegar en
   Cloud Run) — `gcloud` ya viene autenticado por defecto en Cloud Shell,
   así que puedes copiar y pegar esos comandos tal cual.

> Cloud Shell borra el disco de la VM entre sesiones largas de
> inactividad, pero conserva tu `$HOME` (5 GB persistentes), así que el
> repo clonado y `node_modules` siguen ahí si vuelves más tarde. Si algo
> falla, vuelve a correr el script del paso 3.

## 5. Ajustar tus 3 prompts

Edita `src/config/prompts.ts` y sustituye el contenido de
`RESEARCH_PROMPTS` por tus 3 enfoques reales (ligas, mercados, criterios).
No toques la parte de `OUTPUT_FORMAT_INSTRUCTIONS`: es lo que le exige a
Gemini terminar con un bloque `SELECCIONES FINALES` parseable por el bot.

## 6. Probar en local

```bash
npm run dev
```

En local no hay webhook público, así que para probar de verdad necesitas
exponer tu máquina (p. ej. con `ngrok http 8080`) y usar esa URL como
`PUBLIC_URL` temporalmente, o desplegar directo en Cloud Run (paso 7).

## 7. Desplegar en Cloud Run

Estos comandos ya están rellenados con tu token de bot, tu ID de Telegram
y un secreto de webhook generado aleatoriamente (están en tu `.env`
local, que nunca se sube al repo). Ejecútalos tú desde tu terminal con
`gcloud` autenticado (`gcloud auth login` y `gcloud config set project
<TU_PROJECT_ID>` si no lo has hecho aún) — yo no tengo acceso a tu cuenta
de Google Cloud para correrlos por ti.

### 7.1 Subir los dos secretos (token del bot y sesión de Gemini)

El token del bot y la sesión de Gemini se guardan en Secret Manager en
vez de como variables de entorno planas, para que no queden visibles en
la consola de Cloud Run:

```bash
echo -n "8808749603:AAGWeLFuQfC52xHB6j3LBZgJx5m7jp7S5PM" | gcloud secrets create telegram-bot-token --data-file=-

gcloud secrets create gemini-session --data-file=storage/gemini-session.json
```

Cada vez que renueves la sesión de Gemini (`npm run gemini:login`), sube
una nueva versión:

```bash
gcloud secrets versions add gemini-session --data-file=storage/gemini-session.json
```

Si alguna vez regeneras el token del bot en BotFather (`/revoke`), haz lo
mismo con:

```bash
echo -n "TU_NUEVO_TOKEN" | gcloud secrets versions add telegram-bot-token --data-file=-
```

### 7.2 Construir y desplegar (primera vez)

```bash
gcloud run deploy jc-analistas-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-env-vars TELEGRAM_ALLOWED_USER_ID=8333423129,WEBHOOK_SECRET_PATH=20e723417527d2b37709339395e82ab78dd0c7a34aed14c4,DEEP_RESEARCH_TIMEOUT_MINUTES=20 \
  --set-secrets /app/storage/gemini-session.json=gemini-session:latest,TELEGRAM_BOT_TOKEN=telegram-bot-token:latest \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=2
```

Al terminar, `gcloud` imprime la URL pública del servicio (algo como
`https://jc-analistas-bot-xxxxx-uc.a.run.app`). Cópiala para el siguiente
paso.

### 7.3 Segundo despliegue: añadir PUBLIC_URL

El servicio necesita conocer su propia URL pública para registrar el
webhook de Telegram al arrancar. Vuelve a desplegar añadiendo
`PUBLIC_URL` con la URL que te dio el paso anterior:

```bash
gcloud run services update jc-analistas-bot \
  --region europe-southwest1 \
  --update-env-vars PUBLIC_URL=https://TU-URL-DE-CLOUD-RUN.a.run.app
```

Notas:
- `--timeout=3600` porque un `/research` con 3 Deep Research puede tardar
  bastante más que el timeout HTTP por defecto de Cloud Run.
- `--memory=2Gi --cpu=2` porque Playwright + Chromium consumen bastante
  más que un contenedor Node.js típico.
- Necesitas haber hecho el paso 4 (`npm run gemini:login`) ANTES del
  primer despliegue, porque `storage/gemini-session.json` se sube en el
  paso 7.1.

### 7.4 Verificar el webhook

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Debe apuntar a `https://<tu-servicio>.a.run.app/telegram/<WEBHOOK_SECRET_PATH>`.

## Uso

En Telegram, háblale al bot:

- `/start` — mensaje de bienvenida.
- `/research` — lanza los 3 Deep Research y, cuando terminan, envía:
  1. Un mensaje con las selecciones finales de cada Deep Research (formato
     simple, un partido por línea).
  2. Un segundo mensaje con las selecciones que coincidieron en 2 o 3
     informes, incluyendo la explicación que dio cada uno.

## Limitaciones conocidas de esta primera versión

- El emparejamiento de selecciones repetidas es heurístico (normaliza
  texto y usa similitud de cadenas): revisa siempre el resultado, sobre
  todo si los 3 informes redactan el mismo partido de forma muy distinta.
- Si Gemini cambia su interfaz, algunos selectores en
  `src/gemini/selectors.ts` pueden dejar de funcionar y habrá que
  actualizarlos.
- Solo un `/research` puede correr a la vez (para no lanzar varias
  sesiones de navegador simultáneas sobre la misma cuenta).

## Estructura del proyecto

```
src/
  bot.ts                    Lógica del bot de Telegram (comandos)
  server.ts                 Servidor Express + registro del webhook
  config/
    env.ts                  Carga de variables de entorno
    prompts.ts               Los 3 prompts + formato de salida exigido
  gemini/
    captureLogin.ts          Script de login manual (un solo uso)
    deepResearch.ts           Automatización de Deep Research con Playwright
    selectors.ts               Selectores de la UI de Gemini (editar si cambian)
  matching/
    normalize.ts              Normalización de texto para comparar selecciones
    matchSelections.ts        Parseo del bloque "SELECCIONES FINALES" + matching
  format/
    telegramFormat.ts         Construcción de los mensajes de Telegram
```
