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
  const webhookUrl = `${env.publicUrl.replace(/\/$/, "")}${webhookPath}`;
  await bot.telegram.setWebhook(webhookUrl);
  console.log(`Webhook registrado en: ${webhookUrl}`);

  app.listen(env.port, () => {
    console.log(`Servidor escuchando en el puerto ${env.port}`);
  });
}

main().catch((err) => {
  console.error("Error iniciando el servidor:", err);
  process.exit(1);
});
