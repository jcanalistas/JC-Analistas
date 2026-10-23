import express from "express";
import { bot } from "./bot";
import { env } from "./config/env";
import { pollMtoChannel } from "./mto/poll";

// Red de seguridad: sin esto, un rechazo de promesa no capturado en
// cualquier dependencia tumba TODO el proceso. Lo registramos y seguimos
// vivos en vez de morir.
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

// Lo llama Cloud Scheduler cada pocos minutos: lee los avisos nuevos del
// canal de lesiones y manda las alertas de patrones. Protegido por la misma
// ruta secreta que el webhook.
app.post(`/mto/poll/${env.webhookSecretPath}`, async (_req, res) => {
  try {
    const result = await pollMtoChannel(bot.telegram);
    res.status(200).json(result);
  } catch (err) {
    console.error("Fallo leyendo el canal de MTO:", err);
    res.status(500).json({ error: (err as Error).message });
  }
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
