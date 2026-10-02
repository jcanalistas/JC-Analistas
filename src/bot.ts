import { Markup, Telegraf, type Context } from "telegraf";
import { env } from "./config/env";
import {
  buildCombinedPrompt,
  formatMadridShortDate,
  FOOTBALL_COMPETITIONS,
  SPORT_LABELS,
  type DateFilter,
  type Sport,
  type TennisCategory,
} from "./config/prompts";
import { composeMontage } from "./montage/composeMontage";
import {
  BOOKIES,
  DEFAULT_BOOKIE,
  formatTicketCaption,
  formatSelectionsSummary,
  parseBookie,
  type BookieId,
  type TicketInfo,
  type TicketSport,
} from "./montage/formatTicketCaption";
import {
  getPendingBets,
  markBetLost,
  markBetWon,
  getStatsSummary,
  formatMoney,
} from "./stats/betsStore";

// Por defecto Telegraf corta el procesamiento de cada update a los 90s
// (handlerTimeout); se desactiva para que un montaje lento de /ticket no
// se corte a medias.
export const bot = new Telegraf(env.telegramBotToken, { handlerTimeout: Infinity });

// Botones fijos debajo del teclado, siempre visibles, en este orden.
const START_BUTTON_TEXT = "🏠 Empezar";
const RESEARCH_BUTTON_TEXT = "🔍 Analizar";
const TICKET_BUTTON_TEXT = "📸 Ticket";
const PENDIENTES_BUTTON_TEXT = "📝 Pendientes";
const STATS_BUTTON_TEXT = "📊 Stats";
const mainKeyboard = Markup.keyboard([
  [START_BUTTON_TEXT, RESEARCH_BUTTON_TEXT, TICKET_BUTTON_TEXT],
  [PENDIENTES_BUTTON_TEXT, STATS_BUTTON_TEXT],
]).resize();

bot.use(async (ctx, next) => {
  // El bot es admin del canal (para poder publicar los montajes), así que
  // también recibe como updates cualquier publicación/actividad del canal
  // (channel_post, etc.) — esas no tienen ctx.from de un usuario normal.
  // Se ignoran en silencio: el bot solo debe reaccionar en su chat privado
  // con el usuario autorizado, nunca contestar dentro del canal.
  if (ctx.chat?.type !== "private") return;

  const userId = ctx.from?.id?.toString();
  if (userId !== env.telegramAllowedUserId) {
    await ctx.reply("No tienes autorización para usar este bot.");
    return;
  }
  return next();
});

async function sendWelcome(ctx: Context) {
  await ctx.reply(
    "Bot de JC Analistas listo.\n\n" +
      "🔍 Analizar — eliges deporte, fecha y competiciones y te devuelvo el prompt de los 3 analistas para pegar en Gemini web.\n" +
      "📸 Ticket — te pide la foto del ticket y una foto de fondo, y te devuelve el montaje.\n" +
      "📝 Pendientes — apuestas registradas a la espera de marcarse ganada/perdida.\n" +
      "📊 Stats — aciertos y beneficio acumulado (stake fijo 50€).",
    mainKeyboard
  );
}

bot.start(sendWelcome);
bot.hears(START_BUTTON_TEXT, sendWelcome);

function sportKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback(SPORT_LABELS.futbol, "research:futbol"),
    Markup.button.callback(SPORT_LABELS.tenis, "research:tenis"),
  ]);
}

async function startResearchFlow(ctx: Context) {

  await ctx.reply("¿Qué deporte analizamos?", sportKeyboard());
}

bot.command("analizar", startResearchFlow);
bot.hears(RESEARCH_BUTTON_TEXT, startResearchFlow);

// Filtro de fecha (hoy / mañana / próximas 24h) elegido por cada usuario,
// antes de la selección de competiciones. Todo el recorrido deporte ->
// fecha -> [fútbol: todas/elegir -> lista de competiciones] vive en UN
// solo mensaje que se va editando, para poder ofrecer "⬅️ Atrás" en cada
// paso sin dejar mensajes duplicados por el camino.
const dateFilterSelection = new Map<number, DateFilter>();

function dateFilterLabel(filter: DateFilter): string {
  if (filter === "hoy") return "Hoy";
  if (filter === "manana") return "Mañana";
  return "Próximas 24h";
}

function dateKeyboard(sport: Sport) {
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return Markup.inlineKeyboard([
    [Markup.button.callback(`📅 Hoy (${formatMadridShortDate(today)})`, `date:hoy:${sport}`)],
    [Markup.button.callback(`📅 Mañana (${formatMadridShortDate(tomorrow)})`, `date:manana:${sport}`)],
    [Markup.button.callback("🕐 Próximas 24h", `date:24h:${sport}`)],
    [Markup.button.callback("⬅️ Atrás", "back:sport")],
  ]);
}

async function showDateStep(ctx: Context, sport: Sport) {
  await ctx.editMessageText(
    `Deporte elegido: ${SPORT_LABELS[sport]}\n\n¿Qué partidos analizamos?`,
    dateKeyboard(sport)
  );
}

// Selección de competiciones de fútbol (opcional) antes de lanzar, por
// usuario: qué ids de FOOTBALL_COMPETITIONS lleva marcados ahora mismo.
const competitionSelection = new Map<number, Set<string>>();

function competitionKeyboard(userId: number) {
  const selected = competitionSelection.get(userId) ?? new Set<string>();
  const rows = FOOTBALL_COMPETITIONS.map((comp) => [
    Markup.button.callback(
      `${selected.has(comp.id) ? "✅" : "⬜"} ${comp.label} ${comp.flag}`,
      `comp:toggle:${comp.id}`
    ),
  ]);
  rows.push([Markup.button.callback("▶️ Generar prompt con esta selección", "comp:confirm")]);
  rows.push([Markup.button.callback("⬅️ Atrás", "back:footbolmode")]);
  return Markup.inlineKeyboard(rows);
}

async function showFootbolModeStep(ctx: Context) {
  await ctx.editMessageText(
    "Deporte elegido: Fútbol ⚽\n\n¿Analizamos todas las competiciones o restringimos a algunas?",
    Markup.inlineKeyboard([
      [Markup.button.callback("✅ Todas las competiciones", "comp:all")],
      [Markup.button.callback("🎯 Elegir competiciones", "comp:pick")],
      [Markup.button.callback("⬅️ Atrás", "back:date:futbol")],
    ])
  );
}

function tennisCategoryLabel(category: TennisCategory): string {
  if (category === "atp") return "ATP";
  if (category === "challenger") return "Challenger";
  return "Todo";
}

function tennisCategoryKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🎾 ATP", "tenniscat:atp")],
    [Markup.button.callback("🏆 Challenger", "tenniscat:challenger")],
    [Markup.button.callback("✅ Todo", "tenniscat:ambos")],
    [Markup.button.callback("⬅️ Atrás", "back:date:tenis")],
  ]);
}

async function showTennisCategoryStep(ctx: Context) {
  await ctx.editMessageText(
    "Deporte elegido: Tenis 🎾\n\n¿Qué categoría de torneos analizamos? (siempre individuales masculinos)",
    tennisCategoryKeyboard()
  );
}

bot.action(/^research:(futbol|tenis)$/, async (ctx) => {
  const sport = ctx.match[1] as Sport;

  await ctx.answerCbQuery();
  await showDateStep(ctx, sport);
});

bot.action("back:sport", async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.delete(ctx.from!.id);
  dateFilterSelection.delete(ctx.from!.id);
  await ctx.editMessageText("¿Qué deporte analizamos?", sportKeyboard());
});

bot.action(/^date:(hoy|manana|24h):(futbol|tenis)$/, async (ctx) => {
  const filter = ctx.match[1] as DateFilter;
  const sport = ctx.match[2] as Sport;

  await ctx.answerCbQuery();
  dateFilterSelection.set(ctx.from!.id, filter);

  if (sport === "tenis") {
    await showTennisCategoryStep(ctx);
    return;
  }

  await showFootbolModeStep(ctx);
});

bot.action(/^back:date:(futbol|tenis)$/, async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.delete(ctx.from!.id);
  await showDateStep(ctx, ctx.match[1] as Sport);
});

bot.action(/^tenniscat:(atp|challenger|ambos)$/, async (ctx) => {
  const category = ctx.match[1] as TennisCategory;

  await ctx.answerCbQuery();

  const dateFilter = dateFilterSelection.get(ctx.from!.id);
  await ctx.editMessageText(
    `Deporte elegido: ${SPORT_LABELS.tenis}\nFecha: ${dateFilterLabel(dateFilter ?? "24h")}\nCategoría: ${tennisCategoryLabel(category)}`
  );
  await sendAnalysisPrompt(ctx, "tenis", undefined, dateFilter, category);
});

bot.action("back:footbolmode", async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.delete(ctx.from!.id);
  await showFootbolModeStep(ctx);
});

bot.action("comp:all", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.editMessageText("Todas las competiciones ✅");
  await sendAnalysisPrompt(ctx, "futbol", undefined, dateFilterSelection.get(ctx.from!.id));
});

bot.action("comp:pick", async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.set(ctx.from!.id, new Set());
  await ctx.editMessageText(
    "Marca las competiciones a analizar y pulsa 'Generar prompt':",
    { reply_markup: competitionKeyboard(ctx.from!.id).reply_markup }
  );
});

bot.action(/^comp:toggle:(\w+)$/, async (ctx) => {
  const id = ctx.match[1];
  const userId = ctx.from!.id;
  const selected = competitionSelection.get(userId) ?? new Set<string>();
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  competitionSelection.set(userId, selected);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(competitionKeyboard(userId).reply_markup);
});

bot.action("comp:confirm", async (ctx) => {
  const userId = ctx.from!.id;
  const selectedIds = competitionSelection.get(userId) ?? new Set<string>();
  if (selectedIds.size === 0) {
    await ctx.answerCbQuery("Marca al menos una, o vuelve atrás y pulsa 'Todas las competiciones'.", {
      show_alert: true,
    });
    return;
  }
  await ctx.answerCbQuery();

  const selectedComps = FOOTBALL_COMPETITIONS.filter((c) => selectedIds.has(c.id));
  const displayLabels = selectedComps.map((c) => c.label);
  const promptLabels = selectedComps.map((c) => c.searchHint ?? c.label);
  competitionSelection.delete(userId);
  await ctx.editMessageText(`Competiciones elegidas: ${displayLabels.join(", ")}`);
  await sendAnalysisPrompt(ctx, "futbol", promptLabels, dateFilterSelection.get(userId));
});

// Límite de Telegram: 4096 caracteres por mensaje. Se deja margen para
// el <pre></pre> y el escapado HTML.
const PROMPT_CHUNK_MAX = 3500;

/** Parte el prompt por párrafos en trozos que quepan en un mensaje de Telegram. */
function splitPrompt(prompt: string): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of prompt.split("\n\n")) {
    // Un párrafo suelto más largo que el límite se parte por líneas.
    const pieces = paragraph.length > PROMPT_CHUNK_MAX ? paragraph.split("\n") : [paragraph];
    const joiner = paragraph.length > PROMPT_CHUNK_MAX ? "\n" : "\n\n";
    for (const piece of pieces) {
      const candidate = current ? `${current}${joiner}${piece}` : piece;
      if (candidate.length > PROMPT_CHUNK_MAX && current) {
        chunks.push(current);
        current = piece;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * /analizar ya no llama a la API de Gemini (el Deep Research dejó de estar
 * en el plan gratuito): genera el prompt de los 3 analistas con la
 * configuración elegida y lo devuelve para copiarlo y pegarlo en Gemini
 * web. Va como archivo .txt (se puede adjuntar tal cual en Gemini) y
 * también troceado en bloques de código, que en Telegram se copian con un
 * toque.
 */
async function sendAnalysisPrompt(
  ctx: Context,
  sport: Sport,
  competitions?: string[],
  dateFilter?: DateFilter,
  tennisCategory?: TennisCategory
) {
  const prompt = buildCombinedPrompt(sport, { competitions, dateFilter, tennisCategory });
  const chunks = splitPrompt(prompt);

  await ctx.reply(
    `📋 Prompt de ${SPORT_LABELS[sport]} listo (${chunks.length} ${chunks.length === 1 ? "parte" : "partes"}).\n\n` +
      "Toca cada bloque para copiarlo y pégalos en orden en el mismo mensaje de Gemini web. " +
      "O, más fácil, adjunta en Gemini el archivo .txt del final y escribe: \"Sigue las instrucciones del archivo adjunto\"."
  );
  for (const [idx, chunk] of chunks.entries()) {
    await ctx.reply(`<b>Parte ${idx + 1}/${chunks.length}</b>\n<pre>${escapeHtml(chunk)}</pre>`, { parse_mode: "HTML" });
  }
  await ctx.replyWithDocument({ source: Buffer.from(prompt, "utf-8"), filename: `prompt-${sport}.txt` });
}

// userId -> id de la apuesta esperando que el usuario escriba la cuota REAL
// obtenida (no la del informe) tras pulsar "✅ Ganada" en /pendientes.
const awaitingRealOdds = new Map<number, string>();

async function showPendingBets(ctx: Context) {
  let bets;
  try {
    bets = await getPendingBets();
  } catch (err) {
    console.error("No se pudieron obtener las apuestas pendientes:", err);
    await ctx.reply("⚠️ No se pudieron obtener las apuestas pendientes. Revisa los logs.");
    return;
  }

  if (bets.length === 0) {
    await ctx.reply("No hay apuestas pendientes de resolver.");
    return;
  }

  for (const bet of bets) {
    const lines = [
      `📌 *${bet.matchup}*`,
      bet.tournament ? `🏟️ ${bet.tournament}` : null,
      `🎯 ${bet.market}`,
      `_${bet.sourceLabel}_`,
    ].filter((l): l is string => l !== null);

    await ctx.reply(lines.join("\n"), {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback("✅ Ganada", `betwon:${bet.id}`),
          Markup.button.callback("❌ Perdida", `betlost:${bet.id}`),
        ],
      ]).reply_markup,
    });
  }
}

bot.command("pendientes", showPendingBets);
bot.hears(PENDIENTES_BUTTON_TEXT, showPendingBets);

bot.action(/^betlost:(.+)$/, async (ctx) => {
  const betId = ctx.match[1];
  try {
    await markBetLost(betId);
    await ctx.answerCbQuery("Marcada como perdida ❌");
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply("❌ Apuesta marcada como perdida (-50€).");
  } catch (err) {
    console.error("No se pudo marcar la apuesta como perdida:", err);
    await ctx.answerCbQuery("⚠️ No se pudo actualizar. Revisa los logs.", { show_alert: true });
  }
});

bot.action(/^betwon:(.+)$/, async (ctx) => {
  const betId = ctx.match[1];
  awaitingRealOdds.set(ctx.from!.id, betId);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await ctx.reply(
    "✅ Marcada como ganada. Mándame la cuota REAL que conseguiste en la casa de apuestas (no la del informe), p.ej. 1,91."
  );
});

function parseOddsInput(text: string): number | null {
  const value = Number(text.replace(",", ".").trim());
  return Number.isFinite(value) && value > 1 ? value : null;
}

async function showStats(ctx: Context) {
  let summary;
  try {
    summary = await getStatsSummary();
  } catch (err) {
    console.error("No se pudieron obtener las estadísticas:", err);
    await ctx.reply("⚠️ No se pudieron obtener las estadísticas. Revisa los logs.");
    return;
  }

  const resolved = summary.won + summary.lost;
  const lines = [
    "📊 *Estadísticas* (stake fijo 50€)",
    "",
    `Apuestas registradas: ${summary.total}`,
    `Pendientes: ${summary.pending}`,
    `Resueltas: ${resolved} (${summary.won} ganadas, ${summary.lost} perdidas)`,
    resolved > 0 ? `Acierto: ${formatMoney(summary.hitRate)}%` : "Acierto: —",
    `Beneficio neto: ${summary.netProfit >= 0 ? "+" : ""}${formatMoney(summary.netProfit)}€`,
  ];

  await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
}

bot.command("stats", showStats);
bot.hears(STATS_BUTTON_TEXT, showStats);

// --- /ticket: superpone la foto del ticket sobre una foto de fondo ---

// Flujo: foto del ticket → foto de fondo → deporte (botones) → texto
// escrito a mano (competición / selecciones / cuota). El texto ya no se lee
// de la imagen con Gemini para no gastar API en cada ticket.
interface MontageState {
  step: "esperando_ticket" | "esperando_fondo" | "esperando_deporte" | "esperando_texto";
  ticketBuffer?: Buffer;
  backgroundBuffer?: Buffer;
  sport?: TicketSport;
}
const montageState = new Map<number, MontageState>();

// Montajes pendientes de publicar en el canal, indexados por el message_id
// del mensaje que el bot le mandó al usuario para revisar.
interface PendingPublish {
  fileId: string;
  caption?: string;
}
const pendingPublish = new Map<number, PendingPublish>();

// El mensaje-resumen ("✅ ... ✅ / Sumamos...") también se puede publicar,
// de forma completamente independiente del montaje: cada botón "Publicar"
// solo afecta a su propio mensaje. Indexado por su propio message_id.
interface PendingSummaryPublish {
  text: string;
}
const pendingSummaryPublish = new Map<number, PendingSummaryPublish>();

// Último fondo enviado por cada usuario, para poder reutilizarlo sin
// tener que volver a mandarlo cada vez.
const lastBackground = new Map<number, Buffer>();

// Usuarios con un montaje ya en marcha ahora mismo: evita que un reenvío
// del mismo update por parte de Telegram (si la respuesta al webhook
// tarda) dispare el montaje por duplicado.
const ticketProcessing = new Set<number>();

async function startTicketFlow(ctx: Context) {
  montageState.set(ctx.from!.id, { step: "esperando_ticket" });
  await ctx.reply(
    "📸 Mándame la foto del ticket (la tarjeta ya recortada, sin fondo blanco alrededor)."
  );
}

bot.command("ticket", startTicketFlow);
bot.hears(TICKET_BUTTON_TEXT, startTicketFlow);

async function downloadTelegramPhoto(ctx: Context): Promise<Buffer> {
  const message = ctx.message as { photo?: Array<{ file_id: string }> } | undefined;
  const photos = message?.photo;
  if (!photos || photos.length === 0) {
    throw new Error("No se encontró ninguna foto en el mensaje.");
  }
  const fileId = photos[photos.length - 1].file_id; // la de mayor resolución
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileLink.href);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

const TICKET_TEXT_INSTRUCTIONS =
  "✍️ Escríbeme los datos del ticket en un solo mensaje, una cosa por línea:\n\n" +
  "Competición\nSelecciones\nCuota total\nCasa de apuestas\n\n" +
  "Ejemplo:\nATP Washington & CH Bonn\nPoljicak + Dalla Valle Set\n1,91\nWH\n\n" +
  "La cuota es opcional (sin ella no se genera el mensaje de beneficio). " +
  `Casa: ${Object.values(BOOKIES)
    .map((b) => b.hint)
    .join(" o ")}; si no la pones, se usa ${BOOKIES[DEFAULT_BOOKIE].label}.`;

async function askTicketSport(ctx: Context) {
  await ctx.reply(
    "🏷️ ¿De qué deporte es el ticket?",
    Markup.inlineKeyboard([
      [Markup.button.callback("🎾 Tenis", "ticketsport:tenis"), Markup.button.callback("⚽ Fútbol", "ticketsport:futbol")],
      [Markup.button.callback("🖼️ Sin texto, solo la imagen", "ticketsport:none")],
    ])
  );
}

/**
 * "ATP Washington\nPoljicak + Dalla Valle Set\n1,91\nWH" → TicketInfo.
 * Las dos primeras líneas son competición y selecciones; las siguientes
 * (cuota y casa, ambas opcionales y en cualquier orden) se reconocen por
 * su contenido. Devuelve un mensaje de error si algo no cuadra.
 */
function parseTicketText(text: string, sport: TicketSport): TicketInfo | { error: string } {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return { error: "Necesito al menos 2 líneas (competición y selecciones)." };
  const [competition, selections, ...rest] = lines;

  let odds = "";
  let bookie: BookieId = DEFAULT_BOOKIE;
  for (const line of rest) {
    const maybeOdds = line.replace(/^@/, "").replace(".", ",").trim();
    if (/^\d+(,\d+)?$/.test(maybeOdds)) {
      odds = maybeOdds;
      continue;
    }
    const parsedBookie = parseBookie(line);
    if (parsedBookie) {
      bookie = parsedBookie;
      continue;
    }
    return { error: `No entiendo la línea "${line}": no es una cuota ni una casa de apuestas conocida.` };
  }
  return { sport, competition, selections, odds, bookie };
}

async function finishTicketMontage(
  ctx: Context,
  userId: number,
  ticketBuffer: Buffer,
  backgroundBuffer: Buffer,
  ticketInfo?: TicketInfo
) {
  await ctx.reply("🎨 Montando la imagen…");
  try {
    const result = await composeMontage(ticketBuffer, backgroundBuffer);

    const caption = ticketInfo ? formatTicketCaption(ticketInfo) : undefined;
    const summary = ticketInfo?.odds ? formatSelectionsSummary(ticketInfo) : undefined;

    const sentMsg = await ctx.replyWithPhoto(
      { source: result },
      caption ? { caption, parse_mode: "HTML" } : undefined
    );

    if (summary) {
      const summaryMsg = await ctx.reply(summary, { parse_mode: "HTML" });
      pendingSummaryPublish.set(summaryMsg.message_id, { text: summary });
      await ctx.telegram.editMessageReplyMarkup(
        summaryMsg.chat.id,
        summaryMsg.message_id,
        undefined,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Publicar", `publishsummary:${summaryMsg.message_id}`)],
          [Markup.button.callback("✏️ Editar", `editsum:${summaryMsg.message_id}`)],
        ]).reply_markup
      );
    }

    const largestPhoto = sentMsg.photo?.at(-1);
    if (largestPhoto) {
      pendingPublish.set(sentMsg.message_id, { fileId: largestPhoto.file_id, caption });
      await ctx.telegram.editMessageReplyMarkup(
        sentMsg.chat.id,
        sentMsg.message_id,
        undefined,
        Markup.inlineKeyboard([
          [Markup.button.callback("✅ Publicar", `publish:${sentMsg.message_id}`)],
          [Markup.button.callback("✏️ Editar", `editcap:${sentMsg.message_id}`)],
        ]).reply_markup
      );
    }
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ No se pudo generar el montaje. Revisa que ambas fotos sean válidas e inténtalo de nuevo con /ticket.");
  } finally {
    montageState.delete(userId);
    ticketProcessing.delete(userId);
  }
}

bot.on("photo", async (ctx) => {
  const state = montageState.get(ctx.from.id);
  if (!state) return; // no hay ningún /ticket en curso, se ignora

  let photoBuffer: Buffer;
  try {
    photoBuffer = await downloadTelegramPhoto(ctx);
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ No pude descargar esa foto, inténtalo de nuevo.");
    return;
  }

  if (state.step === "esperando_ticket") {
    montageState.set(ctx.from.id, { step: "esperando_fondo", ticketBuffer: photoBuffer });
    if (lastBackground.has(ctx.from.id)) {
      await ctx.reply(
        "🖼️ Ticket recibido. Mándame la foto de fondo, o reutiliza la última:",
        Markup.inlineKeyboard([[Markup.button.callback("🔁 Usar el mismo fondo de la última vez", "reusebg")]])
      );
    } else {
      await ctx.reply("🖼️ Ticket recibido. Ahora mándame la foto de fondo.");
    }
    return;
  }

  if (state.step !== "esperando_fondo") {
    await ctx.reply("Ya tengo las dos fotos: ahora elige el deporte o escríbeme los datos del ticket.");
    return;
  }

  lastBackground.set(ctx.from.id, photoBuffer);
  montageState.set(ctx.from.id, { ...state, step: "esperando_deporte", backgroundBuffer: photoBuffer });
  await askTicketSport(ctx);
});

bot.action("reusebg", async (ctx) => {
  const userId = ctx.from!.id;
  const state = montageState.get(userId);
  const background = lastBackground.get(userId);
  if (!state || state.step !== "esperando_fondo" || !background) {
    await ctx.answerCbQuery("Ya no aplica: manda la foto del ticket de nuevo con /ticket.");
    return;
  }
  montageState.set(userId, { ...state, step: "esperando_deporte", backgroundBuffer: background });
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await askTicketSport(ctx);
});

bot.action(/^ticketsport:(tenis|futbol|none)$/, async (ctx) => {
  const userId = ctx.from!.id;
  const state = montageState.get(userId);
  if (!state || state.step !== "esperando_deporte") {
    await ctx.answerCbQuery("Ya no aplica: empieza de nuevo con /ticket.");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);

  const choice = ctx.match[1];
  if (choice === "none") {
    if (ticketProcessing.has(userId)) return;
    ticketProcessing.add(userId);
    // Sin await a propósito: si el montaje tardara, Telegram podría reenviar
    // el mismo update al no recibir respuesta a tiempo.
    finishTicketMontage(ctx, userId, state.ticketBuffer!, state.backgroundBuffer!).catch((err) => {
      console.error("Fallo inesperado montando el ticket:", err);
      ticketProcessing.delete(userId);
    });
    return;
  }

  montageState.set(userId, { ...state, step: "esperando_texto", sport: choice as TicketSport });
  await ctx.reply(TICKET_TEXT_INSTRUCTIONS);
});

bot.action(/^publish:(\d+)$/, async (ctx) => {
  const messageId = Number(ctx.match[1]);
  const pending = pendingPublish.get(messageId);
  if (!pending) {
    await ctx.answerCbQuery("Este montaje ya se publicó o ha caducado.");
    return;
  }

  try {
    await ctx.telegram.sendPhoto(
      env.telegramChannelId,
      pending.fileId,
      pending.caption ? { caption: pending.caption, parse_mode: "HTML" } : undefined
    );
    pendingPublish.delete(messageId);
    await ctx.answerCbQuery("Publicado en el canal ✅");
    await ctx.editMessageReplyMarkup(undefined);
  } catch (err) {
    console.error("No se pudo publicar en el canal:", err);
    await ctx.answerCbQuery("⚠️ No se pudo publicar. ¿Es el bot admin del canal?", { show_alert: true });
  }
});

bot.action(/^publishsummary:(\d+)$/, async (ctx) => {
  const messageId = Number(ctx.match[1]);
  const pending = pendingSummaryPublish.get(messageId);
  if (!pending) {
    await ctx.answerCbQuery("Este mensaje ya se publicó o ha caducado.");
    return;
  }

  try {
    await ctx.telegram.sendMessage(env.telegramChannelId, pending.text, { parse_mode: "HTML" });
    pendingSummaryPublish.delete(messageId);
    await ctx.answerCbQuery("Publicado en el canal ✅");
    await ctx.editMessageReplyMarkup(undefined);
  } catch (err) {
    console.error("No se pudo publicar el resumen en el canal:", err);
    await ctx.answerCbQuery("⚠️ No se pudo publicar. ¿Es el bot admin del canal?", { show_alert: true });
  }
});

// userId -> message_id del montaje/resumen cuyo texto está esperando ser
// reemplazado. Son dos mapas separados porque uno edita el caption de una
// foto (editMessageCaption) y el otro el texto de un mensaje normal
// (editMessageText) — son llamadas de API distintas.
const editingCaption = new Map<number, number>();
const editingSummary = new Map<number, number>();

bot.action(/^editcap:(\d+)$/, async (ctx) => {
  const messageId = Number(ctx.match[1]);
  if (!pendingPublish.has(messageId)) {
    await ctx.answerCbQuery("Este montaje ya se publicó o ha caducado.");
    return;
  }
  editingCaption.set(ctx.from!.id, messageId);
  await ctx.answerCbQuery();
  await ctx.reply(
    "✏️ Mándame el texto nuevo para este montaje (puedes usar HTML: <u>, <b>, <i>, <a href=\"...\">)."
  );
});

bot.action(/^editsum:(\d+)$/, async (ctx) => {
  const messageId = Number(ctx.match[1]);
  if (!pendingSummaryPublish.has(messageId)) {
    await ctx.answerCbQuery("Este mensaje ya se publicó o ha caducado.");
    return;
  }
  editingSummary.set(ctx.from!.id, messageId);
  await ctx.answerCbQuery();
  await ctx.reply("✏️ Mándame el texto nuevo para el resumen (puedes usar HTML: <u>, <b>, <i>).");
});

bot.on("text", async (ctx) => {
  const ticketState = montageState.get(ctx.from.id);
  if (ticketState?.step === "esperando_texto") {
    const ticketInfo = parseTicketText(ctx.message.text, ticketState.sport!);
    if ("error" in ticketInfo) {
      await ctx.reply(`⚠️ ${ticketInfo.error}\n\n${TICKET_TEXT_INSTRUCTIONS}`);
      return;
    }
    if (ticketProcessing.has(ctx.from.id)) return; // ya está montándose (posible reenvío de Telegram), se ignora
    ticketProcessing.add(ctx.from.id);
    // Sin await a propósito, mismo motivo que en ticketsport.
    finishTicketMontage(ctx, ctx.from.id, ticketState.ticketBuffer!, ticketState.backgroundBuffer!, ticketInfo).catch(
      (err) => {
        console.error("Fallo inesperado montando el ticket:", err);
        ticketProcessing.delete(ctx.from.id);
      }
    );
    return;
  }

  const betIdAwaitingOdds = awaitingRealOdds.get(ctx.from.id);
  if (betIdAwaitingOdds !== undefined) {
    awaitingRealOdds.delete(ctx.from.id);

    const oddsValue = parseOddsInput(ctx.message.text);
    if (oddsValue === null) {
      await ctx.reply(
        "⚠️ No entendí esa cuota. Vuelve a pulsar '✅ Ganada' en /pendientes e inténtalo de nuevo, p.ej. 1,91."
      );
      return;
    }

    try {
      const profit = await markBetWon(betIdAwaitingOdds, oddsValue);
      await ctx.reply(`✅ Apuesta ganada @${ctx.message.text.trim()}. Beneficio: +${formatMoney(profit)}€.`);
    } catch (err) {
      console.error("No se pudo marcar la apuesta como ganada:", err);
      await ctx.reply("⚠️ No se pudo actualizar la apuesta. Revisa los logs.");
    }
    return;
  }

  const summaryMessageId = editingSummary.get(ctx.from.id);
  if (summaryMessageId !== undefined) {
    editingSummary.delete(ctx.from.id);

    const pending = pendingSummaryPublish.get(summaryMessageId);
    if (!pending) {
      await ctx.reply("⚠️ Ese mensaje ya no está disponible para editar.");
      return;
    }

    const newText = ctx.message.text;
    try {
      await ctx.telegram.editMessageText(ctx.chat.id, summaryMessageId, undefined, newText, {
        parse_mode: "HTML",
      });
      pending.text = newText;
      await ctx.reply("✏️ Texto actualizado.");
    } catch (err) {
      console.error("No se pudo actualizar el resumen:", err);
      await ctx.reply(
        "⚠️ No pude actualizar el texto (¿formato HTML inválido?). Pulsa 'Editar' de nuevo para reintentar."
      );
    }
    return;
  }

  const messageId = editingCaption.get(ctx.from.id);
  if (messageId === undefined) return; // no hay ninguna edición de texto en curso, se ignora
  editingCaption.delete(ctx.from.id);

  const pending = pendingPublish.get(messageId);
  if (!pending) {
    await ctx.reply("⚠️ Ese montaje ya no está disponible para editar.");
    return;
  }

  const newCaption = ctx.message.text;
  try {
    await ctx.telegram.editMessageCaption(ctx.chat.id, messageId, undefined, newCaption, {
      parse_mode: "HTML",
    });
    pending.caption = newCaption;
    await ctx.reply("✏️ Texto actualizado.");
  } catch (err) {
    console.error("No se pudo actualizar el texto del montaje:", err);
    await ctx.reply(
      "⚠️ No pude actualizar el texto (¿formato HTML inválido?). Pulsa 'Editar' de nuevo para reintentar."
    );
  }
});
