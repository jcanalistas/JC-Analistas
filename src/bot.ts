import { Markup, Telegraf, type Context } from "telegraf";
import { env } from "./config/env";
import { buildAllPrompts, SPORT_LABELS, type Sport } from "./config/prompts";
import { runDeepResearch, DeepResearchError, type DeepResearchResult } from "./gemini/deepResearch";
import { parseSelections, findRepeatedSelections, type Selection } from "./matching/matchSelections";
import { formatIndividualSelections, formatRepeatedSelections } from "./format/telegramFormat";

export const bot = new Telegraf(env.telegramBotToken);

let researchInProgress = false;

// Botón fijo debajo del teclado, siempre visible, alternativa a escribir /research.
const RESEARCH_BUTTON_TEXT = "🔎 Research";
const mainKeyboard = Markup.keyboard([[RESEARCH_BUTTON_TEXT]]).resize();

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id?.toString();
  if (userId !== env.telegramAllowedUserId) {
    await ctx.reply("No tienes autorización para usar este bot.");
    return;
  }
  return next();
});

bot.start((ctx) =>
  ctx.reply(
    "Bot de JC Analistas listo.\n\nToca el botón de abajo (o escribe /research) para lanzar los 3 Deep Research en Gemini y comparar las selecciones.",
    mainKeyboard
  )
);

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

bot.command("research", startResearchFlow);
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
      `🔎 Lanzando los 3 Deep Research de ${SPORT_LABELS[sport]} en Gemini, uno detrás de otro. Cada uno puede tardar bastantes minutos — te aviso según vaya terminando cada uno.`
    );

    const promptDefs = buildAllPrompts(sport);
    const results: DeepResearchResult[] = [];
    const labels: string[] = [];
    for (let i = 0; i < promptDefs.length; i++) {
      const { label, prompt } = promptDefs[i];
      const result = await runDeepResearch(prompt, {
        storageStatePath: env.geminiStorageStatePath,
        timeoutMinutes: env.deepResearchTimeoutMinutes,
      });
      results.push(result);
      labels.push(label);
      await ctx.reply(`✅ ${label} (${i + 1}/${promptDefs.length}) completado.`);
    }

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
      if (err.screenshot) {
        await ctx.replyWithPhoto(
          { source: err.screenshot },
          { caption: "Captura del navegador en el momento del fallo" }
        );
      }
    } else {
      console.error(err);
      await ctx.reply("⚠️ Ocurrió un error inesperado ejecutando los Deep Research. Revisa los logs.");
    }
  } finally {
    researchInProgress = false;
  }
});
