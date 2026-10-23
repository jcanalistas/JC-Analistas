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
  // Canal donde se publican los montajes al pulsar "Publicar en canal".
  // El bot debe ser admin de ese canal con permiso de publicar mensajes.
  telegramChannelId: required("TELEGRAM_CHANNEL_ID"),
  // Opcional a propósito: en el primer despliegue a Cloud Run todavía no
  // conocemos la URL pública del propio servicio (huevo y gallina). El
  // servidor arranca igualmente y solo registra el webhook si esto está
  // definido (ver server.ts) — se completa en el segundo despliegue.
  publicUrl: process.env.PUBLIC_URL,
  webhookSecretPath: required("WEBHOOK_SECRET_PATH"),
  port: Number(process.env.PORT ?? 8080),
  // Lector de asistencias médicas (MTO). Opcionales: sin ellos el resto del
  // bot funciona igual y /mto avisa de que falta configurarlo. Se sacan de
  // https://my.telegram.org -> API development tools.
  telegramApiId: process.env.TELEGRAM_API_ID ? Number(process.env.TELEGRAM_API_ID) : undefined,
  telegramApiHash: process.env.TELEGRAM_API_HASH,
  // Texto que contiene el título del canal de avisos de lesiones.
  mtoChannelTitle: process.env.MTO_CHANNEL_TITLE ?? "BOT LESIONES",
};
