import { Markup, Telegraf, type Context } from "telegraf";
import { env } from "./config/env";
import {
  buildAllPrompts,
  formatMadridShortDate,
  FOOTBALL_COMPETITIONS,
  SPORT_LABELS,
  type DateFilter,
  type Sport,
  type TennisCategory,
} from "./config/prompts";
import { runDeepResearch, DeepResearchError, type DeepResearchResult } from "./gemini/deepResearch";
import {
  parseSelections,
  parseCombinadaLegs,
  findRepeatedSelections,
  findRepeatedMatchupsWithDifferentMarkets,
  type Selection,
} from "./matching/matchSelections";
import { suggestCombinada } from "./matching/suggestCombinada";
import {
  formatIndividualSelections,
  formatRepeatedSelections,
  formatMixedMarketMatchups,
  formatCombinadaSuggestion,
  type FormattedBetEntry,
} from "./format/telegramFormat";
import { composeMontage } from "./montage/composeMontage";
import { analyzeTicket } from "./montage/analyzeTicket";
import { formatTicketCaption, formatSelectionsSummary } from "./montage/formatTicketCaption";
import {
  createPendingBet,
  getPendingBets,
  markBetLost,
  markBetWon,
  getStatsSummary,
  formatMoney,
  type BetCandidate,
} from "./stats/betsStore";
import { randomUUID } from "node:crypto";

// Por defecto Telegraf corta el procesamiento de cada update a los 90s
// (handlerTimeout), lo que interrumpía /ticket (búsqueda en Google) y
// habría interrumpido igualmente /analizar de no ser porque ya tiene su
// propio límite en deepResearch.ts. Lo desactivamos aquí y cada llamada
// larga a Gemini se limita a sí misma con su propio timeout.
export const bot = new Telegraf(env.telegramBotToken, { handlerTimeout: Infinity });

let researchInProgress = false;

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
      "🔍 Analizar — lanza los 3 Deep Research en Gemini y compara las selecciones.\n" +
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
  if (researchInProgress) {
    await ctx.reply("Ya hay un Deep Research en curso, espera a que termine antes de lanzar otro.");
    return;
  }

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
  rows.push([Markup.button.callback("▶️ Lanzar con esta selección", "comp:confirm")]);
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

  if (researchInProgress) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
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

  if (researchInProgress) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
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

  if (researchInProgress) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
  await ctx.answerCbQuery();

  const dateFilter = dateFilterSelection.get(ctx.from!.id);
  await ctx.editMessageText(
    `Deporte elegido: ${SPORT_LABELS.tenis}\nFecha: ${dateFilterLabel(dateFilter ?? "24h")}\nCategoría: ${tennisCategoryLabel(category)}`
  );
  await launchResearch(ctx, "tenis", undefined, dateFilter, category);
});

bot.action("back:footbolmode", async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.delete(ctx.from!.id);
  await showFootbolModeStep(ctx);
});

bot.action("comp:all", async (ctx) => {
  if (researchInProgress) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText("Todas las competiciones ✅");
  await launchResearch(ctx, "futbol", undefined, dateFilterSelection.get(ctx.from!.id));
});

bot.action("comp:pick", async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.set(ctx.from!.id, new Set());
  await ctx.editMessageText(
    "Marca las competiciones a analizar y pulsa 'Lanzar':",
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
  if (researchInProgress) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
  await ctx.answerCbQuery();

  const labels = FOOTBALL_COMPETITIONS.filter((c) => selectedIds.has(c.id)).map((c) => c.label);
  competitionSelection.delete(userId);
  await ctx.editMessageText(`Competiciones elegidas: ${labels.join(", ")}`);
  await launchResearch(ctx, "futbol", labels, dateFilterSelection.get(userId));
});

// Firma común de ctx.reply — así runResearch() sirve tanto para el flujo
// interactivo (pasando ctx.reply) como para el disparo programado (pasando
// una función que manda directamente al chat privado del usuario, sin ctx).
type ReplyFn = (text: string, extra?: Record<string, unknown>) => Promise<unknown>;

async function launchResearch(
  ctx: Context,
  sport: Sport,
  competitions?: string[],
  dateFilter?: DateFilter,
  tennisCategory?: TennisCategory
) {
  await runResearch((text, extra) => ctx.reply(text, extra), sport, competitions, dateFilter, tennisCategory);
}

async function runResearch(
  reply: ReplyFn,
  sport: Sport,
  competitions?: string[],
  dateFilter?: DateFilter,
  tennisCategory?: TennisCategory
) {
  if (researchInProgress) {
    await reply("Ya hay un Deep Research en curso, espera a que termine antes de lanzar otro.");
    return;
  }

  researchInProgress = true;
  try {
    const categoryNote = sport === "tenis" && tennisCategory ? `, ${tennisCategoryLabel(tennisCategory)}` : "";
    await reply(
      `🔎 Lanzando los 3 Deep Research de ${SPORT_LABELS[sport]} (${dateFilterLabel(dateFilter ?? "24h")}${categoryNote}) en Gemini, te aviso según vaya terminando cada uno.`
    );

    const promptDefs = buildAllPrompts(sport, { competitions, dateFilter, tennisCategory });
    // En paralelo: cada uno es una llamada de API independiente (no hay
    // ninguna sesión de navegador compartida que pueda saturarse).
    // allSettled en vez de all: si un perfil falla (cuota, timeout...) no
    // queremos perder los otros dos que sí hayan terminado.
    const settled = await Promise.allSettled(
      promptDefs.map(async ({ label, prompt }) => {
        const result = await runDeepResearch(prompt, {
          apiKey: env.geminiApiKey,
          agent: env.geminiDeepResearchAgent,
          timeoutMinutes: env.deepResearchTimeoutMinutes,
        });
        await reply(`✅ ${label} completado.`);
        return { label, result };
      })
    );

    const successful: Array<{ label: string; result: DeepResearchResult }> = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") {
        successful.push(outcome.value);
      } else {
        const reason = outcome.reason;
        const message = reason instanceof DeepResearchError ? reason.message : describeError(reason);
        console.error("Un perfil de /analizar falló:", reason);
        await reply(`⚠️ Ese perfil falló: ${message}`);
      }
    }

    if (successful.length === 0) {
      await reply("⚠️ Los 3 Deep Research fallaron, no hay nada que mostrar.");
      return;
    }

    const labels = successful.map((s) => s.label);
    const selectionsBySource: Selection[][] = successful.map((s, idx) =>
      parseSelections(s.result.reportText, idx, s.label)
    );

    for (const chunk of formatIndividualSelections(labels, selectionsBySource)) {
      await reply(chunk, { parse_mode: "Markdown" });
    }

    const allSelections = selectionsBySource.flat();
    const repeatedGroups = findRepeatedSelections(allSelections);
    await sendBetEntries(reply, formatRepeatedSelections(repeatedGroups));

    const mixedMarketGroups = findRepeatedMatchupsWithDifferentMarkets(allSelections);
    await sendBetEntries(reply, formatMixedMarketMatchups(mixedMarketGroups));

    const promptedCombinadas = successful.map((s) => ({
      label: s.label,
      legs: parseCombinadaLegs(s.result.reportText),
    }));
    const combinada = suggestCombinada(allSelections, promptedCombinadas);
    await sendBetEntries(reply, formatCombinadaSuggestion(combinada));
  } catch (err) {
    if (err instanceof DeepResearchError) {
      await reply(`⚠️ Error ejecutando Deep Research: ${err.message}`);
    } else {
      console.error(err);
      await reply("⚠️ Ocurrió un error inesperado ejecutando los Deep Research. Revisa los logs.");
    }
  } finally {
    researchInProgress = false;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Candidatos a apuesta pendientes de que el usuario pulse "📝 Registrar
// apuesta" en su propio mensaje, indexados por un token aleatorio (no por
// message_id: así el mismo helper vale tanto para ctx.reply como para el
// envío programado, que no comparten el mismo tipo de mensaje).
const pendingBetRegistration = new Map<string, BetCandidate>();

/** Manda cada entrada como su PROPIO mensaje, con botón de registrar apuesta si trae datos de apuesta. */
async function sendBetEntries(reply: ReplyFn, entries: FormattedBetEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.bet) {
      await reply(entry.text, { parse_mode: "Markdown" });
      continue;
    }
    const token = randomUUID();
    pendingBetRegistration.set(token, entry.bet);
    await reply(entry.text, {
      parse_mode: "Markdown",
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback("📝 Registrar apuesta", `regbet:${token}`)],
      ]).reply_markup,
    });
  }
}

bot.action(/^regbet:(.+)$/, async (ctx) => {
  const token = ctx.match[1];
  const candidate = pendingBetRegistration.get(token);
  if (!candidate) {
    await ctx.answerCbQuery("Esta apuesta ya se registró o el botón ha caducado.");
    return;
  }
  pendingBetRegistration.delete(token);

  try {
    await createPendingBet(candidate);
    await ctx.answerCbQuery("Apuesta registrada ✅");
    await ctx.editMessageReplyMarkup(undefined);
    await ctx.reply("📝 Apuesta registrada como pendiente. Usa /pendientes para marcarla como ganada o perdida.");
  } catch (err) {
    console.error("No se pudo registrar la apuesta:", err);
    await ctx.answerCbQuery("⚠️ No se pudo registrar la apuesta. Revisa los logs.", { show_alert: true });
  }
});

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

/** Lanzado desde fuera de Telegram (ver server.ts): /analizar de tenis automático a las 7:00. */
export async function runScheduledTennisAnalysis(): Promise<void> {
  const reply: ReplyFn = (text, extra) => bot.telegram.sendMessage(env.telegramAllowedUserId, text, extra);
  await reply("⏰ Análisis automático de tenis (7:00) empezando...");
  await runResearch(reply, "tenis", undefined, "hoy");
}

// --- /ticket: superpone la foto del ticket sobre una foto de fondo ---

interface MontageState {
  step: "esperando_ticket" | "esperando_fondo";
  ticketBuffer?: Buffer;
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

async function finishTicketMontage(ctx: Context, userId: number, ticketBuffer: Buffer, backgroundBuffer: Buffer) {
  await ctx.reply("🎨 Montando la imagen…");
  try {
    const result = await composeMontage(ticketBuffer, backgroundBuffer);

    let caption: string | undefined;
    let summary: string | undefined;
    try {
      const ticketInfo = await analyzeTicket(ticketBuffer, env.geminiApiKey);
      caption = formatTicketCaption(ticketInfo);
      if (ticketInfo.odds) summary = formatSelectionsSummary(ticketInfo);
    } catch (err) {
      console.error("No se pudo analizar el ticket para generar el texto:", err);
      await ctx.reply("⚠️ No pude leer los datos del ticket, te mando la imagen sin el texto.");
    }

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

  // step === "esperando_fondo"
  lastBackground.set(ctx.from.id, photoBuffer);
  await finishTicketMontage(ctx, ctx.from.id, state.ticketBuffer!, photoBuffer);
});

bot.action("reusebg", async (ctx) => {
  const userId = ctx.from!.id;
  const state = montageState.get(userId);
  const background = lastBackground.get(userId);
  if (!state || state.step !== "esperando_fondo" || !background) {
    await ctx.answerCbQuery("Ya no aplica: manda la foto del ticket de nuevo con /ticket.");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  await finishTicketMontage(ctx, userId, state.ticketBuffer!, background);
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
