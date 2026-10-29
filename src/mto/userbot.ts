import { Api, TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { env } from "../config/env";
import { getUserSession } from "./mtoStore";

// Cliente de Telegram con TU cuenta (no la del bot): un bot no puede leer
// un canal del que no es administrador, pero tu cuenta ya está suscrita.
// Solo se usa para leer mensajes del canal de lesiones.

export function mtoConfigured(): boolean {
  return Boolean(env.telegramApiId && env.telegramApiHash);
}

export function apiCredentials() {
  if (!env.telegramApiId || !env.telegramApiHash) {
    throw new Error("Faltan TELEGRAM_API_ID / TELEGRAM_API_HASH");
  }
  return { apiId: env.telegramApiId, apiHash: env.telegramApiHash };
}

export async function connectClient(session = ""): Promise<TelegramClient> {
  const { apiId, apiHash } = apiCredentials();
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
  });
  client.setLogLevel("error" as never);
  await client.connect();
  return client;
}

/** Cliente con la sesión guardada, o null si todavía no se ha hecho /mto_login. */
export async function connectUserClient(): Promise<TelegramClient | null> {
  const session = await getUserSession();
  if (!session) return null;
  const client = await connectClient(session);
  if (!(await client.checkAuthorization())) {
    await client.disconnect();
    return null;
  }
  return client;
}

export interface ChannelRef {
  id: string;
  title: string;
  entity: Api.TypeEntityLike;
}

/** Busca el canal entre tus chats: por ID si ya se conoce, si no por título. */
export async function findChannel(client: TelegramClient, knownId?: string): Promise<ChannelRef | null> {
  const needle = env.mtoChannelTitle.toLowerCase();
  const dialogs = await client.getDialogs({});
  const dialog = dialogs.find((d) =>
    knownId ? d.id?.toString() === knownId : (d.title ?? "").toLowerCase().includes(needle)
  );
  if (!dialog?.entity || !dialog.id) return null;
  return { id: dialog.id.toString(), title: dialog.title ?? "", entity: dialog.entity };
}

export interface ChannelMessage {
  id: number;
  date: number; // ms
  text: string;
}

/**
 * Mensajes posteriores a `afterId`, del más antiguo al más reciente.
 * `more` indica que se llegó al límite y quedan mensajes por leer.
 */
export async function fetchMessagesAfter(
  client: TelegramClient,
  entity: Api.TypeEntityLike,
  afterId: number,
  limit: number
): Promise<{ messages: ChannelMessage[]; more: boolean }> {
  const messages: ChannelMessage[] = [];
  let seen = 0;
  for await (const message of client.iterMessages(entity, { reverse: true, minId: afterId, limit })) {
    // Los mensajes de servicio (fijados, cambios de título…) cuentan para el
    // límite pero no tienen texto que leer.
    seen++;
    if (!(message instanceof Api.Message)) continue;
    messages.push({ id: message.id, date: message.date * 1000, text: message.message ?? "" });
  }
  return { messages, more: seen >= limit };
}

/** Los `limit` mensajes más recientes del canal, del más reciente al más antiguo. */
export async function fetchLatestMessages(
  client: TelegramClient,
  entity: Api.TypeEntityLike,
  limit: number
): Promise<ChannelMessage[]> {
  const messages: ChannelMessage[] = [];
  for await (const message of client.iterMessages(entity, { limit })) {
    if (!(message instanceof Api.Message)) continue;
    messages.push({ id: message.id, date: message.date * 1000, text: message.message ?? "" });
  }
  return messages;
}
