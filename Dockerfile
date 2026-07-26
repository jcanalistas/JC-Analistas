# Imagen oficial de Playwright: ya trae Chromium/Firefox/WebKit y sus
# dependencias del sistema instaladas, evita tener que instalarlas a mano.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# El archivo de sesión de Gemini (storage/gemini-session.json) NO se copia
# a la imagen: se monta en tiempo de ejecución desde Secret Manager
# (ver README, sección de despliegue en Cloud Run).
RUN mkdir -p /app/storage

ENV NODE_ENV=production
EXPOSE 8080

CMD ["npm", "start"]
