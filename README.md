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

### 7.1 Subir la sesión de Gemini como secreto

```bash
gcloud secrets create gemini-session --data-file=storage/gemini-session.json
```

Cada vez que renueves la sesión (`npm run gemini:login`), sube una nueva
versión:

```bash
gcloud secrets versions add gemini-session --data-file=storage/gemini-session.json
```

### 7.2 Construir y desplegar

```bash
gcloud run deploy jc-analistas-bot \
  --source . \
  --region europe-southwest1 \
  --allow-unauthenticated \
  --set-env-vars TELEGRAM_BOT_TOKEN=xxxx,TELEGRAM_ALLOWED_USER_ID=xxxx,WEBHOOK_SECRET_PATH=xxxx,DEEP_RESEARCH_TIMEOUT_MINUTES=20 \
  --set-secrets /app/storage/gemini-session.json=gemini-session:latest \
  --timeout=3600 \
  --memory=2Gi \
  --cpu=2
```

Notas:
- `--timeout=3600` porque un `/research` con 3 Deep Research puede tardar
  bastante más que el timeout HTTP por defecto de Cloud Run.
- `--memory=2Gi --cpu=2` porque Playwright + Chromium consumen bastante
  más que un contenedor Node.js típico.
- Tras el primer despliegue, Cloud Run te da la URL pública del servicio.
  Vuelve a desplegar (o usa `gcloud run services update`) añadiendo
  `PUBLIC_URL=<esa URL>` a las variables de entorno para que el propio
  servicio registre el webhook de Telegram correctamente al arrancar.

### 7.3 Verificar el webhook

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
