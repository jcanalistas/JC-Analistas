import type { Context, Telegraf } from "telegraf";
import { Api } from "telegram";
import { computeCheck } from "telegram/Password";
import { formatPlayerHistory, formatRanking, escapeHtml } from "./format";
import {
  clearPendingLogin,
  getCursor,
  getEventsSince,
  getPendingLogin,
  getPlayerEvents,
  getUserSession,
  savePendingLogin,
  saveUserSession,
} from "./mtoStore";
import { normalizeName } from "./parseMto";
import { pollMtoChannel } from "./poll";
import { apiCredentials, connectClient, findChannel, mtoConfigured } from "./userbot";

export const MTO_BUTTON_TEXT = "🚑 MTO";

const NOT_CONFIGURED =
  "⚠️ El lector de MTO no está configurado: faltan TELEGRAM_API_ID y TELEGRAM_API_HASH en el servicio.";

// Paso del inicio de sesión de tu cuenta en el que está cada usuario.
type LoginStep = "phone" | "code" | "password";
const loginStep = new Map<number, LoginStep>();

export function registerMtoHandlers(bot: Telegraf) {
  // Va antes que el resto de manejadores de texto del bot: mientras hay un
  // inicio de sesión en marcha, los mensajes de texto son para él.
  bot.on("text", async (ctx, next) => {
    const step = loginStep.get(ctx.from.id);
    if (!step || ctx.message.text.startsWith("/")) return next();
    await handleLoginText(ctx, step, ctx.message.text);
  });

  bot.command("mto", async (ctx) => {
    const query = ctx.message.text.replace(/^\/mto(@\w+)?/, "").trim();
    await (query ? showPlayer(ctx, query) : showRanking(ctx));
  });
  bot.hears(MTO_BUTTON_TEXT, showRanking);
  bot.command("mto_estado", showStatus);
  bot.command("mto_leer", readNow);
  bot.command("mto_login", startLogin);
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
    const r = await pollMtoChannel(ctx.telegram);
    await ctx.reply(
      `✅ ${r.channel ?? "Canal"}: ${r.read} mensajes leídos, ${r.saved} asistencias nuevas guardadas, ` +
        `${r.alerts} alertas` +
        (r.unparsed ? `, ${r.unparsed} mensajes que no son avisos.` : ".") +
        (r.read >= 3000 ? "\nQuedan mensajes antiguos: vuelve a lanzar /mto_leer." : "")
    );
  } catch (err) {
    console.error("Fallo leyendo el canal de MTO:", err);
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
        await client.disconnect();
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
      await client.disconnect();
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

