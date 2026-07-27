import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria: ${name} (revisa tu .env)`);
  }
  return value;
}

export const env = {
  telegramBotToken: required("TELEGRAM_BOT_TOKEN"),
  telegramAllowedUserId: required("TELEGRAM_ALLOWED_USER_ID"),
  // Opcional a propósito: en el primer despliegue a Cloud Run todavía no
  // conocemos la URL pública del propio servicio (huevo y gallina). El
  // servidor arranca igualmente y solo registra el webhook si esto está
  // definido (ver server.ts) — se completa en el segundo despliegue.
  publicUrl: process.env.PUBLIC_URL,
  webhookSecretPath: required("WEBHOOK_SECRET_PATH"),
  port: Number(process.env.PORT ?? 8080),
  geminiApiKey: required("GEMINI_API_KEY"),
  // Modelo/agente de Deep Research en la API de Gemini. "preview" es más
  // rápido; "max-preview" es más exhaustivo pero más lento.
  geminiDeepResearchAgent: process.env.GEMINI_DEEP_RESEARCH_AGENT ?? "deep-research-preview-04-2026",
  deepResearchTimeoutMinutes: Number(process.env.DEEP_RESEARCH_TIMEOUT_MINUTES ?? 20),
};
