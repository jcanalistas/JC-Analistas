# Imagen oficial de Playwright: ya trae Chromium/Firefox/WebKit y sus
# dependencias del sistema instaladas, evita tener que instalarlas a mano.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# El código usa channel: "chrome" (Google Chrome real) en vez del Chromium
# por defecto, porque Google bloquea el login/uso de Gemini cuando detecta
# un navegador controlado por automatización.
RUN npx playwright install --with-deps chrome

# Xvfb: Google también bloquea Chrome en modo headless real (aunque sea
# Chrome real y no Chromium), así que corremos siempre en modo "visible"
# contra un display virtual (ver src/gemini/virtualDisplay.ts).
RUN apt-get update && apt-get install -y --no-install-recommends xvfb \
    && rm -rf /var/lib/apt/lists/*

# El archivo de sesión de Gemini (storage/gemini-session.json) NO se copia
# a la imagen: se monta en tiempo de ejecución desde Secret Manager
# (ver README, sección de despliegue en Cloud Run).
RUN mkdir -p /app/storage

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
