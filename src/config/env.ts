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
  publicUrl: required("PUBLIC_URL"),
  webhookSecretPath: required("WEBHOOK_SECRET_PATH"),
  port: Number(process.env.PORT ?? 8080),
  geminiStorageStatePath: process.env.GEMINI_STORAGE_STATE_PATH ?? "./storage/gemini-session.json",
  deepResearchTimeoutMinutes: Number(process.env.DEEP_RESEARCH_TIMEOUT_MINUTES ?? 20),
};
