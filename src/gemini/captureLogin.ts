/**
 * Script de un solo uso: abre un navegador VISIBLE para que inicies sesión
 * manualmente en tu cuenta de Google y quede activada la sesión de Gemini.
 * Al terminar, guarda las cookies/estado en storage/gemini-session.json.
 *
 * Ese archivo es lo que el bot (en modo headless, en Cloud Run) reutiliza
 * para entrar a Gemini ya logueado, sin manejar contraseñas ni 2FA en el
 * propio bot.
 *
 * Uso: npm run gemini:login
 */
import path from "node:path";
import fs from "node:fs";
import { chromium } from "playwright";

const STORAGE_DIR = path.join(process.cwd(), "storage");
const STORAGE_FILE = path.join(STORAGE_DIR, "gemini-session.json");

async function main() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("https://gemini.google.com/app");

  console.log("\n============================================================");
  console.log("Se abrió una ventana de Chromium.");
  console.log("1. Inicia sesión con la cuenta de Google que quieres usar para Gemini.");
  console.log("2. Completa cualquier verificación en dos pasos si te la pide.");
  console.log("3. Espera a ver el chat de Gemini cargado normalmente.");
  console.log("4. Vuelve aquí y pulsa ENTER en esta terminal para guardar la sesión.");
  console.log("============================================================\n");

  await waitForEnter();

  await context.storageState({ path: STORAGE_FILE });
  console.log(`\nSesión guardada en: ${STORAGE_FILE}`);
  console.log("Guarda este archivo como secreto (Secret Manager) para el despliegue en Cloud Run.");
  console.log("NUNCA lo subas al repositorio de git.\n");

  await browser.close();
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      resolve();
    });
  });
}

main().catch((err) => {
  console.error("Error capturando la sesión de Gemini:", err);
  process.exit(1);
});
