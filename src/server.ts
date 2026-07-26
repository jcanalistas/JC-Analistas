import express from "express";
import { bot } from "./bot";
import { env } from "./config/env";

const app = express();
app.use(express.json());

const webhookPath = `/telegram/${env.webhookSecretPath}`;

app.get("/", (_req, res) => {
  res.status(200).send("JC Analistas bot activo.");
});

app.use(bot.webhookCallback(webhookPath));

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
