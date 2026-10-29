import { Markup, type Context, type Telegraf } from "telegraf";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import {
  formatPlayerHistory,
  formatRanking,
  formatRepeaters,
  formatTournaments,
  formatWatchlist,
  escapeHtml,
  splitMessage,
} from "./format";
import {
  clearPendingLogin,
  getAllEventsSince,
  getCursor,
  getEventsSince,
  getPendingLogin,
  getPlayerEvents,
  getUserSession,
  savePendingLogin,
  saveUserSession,
} from "./mtoStore";
import { normalizeName } from "./parseMto";
import { buildWatchlist, findUnparsedMessages, pollMtoChannel } from "./poll";
import { apiCredentials, connectClient, findChannel, mtoConfigured } from "./userbot";

export const MTO_BUTTON_TEXT = "🚑 MTO";

const NOT_CONFIGURED =
  "⚠️ El lector de MTO no está configurado: faltan TELEGRAM_API_ID y TELEGRAM_API_HASH en el servicio.";

// Paso del inicio de sesión de tu cuenta en el que está cada usuario.
type LoginStep = "phone" | "code" | "password";
const loginStep = new Map<number, LoginStep>();
// Usuarios que han pulsado "🔎 Buscar jugador" y deben mandar el nombre.
const awaitingPlayerSearch = new Set<number>();

function menuKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔄 Leer canal", "mto:leer"), Markup.button.callback("🔁 Quién repite", "mto:repiten")],
    [Markup.button.callback("👀 Todos los atendidos", "mto:vigilar"), Markup.button.callback("📊 Ranking", "mto:ranking")],
    [Markup.button.callback("🔎 Buscar jugador", "mto:buscar"), Markup.button.callback("🏷️ Torneos", "mto:torneos")],
    [Markup.button.callback("⚙️ Estado", "mto:estado"), Markup.button.callback("🧩 Mensajes raros", "mto:raros")],
    [Markup.button.callback("🔐 Conectar cuenta", "mto:login")],
  ]);
}

async function showMenu(ctx: Context) {
  await ctx.reply(
    "🚑 <b>Asistencias médicas (MTO)</b>\n\n" +
      "🔄 Leer canal — trae los avisos nuevos y te da el resumen de quién repite\n" +
      "🔁 Quién repite — repiten asistencia en los últimos 14 días\n" +
      "👀 Todos los atendidos — últimos 14 días\n" +
      "📊 Ranking — 2+ asistencias en 7 y 30 días\n" +
      "🔎 Buscar jugador — historial de un jugador\n" +
      "🏷️ Torneos — qué torneos entran en el análisis y cuáles se descartan",
    { parse_mode: "HTML", ...menuKeyboard() }
  );
}

async function askPlayerName(ctx: Context) {
  awaitingPlayerSearch.add(ctx.from!.id);
  await ctx.reply("🔎 Escribe el nombre del jugador (vale solo el apellido).");
}

export function registerMtoHandlers(bot: Telegraf) {
  // Va antes que el resto de manejadores de texto del bot: mientras hay un
  // inicio de sesión en marcha, los mensajes de texto son para él.
  bot.on("text", async (ctx, next) => {
    const text = ctx.message.text;
    // Un comando o un botón del teclado (empiezan por "/" o por emoji, no
    // por letra) cancela la búsqueda en vez de tomarse como nombre.
    if (!/^\p{L}/u.test(text.trim())) awaitingPlayerSearch.delete(ctx.from.id);
    if (text.startsWith("/")) return next();
    if (awaitingPlayerSearch.delete(ctx.from.id)) {
      await showPlayer(ctx, text.trim());
      return;
    }
    const step = loginStep.get(ctx.from.id);
    if (!step) return next();
    await handleLoginText(ctx, step, text);
  });

  // Botones del menú 🚑 MTO: cada uno hace lo mismo que su comando.
  const menuActions: Record<string, (ctx: Context) => Promise<void>> = {
    leer: readNow,
    repiten: showRepeaters,
    vigilar: showWatchlist,
    ranking: showRanking,
    buscar: askPlayerName,
    estado: showStatus,
    raros: showUnparsed,
    login: startLogin,
    torneos: showTournaments,
  };
  bot.action(/^mto:(\w+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    await menuActions[ctx.match[1]]?.(ctx);
  });

  bot.command("mto", async (ctx) => {
    const query = ctx.message.text.replace(/^\/mto(@\w+)?/, "").trim();
    await (query ? showPlayer(ctx, query) : showRanking(ctx));
  });
  bot.hears(MTO_BUTTON_TEXT, showMenu);
  bot.command("mto_vigilar", showWatchlist);
  bot.command("mto_repiten", showRepeaters);
  bot.command("mto_estado", showStatus);
  bot.command("mto_leer", readNow);
  bot.command("mto_login", startLogin);
  bot.command("mto_raros", showUnparsed);
  bot.command("mto_torneos", showTournaments);
  bot.command("mto_cancelar", async (ctx) => {
    loginStep.delete(ctx.from.id);
    await clearPendingLogin().catch(() => undefined);
    await ctx.reply("Inicio de sesión cancelado.");
  });
}

async function showRanking(ctx: Context) {
  try {
    const events = await getEventsSince(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await ctx.reply(formatRanking(events), { parse_mode: "HTML" });
  } catch (err) {
    console.error("No se pudo sacar el ranking de MTO:", err);
    await ctx.reply("⚠️ No se pudo sacar el ranking. Revisa los logs.");
  }
}

const WATCHLIST_DAYS = 14;

async function showWatchlist(ctx: Context) {
  try {
    const text = formatWatchlist(await buildWatchlist(WATCHLIST_DAYS), WATCHLIST_DAYS);
    for (const chunk of splitMessage(text)) await ctx.reply(chunk, { parse_mode: "HTML" });
  } catch (err) {
    console.error("No se pudo sacar la lista de vigilancia de MTO:", err);
    await ctx.reply("⚠️ No se pudo sacar la lista. Revisa los logs.");
  }
}

async function showRepeaters(ctx: Context) {
  try {
    const text = formatRepeaters(await buildWatchlist(WATCHLIST_DAYS), WATCHLIST_DAYS);
    for (const chunk of splitMessage(text)) await ctx.reply(chunk, { parse_mode: "HTML" });
  } catch (err) {
    console.error("No se pudo sacar la lista de jugadores que repiten MTO:", err);
    await ctx.reply("⚠️ No se pudo sacar la lista. Revisa los logs.");
  }
}

async function showTournaments(ctx: Context) {
  try {
    const days = 7;
    const events = await getAllEventsSince(Date.now() - days * 24 * 60 * 60 * 1000);
    for (const chunk of splitMessage(formatTournaments(events, days))) await ctx.reply(chunk, { parse_mode: "HTML" });
  } catch (err) {
    console.error("No se pudo sacar la lista de torneos de MTO:", err);
    await ctx.reply("⚠️ No se pudo sacar la lista. Revisa los logs.");
  }
}

async function showPlayer(ctx: Context, query: string) {
  try {
    const key = normalizeName(query);
    let events = await getPlayerEvents(key);
    if (!events.length) {
      // Búsqueda parcial ("brain" -> "lachlan brain") sobre el último año.
      const lastYear = await getEventsSince(Date.now() - 365 * 24 * 60 * 60 * 1000);
      events = lastYear.filter((e) => e.playerKey.includes(key));
    }
    const players = new Map(events.map((e) => [e.playerKey, e.player]));
    if (!players.size) {
      await ctx.reply(`No hay asistencias médicas registradas para "${query}".`);
      return;
    }
    if (players.size > 1) {
      await ctx.reply(
        "Hay varios jugadores que coinciden. Escribe el nombre completo:\n" +
          [...players.values()].slice(0, 20).map((p) => `• /mto ${p}`).join("\n")
      );
      return;
    }
    await ctx.reply(formatPlayerHistory(events), { parse_mode: "HTML" });
  } catch (err) {
    console.error("No se pudo sacar el historial de MTO:", err);
    await ctx.reply("⚠️ No se pudo sacar el historial. Revisa los logs.");
  }
}

async function showStatus(ctx: Context) {
  if (!mtoConfigured()) {
    await ctx.reply(NOT_CONFIGURED);
    return;
  }
  const [session, cursor] = await Promise.all([getUserSession(), getCursor()]);
  const lines = [
    "🚑 <b>Lector de MTO</b>",
    `Sesión de tu cuenta: ${session ? "✅ iniciada" : "❌ falta /mto_login"}`,
    `Canal: ${cursor.channelTitle ? escapeHtml(cursor.channelTitle) : "— (se busca en la primera lectura)"}`,
    `Último mensaje leído: ${cursor.lastMessageId || "—"}`,
  ];
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

async function readNow(ctx: Context) {
  if (!mtoConfigured()) {
    await ctx.reply(NOT_CONFIGURED);
    return;
  }
  await ctx.reply("⏳ Leyendo el canal de lesiones…");
  try {
    const r = await pollMtoChannel();
    const day = (ms: number) =>
      new Date(ms).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit" });
    const range = r.from && r.to ? ` (del ${day(r.from)} al ${day(r.to)})` : "";
    await ctx.reply(
      `✅ ${r.channel ?? "Canal"}: ${r.read} mensajes nuevos leídos${range}.\n\n` +
        `🚑 ${r.saved} asistencias nuevas: ${r.atp} ATP, ${r.challenger} Challenger y ` +
        `${r.saved - r.atp - r.challenger} descartadas (UTR, ITF, femenino).` +
        (r.unparsed ? `\n${r.unparsed} mensajes que no son avisos.` : "") +
        (r.more ? "\n\n⏩ Quedan más mensajes por leer: pulsa otra vez." : "\n\n✔️ Canal al día."),
      r.more ? Markup.inlineKeyboard([Markup.button.callback("🔄 Seguir leyendo", "mto:leer")]) : undefined
    );
    // El resumen de quién repite solo tiene sentido con el canal al día.
    if (!r.more) await showRepeaters(ctx);
  } catch (err) {
    console.error("Fallo leyendo el canal de MTO:", err);
    await ctx.reply(`⚠️ ${(err as Error).message}`);
  }
}

async function showUnparsed(ctx: Context) {
  if (!mtoConfigured()) {
    await ctx.reply(NOT_CONFIGURED);
    return;
  }
  try {
    const groups = await findUnparsedMessages(1000);
    if (!groups.length) {
      await ctx.reply("✅ En los últimos 1000 mensajes del canal todos son avisos de asistencia médica.");
      return;
    }
    const lines = ["🔎 <b>Mensajes del canal que no son avisos</b> (últimos 1000 mensajes)", ""];
    for (const g of groups.slice(0, 10)) {
      lines.push(`<b>${g.count}×</b>`, `<pre>${escapeHtml(g.example.slice(0, 300))}</pre>`, "");
    }
    for (const chunk of splitMessage(lines.join("\n"))) await ctx.reply(chunk, { parse_mode: "HTML" });
  } catch (err) {
    console.error("Fallo buscando mensajes no reconocidos:", err);
    await ctx.reply(`⚠️ ${(err as Error).message}`);
  }
}

async function startLogin(ctx: Context) {
  if (!mtoConfigured()) {
    await ctx.reply(NOT_CONFIGURED);
    return;
  }
  loginStep.set(ctx.from!.id, "phone");
  await ctx.reply(
    "🔐 Vamos a conectar TU cuenta de Telegram para leer el canal de lesiones (solo lectura).\n\n" +
      "Mándame tu número con prefijo, p.ej. +34600111222.\n/mto_cancelar para salir."
  );
}

async function handleLoginText(ctx: Context, step: LoginStep, text: string) {
  const userId = ctx.from!.id;
  try {
    if (step === "phone") {
      const phone = text.replace(/[^\d+]/g, "");
      const client = await connectClient();
      try {
        const { phoneCodeHash } = await client.sendCode(apiCredentials(), phone);
        await savePendingLogin({ phone, phoneCodeHash, session: client.session.save() as unknown as string });
      } finally {
        await client.destroy();
      }
      loginStep.set(userId, "code");
      await ctx.reply(
        "📩 Te ha llegado un código en Telegram (chat \"Telegram\").\n\n" +
          "Mándamelo con letras o espacios en medio, p.ej. <code>1a2b3c4d5</code>: si lo envías tal cual, " +
          "Telegram detecta que lo compartes y lo anula.",
        { parse_mode: "HTML" }
      );
      return;
    }

    const login = await getPendingLogin();
    if (!login) {
      loginStep.delete(userId);
      await ctx.reply("⚠️ El inicio de sesión caducó. Vuelve a empezar con /mto_login.");
      return;
    }

    const client = await connectClient(login.session);
    try {
      if (step === "code") {
        const phoneCode = text.replace(/\D/g, "");
        try {
          await client.invoke(
            new Api.auth.SignIn({ phoneNumber: login.phone, phoneCodeHash: login.phoneCodeHash, phoneCode })
          );
        } catch (err) {
          if ((err as { errorMessage?: string }).errorMessage !== "SESSION_PASSWORD_NEEDED") throw err;
          loginStep.set(userId, "password");
          await ctx.reply("🔑 Tu cuenta tiene verificación en dos pasos. Mándame la contraseña (la borro del chat).");
          return;
        }
      } else {
        await ctx.deleteMessage().catch(() => undefined);
        const srp = await client.invoke(new Api.account.GetPassword());
        await client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(srp, text) }));
      }

      await saveUserSession(client.session.save() as unknown as string);
      await clearPendingLogin();
      loginStep.delete(userId);
      const channel = await findChannel(client);
      await ctx.reply(
        "✅ Cuenta conectada.\n" +
          (channel
            ? `Canal encontrado: ${channel.title}\n\nLanza /mto_leer para cargar el historial.`
            : "⚠️ Pero no encuentro el canal de lesiones entre tus chats. Revisa MTO_CHANNEL_TITLE.")
      );
    } finally {
      await client.destroy();
    }
  } catch (err) {
    const code = (err as { errorMessage?: string }).errorMessage;
    console.error("Fallo en /mto_login:", err);
    if (code === "PHONE_CODE_INVALID" || code === "PASSWORD_HASH_INVALID") {
      await ctx.reply("❌ Incorrecto, prueba otra vez (o /mto_cancelar).");
      return;
    }
    loginStep.delete(userId);
    await ctx.reply(`⚠️ No se pudo iniciar sesión (${code ?? (err as Error).message}). Empieza otra vez con /mto_login.`);
  }
}

