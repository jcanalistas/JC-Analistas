import { env } from "../config/env";
import type { DigestItem } from "./format";
import { createEvents, getCursor, getEventsSince, saveCursor } from "./mtoStore";
import { parseMto, tennisCategory } from "./parseMto";
import { dedupe, detectPatterns, isoWeek, type MtoEvent } from "./patterns";
import { connectUserClient, fetchLatestMessages, fetchMessagesAfter, findChannel, lastMessageIdBefore } from "./userbot";

// Solo interesan los últimos 45 días (los patrones miran 30 días + los 14
// de la lista). Cada lectura sigue donde lo dejó la anterior, en tandas de
// 3.000 mensajes para que la petición acabe a tiempo: si quedan más, se
// vuelve a pulsar "Leer canal".
const MAX_DAYS_BACK = 45;
const MAX_MESSAGES_PER_RUN = 3000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PollResult {
  read: number;
  saved: number;
  unparsed: number;
  /** De las asistencias guardadas, cuántas entran en el análisis (ATP / Challenger masculino). */
  atp: number;
  challenger: number;
  /** Fechas del primer y último mensaje leídos en esta tanda (ms). */
  from?: number;
  to?: number;
  /** Quedan mensajes por leer (se llegó al límite de la tanda). */
  more: boolean;
  channel?: string;
}

let running = false;

export async function pollMtoChannel(): Promise<PollResult> {
  // Evita dos lecturas a la vez si se pulsa /mto_leer dos veces seguidas.
  if (running) return { read: 0, saved: 0, unparsed: 0, atp: 0, challenger: 0, more: false };
  running = true;
  try {
    return await runPoll();
  } finally {
    running = false;
  }
}

async function runPoll(): Promise<PollResult> {
  const client = await connectUserClient();
  if (!client) throw new Error("No hay sesión de Telegram: haz /mto_login en el bot.");

  try {
    const cursor = await getCursor();
    const channel = await findChannel(client, cursor.channelId);
    if (!channel) {
      throw new Error(`No encuentro ningún canal con "${env.mtoChannelTitle}" en el título entre tus chats.`);
    }
    if (channel.id !== cursor.channelId) {
      // Canal nuevo (o primera ejecución): se empieza desde el principio.
      cursor.channelId = channel.id;
      cursor.channelTitle = channel.title;
      cursor.lastMessageId = 0;
    }

    // Lo anterior a 45 días no hace falta: se salta directamente.
    const startId = await lastMessageIdBefore(client, channel.entity, Date.now() - MAX_DAYS_BACK * DAY_MS);
    const { messages, more } = await fetchMessagesAfter(
      client,
      channel.entity,
      Math.max(cursor.lastMessageId, startId),
      MAX_MESSAGES_PER_RUN
    );
    const result: PollResult = {
      read: messages.length,
      saved: 0,
      unparsed: 0,
      atp: 0,
      challenger: 0,
      from: messages[0]?.date,
      to: messages[messages.length - 1]?.date,
      more,
      channel: channel.title,
    };

    const events: MtoEvent[] = [];
    for (const message of messages) {
      const parsed = parseMto(message.text);
      if (parsed) {
        events.push({ id: String(message.id), ...parsed, timestamp: message.date, week: isoWeek(message.date) });
      } else if (message.text.trim()) {
        result.unparsed++;
      }
    }

    const created = await createEvents(events);
    result.saved = created.length;
    for (const event of created) {
      const category = tennisCategory(event);
      if (category) result[category]++;
    }
    if (messages.length) cursor.lastMessageId = messages[messages.length - 1].id;

    await saveCursor(cursor);
    return result;
  } finally {
    await client.disconnect();
  }
}

/** Último aviso de cada jugador con asistencia en los últimos `days` días, con sus patrones. */
export async function buildWatchlist(days: number): Promise<DigestItem[]> {
  const now = Date.now();
  // Se cargan 30 días más para poder calcular "3+ en 30 días" y las semanas seguidas.
  const events = await getEventsSince(now - (days + 30) * DAY_MS);
  const byPlayer = new Map<string, MtoEvent[]>();
  for (const e of events) byPlayer.set(e.playerKey, [...(byPlayer.get(e.playerKey) ?? []), e]);

  const items: DigestItem[] = [];
  for (const playerEvents of byPlayer.values()) {
    // Sin los avisos repetidos del mismo partido, para no tomar uno como "anterior".
    const history = dedupe(playerEvents);
    const last = history[history.length - 1];
    if (now - last.timestamp > days * DAY_MS) continue;
    items.push({ event: last, patterns: detectPatterns(last, history, events) });
  }
  return items;
}

export interface UnparsedGroup {
  count: number;
  example: string;
}

/**
 * Mensajes recientes del canal que no son avisos de asistencia, agrupados
 * por su primera línea (sin números), para ver si hay otro tipo de aviso
 * que el lector se está perdiendo.
 */
export async function findUnparsedMessages(limit: number): Promise<UnparsedGroup[]> {
  const client = await connectUserClient();
  if (!client) throw new Error("No hay sesión de Telegram: haz /mto_login en el bot.");
  try {
    const cursor = await getCursor();
    const channel = await findChannel(client, cursor.channelId);
    if (!channel) throw new Error(`No encuentro ningún canal con "${env.mtoChannelTitle}" en el título.`);

    const groups = new Map<string, UnparsedGroup>();
    for (const message of await fetchLatestMessages(client, channel.entity, limit)) {
      const text = message.text.trim();
      if (!text || parseMto(text)) continue;
      const key = text.split("\n")[0].replace(/\d+/g, "#").slice(0, 60);
      const group = groups.get(key);
      if (group) group.count++;
      else groups.set(key, { count: 1, example: text });
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  } finally {
    await client.disconnect();
  }
}
