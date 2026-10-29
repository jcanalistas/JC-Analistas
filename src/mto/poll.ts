import type { Telegram } from "telegraf";
import { env } from "../config/env";
import { formatDigest, splitMessage, type DigestItem } from "./format";
import { createEvent, getCursor, getEventsSince, getPlayerEvents, getTournamentEvents, saveCursor } from "./mtoStore";
import { parseMto } from "./parseMto";
import { detectPatterns, isDuplicate, isoWeek, type MtoEvent } from "./patterns";
import { connectUserClient, fetchLatestMessages, fetchMessagesAfter, findChannel } from "./userbot";

// Mensajes leídos como máximo por ejecución. La primera vez se carga el
// historial entero del canal en tandas: lo que no quepa se lee en la
// siguiente ejecución, que empieza donde lo dejó esta.
const MAX_MESSAGES_PER_RUN = 3000;
// El canal se lee cada 6 horas. Los avisos más antiguos que esto se guardan
// pero no entran en el resumen: evita un resumen con cientos de avisos al
// cargar el historial, y deja margen si una lectura falla.
const DIGEST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PollResult {
  read: number;
  saved: number;
  /** Asistencias nuevas incluidas en el resumen enviado. */
  inDigest: number;
  unparsed: number;
  /** Quedan mensajes antiguos por leer (se llegó al límite de la tanda). */
  more: boolean;
  channel?: string;
}

let running = false;

export async function pollMtoChannel(telegram: Telegram): Promise<PollResult> {
  // Cloud Scheduler podría solaparse con una ejecución lenta en la misma instancia.
  if (running) return { read: 0, saved: 0, inDigest: 0, unparsed: 0, more: false };
  running = true;
  try {
    return await runPoll(telegram);
  } finally {
    running = false;
  }
}

async function runPoll(telegram: Telegram): Promise<PollResult> {
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

    const { messages, more } = await fetchMessagesAfter(
      client,
      channel.entity,
      cursor.lastMessageId,
      MAX_MESSAGES_PER_RUN
    );
    const result: PollResult = {
      read: messages.length,
      saved: 0,
      inDigest: 0,
      unparsed: 0,
      more,
      channel: channel.title,
    };
    const digest: DigestItem[] = [];

    for (const message of messages) {
      const parsed = parseMto(message.text);
      if (!parsed) {
        if (message.text.trim()) result.unparsed++;
      } else {
        const event: MtoEvent = { id: String(message.id), ...parsed, timestamp: message.date, week: isoWeek(message.date) };
        if (await createEvent(event)) {
          result.saved++;
          if (Date.now() - event.timestamp <= DIGEST_MAX_AGE_MS) {
            const item = await analyze(event);
            if (item) digest.push(item);
          }
        }
      }
      cursor.lastMessageId = message.id;
    }

    await saveCursor(cursor);

    if (digest.length) {
      for (const chunk of splitMessage(formatDigest(digest))) {
        await telegram.sendMessage(env.telegramAllowedUserId, chunk, { parse_mode: "HTML" });
      }
      result.inDigest = digest.length;
    }
    return result;
  } finally {
    await client.disconnect();
  }
}

/** Patrones de un aviso nuevo. Null si es un aviso repetido del mismo partido. */
async function analyze(event: MtoEvent): Promise<DigestItem | null> {
  const history = await getPlayerEvents(event.playerKey);
  if (isDuplicate(event, history)) return null;
  const tournamentEvents = await getTournamentEvents(event.tournamentKey);
  return { event, patterns: detectPatterns(event, history, tournamentEvents) };
}

/** Último aviso de cada jugador con asistencia en los últimos `days` días, con sus patrones. */
export async function buildWatchlist(days: number): Promise<DigestItem[]> {
  const now = Date.now();
  // Se cargan 30 días más para poder calcular "3+ en 30 días" y las semanas seguidas.
  const events = await getEventsSince(now - (days + 30) * DAY_MS);
  const byPlayer = new Map<string, MtoEvent[]>();
  for (const e of events) byPlayer.set(e.playerKey, [...(byPlayer.get(e.playerKey) ?? []), e]);

  const items: DigestItem[] = [];
  for (const history of byPlayer.values()) {
    const last = history.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
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
