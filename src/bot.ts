import { Markup, Telegraf, type Context } from "telegraf";
import { env } from "./config/env";
import { buildAllPrompts, SPORT_LABELS, type Sport } from "./config/prompts";
import { runDeepResearch, DeepResearchError, type DeepResearchResult } from "./gemini/deepResearch";
import { parseSelections, findRepeatedSelections, type Selection } from "./matching/matchSelections";
import { formatIndividualSelections, formatRepeatedSelections } from "./format/telegramFormat";
import { composeMontage } from "./montage/composeMontage";

export const bot = new Telegraf(env.telegramBotToken);

let researchInProgress = false;

// Botones fijos debajo del teclado, siempre visibles, en este orden.
const START_BUTTON_TEXT = "🏠 Empezar";
const RESEARCH_BUTTON_TEXT = "🔍 Analizar";
const TICKET_BUTTON_TEXT = "📸 Ticket";
const mainKeyboard = Markup.keyboard([
  [START_BUTTON_TEXT, RESEARCH_BUTTON_TEXT, TICKET_BUTTON_TEXT],
]).resize();

bot.use(async (ctx, next) => {
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
      "📸 Ticket — te pide la foto del ticket y una foto de fondo, y te devuelve el montaje.",
    mainKeyboard
  );
}

bot.start(sendWelcome);
bot.hears(START_BUTTON_TEXT, sendWelcome);

async function startResearchFlow(ctx: Context) {
  if (researchInProgress) {
    await ctx.reply("Ya hay un Deep Research en curso, espera a que termine antes de lanzar otro.");
    return;
  }

  await ctx.reply(
    "¿Qué deporte analizamos?",
    Markup.inlineKeyboard([
      Markup.button.callback(SPORT_LABELS.futbol, "research:futbol"),
      Markup.button.callback(SPORT_LABELS.tenis, "research:tenis"),
    ])
  );
}

bot.command("analizar", startResearchFlow);
bot.hears(RESEARCH_BUTTON_TEXT, startResearchFlow);

bot.action(/^research:(futbol|tenis)$/, async (ctx) => {
  const sport = ctx.match[1] as Sport;

  if (researchInProgress) {
    await ctx.answerCbQuery("Ya hay un Deep Research en curso.");
    return;
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText(`Deporte elegido: ${SPORT_LABELS[sport]}`);

  researchInProgress = true;
  try {
    await ctx.reply(
      `🔎 Lanzando los 3 Deep Research de ${SPORT_LABELS[sport]} en Gemini, te aviso según vaya terminando cada uno.`
    );

    const promptDefs = buildAllPrompts(sport);
    const labels = promptDefs.map((def) => def.label);
    // En paralelo: cada uno es una llamada de API independiente (no hay
    // ninguna sesión de navegador compartida que pueda saturarse).
    const results: DeepResearchResult[] = await Promise.all(
      promptDefs.map(async ({ label, prompt }) => {
        const result = await runDeepResearch(prompt, {
          apiKey: env.geminiApiKey,
          agent: env.geminiDeepResearchAgent,
          timeoutMinutes: env.deepResearchTimeoutMinutes,
        });
        await ctx.reply(`✅ ${label} completado.`);
        return result;
      })
    );

    const selectionsBySource: Selection[][] = results.map((r, idx) =>
      parseSelections(r.reportText, idx, labels[idx])
    );

    for (const chunk of formatIndividualSelections(labels, selectionsBySource)) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }

    const allSelections = selectionsBySource.flat();
    const repeatedGroups = findRepeatedSelections(allSelections);

    for (const chunk of formatRepeatedSelections(repeatedGroups)) {
      await ctx.reply(chunk, { parse_mode: "Markdown" });
    }
  } catch (err) {
    if (err instanceof DeepResearchError) {
      await ctx.reply(`⚠️ Error ejecutando Deep Research: ${err.message}`);
    } else {
      console.error(err);
      await ctx.reply("⚠️ Ocurrió un error inesperado ejecutando los Deep Research. Revisa los logs.");
    }
  } finally {
    researchInProgress = false;
  }
});

// --- /ticket: superpone la foto del ticket sobre una foto de fondo ---

interface MontageState {
  step: "esperando_ticket" | "esperando_fondo";
  ticketBuffer?: Buffer;
}
const montageState = new Map<number, MontageState>();

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
    await ctx.reply("🖼️ Ticket recibido. Ahora mándame la foto de fondo.");
    return;
  }

  // step === "esperando_fondo"
  await ctx.reply("🎨 Montando la imagen…");
  try {
    const result = await composeMontage(state.ticketBuffer!, photoBuffer);
    await ctx.replyWithPhoto({ source: result });
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ No se pudo generar el montaje. Revisa que ambas fotos sean válidas e inténtalo de nuevo con /ticket.");
  } finally {
    montageState.delete(ctx.from.id);
  }
});
