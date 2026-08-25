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
import { createDeepResearchInteraction, pollDeepResearchOnce, DeepResearchError } from "./gemini/deepResearch";
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
  createBetCandidate,
  consumeBetCandidate,
  createPendingBet,
  getPendingBets,
  markBetLost,
  markBetWon,
  getStatsSummary,
  formatMoney,
} from "./stats/betsStore";
import {
  createResearchJob,
  getUnresolvedResearchJobs,
  hasUnresolvedResearchJob,
  updateResearchJob,
  deleteResearchJob,
  type ResearchJob,
  type ResearchJobProfile,
} from "./stats/researchJobs";
import { randomUUID } from "node:crypto";

// Por defecto Telegraf corta el procesamiento de cada update a los 90s
// (handlerTimeout), lo que interrumpía /ticket (búsqueda en Google) y
// habría interrumpido igualmente /analizar de no ser porque ya tiene su
// propio límite en deepResearch.ts. Lo desactivamos aquí y cada llamada
// larga a Gemini se limita a sí misma con su propio timeout.
export const bot = new Telegraf(env.telegramBotToken, { handlerTimeout: Infinity });

// Botones fijos debajo del teclado, siempre visibles, en este orden.
const START_BUTTON_TEXT = "🏠 Empezar";
const RESEARCH_BUTTON_TEXT = "🔍 Analizar";
const TICKET_BUTTON_TEXT = "📸 Ticket";
const PENDIENTES_BUTTON_TEXT = "📝 Pendientes";
const STATS_BUTTON_TEXT = "📊 Stats";
const CANCELAR_BUTTON_TEXT = "❌ Cancelar análisis";
const mainKeyboard = Markup.keyboard([
  [START_BUTTON_TEXT, RESEARCH_BUTTON_TEXT, TICKET_BUTTON_TEXT],
  [PENDIENTES_BUTTON_TEXT, STATS_BUTTON_TEXT],
  [CANCELAR_BUTTON_TEXT],
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
      "📊 Stats — aciertos y beneficio acumulado (stake fijo 50€).\n" +
      "❌ Cancelar análisis — si un /analizar se queda colgado, lo cancela para poder lanzar otro.",
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
  if (await hasUnresolvedResearchJob()) {
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

  if (await hasUnresolvedResearchJob()) {
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

  if (await hasUnresolvedResearchJob()) {
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

  if (await hasUnresolvedResearchJob()) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
  await ctx.answerCbQuery();

  const dateFilter = dateFilterSelection.get(ctx.from!.id);
  await ctx.editMessageText(
    `Deporte elegido: ${SPORT_LABELS.tenis}\nFecha: ${dateFilterLabel(dateFilter ?? "24h")}\nCategoría: ${tennisCategoryLabel(category)}`
  );
  await launchResearchJob(ctx, "tenis", undefined, dateFilter, category);
});

bot.action("back:footbolmode", async (ctx) => {
  await ctx.answerCbQuery();
  competitionSelection.delete(ctx.from!.id);
  await showFootbolModeStep(ctx);
});

bot.action("comp:all", async (ctx) => {
  if (await hasUnresolvedResearchJob()) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
  await ctx.answerCbQuery();
  await ctx.editMessageText("Todas las competiciones ✅");
  await launchResearchJob(ctx, "futbol", undefined, dateFilterSelection.get(ctx.from!.id));
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
  if (await hasUnresolvedResearchJob()) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }
  await ctx.answerCbQuery();

  const selectedComps = FOOTBALL_COMPETITIONS.filter((c) => selectedIds.has(c.id));
  const displayLabels = selectedComps.map((c) => c.label);
  const promptLabels = selectedComps.map((c) => c.searchHint ?? c.label);
  competitionSelection.delete(userId);
  await ctx.editMessageText(`Competiciones elegidas: ${displayLabels.join(", ")}`);
  await launchResearchJob(ctx, "futbol", promptLabels, dateFilterSelection.get(userId));
});

// Firma común de "responder" — la usan sendFinalResults/sendBetEntries,
// que sirven tanto para el flujo interactivo como para el sondeo
// programado (siempre mandando directamente al chat guardado en el job,
// nunca dependiendo de un ctx en concreto).
type ReplyFn = (text: string, extra?: Record<string, unknown>) => Promise<unknown>;

/**
 * Crea las 3 interacciones en Gemini (tarda segundos, no minutos) y guarda
 * el job en Firestore. NO espera a que Gemini termine — eso lo hace
 * pollAllResearchJobs(), llamado periódicamente desde fuera (ver
 * /internal/poll-research en server.ts). Así el proceso que lanza
 * /analizar no necesita seguir vivo los 20-30 minutos que puede tardar
 * Gemini: si Cloud Run recicla el contenedor por el camino, el progreso
 * ya guardado en Firestore no se pierde, y el siguiente sondeo continúa
 * donde se quedó.
 */
async function createAndStoreResearchJob(
  chatId: number,
  sport: Sport,
  options: {
    competitions?: string[];
    dateFilter?: DateFilter;
    tennisCategory?: TennisCategory;
    scheduled: boolean;
  }
): Promise<void> {
  const promptDefs = buildAllPrompts(sport, options);
  // En paralelo: cada uno es una llamada de API independiente. allSettled
  // en vez de all: si un perfil falla al crearse (cuota, timeout...) no
  // queremos perder los otros dos que sí se hayan podido lanzar.
  const created = await Promise.allSettled(
    promptDefs.map(({ prompt }) =>
      createDeepResearchInteraction(prompt, { apiKey: env.geminiApiKey, agent: env.geminiDeepResearchAgent })
    )
  );

  const profiles: ResearchJobProfile[] = [];
  for (const [idx, { label }] of promptDefs.entries()) {
    const outcome = created[idx];
    if (outcome.status === "fulfilled") {
      profiles.push({ label, interactionId: outcome.value, status: "pending", notified: false });
      continue;
    }
    const reason = outcome.reason;
    const message = reason instanceof DeepResearchError ? reason.message : describeError(reason);
    console.error(`No se pudo crear la interacción de Gemini para ${label}:`, reason);
    // Se avisa ya mismo (en vez de esperar al siguiente sondeo, hasta 1-2
    // min después) porque no hace falta esperar a nada: ya sabemos que
    // este perfil ha fallado del todo.
    await bot.telegram.sendMessage(chatId, `⚠️ Ese perfil falló: ${message}`);
    profiles.push({ label, status: "failed", errorMessage: message, notified: true });
  }

  await createResearchJob({
    chatId,
    sport,
    dateFilter: options.dateFilter,
    tennisCategory: options.tennisCategory,
    competitions: options.competitions,
    scheduled: options.scheduled,
    createdAt: Date.now(),
    deadline: Date.now() + env.deepResearchTimeoutMinutes * 60_000,
    profiles,
    resultsSent: false,
  });
}

async function launchResearchJob(
  ctx: Context,
  sport: Sport,
  competitions?: string[],
  dateFilter?: DateFilter,
  tennisCategory?: TennisCategory
) {
  if (await hasUnresolvedResearchJob()) {
    await ctx.reply("Ya hay un Deep Research en curso, espera a que termine antes de lanzar otro.");
    return;
  }

  const categoryNote = sport === "tenis" && tennisCategory ? `, ${tennisCategoryLabel(tennisCategory)}` : "";
  await ctx.reply(
    `🔎 Lanzando los 3 Deep Research de ${SPORT_LABELS[sport]} (${dateFilterLabel(dateFilter ?? "24h")}${categoryNote}) en Gemini, te aviso según vaya terminando cada uno.`
  );

  try {
    await createAndStoreResearchJob(ctx.chat!.id, sport, { competitions, dateFilter, tennisCategory, scheduled: false });
  } catch (err) {
    console.error("No se pudo lanzar el análisis:", err);
    await ctx.reply("⚠️ Ocurrió un error inesperado lanzando el análisis. Revisa los logs.");
  }
}

/** Manda los mensajes finales (Selecciones/Recomendaciones/Mismo partido/Combinada) de un job ya resuelto. */
async function sendFinalResults(job: ResearchJob): Promise<void> {
  const reply: ReplyFn = (text, extra) => bot.telegram.sendMessage(job.chatId, text, extra);
  const successful = job.profiles.filter(
    (p): p is ResearchJobProfile & { reportText: string } => p.status === "completed" && !!p.reportText
  );

  if (successful.length === 0) {
    await reply("⚠️ Los 3 Deep Research fallaron, no hay nada que mostrar.");
    return;
  }

  const labels = successful.map((s) => s.label);
  const selectionsBySource: Selection[][] = successful.map((s, idx) => parseSelections(s.reportText, idx, s.label));

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
    legs: parseCombinadaLegs(s.reportText),
  }));
  const combinada = suggestCombinada(allSelections, promptedCombinadas);
  await sendBetEntries(reply, formatCombinadaSuggestion(combinada));
}

/** Lanzado periódicamente desde /internal/poll-research (Cloud Scheduler, cada 1-2 min). */
export async function pollAllResearchJobs(): Promise<void> {
  const jobs = await getUnresolvedResearchJobs();
  for (const job of jobs) {
    try {
      await pollResearchJob(job);
    } catch (err) {
      console.error(`Fallo sondeando el job de research ${job.id}:`, err);
    }
  }
}

async function pollResearchJob(job: ResearchJob): Promise<void> {
  let changed = false;

  for (const profile of job.profiles) {
    if (profile.status !== "pending") continue;

    if (Date.now() > job.deadline) {
      profile.status = "failed";
      profile.errorMessage =
        `Gemini no terminó el informe en ${env.deepResearchTimeoutMinutes} minutos. ` +
        `Puedes subir DEEP_RESEARCH_TIMEOUT_MINUTES si tus investigaciones tardan más.`;
      changed = true;
      continue;
    }

    if (!profile.interactionId) continue; // no debería pasar (pending sin interactionId); por si acaso no se toca

    const outcome = await pollDeepResearchOnce(profile.interactionId, { apiKey: env.geminiApiKey });
    if (outcome.status === "completed") {
      profile.status = "completed";
      profile.reportText = outcome.reportText;
      changed = true;
    } else if (outcome.status === "failed") {
      profile.status = "failed";
      profile.errorMessage = outcome.message;
      changed = true;
    }
    // "running": no cambia nada, se reintenta en el siguiente sondeo.
  }

  for (const profile of job.profiles) {
    if (profile.status !== "pending" && !profile.notified) {
      const text =
        profile.status === "completed" ? `✅ ${profile.label} completado.` : `⚠️ Ese perfil falló: ${profile.errorMessage}`;
      await bot.telegram.sendMessage(job.chatId, text);
      profile.notified = true;
      changed = true;
    }
  }

  // Se guarda el progreso de los perfiles ANTES de intentar mandar los
  // mensajes finales: si sendFinalResults fallara a medias, no queremos
  // perder ni repetir los avisos "✅/⚠️" de cada perfil ya notificados.
  if (changed) {
    await updateResearchJob(job);
  }

  const allSettled = job.profiles.every((p) => p.status !== "pending");
  if (allSettled && !job.resultsSent) {
    await sendFinalResults(job);
    job.resultsSent = true;
    await updateResearchJob(job);
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Manda cada entrada como su PROPIO mensaje, con botón de registrar apuesta si trae datos de apuesta. */
async function sendBetEntries(reply: ReplyFn, entries: FormattedBetEntry[]): Promise<void> {
  for (const entry of entries) {
    if (!entry.bet) {
      await reply(entry.text, { parse_mode: "Markdown" });
      continue;
    }

    // El candidato se guarda en Firestore (no en memoria): Cloud Run puede
    // reciclar el contenedor por inactividad en pocos minutos, mucho antes
    // de que el usuario vuelva a mirar el móvil y pulse el botón.
    const token = randomUUID();
    try {
      await createBetCandidate(token, entry.bet);
      await reply(entry.text, {
        parse_mode: "Markdown",
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback("📝 Registrar apuesta", `regbet:${token}`)],
        ]).reply_markup,
      });
    } catch (err) {
      console.error("No se pudo guardar el candidato a apuesta:", err);
      await reply(entry.text, { parse_mode: "Markdown" });
    }
  }
}

bot.action(/^regbet:(.+)$/, async (ctx) => {
  const token = ctx.match[1];
  try {
    const candidate = await consumeBetCandidate(token);
    if (!candidate) {
      await ctx.answerCbQuery("Esta apuesta ya se registró o el botón ha caducado.");
      return;
    }
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

/**
 * Cancela a mano cualquier /analizar que se haya quedado colgado (p. ej.
 * si el sondeo de Cloud Scheduler falla o no está bien configurado): borra
 * el job de Firestore sin más, para no tener que hacerlo desde Cloud
 * Shell cada vez. La investigación en los servidores de Gemini puede
 * seguir corriendo por su cuenta, pero al borrar el job el bot deja de
 * mirarla y ya no manda nada más sobre ella.
 */
async function cancelResearch(ctx: Context) {
  let jobs;
  try {
    jobs = await getUnresolvedResearchJobs();
  } catch (err) {
    console.error("No se pudieron obtener los análisis en curso:", err);
    await ctx.reply("⚠️ No se pudo comprobar si hay algún análisis en curso. Revisa los logs.");
    return;
  }

  if (jobs.length === 0) {
    await ctx.reply("No hay ningún análisis en curso ahora mismo.");
    return;
  }

  try {
    for (const job of jobs) {
      await deleteResearchJob(job.id);
    }
  } catch (err) {
    console.error("No se pudo cancelar el análisis:", err);
    await ctx.reply("⚠️ No se pudo cancelar. Revisa los logs.");
    return;
  }

  const label = jobs.length === 1 ? "El análisis en curso" : `Los ${jobs.length} análisis en curso`;
  await ctx.reply(`❌ ${label} se ha cancelado. Ya puedes lanzar /analizar de nuevo.`);
}

bot.command("cancelar", cancelResearch);
bot.hears(CANCELAR_BUTTON_TEXT, cancelResearch);

/** Lanzado desde fuera de Telegram (ver server.ts): /analizar de tenis automático a las 7:00. */
export async function runScheduledTennisAnalysis(): Promise<void> {
  const chatId = Number(env.telegramAllowedUserId);

  if (await hasUnresolvedResearchJob()) {
    await bot.telegram.sendMessage(
      chatId,
      "⏰ Análisis automático de tenis (7:00): ya había un Deep Research en curso, no se lanza otro."
    );
    return;
  }

  await bot.telegram.sendMessage(chatId, "⏰ Análisis automático de tenis (7:00) empezando...");
  try {
    await createAndStoreResearchJob(chatId, "tenis", { dateFilter: "hoy", scheduled: true });
  } catch (err) {
    console.error("No se pudo lanzar el análisis automático de tenis:", err);
    await bot.telegram.sendMessage(chatId, "⚠️ Ocurrió un error inesperado lanzando el análisis automático.");
  }
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

// Usuarios con un montaje ya en marcha ahora mismo: evita que un reenvío
// del mismo update por parte de Telegram (si la respuesta al webhook
// tarda, p. ej. porque Gemini va lento) dispare el montaje por duplicado.
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

  // step === "esperando_fondo"
  if (ticketProcessing.has(ctx.from.id)) return; // ya está montándose (posible reenvío de Telegram), se ignora
  ticketProcessing.add(ctx.from.id);
  lastBackground.set(ctx.from.id, photoBuffer);
  // Sin await a propósito: si esto tardara (Gemini lento), Telegram podría
  // reenviar el mismo update al no recibir respuesta a tiempo. Se deja
  // correr en segundo plano y el handler responde ya mismo.
  finishTicketMontage(ctx, ctx.from.id, state.ticketBuffer!, photoBuffer).catch((err) => {
    console.error("Fallo inesperado montando el ticket:", err);
    ticketProcessing.delete(ctx.from.id);
  });
});

bot.action("reusebg", async (ctx) => {
  const userId = ctx.from!.id;
  const state = montageState.get(userId);
  const background = lastBackground.get(userId);
  if (!state || state.step !== "esperando_fondo" || !background) {
    await ctx.answerCbQuery("Ya no aplica: manda la foto del ticket de nuevo con /ticket.");
    return;
  }
  if (ticketProcessing.has(userId)) {
    await ctx.answerCbQuery("Ya se está montando.");
    return;
  }
  ticketProcessing.add(userId);
  await ctx.answerCbQuery();
  await ctx.editMessageReplyMarkup(undefined);
  // Sin await a propósito, mismo motivo que en bot.on("photo").
  finishTicketMontage(ctx, userId, state.ticketBuffer!, background).catch((err) => {
    console.error("Fallo inesperado montando el ticket:", err);
    ticketProcessing.delete(userId);
  });
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
