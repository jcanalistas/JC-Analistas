import type { Telegram } from "telegraf";
import { env } from "../config/env";
import { formatAlert } from "./format";
import { createEvent, getCursor, getPlayerEvents, getTournamentEvents, saveCursor } from "./mtoStore";
import { parseMto } from "./parseMto";
import { detectPatterns, isDuplicate, isoWeek, type MtoEvent } from "./patterns";
import { connectUserClient, fetchMessagesAfter, findChannel } from "./userbot";

// Mensajes leídos como máximo por ejecución. La primera vez se carga el
// historial entero del canal en tandas: lo que no quepa se lee en la
// siguiente ejecución, que empieza donde lo dejó esta.
const MAX_MESSAGES_PER_RUN = 3000;
// Avisos más antiguos que esto se guardan pero no generan alerta: evita
// recibir cientos de alertas al cargar el historial.
const ALERT_MAX_AGE_MS = 3 * 60 * 60 * 1000;

export interface PollResult {
  read: number;
  saved: number;
  alerts: number;
  unparsed: number;
  channel?: string;
}

let running = false;

export async function pollMtoChannel(telegram: Telegram): Promise<PollResult> {
  // Cloud Scheduler podría solaparse con una ejecución lenta en la misma instancia.
  if (running) return { read: 0, saved: 0, alerts: 0, unparsed: 0 };
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

    const messages = await fetchMessagesAfter(client, channel.entity, cursor.lastMessageId, MAX_MESSAGES_PER_RUN);
    const result: PollResult = { read: messages.length, saved: 0, alerts: 0, unparsed: 0, channel: channel.title };

    for (const message of messages) {
      const parsed = parseMto(message.text);
      if (!parsed) {
        if (message.text.trim()) result.unparsed++;
      } else {
        const event: MtoEvent = { id: String(message.id), ...parsed, timestamp: message.date, week: isoWeek(message.date) };
        if (await createEvent(event)) {
          result.saved++;
          if (Date.now() - event.timestamp <= ALERT_MAX_AGE_MS && (await maybeAlert(telegram, event))) {
            result.alerts++;
          }
        }
      }
      cursor.lastMessageId = message.id;
    }

    await saveCursor(cursor);
    return result;
  } finally {
    await client.disconnect();
  }
}

async function maybeAlert(telegram: Telegram, event: MtoEvent): Promise<boolean> {
  const history = await getPlayerEvents(event.playerKey);
  if (isDuplicate(event, history)) return false;

  const tournamentEvents = await getTournamentEvents(event.tournamentKey);
  const patterns = detectPatterns(event, history, tournamentEvents);
  if (!patterns.alert) return false;

  await telegram.sendMessage(env.telegramAllowedUserId, formatAlert(event, patterns), { parse_mode: "HTML" });
  return true;
}
