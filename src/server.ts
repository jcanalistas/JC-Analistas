import express from "express";
import { bot, runScheduledTennisAnalysis } from "./bot";
import { env } from "./config/env";

// Red de seguridad: sin esto, un rechazo de promesa no capturado en
// cualquier dependencia (p.ej. un timeout interno del SDK de Gemini)
// tumba TODO el proceso — incluidos los /research de otros usuarios en
// curso. Lo registramos y seguimos vivos en vez de morir.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection (proceso sigue vivo):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception (proceso sigue vivo):", err);
});

const app = express();
app.use(express.json());

const webhookPath = `/telegram/${env.webhookSecretPath}`;

app.get("/", (_req, res) => {
  res.status(200).send("JC Analistas bot activo.");
});

app.use(bot.webhookCallback(webhookPath));

// Lo llama Cloud Scheduler todos los días a las 7:00 (hora de España) para
// lanzar el /analizar de tenis automáticamente. Responde rápido y sigue en
// segundo plano: Cloud Scheduler no necesita esperar a que termine el
// Deep Research (puede tardar varios minutos).
app.post("/internal/auto-analizar-tenis", (req, res) => {
  const secret = req.query.secret ?? req.get("X-Auto-Secret");
  if (secret !== env.autoAnalizarSecret) {
    res.status(401).send("unauthorized");
    return;
  }
  res.status(202).send("ok");
  runScheduledTennisAnalysis().catch((err) => {
    console.error("El análisis automático de tenis falló:", err);
  });
});

async function main() {
  if (env.publicUrl) {
    const webhookUrl = `${env.publicUrl.replace(/\/$/, "")}${webhookPath}`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log(`Webhook registrado en: ${webhookUrl}`);
  } else {
    console.warn(
      "PUBLIC_URL no está definida todavía: arrancando sin registrar el webhook de Telegram. " +
        "Añade PUBLIC_URL y vuelve a desplegar en cuanto tengas la URL de este servicio."
    );
  }

  app.listen(env.port, () => {
    console.log(`Servidor escuchando en el puerto ${env.port}`);
  });
}

main().catch((err) => {
  console.error("Error iniciando el servidor:", err);
  process.exit(1);
});
